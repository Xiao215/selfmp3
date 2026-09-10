import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildLrc,
  formatDuration,
  formatLrcTimestamp,
  parseLyrics,
  splitPlainLyrics,
  type Song,
} from '@selfmp3/shared'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api.js'
import { queryKeys } from '../lib/queries.js'
import { usePlayer } from '../player/PlayerProvider.js'
import { Pause, Play, Refresh } from './Icons.js'

/**
 * The lyric timing editor.
 *
 * Two steps. First the words: paste them, fix them, or start from the plain
 * lyrics the song already has — an `.lrc` pasted here is understood too and
 * arrives with its times filled in. Then the timing: play the song and tap
 * (Space, or the big button) as each line begins. Every line can be nudged by
 * a tenth of a second or re-tapped, and tapping a timestamp jumps the player
 * there so a stamp can be checked by ear before saving.
 *
 * Saving writes an `.lrc` next to the audio through the server, the same
 * sidecar the app reads lyrics from — so it works offline afterwards and any
 * other player sees it too.
 */

interface EditableLine {
  readonly text: string
  readonly time: number | null
}

const NUDGE = 0.1

function fromText(text: string): EditableLine[] {
  const parsed = parseLyrics(text)
  if (parsed.synced) return parsed.lines.map(line => ({ text: line.text, time: line.time }))
  return splitPlainLyrics(text).map(line => ({ text: line, time: null }))
}

