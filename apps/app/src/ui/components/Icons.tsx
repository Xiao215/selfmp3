import type { ReactNode } from 'react'
import { useUnistyles } from 'react-native-unistyles'
import type { ThemePalette } from '@selfmp3/client'
import { Circle, Path, Rect, Svg } from 'react-native-svg'

/**
 * The app's icon set, hand-drawn rather than system glyphs.
 *
 * These were text characters — `♪`, `≣`, `⚙`, `↓` — chosen to avoid a native
 * module for "a dozen glyphs". It saved a dependency and cost the app its
 * face: a system font's approximations of them do not sit together, do not
 * share a weight, and do not look like the same product.
 *
 * Each is hand-drawn on a 24-unit grid with a 1.8 stroke: a `color` prop
 * stands in for CSS's `currentColor`, and `knockout` takes the surface a
 * badge sits on, for icons that knock a shape out of a filled badge.
 */

/** A colour in the theme's palette, named. */
export type IconTone = keyof ThemePalette

interface IconProps {
  readonly size?: number
  readonly color?: string
  /**
   * The theme colour to draw in, by name: `tone="accent"` rather than
   * `color={accent.accent}`.
   *
   * It matters which of the two draws an icon in the accent. A colour passed
   * in is a prop, so whoever works it out has to read the accent, and a
   * screen that reads the accent is re-rendered — all of it — on every step
   * of a drag on the accent picker. A tone is read here instead, by an icon
   * that is a handful of paths, and the screen around it holds still.
   */
  readonly tone?: IconTone
}

/** An icon's ink: what it was given, the tone it asked for, or the default. */
export function useInk(
  given: string | undefined,
  tone: IconTone | undefined,
  fallback: IconTone = 'textSecondary',
): string {
  const { theme } = useUnistyles()
  return given ?? theme.colors[tone ?? fallback]
}

/** The frame every icon is drawn in, in an ink already worked out. */
function Icon({
  size = 20,
  color,
  children,
}: {
  size?: number
  color: string
  children: ReactNode
}): ReactNode {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </Svg>
  )
}

/**
 * An icon from its paths: `draw` is handed the ink, for the parts that are
 * filled rather than stroked. The ink is worked out once, here, and the theme
 * read once with it.
 */
function icon(
  draw: (color: string) => ReactNode,
  fallback: IconTone = 'textSecondary',
): (props: IconProps) => ReactNode {
  return function Glyph({ color: given, tone, size }: IconProps): ReactNode {
    const color = useInk(given, tone, fallback)
    return (
      <Icon size={size} color={color}>
        {draw(color)}
      </Icon>
    )
  }
}

export const Play = icon(color => <Path d="M7 4.5v15l13-7.5z" fill={color} stroke="none" />)

export const Pause = icon(color => (
  <>
    <Rect x="6" y="4.5" width="4" height="15" rx="1.4" fill={color} stroke="none" />
    <Rect x="14" y="4.5" width="4" height="15" rx="1.4" fill={color} stroke="none" />
  </>
))

/** Stops something being worked on: a filled square, the way a chat's send button turns while it answers. */
export const Stop = icon(color => (
  <Rect x="6" y="6" width="12" height="12" rx="2.5" fill={color} stroke="none" />
))

export const Next = icon(color => (
  <>
    <Path d="M5 5v14l9-7z" fill={color} stroke="none" />
    <Rect x="16.4" y="5" width="2.6" height="14" rx="1.3" fill={color} stroke="none" />
  </>
))

export const Prev = icon(color => (
  <>
    <Path d="M19 5v14l-9-7z" fill={color} stroke="none" />
    <Rect x="5" y="5" width="2.6" height="14" rx="1.3" fill={color} stroke="none" />
  </>
))

export const Shuffle = icon(() => (
  <>
    <Path d="M16 3h5v5" />
    <Path d="M4 20 21 3" />
    <Path d="M21 16v5h-5" />
    <Path d="m15 15 6 6" />
    <Path d="m4 4 5 5" />
  </>
))

export const Repeat = icon(() => (
  <>
    <Path d="m17 2 4 4-4 4" />
    <Path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <Path d="m7 22-4-4 4-4" />
    <Path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </>
))

export const RepeatOne = icon(() => (
  <>
    <Path d="m17 2 4 4-4 4" />
    <Path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <Path d="m7 22-4-4 4-4" />
    <Path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <Path d="M11 10h1v4" />
  </>
))

export const Volume = icon(color => (
  <>
    <Path d="M11 5 6 9H2v6h4l5 4z" fill={color} stroke="none" />
    <Path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <Path d="M18.4 5.6a9 9 0 0 1 0 12.8" />
  </>
))

export const VolumeMute = icon(color => (
  <>
    <Path d="M11 5 6 9H2v6h4l5 4z" fill={color} stroke="none" />
    <Path d="m22 9-6 6M16 9l6 6" />
  </>
))

