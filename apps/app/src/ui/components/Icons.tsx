import type { ReactNode } from 'react'
import { useUnistyles } from 'react-native-unistyles'
import type { ThemePalette } from '@selfmp3/client'
import { Circle, Ellipse, Path, Rect, Svg } from 'react-native-svg'

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
type IconTone = keyof ThemePalette

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
  /** For icons that knock a shape out of a filled badge. */
  readonly knockout?: string
}

/** An icon's ink: what it was given, the tone it asked for, or the default. */
function useInk(
  given: string | undefined,
  tone: IconTone | undefined,
  fallback: IconTone = 'textSecondary',
): string {
  const { theme } = useUnistyles()
  return given ?? theme.colors[tone ?? fallback]
}

function Icon({
  size = 20,
  color: given,
  tone,
  children,
}: IconProps & { children: ReactNode }): ReactNode {
  const color = useInk(given, tone)
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

export const Play = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M7 4.5v15l13-7.5z" fill={color} stroke="none" />
    </Icon>
  )
}

export const Pause = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Rect x="6" y="4.5" width="4" height="15" rx="1.4" fill={color} stroke="none" />
      <Rect x="14" y="4.5" width="4" height="15" rx="1.4" fill={color} stroke="none" />
    </Icon>
  )
}

export const Next = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M5 5v14l9-7z" fill={color} stroke="none" />
      <Rect x="16.4" y="5" width="2.6" height="14" rx="1.3" fill={color} stroke="none" />
    </Icon>
  )
}

export const Prev = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M19 5v14l-9-7z" fill={color} stroke="none" />
      <Rect x="5" y="5" width="2.6" height="14" rx="1.3" fill={color} stroke="none" />
    </Icon>
  )
}

export const Shuffle = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M16 3h5v5" />
      <Path d="M4 20 21 3" />
      <Path d="M21 16v5h-5" />
      <Path d="m15 15 6 6" />
      <Path d="m4 4 5 5" />
    </Icon>
  )
}

export const Repeat = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="m17 2 4 4-4 4" />
      <Path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <Path d="m7 22-4-4 4-4" />
      <Path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </Icon>
  )
}

export const RepeatOne = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="m17 2 4 4-4 4" />
      <Path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <Path d="m7 22-4-4 4-4" />
      <Path d="M21 13v1a4 4 0 0 1-4 4H3" />
      <Path d="M11 10h1v4" />
    </Icon>
  )
}

export const Volume = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M11 5 6 9H2v6h4l5 4z" fill={color} stroke="none" />
      <Path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <Path d="M18.4 5.6a9 9 0 0 1 0 12.8" />
    </Icon>
  )
}

export const VolumeMute = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M11 5 6 9H2v6h4l5 4z" fill={color} stroke="none" />
      <Path d="m22 9-6 6M16 9l6 6" />
    </Icon>
  )
}

export const Music = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M9 18V5l12-2v13" />
      <Circle cx="6" cy="18" r="3" />
      <Circle cx="18" cy="16" r="3" />
    </Icon>
  )
}

export const Download = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M12 3v12" />
      <Path d="m7 10 5 5 5-5" />
      <Path d="M5 21h14" />
    </Icon>
  )
}

export const CloudDownload = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M7 17a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17 17" />
      <Path d="M12 12v8" />
      <Path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
    </Icon>
  )
}

export const CloudUpload = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M7 17a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17 17" />
      <Path d="M12 20v-8" />
      <Path d="m8.5 15.5 3.5-3.5 3.5 3.5" />
    </Icon>
  )
}

export const Downloaded = ({
  color: colorGiven,
  knockout: knockoutGiven,
  tone,
  ...rest
}: IconProps): ReactNode => {
  const { theme } = useUnistyles()
  const color = colorGiven ?? theme.colors[tone ?? 'textSecondary']
  const knockout = knockoutGiven ?? theme.colors.surface0
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="12" r="9.5" fill={color} stroke="none" />
      <Path d="M12 7v8.5M8.5 12.5 12 16l3.5-3.5" stroke={knockout} strokeWidth={2.2} />
    </Icon>
  )
}

