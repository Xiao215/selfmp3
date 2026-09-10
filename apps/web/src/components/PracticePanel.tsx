import { useEffect, useState } from 'react'
import {
  formatDuration,
  formatSemitones,
  rateToSemitones,
  transposeCamelot,
  transposeKey,
} from '@selfmp3/shared'
import { usePlayer } from '../player/PlayerProvider.js'
import { countInMs, PRACTICE_SPEEDS } from '../player/practice.js'
import { X } from './Icons.js'

/**
 * The practice panel: loop, speed and key, in one place.
 *
 * Learning a part means playing four bars over and over, slowly, without the
 * pitch drifting — three things that are otherwise scattered across a transport
 * bar. Each group collapses so the panel still fits a phone screen with the
 * artwork above it.
 *
 * The same component is the phone's practice sheet and the desktop side panel;
 * `.now-playing .side-panel` already makes the shell fill the sheet.
 */

/** Which groups start open. Loop is the reason people open this panel. */
const INITIAL_OPEN = { loop: true, speed: true, key: false }

export function PracticePanel({ onClose }: { onClose: () => void }) {
  const player = usePlayer()
  const song = player.current
  const [open, setOpen] = useState<Record<'loop' | 'speed' | 'key', boolean>>(INITIAL_OPEN)
  const [semitones, setSemitones] = useState(0)

  // Transposing is a per-song thought; carrying +3 into the next track would
  // silently lie about its key.
  useEffect(() => setSemitones(0), [song?.id])

  const toggleGroup = (group: 'loop' | 'speed' | 'key'): void =>
    setOpen(current => ({ ...current, [group]: !current[group] }))

  const bpm = song?.features?.bpm ?? null
  const key = song?.features?.key ?? null
  const loopReady = player.loopA !== null && player.loopB !== null
  const loopLength = loopReady ? Math.abs((player.loopB ?? 0) - (player.loopA ?? 0)) : 0
  // With pitch lock off, speed drags the pitch with it — worth showing, since
  // that is exactly what a transposing musician is trying to keep track of.
  const rateShift = player.preservesPitch ? 0 : rateToSemitones(player.rate)
  const shownShift = semitones + Math.round(rateShift)

  return (
    <aside className="side-panel practice-panel">
      <header className="side-panel-head">
        <div className="side-panel-titles">
          <div className="side-panel-title">Practice</div>
          <div className="side-panel-sub">
            {song ? song.title : 'Nothing playing'}
            {bpm !== null && ` · ${Math.round(bpm)} BPM`}
          </div>
        </div>
        <div className="side-panel-actions">
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close practice"
          >
            <X size={17} />
          </button>
        </div>
      </header>

      <div className="practice-body">
        <section className="practice-group">
          <button
            type="button"
            className="practice-group-head"
            onClick={() => toggleGroup('loop')}
            aria-expanded={open.loop}
          >
            <span>A–B loop</span>
            <span className="practice-group-state">
              {loopReady
                ? `${formatDuration(player.loopA ?? 0)} – ${formatDuration(player.loopB ?? 0)}`
                : player.loopA !== null
                  ? 'set B'
                  : 'off'}
            </span>
          </button>

          {open.loop && (
            <div className="practice-group-body">
              <div className="practice-ab">
                <button
                  type="button"
                  className={`button practice-ab-button ${player.loopA !== null ? 'is-set' : ''}`}
                  onClick={() => player.tapLoopPoint('A')}
                  disabled={!song}
                >
                  <span className="practice-ab-letter">A</span>
                  <span className="practice-ab-time">
                    {player.loopA === null ? 'tap to set' : formatDuration(player.loopA)}
                  </span>
                </button>
                <button
                  type="button"
                  className={`button practice-ab-button ${player.loopB !== null ? 'is-set' : ''}`}
                  onClick={() => player.tapLoopPoint('B')}
                  disabled={!song}
                >
                  <span className="practice-ab-letter">B</span>
                  <span className="practice-ab-time">
                    {player.loopB === null ? 'tap to set' : formatDuration(player.loopB)}
                  </span>
                </button>
                <button
                  type="button"
                  className="button"
                  onClick={player.clearLoop}
                  disabled={player.loopA === null && player.loopB === null}
                >
                  Clear
                </button>
              </div>

              <p className="hint practice-hint">
                {loopReady
                  ? `Looping ${loopLength.toFixed(1)}s${player.countingIn ? ' · counting in…' : ''}`
                  : 'Tap A where the phrase starts, B where it ends. Play on either side of the region and it keeps playing until B.'}
              </p>

              <label className="practice-check">
                <input
                  type="checkbox"
                  className="toggle toggle-small"
                  checked={player.countIn}
                  onChange={event => player.setCountIn(event.target.checked)}
                />
                <span>
                  Count in
                  <span className="hint">
                    {' '}
                    ({countInMs(bpm)} ms{bpm === null ? '' : ', one beat'})
                  </span>
                </span>
              </label>
            </div>
          )}
        </section>

        <section className="practice-group">
          <button
            type="button"
            className="practice-group-head"
            onClick={() => toggleGroup('speed')}
            aria-expanded={open.speed}
          >
            <span>Speed</span>
            <span className="practice-group-state">{player.rate}×</span>
          </button>

          {open.speed && (
            <div className="practice-group-body">
              <div className="segmented practice-speeds" role="group" aria-label="Playback speed">
                {PRACTICE_SPEEDS.map(speed => (
                  <button
                    key={speed}
                    type="button"
                    className={`segmented-item ${player.rate === speed ? 'is-active' : ''}`}
                    onClick={() => player.setRate(speed)}
                    aria-pressed={player.rate === speed}
                  >
                    {speed}×
                  </button>
                ))}
              </div>

              <label className="practice-check">
                <input
                  type="checkbox"
                  className="toggle toggle-small"
                  checked={player.preservesPitch}
                  onChange={event => player.setPreservesPitch(event.target.checked)}
                />
                <span>
                  Pitch lock
                  <span className="hint"> (keep the key when slowing down)</span>
                </span>
              </label>

              {!player.preservesPitch && player.rate !== 1 && (
                <p className="hint practice-hint">
                  Pitch follows the speed: {formatSemitones(rateToSemitones(player.rate))}{' '}
                  semitones.
                </p>
              )}
            </div>
          )}
        </section>

        <section className="practice-group">
          <button
            type="button"
            className="practice-group-head"
            onClick={() => toggleGroup('key')}
            aria-expanded={open.key}
          >
            <span>Transpose</span>
            <span className="practice-group-state">{formatSemitones(semitones)}</span>
          </button>

          {open.key && (
            <div className="practice-group-body">
              {key === null ? (
                <p className="hint practice-hint">
                  No key for this song yet — run the audio analyser in Settings and it appears here.
                </p>
              ) : (
                <>
                  <div className="practice-transpose">
                    <button
                      type="button"
                      className="button"
                      onClick={() => setSemitones(value => Math.max(-12, value - 1))}
                      aria-label="Down a semitone"
                    >
                      −
                    </button>
                    <div className="practice-key">
                      <span className="practice-key-name">
                        {transposeKey(key, shownShift) ?? key}
                      </span>
                      <span className="practice-key-sub">
                        {transposeCamelot(key, shownShift) ?? '—'} · from {key}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="button"
                      onClick={() => setSemitones(value => Math.min(12, value + 1))}
                      aria-label="Up a semitone"
                    >
                      +
                    </button>
                  </div>
                  <p className="hint practice-hint">
                    Display only — the audio is not pitch-shifted. Use it to read the key you are
                    actually playing in with a capo, or transposed for another instrument.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </aside>
  )
}