export const Music = icon(() => (
  <>
    <Path d="M9 18V5l12-2v13" />
    <Circle cx="6" cy="18" r="3" />
    <Circle cx="18" cy="16" r="3" />
  </>
))

export const Download = icon(() => (
  <>
    <Path d="M12 3v12" />
    <Path d="m7 10 5 5 5-5" />
    <Path d="M5 21h14" />
  </>
))

export const CloudDownload = icon(() => (
  <>
    <Path d="M7 17a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17 17" />
    <Path d="M12 12v8" />
    <Path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
  </>
))

/**
 * Taking a song off this device: the same cloud, with the arrow replaced by a
 * cross rather than a different shape altogether — undownloading is the
 * download undone, and the mock draws it as the cloud either way (`S3`).
 */
export const CloudRemove = icon(() => (
  <>
    <Path d="M7 17a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17 17" />
    <Path d="m9.5 15.5 5 5" />
    <Path d="m14.5 15.5-5 5" />
  </>
))

export const CloudUpload = icon(() => (
  <>
    <Path d="M7 17a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17 17" />
    <Path d="M12 20v-8" />
    <Path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
  </>
))

export function Downloaded({
  color: given,
  tone,
  size,
  knockout: knockoutGiven,
}: IconProps & {
  /** The surface the badge sits on, which its arrow is knocked out in. */
  knockout?: string
}): ReactNode {
  const { theme } = useUnistyles()
  const color = given ?? theme.colors[tone ?? 'textSecondary']
  const knockout = knockoutGiven ?? theme.colors.surface0
  return (
    <Icon size={size} color={color}>
      <Circle cx="12" cy="12" r="9.5" fill={color} stroke="none" />
      <Path d="M12 7v8.5M8.5 12.5 12 16l3.5-3.5" stroke={knockout} strokeWidth={2.2} />
    </Icon>
  )
}

/**
 * A song that is not on this device: the cloud it is in, and nothing else.
 *
 * It was a download arrow in a circle, which says what you could do to the
 * song rather than where it is — and beside a row that offers downloading in
 * its ⋯ menu, an arrow reads as a button (Xiao, 2026-09-22). The same cloud
 * the download icons are drawn from, without their arrow.
 */
export const NotDownloaded = icon(
  () => <Path d="M7 17.5a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5 3.5 3.5 0 0 1-.5 6.5Z" />,
  'textMuted',
)

export const Info = icon(color => (
  <>
    <Circle cx="12" cy="12" r="9" />
    <Path d="M12 11v5.5" />
    <Circle cx="12" cy="7.8" r="1.1" fill={color} stroke="none" />
  </>
))

export const TagPlus = icon(color => (
  <>
    <Path d="M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7l8.3 8.3a1.7 1.7 0 0 1 0 2.4l-6.8 6.8a1.7 1.7 0 0 1-2.4 0z" />
    <Circle cx="8" cy="8" r="1.3" fill={color} stroke="none" />
    <Path d="M17.5 3v5M15 5.5h5" />
  </>
))

export const Plus = icon(() => <Path d="M12 5v14M5 12h14" />)

/** A house, for Home: a roof over a door. */
export const Home = icon(() => (
  <Path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
))

export const Search = icon(() => (
  <>
    <Circle cx="11" cy="11" r="7" />
    <Path d="m20 20-3.5-3.5" />
  </>
))

/**
 * A four-pointed sparkle: the mark of something the model does (docs/features/ai.md),
 * set beside every way into it — Ask, Let it pick, Suggest tags — so a press that
 * asks a model looks different from one that only searches or sorts. Filled, and
 * in the accent unless told otherwise, so it reads as a mark rather than a glyph.
 */
export const Sparkle = icon(
  color => (
    <Path
      d="M12 2.5c.8 5 4.5 8.7 9.5 9.5-5 .8-8.7 4.5-9.5 9.5-.8-5-4.5-8.7-9.5-9.5 5-.8 8.7-4.5 9.5-9.5z"
      fill={color}
      stroke="none"
    />
  ),
  'accent',
)

export const X = icon(() => <Path d="M18 6 6 18M6 6l12 12" />)

export const Check = icon(() => <Path d="M20 6 9 17l-5-5" />)

/** Three lines, each shorter: an order (docs/ui-mock `P12`). */
export const SortLines = icon(() => <Path d="M4 7h16M7 12h10M10 17h4" />)

export const Minus = icon(() => <Path d="M6 12h12" />)

export const CheckSquare = icon(() => (
  <>
    <Path d="M20 11.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    <Path d="m9 11 3 3 8-8" />
  </>
))

export const Refresh = icon(() => (
  <>
    <Path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <Path d="M21 3v6h-6" />
  </>
))

export const Mic = icon(() => (
  <>
    <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <Path d="M12 19v3" />
  </>
))

export const ListMusic = icon(() => (
  <>
    <Path d="M3 6h11M3 12h8M3 18h6" />
    <Path d="M17 17V8l4-1v8" />
    <Circle cx="15.5" cy="17.5" r="2" />
  </>
))

