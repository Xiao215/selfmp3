import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode, RefObject } from 'react'
import type { FlatList, LayoutChangeEvent } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
import { withAlpha } from '@selfmp3/client'
import type { Song } from '@selfmp3/shared'
import { useArt } from '../offline/useArt'
import { usePlayingSongId } from '../player/PlayerProvider'
import {
  rowAt,
  rowMark,
  rowOnScreen,
  scrollForThumb,
  scrollToRow,
  thumbLength,
  thumbOffset,
  type RowSpan,
  type ScrollLabel,
  type ScrollMetrics,
} from '../ui/components/listScrollbar.model'
import { useMotionReduced } from '../ui/motion'
import { EASE_IN_CSS, EASE_OUT_CSS, MOVE_MS } from '../ui/motion.model'
import { floating } from '../ui/surfaces'
import { useSongColor } from '../ui/useSongColor'

/**
 * A long song list's own scrollbar in a browser and the Mac app (Xiao chose B,
 * C and E of the scrollbar mock, 2026-10-02).
 *
 * The browser's own bar stays hidden everywhere (`scrollbars.web.ts`): a mouse
 * on a Mac drew a white gutter beside every list. This one is drawn over the
 * list's right edge, so no row moves, and is gone at rest: it fades in while
 * the list moves or when the pointer comes near the edge, and out a second
 * after (B). It widens under the pointer, drags, and a press on the track
 * jumps there. While it is dragged, a bubble beside the thumb names where the
 * list is in its order — the letter, the artist, the day (C). A dot in the
 * playing song's colour marks where that song sits; it stays out on its own
 * while the song is off screen, and a press takes the list to it (E).
 *
 * The thumb and the dot follow the scroll from the list's own scroll event and
 * are moved directly, never through a render; React only hears that the bar
 * came out, went away, or is being held.
 */
interface ListScrollbarOptions {
  readonly list: RefObject<FlatList<Song> | null>
  readonly songs: readonly Song[]
  readonly label: ScrollLabel
  readonly hasHeader: boolean
  readonly enabled: boolean
}

interface ListScrollbar {
  readonly onLayout: ((event: LayoutChangeEvent) => void) | undefined
  readonly overlay: ReactNode
}

/** Where the list sits in the box it shares with this bar. */
interface Box {
  readonly y: number
  readonly height: number
}

/** The track's inset from the list's top and bottom. */
const INSET = 6
/** How near the right edge the pointer brings the bar out. */
const EDGE = 28
/** How long the bar stays after the list stops or the pointer leaves it. */
const LINGER_MS = 1100
const BUBBLE_HEIGHT = 36
const MARK_SIZE = 10
/** react-native-web's own `System` stack: these are DOM elements, not `Text`. */
const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

export function useListScrollbar({
  list,
  songs,
  label,
  hasHeader,
  enabled,
}: ListScrollbarOptions): ListScrollbar {
  const [box, setBox] = useState<Box | null>(null)
  const [onLayout] = useState(() => (event: LayoutChangeEvent): void => {
    const { y, height } = event.nativeEvent.layout
    setBox(was => (was && was.y === y && was.height === height ? was : { y, height }))
  })
  return {
    onLayout,
    overlay:
      enabled && box ? (
        <Scrollbar list={list} box={box} songs={songs} label={label} hasHeader={hasHeader} />
      ) : null,
  }
}

/** The list's scrolling element: react-native-web hands it over by name. */
function scrollNode(list: FlatList<Song> | null): HTMLElement | null {
  const node: unknown = list?.getScrollableNode()
  return node instanceof HTMLElement ? node : null
}

function metricsOf(node: HTMLElement): ScrollMetrics {
  return {
    viewport: node.clientHeight,
    content: node.scrollHeight,
    track: Math.max(1, node.clientHeight - INSET * 2),
  }
}

