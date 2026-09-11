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
  excluded = false,
  onClick,
  onRemove,
  size = 'normal',
  title,
}: {
  tag: Pick<Tag, 'id' | 'name' | 'hue'>
  active?: boolean
  /** Filtering *out*: "everything but this". Drawn struck through, said as "not". */
  excluded?: boolean
  onClick?: () => void
  onRemove?: () => void
  size?: 'normal' | 'small'
  title?: string
}) {
  const style = {
    '--tag-hue': String(tag.hue),
  } as CSSProperties

  const className = [
    'tag-chip',
    active ? 'is-active' : '',
    excluded ? 'is-excluded' : '',
    size === 'small' ? 'is-small' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const label = (
    <>
      {excluded && <span className="tag-chip-not">not</span>}
      {tag.name}
    </>
  )

  if (!onClick && !onRemove) {
    return (
      <span className={className} style={style} title={title}>
        {label}
      </span>
    )
  }

  return (
    <span className={className} style={style}>
      <button
        type="button"
        className="tag-chip-label"
        onClick={onClick}
        aria-pressed={onClick ? active || excluded : undefined}
        title={title}
      >
        {label}
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
