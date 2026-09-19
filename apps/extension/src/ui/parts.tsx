import { tagColors } from '@selfmp3/client/core'
import { TAG_NAME_MAX, type Tag } from '@selfmp3/shared'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { newTagFrom } from '../popup/popup.model.js'
import { NOTE_PATH } from './mark.js'

/** The parts the popup and the options page are both drawn from (`S2`). */

export function Logo({ size = 18, children }: { size?: number; children?: ReactNode }): ReactNode {
  return (
    <span className="logo">
      <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d={NOTE_PATH} />
      </svg>
      {children ?? 'self.mp3'}
    </span>
  )
}

/**
 * A tag's dot in both themes, handed to the stylesheet: `tagColors` is where a
 * hue becomes a colour, and the page follows the system's scheme on its own.
 */
function dotStyle(hue: number): CSSProperties {
  return {
    '--dot': tagColors(hue, 'dark').dot,
    '--dot-light': tagColors(hue, 'light').dot,
  } as CSSProperties
}

export function TagChip({
  tag,
  state,
  onToggle,
}: {
  tag: Tag
  /** `fixed` is a tag the server adds to every import: on, and not a choice. */
  state: 'fixed' | 'on' | 'off'
  onToggle?: () => void
}): ReactNode {
  return (
    <button
      type="button"
      className="chip"
      aria-pressed={state !== 'off'}
      disabled={state === 'fixed' || !onToggle}
      onClick={onToggle}
      style={dotStyle(tag.hue)}
    >
      <span className="dot" aria-hidden="true" />
      {tag.name}
    </button>
  )
}

/**
 * The dashed "+ new" chip. Pressed, it becomes the field it stands for; a name
 * already there picks that tag rather than making a second of it.
 */
export function AddTag({
  tags,
  pending,
  onPick,
  onCreate,
}: {
  tags: readonly Tag[]
  pending: boolean
  onPick: (id: number) => void
  onCreate: (name: string) => void
}): ReactNode {
  const [text, setText] = useState<string | null>(null)

  if (text === null) {
    return (
      <button type="button" className="chip add" disabled={pending} onClick={() => setText('')}>
        {pending ? 'Adding…' : '+ new'}
      </button>
    )
  }

  const done = (): void => {
    const made = newTagFrom(text, tags)
    if (made.kind === 'existing') onPick(made.tag.id)
    if (made.kind === 'new') onCreate(made.name)
    setText(null)
  }

  return (
    <span className="chip add">
      <input
        aria-label="New tag"
        value={text}
        maxLength={TAG_NAME_MAX}
        placeholder="new tag"
        autoFocus
        onChange={event => setText(event.target.value)}
        onBlur={done}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            done()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            setText(null)
          }
        }}
      />
    </span>
  )
}