function Scrollbar({
  list,
  box,
  songs,
  label,
  hasHeader,
}: {
  list: RefObject<FlatList<Song> | null>
  box: Box
  songs: readonly Song[]
  label: ScrollLabel
  hasHeader: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const reduced = useMotionReduced()
  // Which song is loaded, and nothing else of the player: a pause or a song
  // added to Up next is not a reason to draw the bar again.
  const playingId = usePlayingSongId()
  const artFor = useArt()
  const playing = useMemo(
    () => (playingId === null ? -1 : songs.findIndex(song => song.id === playingId)),
    [playingId, songs],
  )
  const playingSong = playing >= 0 ? (songs[playing] ?? null) : null
  const { tint } = useSongColor(playingSong, playingSong ? artFor(playingSong) : null)

  // Out because the list moved or the pointer came near; under the pointer; held.
  const [shown, setShown] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [held, setHeld] = useState(false)
  // A list short enough to need no scrolling gets no bar at all.
  const [scrolls, setScrolls] = useState(false)
  const out = scrolls && (shown || hovered || held)

  const trackRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const markRef = useRef<HTMLButtonElement>(null)
  /** The drag under way: where the pointer and the list were when it began. */
  const drag = useRef<{ y: number; scroll: number } | null>(null)
  const hideTimer = useRef(0)

  // What the listeners read, current without attaching them again.
  const live = useRef({ songs, label, hasHeader, playing, out })
  useEffect(() => {
    live.current = { songs, label, hasHeader, playing, out }
  })

  /**
   * Where the rows run, from the page: after the content's top padding and the
   * header, up to the footer (the room a player bar takes) and the bottom
   * padding. Counted as rows, those put the playing song's dot a player bar
   * out.
   *
   * Measured once and kept until the list's size or its songs change: it is a
   * computed style and three element heights, and read on every scroll event
   * — after the thumb had been moved — it laid the page out again each time.
   */
  const span = useRef<RowSpan | null>(null)
  const spanOf = (node: HTMLElement): RowSpan => {
    span.current ??= measureSpan(node)
    return span.current
  }
  const measureSpan = (node: HTMLElement): RowSpan => {
    const content = node.firstElementChild as HTMLElement | null
    const count = live.current.songs.length
    if (!content) return { header: 0, content: node.scrollHeight, count }
    const padding = getComputedStyle(content)
    const header = live.current.hasHeader
      ? ((content.firstElementChild as HTMLElement | null)?.offsetHeight ?? 0)
      : 0
    const footer = (content.lastElementChild as HTMLElement | null)?.offsetHeight ?? 0
    return {
      header: parseFloat(padding.paddingTop) + header,
      content: node.scrollHeight - parseFloat(padding.paddingBottom) - footer,
      count,
    }
  }

  /** Puts the thumb, the bubble's words and the dot where the scroll says. */
  const draw = (): void => {
    const node = scrollNode(list.current)
    const thumb = thumbRef.current
    if (!node || !thumb) return
    // Every read before any write, so moving the thumb never makes the next
    // read lay the page out again.
    const metrics = metricsOf(node)
    const scrollTop = node.scrollTop
    const rowSpan = spanOf(node)
    const canScroll = metrics.content > metrics.viewport + 1
    setScrolls(canScroll)
    const length = thumbLength(metrics)
    const offset = thumbOffset(scrollTop, metrics)
    thumb.style.height = `${length}px`
    thumb.style.transform = `translateY(${offset}px)`

    const { songs: rows, label: name, playing: at, out: isOut } = live.current
    const bubble = bubbleRef.current
    if (bubble && drag.current && rows.length > 0) {
      const index = rowAt(scrollTop, rowSpan)
      const song = rows[index]
      if (song) bubble.textContent = name(song, index, rows.length)
      const top = Math.max(
        0,
        Math.min(metrics.track - BUBBLE_HEIGHT, offset + length / 2 - BUBBLE_HEIGHT / 2),
      )
      bubble.style.transform = `translateY(${top}px)`
    }

    const mark = markRef.current
    if (mark) {
      const away = at >= 0 && !rowOnScreen(at, scrollTop, metrics.viewport, rowSpan)
      const showMark = canScroll && at >= 0 && (isOut || away)
      mark.style.transform = `translateY(${rowMark(at, metrics, rowSpan) - MARK_SIZE / 2}px)`
      mark.style.opacity = showMark ? '1' : '0'
      mark.style.pointerEvents = showMark ? 'auto' : 'none'
    }
  }

  /** Out now, and away again once nothing has asked for it for a second. */
  const reveal = (): void => {
    setShown(true)
    window.clearTimeout(hideTimer.current)
    hideTimer.current = window.setTimeout(() => setShown(false), LINGER_MS)
  }

  // The list's own scroll moves everything; a size change does too.
  useEffect(() => {
    const node = scrollNode(list.current)
    if (!node) return undefined
    // One draw a frame, however many scroll events the frame carried.
    let frame = 0
    const onScroll = (): void => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        draw()
        reveal()
      })
    }
    const onPointerMove = (event: PointerEvent): void => {
      if (event.clientX > node.getBoundingClientRect().right - EDGE) reveal()
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    node.addEventListener('pointermove', onPointerMove, { passive: true })
    const resize = new ResizeObserver(() => {
      span.current = null
      draw()
    })
    resize.observe(node)
    if (node.firstElementChild) resize.observe(node.firstElementChild)
    draw()
    return () => {
      window.cancelAnimationFrame(frame)
      node.removeEventListener('scroll', onScroll)
      node.removeEventListener('pointermove', onPointerMove)
      resize.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draw and reveal read refs; the list's box is what moves them
  }, [list, box.y, box.height])

  // The hide still to come is left alone when the list only moves (a player
  // bar arriving), or the bar would stay out; it goes with the bar.
  useEffect(() => () => window.clearTimeout(hideTimer.current), [])

  // Other songs, or a header come or gone, run the rows somewhere else.
  useEffect(() => {
    span.current = null
  }, [songs, hasHeader])

  // A song starting, the list changing or the bar coming out moves the dot.
  useEffect(() => {
    draw()
  })

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const node = scrollNode(list.current)
    const track = trackRef.current
    if (event.button !== 0 || !node || !track) return
    event.preventDefault()
    const metrics = metricsOf(node)
    // Off the thumb: the list jumps so that the thumb is under the pointer, and the drag goes on from there.
    if (event.target !== thumbRef.current) {
      const at = event.clientY - track.getBoundingClientRect().top - thumbLength(metrics) / 2
      node.scrollTop = scrollForThumb(at, metrics)
    }
    drag.current = { y: event.clientY, scroll: node.scrollTop }
    track.setPointerCapture(event.pointerId)
    setHeld(true)
    draw()
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const node = scrollNode(list.current)
    if (!drag.current || !node) return
    const metrics = metricsOf(node)
    const from = thumbOffset(drag.current.scroll, metrics)
    node.scrollTop = scrollForThumb(from + event.clientY - drag.current.y, metrics)
  }
  const letGo = (): void => {
    if (!drag.current) return
    drag.current = null
    setHeld(false)
    reveal()
  }

  const goToPlaying = (): void => {
    const node = scrollNode(list.current)
    if (!node || playing < 0) return
    const offset = scrollToRow(playing, metricsOf(node), spanOf(node))
    // The list's own call: react-native-web gives the element React Native's
    // `scrollTo`, which reads a browser's `{ top }` as nowhere.
    list.current?.scrollToOffset({ offset, animated: !reduced })
  }

  const wide = hovered || held
  const fade = (ms: number, ease: string): string => (reduced ? 'none' : `opacity ${ms}ms ${ease}`)

  return (
    <>
      <div
        ref={trackRef}
        aria-hidden="true"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={letGo}
        onPointerCancel={letGo}
        onPointerEnter={() => {
          setHovered(true)
          reveal()
        }}
        onPointerLeave={() => {
          setHovered(false)
          reveal()
        }}
        style={{
          position: 'absolute',
          top: box.y + INSET,
          right: 2,
          width: 16,
          height: Math.max(0, box.height - INSET * 2),
          zIndex: 11,
          borderRadius: 999,
          touchAction: 'none',
          backgroundColor: wide ? withAlpha(theme.colors.textPrimary, 0.06) : 'transparent',
          opacity: out ? 1 : 0,
          pointerEvents: out ? 'auto' : 'none',
          transition: out ? fade(MOVE_MS.hoverIn, EASE_OUT_CSS) : fade(350, EASE_IN_CSS),
        }}
      >
        <div
          ref={thumbRef}
          style={{
            position: 'absolute',
            top: 0,
            right: wide ? 3 : 5,
            width: wide ? 10 : 6,
            borderRadius: 999,
            backgroundColor: withAlpha(theme.colors.textPrimary, wide ? 0.5 : 0.3),
            transition: reduced
              ? 'none'
              : `width ${MOVE_MS.hoverIn}ms, right ${MOVE_MS.hoverIn}ms, background-color ${MOVE_MS.hoverIn}ms`,
          }}
        />
        <div
          ref={bubbleRef}
          style={{
            position: 'absolute',
            top: 0,
            right: 26,
            height: BUBBLE_HEIGHT,
            minWidth: BUBBLE_HEIGHT,
            maxWidth: 240,
            boxSizing: 'border-box',
            padding: '0 14px',
            borderRadius: 12,
            lineHeight: `${BUBBLE_HEIGHT}px`,
            textAlign: 'center',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            fontFamily: FONT_STACK,
            fontSize: 14,
            fontWeight: 700,
            color: theme.colors.textPrimary,
            backgroundColor: theme.colors.surface3,
            ...floating(theme.colors),
            pointerEvents: 'none',
            opacity: held ? 1 : 0,
            transition: held
              ? fade(MOVE_MS.hoverIn, EASE_OUT_CSS)
              : fade(MOVE_MS.hoverOut, EASE_IN_CSS),
          }}
        />
      </div>
      {playingSong ? (
        <button
          ref={markRef}
          type="button"
          tabIndex={-1}
          aria-label={`Go to ${playingSong.title}, playing`}
          data-tip="Go to the playing song"
          onClick={goToPlaying}
          style={{
            position: 'absolute',
            top: box.y + INSET,
            right: 5,
            width: MARK_SIZE,
            height: MARK_SIZE,
            padding: 0,
            border: 0,
            borderRadius: '50%',
            backgroundColor: tint,
            boxShadow: `0 0 0 2px ${theme.colors.surface0}`,
            cursor: 'pointer',
            zIndex: 12,
            opacity: 0,
            pointerEvents: 'none',
            transition: fade(250, EASE_OUT_CSS),
          }}
        />
      ) : null}
    </>
  )
}
