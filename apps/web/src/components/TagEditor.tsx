import { useState } from 'react'
import type { Tag } from '@selfmp3/shared'
import { useDeleteTag, useRenameTag, useSetTagHue } from '../lib/queries.js'
import { Check, Minus, Plus, Trash } from './Icons.js'
import { Popover } from './Menu.js'

/**
 * Everything you can do to a tag itself: rename it, recolour it, filter by it
 * either way, and delete it.
 *
 * Tags are the library's only way of being browsed, so their names and colours
 * are how you find things — and until this existed both were fixed at
 * creation, with delete the only change on offer.
 *
 * The same dialog serves the sidebar's ⋯ on a desktop and a long press on a
 * tag chip on a phone, where it presents as a bottom sheet.
 */

/**
 * Twelve hues around the wheel, skipping the muddy stretch between yellow and
 * green where tag chips stop looking like different colours from each other.
 */
const HUES = [0, 22, 40, 58, 95, 140, 168, 192, 212, 235, 262, 290, 318] as const

export type TagFilterState = 'off' | 'include' | 'exclude'

export function TagEditor({
  anchorRef,
  tag,
  filter,
  onInclude,
  onExclude,
  onDeleted,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  tag: Tag
  /** How this tag is filtering the library right now. */
  filter: TagFilterState
  /** Toggle "only songs with this tag". */
  onInclude: () => void
  /** Toggle "hide songs with this tag". */
  onExclude: () => void
  onDeleted?: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(tag.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const rename = useRenameTag()
  const setHue = useSetTagHue()
  const deleteTag = useDeleteTag()

  const trimmed = name.trim()
  const changed = trimmed.length > 0 && trimmed !== tag.name
  // A tag made before the palette existed has a hue of its own; it leads the
  // row so the current colour is always one of the choices.
  const hues = HUES.some(hue => hue === tag.hue) ? HUES : [tag.hue, ...HUES]

  const submit = (event: React.FormEvent): void => {
    event.preventDefault()
    if (!changed) return
    rename.mutate({ id: tag.id, name: trimmed })
  }

  return (
    <Popover
      anchorRef={anchorRef}
      onClose={onClose}
      role="dialog"
      label={`Edit tag ${tag.name}`}
      className="tag-editor"
      focus="trap"
      sheet
    >
      <div className="popover-title">
        <span className="tag-dot" style={{ '--tag-hue': tag.hue } as React.CSSProperties} />
        Tag <strong>{tag.name}</strong>
        <span className="hint-inline">
          {tag.songCount} {tag.songCount === 1 ? 'song' : 'songs'}
        </span>
      </div>

      <div className="tag-editor-filters" role="group" aria-label="Filter the library">
        <button
          type="button"
          className={`tag-editor-filter ${filter === 'include' ? 'is-on' : ''}`}
          aria-pressed={filter === 'include'}
          onClick={() => {
            onInclude()
            onClose()
          }}
        >
          <Plus size={14} /> Show only these
        </button>
        <button
          type="button"
          className={`tag-editor-filter ${filter === 'exclude' ? 'is-on is-exclude' : ''}`}
          aria-pressed={filter === 'exclude'}
          onClick={() => {
            onExclude()
            onClose()
          }}
        >
          <Minus size={14} /> Hide these
        </button>
      </div>

      <form className="tag-editor-name" onSubmit={submit}>
        <label className="field-label" htmlFor={`tag-name-${tag.id}`}>
          Name
        </label>
        <div className="tag-editor-name-row">
          <input
            id={`tag-name-${tag.id}`}
            className="popover-input"
            value={name}
            onChange={event => {
              setName(event.target.value)
              rename.reset()
            }}
            spellCheck={false}
            autoComplete="off"
            maxLength={40}
          />
          <button
            type="submit"
            className="button button-small button-primary"
            disabled={!changed || rename.isPending}
          >
            {rename.isSuccess && !changed ? <Check size={13} /> : 'Rename'}
          </button>
        </div>
        {rename.error && <p className="field-error">{rename.error.message}</p>}
      </form>

      <div className="tag-editor-colours">
        <span className="field-label">Colour</span>
        <div className="tag-swatches" role="radiogroup" aria-label="Tag colour">
          {hues.map(hue => (
            <button
              key={hue}
              type="button"
              role="radio"
              aria-checked={tag.hue === hue}
              aria-label={`Hue ${hue}`}
              className={`tag-swatch ${tag.hue === hue ? 'is-on' : ''}`}
              style={{ '--tag-hue': hue } as React.CSSProperties}
              onClick={() => setHue.mutate({ id: tag.id, hue })}
            >
              {tag.hue === hue && <Check size={12} />}
            </button>
          ))}
        </div>
      </div>

      <div className="popover-divider" />

      {!confirmingDelete ? (
        <button
          type="button"
          className="popover-item is-danger"
          onClick={() => setConfirmingDelete(true)}
        >
          <Trash size={15} /> Delete tag…
        </button>
      ) : (
        <div className="popover-confirm">
          <p className="hint">
            Delete &ldquo;{tag.name}&rdquo;? Its {tag.songCount}{' '}
            {tag.songCount === 1 ? 'song stays' : 'songs stay'} in your library.
          </p>
          <button
            type="button"
            className="popover-item is-danger"
            onClick={() => {
              deleteTag.mutate(tag.id)
              onDeleted?.()
              onClose()
            }}
          >
            <Trash size={15} /> Delete tag
          </button>
          <button type="button" className="popover-item" onClick={() => setConfirmingDelete(false)}>
            Cancel
          </button>
        </div>
      )}
    </Popover>
  )
}
