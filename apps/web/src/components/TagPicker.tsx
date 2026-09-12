import { useMemo, useRef, useState } from 'react'
import { fuzzyRank, type Song, type Tag } from '@selfmp3/shared'
import { useCreateTag, useSetSongTags } from '../lib/queries.js'
import { Check, Plus } from './Icons.js'
import { Popover, type LayerPlacement } from './Menu.js'
import { showToast } from './Toast.js'

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
  anchorRef,
  song,
  allTags,
  onClose,
  placement,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  song: Song
  allTags: readonly Tag[]
  onClose: () => void
  /** `above` for a trigger at the bottom of the screen, like the player bar. */
  placement?: LayerPlacement
}) {
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set(song.tagIds))
  const setSongTags = useSetSongTags()

  return (
    <TagPickerPanel
      anchorRef={anchorRef}
      title={
        <>
          Tags for <strong>{song.title}</strong>
        </>
      }
      allTags={allTags}
      selected={selected}
      onChange={next => {
        setSelected(next)
        setSongTags.mutate({ songId: song.id, tagIds: [...next] })
      }}
      onClose={onClose}
      placement={placement}
    />
  )
}

/**
 * The picker itself, for any set of tags: a song's, or the ones a batch of
 * songs about to be imported will get. It only reports the new set; what it
 * is applied to is the caller's business.
 */
export function TagPickerPanel({
  anchorRef,
  title,
  allTags,
  selected,
  onChange,
  onClose,
  placement,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  title: React.ReactNode
  allTags: readonly Tag[]
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
  onClose: () => void
  placement?: LayerPlacement
}) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  // Creating waits on the server; a tag ticked meanwhile must survive it.
  const selectedRef = useRef(selected)
  selectedRef.current = selected

  const createTag = useCreateTag()

  const ranked = useMemo(() => fuzzyRank(query, allTags, tag => tag.name), [query, allTags])
  const hasExact = ranked.some(match => match.exact)
  const trimmed = query.trim()

  const toggle = (tagId: number): void => {
    const next = new Set(selected)
    if (next.has(tagId)) next.delete(tagId)
    else next.add(tagId)
    onChange(next)
  }

  const create = async (): Promise<void> => {
    if (!trimmed || createTag.isPending) return
    let tag: Tag
    try {
      tag = await createTag.mutateAsync(trimmed)
    } catch (error) {
      // The name stays in the box, so trying again is one keystroke.
      showToast(`Couldn’t create “${trimmed}”: ${(error as Error).message}`, 'error')
      return
    }
    setQuery('')
    onChange(new Set([...selectedRef.current, tag.id]))
    inputRef.current?.focus()
  }

  const onSubmit = (event: React.FormEvent): void => {
    event.preventDefault()
    // With nothing typed there is no best match to pick — ranking an empty
    // query returns the whole list, and Enter would silently put the first tag
    // in it on the song.
    if (!trimmed) return
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
    <Popover
      anchorRef={anchorRef}
      onClose={onClose}
      role="dialog"
      label="Edit tags"
      className="tag-picker"
      focus="trap"
      placement={placement}
      sheet
    >
      <div className="popover-title">{title}</div>

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
    </Popover>
  )
}