/**
 * Not on this device: the downloaded disc's counterpart, drawn as an outline
 * so it reads as the same mark, not yet filled in.
 */
export const NotDownloaded = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone, 'textMuted')
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7.5v8M8.8 12.3 12 15.5l3.2-3.2" />
    </Icon>
  )
}

export const Info = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 11v5.5" />
      <Circle cx="12" cy="7.8" r="1.1" fill={color} stroke="none" />
    </Icon>
  )
}

export const TagPlus = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7l8.3 8.3a1.7 1.7 0 0 1 0 2.4l-6.8 6.8a1.7 1.7 0 0 1-2.4 0z" />
      <Circle cx="8" cy="8" r="1.3" fill={color} stroke="none" />
      <Path d="M17.5 3v5M15 5.5h5" />
    </Icon>
  )
}

export const Inbox = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M4 13.5 6.3 5.6A2 2 0 0 1 8.2 4h7.6a2 2 0 0 1 1.9 1.6L20 13.5" />
      <Path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5h-4.5l-1.5 2.5h-4l-1.5-2.5z" />
    </Icon>
  )
}

export const Folder = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    </Icon>
  )
}

export const CheckCircle = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="m8.5 12 2.5 2.5 4.5-5" />
    </Icon>
  )
}

export const Plus = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

/** A house, for Home: a roof over a door. */
export const Home = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
    </Icon>
  )
}

export const Search = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="11" cy="11" r="7" />
      <Path d="m20 20-3.5-3.5" />
    </Icon>
  )
}

export const X = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  )
}

export const Check = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M20 6 9 17l-5-5" />
    </Icon>
  )
}

export const Minus = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M6 12h12" />
    </Icon>
  )
}

export const CheckSquare = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M20 11.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
      <Path d="m9 11 3 3 8-8" />
    </Icon>
  )
}

export const Refresh = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <Path d="M21 3v6h-6" />
    </Icon>
  )
}

export const Mic = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <Path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <Path d="M12 19v3" />
    </Icon>
  )
}

export const ListMusic = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M3 6h11M3 12h8M3 18h6" />
      <Path d="M17 17V8l4-1v8" />
      <Circle cx="15.5" cy="17.5" r="2" />
    </Icon>
  )
}

export const Sparkles = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <Path d="m6.3 6.3 2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />
    </Icon>
  )
}

export const BarChart = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </Icon>
  )
}

export const Settings = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="12" r="3" />
      <Path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </Icon>
  )
}

/** A person in a circle: the You tab. */
export const User = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="12" r="9" />
      <Circle cx="12" cy="10" r="3" />
      <Path d="M6.2 18.4a7 7 0 0 1 11.6 0" />
    </Icon>
  )
}

export const Moon = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
    </Icon>
  )
}

export const Trash = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M4 7h16" />
      <Path d="M10 11v6M14 11v6" />
      <Path d="M6 7l1 13h10l1-13" />
      <Path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </Icon>
  )
}

export const More = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="5" r="1.4" fill={color} stroke="none" />
      <Circle cx="12" cy="12" r="1.4" fill={color} stroke="none" />
      <Circle cx="12" cy="19" r="1.4" fill={color} stroke="none" />
    </Icon>
  )
}

/** A pushpin: pinning a playlist to the sidebar. */
export const Pin = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M12 17v5" />
      <Path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </Icon>
  )
}

/** Two sheets: a copy. */
export const Copy = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Rect x="8" y="8" width="13" height="13" rx="2" />
      <Path d="M4 16V5a1 1 0 0 1 1-1h11" />
    </Icon>
  )
}

export const Pencil = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M12 20h9" />
      <Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </Icon>
  )
}

/** A dot sending out waves: a live playlist, which keeps itself up to date. */
export const Live = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="12" r="2.6" fill={color} stroke="none" />
      <Path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4" />
      <Path d="M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    </Icon>
  )
}

