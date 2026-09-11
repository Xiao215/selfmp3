import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { activeLineIndex, type ParsedLyrics } from '@selfmp3/shared'
import { usePlayer } from '../../player/PlayerProvider.js'
import { useTransport } from '../../devices/useTransport.js'
import { Popover } from '../Menu.js'
import { showToast } from '../Toast.js'
import { useSongClock } from './clock.js'

/** How long a hand scroll holds off the auto-centring, so reading ahead is not fought. */
const MANUAL_SCROLL_MS = 4_000
/** Where the line being sung sits, as a fraction of the height from the top. */
const ANCHOR = 0.4
/** Matches `activeLineIndex`: a line lights up a moment before it is sung. */
const LEAD = 0.25

/**
 * The lyrics themselves, at any of the page's sizes.
 *
 * The line being sung stays at the same height on screen; the list moves under
 * it. In Focus the line also fills in as it is sung — estimated between its
 * timestamp and the next, since an `.lrc` is timed per line, not per word —
 * and lines further away blur a little. Both are CSS on top of two custom
 * properties set here, so Stage and Focus share one component and one list,
 * and the change between them is only a class.
 *
 * Click a line to jump to it. Right-click it to loop it: the Practice A–B
 * loop, set from the line's own timestamps. Nothing here reacts to a
 * double-click — it would only ever be two jumps.
 */
export function LyricsView({
  parsed,
  roman,
  mode,
}: {
  parsed: ParsedLyrics
  roman: readonly string[] | null
  mode: 'stage' | 'focus' | 'phone'
}) {
  const player = usePlayer()
  const transport = useTransport()
  const clock = useSongClock()
  const boxRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<(HTMLElement | null)[]>([])
  const lastManualScroll = useRef(0)
  const [active, setActive] = useState(-1)
  const [menu, setMenu] = useState<number | null>(null)
  const menuAnchor = useRef<HTMLElement | null>(null)

  const synced = parsed.synced ? parsed.lines : null
  const clockRef = useRef(clock)
  clockRef.current = clock

  // Follow the playhead every frame: which line is sung, and how far into it.
  useEffect(() => {
    if (!synced) return
    let frame = 0
    let current = -2
    const tick = (): void => {
      frame = requestAnimationFrame(tick)
      const time = clockRef.current.read()
      const index = activeLineIndex(synced, time, LEAD)
      if (index !== current) {
        current = index
        setActive(index)
      }
      const line = synced[index]
      const element = lineRefs.current[index]
      if (!line || !element) return
      const next = synced[index + 1]?.time ?? line.time + 5
      const span = Math.max(0.5, next - line.time - 0.3)
      const fill = Math.min(1, Math.max(0, (time + LEAD - line.time) / span))
      element.style.setProperty('--fill', `${(fill * 100).toFixed(1)}%`)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [synced])

  const centre = (behavior: ScrollBehavior): void => {
    const box = boxRef.current
    const element = lineRefs.current[Math.max(0, active)]
    if (!box || !element || !synced) return
    if (Date.now() - lastManualScroll.current < MANUAL_SCROLL_MS) return
    box.scrollTo({
      top: element.offsetTop + element.offsetHeight / 2 - box.clientHeight * ANCHOR,
      behavior,
    })
  }
  const centreRef = useRef(centre)
  centreRef.current = centre

  useEffect(() => centreRef.current('smooth'), [active])

  // When the type grows or the column widens — Stage to Focus, a romanization
  // line appearing — every line moves; keep the sung one where it was.
  useLayoutEffect(() => {
    const box = boxRef.current
    if (!box) return
    const observer = new ResizeObserver(() => centreRef.current('auto'))
    observer.observe(box)
    if (box.firstElementChild) observer.observe(box.firstElementChild)
    return () => observer.disconnect()
  }, [])

  const markManual = (): void => {
    lastManualScroll.current = Date.now()
  }

  const loopA = player.loopA
  const loopB = player.loopB
  const local = transport.remote === null

  const loopLine = (index: number): void => {
    const line = synced?.[index]
    if (!line) return
    const end = synced?.[index + 1]?.time ?? transport.duration
    player.setLoop(line.time, end)
    if (!transport.playing || Math.abs(transport.currentTime - line.time) > 0.5)
      player.seek(line.time)
    showToast('Looping this line. Right-click any line to stop.')
  }

  const lines = parsed.synced ? parsed.lines.map(line => line.text) : parsed.lines

  return (
    <div
      ref={boxRef}
      className={`lyrics-view is-${mode} ${synced ? '' : 'is-untimed'}`}
      onWheel={markManual}
      onTouchMove={markManual}
    >
      <div className="lyrics-view-track">
        {lines.map((text, index) => {
          const time = synced?.[index]?.time
          const sub = roman?.[index]
          const looped =
            time !== undefined &&
            loopA !== null &&
            loopB !== null &&
            time >= loopA - 0.05 &&
            time < loopB - 0.05
          const content = (
            <>
              <span className="lyric-words">{text || '♪'}</span>
              {sub && <span className="lyric-roman-line">{sub}</span>}
            </>
          )

          if (!synced) {
            return (
              <p
                key={index}
                className="lyric is-plain"
                ref={element => {
                  lineRefs.current[index] = element
                }}
              >
                {content}
              </p>
            )
          }

          const classes = ['lyric', 'is-synced']
          if (index === active) classes.push('is-active')
          else if (index < active) classes.push('is-past')
          if (!text) classes.push('is-gap')
          if (looped) classes.push('is-looped')

          return (
            <button
              key={`${time}-${index}`}
              type="button"
              className={classes.join(' ')}
              style={{ '--distance': Math.min(3, Math.abs(index - active)) } as React.CSSProperties}
              ref={element => {
                lineRefs.current[index] = element
              }}
              onClick={() => {
                lastManualScroll.current = 0
                if (time !== undefined) transport.seek(time)
              }}
              onContextMenu={event => {
                if (!local) return
                event.preventDefault()
                menuAnchor.current = event.currentTarget
                setMenu(index)
              }}
              // A native title, not data-tip: a caption here would cover the next
              // lines and hop from line to line as they scroll under a resting pointer.
              title="Jump to this line · right-click to loop it"
            >
              {content}
            </button>
          )
        })}
      </div>

      {menu !== null && synced && (
        <Popover anchorRef={menuAnchor} onClose={() => setMenu(null)} label="Lyric line" roving>
          <button
            type="button"
            role="menuitem"
            className="popover-item"
            onClick={() => {
              transport.seek(synced[menu]?.time ?? 0)
              setMenu(null)
            }}
          >
            Play from this line
          </button>
          <button
            type="button"
            role="menuitem"
            className="popover-item"
            onClick={() => {
              loopLine(menu)
              setMenu(null)
            }}
          >
            Loop this line
          </button>
          {loopA !== null && loopB !== null && (
            <button
              type="button"
              role="menuitem"
              className="popover-item"
              onClick={() => {
                player.clearLoop()
                setMenu(null)
              }}
            >
              Stop looping
            </button>
          )}
        </Popover>
      )}
    </div>
  )
}