export const Sparkles = icon(() => (
  <>
    <Path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <Path d="m6.3 6.3 2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />
  </>
))

export const BarChart = icon(() => <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />)

export const Settings = icon(() => (
  <>
    <Circle cx="12" cy="12" r="3" />
    <Path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </>
))

/** A person in a circle: Profile. */
export const User = icon(() => (
  <>
    <Circle cx="12" cy="12" r="9" />
    <Circle cx="12" cy="10" r="3" />
    <Path d="M6.2 18.4a7 7 0 0 1 11.6 0" />
  </>
))

export const Moon = icon(() => <Path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />)

export const Trash = icon(() => (
  <>
    <Path d="M4 7h16" />
    <Path d="M10 11v6M14 11v6" />
    <Path d="M6 7l1 13h10l1-13" />
    <Path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </>
))

export const More = icon(color => (
  <>
    <Circle cx="12" cy="5" r="1.4" fill={color} stroke="none" />
    <Circle cx="12" cy="12" r="1.4" fill={color} stroke="none" />
    <Circle cx="12" cy="19" r="1.4" fill={color} stroke="none" />
  </>
))

/** Two sheets: a copy. */
export const Copy = icon(() => (
  <>
    <Rect x="8" y="8" width="13" height="13" rx="2" />
    <Path d="M4 16V5a1 1 0 0 1 1-1h11" />
  </>
))

export const Pencil = icon(() => (
  <>
    <Path d="M12 20h9" />
    <Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </>
))

/** A dot sending out waves: a live playlist, which keeps itself up to date. */
export const Live = icon(color => (
  <>
    <Circle cx="12" cy="12" r="2.6" fill={color} stroke="none" />
    <Path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
    <Path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
  </>
))

export const Grip = icon(color => (
  <>
    <Circle cx="9" cy="6" r="1.3" fill={color} stroke="none" />
    <Circle cx="15" cy="6" r="1.3" fill={color} stroke="none" />
    <Circle cx="9" cy="12" r="1.3" fill={color} stroke="none" />
    <Circle cx="15" cy="12" r="1.3" fill={color} stroke="none" />
    <Circle cx="9" cy="18" r="1.3" fill={color} stroke="none" />
    <Circle cx="15" cy="18" r="1.3" fill={color} stroke="none" />
  </>
))

export const ChevronDown = icon(() => <Path d="m6 9 6 6 6-6" />)

/** The way back: a stack's back edge, and a page's own back button. */
export const ChevronLeft = icon(() => <Path d="m15 6-6 6 6 6" />)

export const ChevronRight = icon(() => <Path d="m9 6 6 6-6 6" />)

export const Expand = icon(() => <Path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6" />)

export const Collapse = icon(() => <Path d="M4 10h6V4M20 14h-6v6M10 10 4 4M14 14l6 6" />)

export const Queue = icon(() => (
  <>
    <Path d="M3 6h13M3 12h13M3 18h8" />
    <Path d="M18 14v7M14.5 17.5h7" />
  </>
))

export const Tag = icon(color => (
  <>
    <Path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9Z" />
    <Circle cx="7.5" cy="7.5" r="1.3" fill={color} stroke="none" />
  </>
))

export const Romanize = icon(() => (
  <>
    <Path d="M3 17 7.5 6l4.5 11M4.6 13h5.8" />
    <Path d="M15 11.2c1-.9 3.6-1 4.6.2.4.5.4 1.1.4 1.8V17" />
    <Path d="M20 13.8c-1.4 0-4.4.1-4.4 1.9 0 1.6 2.4 1.9 4.4.4" />
  </>
))

export const Devices = icon(() => (
  <>
    <Path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h10A1.5 1.5 0 0 1 15 6.5V14" />
    <Path d="M1 17h15" />
    <Rect x="17" y="8" width="6" height="11" rx="1.4" />
    <Path d="M19.6 16.6h.8" />
  </>
))

export const Remote = icon(() => (
  <>
    <Rect x="3" y="3" width="10" height="18" rx="2" />
    <Path d="M7.6 17.6h.8" />
    <Path d="M16.5 8.5a5 5 0 0 1 0 7" />
    <Path d="M19.5 5.5a9 9 0 0 1 0 13" />
  </>
))

export const Metronome = icon(() => (
  <>
    <Path d="M9.5 3h5l4 18h-13z" />
    <Path d="M6.2 16h11.6" />
    <Path d="M12 15 16.5 6.5" />
  </>
))

export function Heart({
  color: given,
  tone,
  size,
  filled = false,
}: IconProps & { filled?: boolean }): ReactNode {
  const color = useInk(given, tone)
  return (
    <Icon size={size} color={color}>
      <Path
        d="M12 20s-7-4.35-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5c0 5.15-7 9.5-7 9.5Z"
        fill={filled ? color : 'none'}
      />
    </Icon>
  )
}