export function LyricsSyncEditor({
  song,
  initialText,
  onDone,
}: {
  song: Song
  initialText: string
  onDone: () => void
}) {
  const player = usePlayer()
  const client = useQueryClient()
  const listRef = useRef<HTMLDivElement>(null)

  const [step, setStep] = useState<'text' | 'tap'>(initialText.trim() ? 'tap' : 'text')
  const [draft, setDraft] = useState(initialText)
  const [lines, setLines] = useState<EditableLine[]>(() => fromText(initialText))
  const [cursor, setCursor] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isCurrent = player.current?.id === song.id
  const now = isCurrent ? player.currentTime : 0
  const tapped = useMemo(() => lines.filter(line => line.time !== null).length, [lines])

  /** Stamp the current playhead onto a line and move on to the next. */
  const stamp = (index: number): void => {
    if (index < 0 || index >= lines.length) return
    const time = Math.round(now * 100) / 100
    setLines(current => current.map((line, i) => (i === index ? { ...line, time } : line)))
    setCursor(Math.min(index + 1, lines.length))
  }

  const nudge = (index: number, delta: number): void => {
    setLines(current =>
      current.map((line, i) =>
        i === index && line.time !== null
          ? { ...line, time: Math.max(0, Math.round((line.time + delta) * 100) / 100) }
          : line,
      ),
    )
  }

  const clearTime = (index: number): void => {
    setLines(current => current.map((line, i) => (i === index ? { ...line, time: null } : line)))
    setCursor(index)
  }

  // Space taps while in the timing step. Registered in the capture phase so
  // the app's own Space (play/pause) never sees it; typing in a field still
  // gets its space character.
  const stampRef = useRef(stamp)
  stampRef.current = stamp
  const cursorRef = useRef(cursor)
  cursorRef.current = cursor
  useEffect(() => {
    if (step !== 'tap') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== ' ' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      event.preventDefault()
      event.stopImmediatePropagation()
      stampRef.current(cursorRef.current)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [step])

  // Keep the next line to tap in view as stamping advances.
  useEffect(() => {
    const element = listRef.current?.querySelector(`[data-sync-line="${cursor}"]`)
    element?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const startTapping = (): void => {
    const next = fromText(draft)
    setLines(next)
    // Resume at the first line still waiting for a time.
    const firstUntimed = next.findIndex(line => line.time === null)
    setCursor(firstUntimed < 0 ? 0 : firstUntimed)
    setStep('tap')
  }

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const text =
        tapped > 0
          ? buildLrc(lines, { title: song.title, artist: song.artist })
          : lines.map(line => line.text).join('\n')
      await api.saveLyrics(song.id, text)
      await client.invalidateQueries({ queryKey: ['lyrics'] })
      await client.invalidateQueries({ queryKey: queryKeys.library })
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  const ensurePlaying = (): void => {
    if (!isCurrent) player.playSong(song)
    else player.toggle()
  }

  if (step === 'text') {
    return (
      <div className="sync-editor">
        <div className="sync-editor-body">
          <p className="hint">
            Paste the lyrics, one line per row — or paste a whole <code>.lrc</code> and its
            timing comes with it.
          </p>
          <textarea
            className="sync-textarea"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder={'First line\nSecond line\n…'}
            spellCheck={false}
            autoFocus
          />
        </div>
        <footer className="sync-editor-foot">
          <button type="button" className="button" onClick={onDone}>
            Cancel
          </button>
          <button
            type="button"
            className="button button-primary"
            onClick={startTapping}
            disabled={!draft.trim()}
          >
            Next: set timing
          </button>
        </footer>
      </div>
    )
  }

  const untimed = lines.length - tapped

  return (
    <div className="sync-editor">
      <div className="sync-transport">
        <button
          type="button"
          className="icon-button"
          onClick={ensurePlaying}
          aria-label={isCurrent && player.playing ? 'Pause' : 'Play'}
        >
          {isCurrent && player.playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button
          type="button"
          className="icon-button"
          onClick={() => {
            if (isCurrent) player.seek(0)
            setCursor(0)
          }}
          aria-label="Restart from the beginning"
          title="Restart"
        >
          <Refresh size={16} />
        </button>
        <span className="sync-clock">{formatDuration(now)}</span>
        <span className="sync-progress-text">
          {tapped}/{lines.length} timed
        </span>
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setDraft(lines.map(line => line.text).join('\n'))
            setStep('text')
          }}
        >
          Edit text
        </button>
      </div>

      <div className="sync-lines" ref={listRef}>
        {lines.map((line, index) => (
          <div
            key={index}
            data-sync-line={index}
            className={['sync-line', index === cursor ? 'is-next' : '', line.time !== null ? 'is-timed' : '']
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="sync-time"
              onClick={() => {
                if (line.time !== null && isCurrent) player.seek(line.time)
                else setCursor(index)
              }}
              title={line.time !== null ? 'Jump here' : 'Tap next'}
            >
              {line.time !== null ? formatLrcTimestamp(line.time).slice(1, -1) : '--:--.--'}
            </button>
            <button
              type="button"
              className="sync-text"
              onClick={() => setCursor(index)}
              title="Make this the next line to tap"
            >
              {line.text || <span className="sync-blank">(blank)</span>}
            </button>
            <span className="sync-line-actions">
              <button
                type="button"
                className="sync-nudge"
                onClick={() => nudge(index, -NUDGE)}
                disabled={line.time === null}
                aria-label="Earlier by 0.1s"
              >
                −
              </button>
              <button
                type="button"
                className="sync-nudge"
                onClick={() => nudge(index, NUDGE)}
                disabled={line.time === null}
                aria-label="Later by 0.1s"
              >
                +
              </button>
              <button
                type="button"
                className="sync-nudge"
                onClick={() => (line.time === null ? stamp(index) : clearTime(index))}
                aria-label={line.time === null ? 'Stamp now' : 'Clear time'}
                title={line.time === null ? 'Stamp now' : 'Clear, then re-tap'}
              >
                {line.time === null ? '●' : '×'}
              </button>
            </span>
          </div>
        ))}
      </div>

      {error && <p className="notice notice-error sync-notice">{error}</p>}

      <footer className="sync-editor-foot">
        <button type="button" className="button" onClick={onDone} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="button button-primary sync-tap"
          onClick={event => {
            stamp(cursor)
            // Keep Space from also "clicking" this focused button.
            event.currentTarget.blur()
          }}
          disabled={cursor >= lines.length}
        >
          Tap <kbd className="sync-kbd">space</kbd>
        </button>
        <button
          type="button"
          className="button"
          onClick={() => void save()}
          disabled={saving || lines.length === 0}
          title={untimed > 0 && tapped > 0 ? `${untimed} untimed lines will be left out` : undefined}
        >
          {saving ? 'Saving…' : tapped > 0 ? 'Save .lrc' : 'Save text'}
        </button>
      </footer>
    </div>
  )
}
