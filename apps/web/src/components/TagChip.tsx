import type { CSSProperties } from 'react'
import type { Tag } from '@selfmp3/shared'

/**
 * A tag pill.
 *
 * Colour comes from the tag's stored hue rather than a hash computed at render
 * time, so renaming a tag does not change its colour — the colour is part of
 * how you recognise it.
 */
export function TagChip({
  tag,
  active = false,
  onClick,
  onRemove,
  size = 'normal',
}: {
  tag: Pick<Tag, 'id' | 'name' | 'hue'>
  active?: boolean
  onClick?: () => void
  onRemove?: () => void
  size?: 'normal' | 'small'
}) {
  const style = {
    '--tag-hue': String(tag.hue),
  } as CSSProperties

  const className = ['tag-chip', active ? 'is-active' : '', size === 'small' ? 'is-small' : '']
    .filter(Boolean)
    .join(' ')

  if (!onClick && !onRemove) {
    return (
      <span className={className} style={style}>
        {tag.name}
      </span>
    )
  }

  return (
    <span className={className} style={style}>
      <button
        type="button"
        className="tag-chip-label"
        onClick={onClick}
        aria-pressed={onClick ? active : undefined}
      >
        {tag.name}
      </button>
      {onRemove && (
        <button
          type="button"
          className="tag-chip-remove"
          onClick={event => {
            event.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove tag ${tag.name}`}
        >
          ×
        </button>
      )}
    </span>
  )
}