export const Grip = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="9" cy="6" r="1.3" fill={color} stroke="none" />
      <Circle cx="15" cy="6" r="1.3" fill={color} stroke="none" />
      <Circle cx="9" cy="12" r="1.3" fill={color} stroke="none" />
      <Circle cx="15" cy="12" r="1.3" fill={color} stroke="none" />
      <Circle cx="9" cy="18" r="1.3" fill={color} stroke="none" />
      <Circle cx="15" cy="18" r="1.3" fill={color} stroke="none" />
    </Icon>
  )
}

export const Clock = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Circle cx="12" cy="12" r="9" />
      <Path d="M12 7v5l3 2" />
    </Icon>
  )
}

export const ChevronDown = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="m6 9 6 6 6-6" />
    </Icon>
  )
}

/** Native only: a stack has a back edge, which the web's router never draws. */
export const ChevronLeft = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="m15 6-6 6 6 6" />
    </Icon>
  )
}

export const ChevronRight = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="m9 6 6 6-6 6" />
    </Icon>
  )
}

export const Expand = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6" />
    </Icon>
  )
}

export const Collapse = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M4 10h6V4M20 14h-6v6M10 10 4 4M14 14l6 6" />
    </Icon>
  )
}

export const Speed = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      <Path d="m13.5 10.5 4-4" />
      <Path d="M4.2 18a9 9 0 1 1 15.6 0" />
    </Icon>
  )
}

export const Queue = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M3 6h13M3 12h13M3 18h8" />
      <Path d="M18 14v7M14.5 17.5h7" />
    </Icon>
  )
}

export const Tag = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9Z" />
      <Circle cx="7.5" cy="7.5" r="1.3" fill={color} stroke="none" />
    </Icon>
  )
}

export const Romanize = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M3 17 7.5 6l4.5 11M4.6 13h5.8" />
      <Path d="M15 11.2c1-.9 3.6-1 4.6.2.4.5.4 1.1.4 1.8V17" />
      <Path d="M20 13.8c-1.4 0-4.4.1-4.4 1.9 0 1.6 2.4 1.9 4.4.4" />
    </Icon>
  )
}

export const Devices = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h10A1.5 1.5 0 0 1 15 6.5V14" />
      <Path d="M1 17h15" />
      <Rect x="17" y="8" width="6" height="11" rx="1.4" />
      <Path d="M19.6 16.6h.8" />
    </Icon>
  )
}

export const Remote = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Rect x="3" y="3" width="10" height="18" rx="2" />
      <Path d="M7.6 17.6h.8" />
      <Path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <Path d="M19.5 5.5a9 9 0 0 1 0 13" />
    </Icon>
  )
}

export const Metronome = ({ color: colorGiven, tone, ...rest }: IconProps): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path d="M9.5 3h5l4 18h-13z" />
      <Path d="M6.2 16h11.6" />
      <Path d="M12 15 16.5 6.5" />
    </Icon>
  )
}

export const Heart = ({
  color: colorGiven,
  filled = false,
  tone,
  ...rest
}: IconProps & { filled?: boolean }): ReactNode => {
  const color = useInk(colorGiven, tone)
  return (
    <Icon color={color} {...rest}>
      <Path
        d="M12 20s-7-4.35-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5c0 5.15-7 9.5-7 9.5Z"
        fill={filled ? color : 'none'}
      />
    </Icon>
  )
}

/** The wordmark's note, on its own 512 grid. */
export const BrandMark = ({
  size = 22,
  color: colorGiven,
  tone,
}: {
  size?: number
  color?: string
  tone?: IconTone
}): ReactNode => {
  const color = useInk(colorGiven, tone, 'accent')
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512" fill={color}>
      <Path d="M186 168 L370 130 L370 190 L186 228 Z" />
      <Rect x="186" y="168" width="26" height="180" rx="13" />
      <Rect x="344" y="130" width="26" height="180" rx="13" />
      <Ellipse cx="152" cy="348" rx="52" ry="39" transform="rotate(-22 152 348)" />
      <Ellipse cx="310" cy="310" rx="52" ry="39" transform="rotate(-22 310 310)" />
    </Svg>
  )
}
