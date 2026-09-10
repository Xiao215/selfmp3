import { useMemo, useRef, useState } from 'react'
import { fuzzyRank, type Song, type Tag } from '@selfmp3/shared'
import { useCreateTag, useSetSongTags } from '../lib/queries.js'
import { useClickOutside } from '../lib/hooks.js'
import { Check, Plus } from './Icons.js'

/**
 * Attach tags to a song.
 *
 * The design goal is that tagging never interrupts listening: the picker
 * filters as you type, Enter applies the best match, and creating a new tag is
 * always one keystroke away — but a near-match is surfaced first, because the
 * usual failure mode of free-form tagging is ending up with "chill", "Chill"
 * and "chilled" as three separate tags.
 */
export function TagPicker({
  song,
  allTags,
  onClose,
}: {
  song: Song
  allTags: readonly Tag[]
  onClose: () => void
}) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set(song.tagIds))
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const setSongTags = useSetSongTags()
  const createTag = useCreateTag()

  const containerRef = useClickOutside<HTMLDivElement>(onClose)

  const ranked = useMemo(() => fuzzyRank(query, allTags, tag => tag.name), [query, allTags])
  const hasExact = ranked.some(match => match.exact)
  const trimmed = query.trim()

  const apply = (next: ReadonlySet<number>): void => {
    setSelected(next)
    setSongTags.mutate({ songId: song.id, tagIds: [...next] })
  }

  const toggle = (tagId: number): void => {
    const next = new Set(selected)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    apply(next)
  }

  const create = async (): Promise<void> => {
    if (!trimmed) return
    const tag = await createTag.mutateAsync(trimmed)
    setQuery('')
    apply(new Set([...selected, tag.id]))
    inputRef.current?.focus()
  }

  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    // Enter picks the best match; it only creates when nothing matches at all.
    const best = ranked[0]
    if (best) {
      toggle(best.item.id)
      setQuery('')
    } else {
      void create()
    }
  }

  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover tag-picker" ref={containerRef} role="dialog" aria-label="Edit tags">
        <div className="popover-title">
          Tags for <strong>{song.title}</strong>
        </div>

        <form onSubmit={onSubmit}>
          <input
            ref={inputRef}
            className="popover-input"
            autoFocus
            value={query}
            placeholder="Search or create a tag…"
            onChange={event => setQuery(event.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
        </form>

        <div className="popover-list">
          {ranked.map(({ item }) => (
            <button
              key={item.id}
              type="button"
              className="popover-item"
              onClick={() => {
                toggle(item.id)
                setQuery('')
              }}
            >
              <span className={`checkbox ${selected.has(item.id) ? 'is-on' : ''}`}>
                {selected.has(item.id) && <Check size={12} />}
              </span>
              <span className="tag-dot" style={{ '--tag-hue': item.hue } as React.CSSProperties} />
              {item.name}
              <span className="popover-item-count">{item.songCount}</span>
            </button>
          ))}

          {ranked.length === 0 && !trimmed && (
            <p className="hint">No tags yet — type a name to create your first one.</p>
          )}
        </div>

        {trimmed && !hasExact && (
          <button type="button" className="popover-item popover-create" onClick={() => void create()}>
            <Plus size={14} />
            Create <strong>{trimmed}</strong>
            {ranked[0] && <span className="hint-inline">similar: {ranked[0].item.name}</span>}
          </button>
        )}
      </div>
    </>
  )
}
