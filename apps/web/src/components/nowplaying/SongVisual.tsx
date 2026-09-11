import { useEffect, useRef, useState } from 'react'
import type { Song } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider.js'
import {
  autoVisual,
  canHearMusic,
  chosenVisual,
  LIVE_VISUALS,
  setChosenVisual,
  VISUAL_NAMES,
  type VisualKind,
} from '../../lib/visuals.js'
import { Popover } from '../Menu.js'
import { ChevronDown } from '../Icons.js'
import { prefersReducedMotion, useSongClock } from './clock.js'
import { draw, type Memory } from './visualDraw.js'
import { useCoverArt } from './useCoverArt.js'

/**
 * The visual for a song, and which one it is.
 *
 * `auto` is what the song gets from its energy; `kind` is what is actually
 * showing, which differs once someone has chosen for this song.
 */
export function useVisualKind(song: Song): {
  kind: VisualKind
  auto: VisualKind
  chosen: boolean
  choose: (kind: VisualKind | null) => void
} {
  const [canHear] = useState(canHearMusic)
  const [choice, setChoice] = useState(() => chosenVisual(song.id))
  useEffect(() => setChoice(chosenVisual(song.id)), [song.id])

  const auto = autoVisual(song.features, canHear)
  // A live visual chosen on a Mac falls back here rather than failing.
  const usable = choice && (!LIVE_VISUALS.has(choice) || canHear) ? choice : null
  return {
    kind: usable ?? auto,
    auto,
    chosen: usable !== null,
    choose: kind => {
      setChosenVisual(song.id, kind)
      setChoice(kind)
    },
  }
}

/**
 * A canvas drawing one of the visuals for the song that is playing.
 *
 * One animation frame loop per mounted visual, paused by the browser whenever
 * the tab is hidden. It reads the playhead each frame rather than waiting for
 * React, so the beat lands on the beat.
 */
export function SongVisual({
  song,
  kind,
  className = '',
}: {
  song: Song
  kind: VisualKind
  className?: string
}) {
  const player = usePlayer()
  const clock = useSongClock()
  const art = useCoverArt(song)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Everything the loop reads, in one ref, so the loop starts once per kind.
  const live = useRef({ clock, art, song, playing: clock.playing })
  live.current = { clock, art, song, playing: clock.playing }

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return

    const analyser = LIVE_VISUALS.has(kind) && canHearMusic() ? player.analyser() : null
    const bins = analyser ? new Uint8Array(analyser.frequencyBinCount) : null
    // The top quarter of the bins is almost always empty in music; leave it out.
    const levels = bins ? new Float32Array(Math.floor(bins.length * 0.75)) : null
    const memory: Memory = {}
    let last = performance.now()
    let frame = 0

    const tick = (now: number): void => {
      frame = requestAnimationFrame(tick)
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const width = canvas.clientWidth
      const height = canvas.clientHeight
      if (!width || !height) return
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      if (analyser && bins && levels) {
        analyser.getByteFrequencyData(bins)
        // A steep curve: a modern master sits near the top of the byte range
        // almost all the time, and a gentle one draws every bar at full length.
        for (let i = 0; i < levels.length; i++)
          levels[i] = Math.pow((bins[i] ?? 0) / 255, 2.6) * 1.25
      }

      const { clock: c, art: a, song: s, playing } = live.current
      const features = s.features
      draw(
        kind,
        ctx,
        width,
        height,
        {
          time: c.read(),
          dt,
          playing,
          still: prefersReducedMotion(),
          bpm: features?.bpm ?? 90,
          energy: features?.energy ?? 0.4,
          danceability: features?.danceability ?? 0.5,
          palette: a.palette,
          cover: a.image,
          spectrum: levels,
        },
        memory,
      )
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [kind, player])

  return <canvas ref={canvasRef} className={`song-visual ${className}`} aria-hidden="true" />
}

/**
 * "Aurora ▾" — the name of what is showing, and the way to change it.
 *
 * The spectrum visuals are only offered where the music can be heard; on a
 * phone they would only ever be stand-ins.
 */
export function VisualPicker({
  song,
  visual,
}: {
  song: Song
  visual: ReturnType<typeof useVisualKind>
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const canHear = canHearMusic()
  const kinds = (Object.keys(VISUAL_NAMES) as VisualKind[]).filter(
    kind => canHear || !LIVE_VISUALS.has(kind),
  )

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className="visual-picker"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Choose a visual for this song"
      >
        {VISUAL_NAMES[visual.kind]} <ChevronDown size={13} />
      </button>
      {open && (
        <Popover
          anchorRef={anchorRef}
          onClose={() => setOpen(false)}
          placement="above"
          label={`Visual for ${song.title}`}
          sheet
          roving
        >
          <div className="popover-title">Visual for this song</div>
          <button
            type="button"
            role="menuitemradio"
            aria-checked={!visual.chosen}
            className={`popover-item ${!visual.chosen ? 'is-active' : ''}`}
            onClick={() => {
              visual.choose(null)
              setOpen(false)
            }}
          >
            Automatic · {VISUAL_NAMES[visual.auto]}
          </button>
          {kinds.map(kind => (
            <button
              key={kind}
              type="button"
              role="menuitemradio"
              aria-checked={visual.chosen && visual.kind === kind}
              className={`popover-item ${visual.chosen && visual.kind === kind ? 'is-active' : ''}`}
              onClick={() => {
                visual.choose(kind)
                setOpen(false)
              }}
            >
              {VISUAL_NAMES[kind]}
            </button>
          ))}
        </Popover>
      )}
    </>
  )
}
