import { useRef, useState } from 'react'
import type { Tag } from '@selfmp3/shared'
import { TagPlus } from './Icons.js'
import { TagChip } from './TagChip.js'
import { TagPickerPanel } from './TagPicker.js'

/**
 * Tags for songs that are not in the library yet — an import, a migration.
 * The choice is only held here; whoever runs the import applies it.
 *
 * Only the chosen tags are on show, so the row stays one line however many
 * tags the library has. The rest are in the same picker a song uses: search
 * as you type, and a tag that does not exist yet is made on the spot — the
 * tag for a new batch is often exactly that.
 */
export function TagChooser({
  tags,
  selected,
  onChange,
  title = 'Tag these songs',
}: {
  tags: readonly Tag[]
  selected: ReadonlySet<number>
  onChange: (next: ReadonlySet<number>) => void
  title?: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const chosen = tags.filter(tag => selected.has(tag.id))

  const remove = (id: number): void => {
    const next = new Set(selected)
    next.delete(id)
    onChange(next)
  }

  return (
    <div className="tag-row-inline">
      {chosen.map(tag => (
        <TagChip
          key={tag.id}
          tag={tag}
          active
          onClick={() => setOpen(true)}
          onRemove={() => remove(tag.id)}
          tip="Change the tags"
        />
      ))}
      <button
        ref={buttonRef}
        type="button"
        className="np-tag-button"
        onClick={() => setOpen(current => !current)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <TagPlus size={14} /> {chosen.length > 0 ? 'Edit tags' : 'Add tags'}
      </button>
      {open && (
        <TagPickerPanel
          anchorRef={buttonRef}
          title={title}
          allTags={tags}
          selected={selected}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
