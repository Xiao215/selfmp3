import type { SVGProps } from 'react'

/**
 * Icons, inlined as components.
 *
 * An icon font or an icon package would both be heavier than this file and
 * would add a network request on a phone that may be offline. These are drawn
 * on a 24-unit grid with a consistent 1.8 stroke so they sit together evenly.
 */

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'size'> {
  readonly size?: number
}

function Icon({ size = 20, children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export const Play = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 4.5v15l13-7.5z" fill="currentColor" stroke="none" />
  </Icon>
)

export const Pause = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="4.5" width="4" height="15" rx="1.4" fill="currentColor" stroke="none" />
    <rect x="14" y="4.5" width="4" height="15" rx="1.4" fill="currentColor" stroke="none" />
  </Icon>
)

export const Next = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 5v14l9-7z" fill="currentColor" stroke="none" />
    <rect x="16.4" y="5" width="2.6" height="14" rx="1.3" fill="currentColor" stroke="none" />
  </Icon>
)

export const Prev = (p: IconProps) => (
  <Icon {...p}>
    <path d="M19 5v14l-9-7z" fill="currentColor" stroke="none" />
    <rect x="5" y="5" width="2.6" height="14" rx="1.3" fill="currentColor" stroke="none" />
  </Icon>
)

export const Shuffle = (p: IconProps) => (
  <Icon {...p}>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="m15 15 6 6" />
    <path d="m4 4 5 5" />
  </Icon>
)

export const Repeat = (p: IconProps) => (
  <Icon {...p}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </Icon>
)

export const RepeatOne = (p: IconProps) => (
  <Icon {...p}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    <path d="M11 10h1v4" />
  </Icon>
)

export const Volume = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
    <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    <path d="M18.4 5.6a9 9 0 0 1 0 12.8" />
  </Icon>
)

export const VolumeMute = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 5 6 9H2v6h4l5 4z" fill="currentColor" stroke="none" />
    <path d="m22 9-6 6M16 9l6 6" />
  </Icon>
)

export const Music = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
  </Icon>
)

export const Download = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </Icon>
)

export const CloudDownload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M7 17a4 4 0 0 1 0-8 5.5 5.5 0 0 1 10.5 1.5A3.5 3.5 0 0 1 17 17" />
    <path d="M12 12v8" />
    <path d="m8.5 16.5 3.5 3.5 3.5-3.5" />
  </Icon>
)

/** On this device: a solid disc with the arrow knocked out of it. */
export const Downloaded = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9.5" fill="currentColor" stroke="none" />
    <path
      d="M12 7v8.5M8.5 12.5 12 16l3.5-3.5"
      stroke="var(--icon-knockout, #000)"
      strokeWidth={2.2}
    />
  </Icon>
)

/** Details about a song: a circled i. */
export const Info = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none" />
  </Icon>
)

/** Tag pen: tagging what is playing. */
export const TagPlus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12.2V4.5A1.5 1.5 0 0 1 4.5 3h7.7l8.3 8.3a1.7 1.7 0 0 1 0 2.4l-6.8 6.8a1.7 1.7 0 0 1-2.4 0z" />
    <circle cx="8" cy="8" r="1.3" fill="currentColor" stroke="none" />
    <path d="M17.5 3v5M15 5.5h5" />
  </Icon>
)

/** Inbox tray, for songs that still need tagging. */
export const Inbox = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 13.5 6.3 5.6A2 2 0 0 1 8.2 4h7.6a2 2 0 0 1 1.9 1.6L20 13.5" />
    <path d="M4 13.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4.5h-4.5l-1.5 2.5h-4l-1.5-2.5z" />
  </Icon>
)

/** A folder, for showing a song's file where it lives on disk. */
export const Folder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  </Icon>
)

export const CheckCircle = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12 2.5 2.5 4.5-5" />
  </Icon>
)

export const Plus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
)

export const Search = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </Icon>
)

export const X = (p: IconProps) => (
  <Icon {...p}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
)

export const Check = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
)

/** The dash a part-selected checkbox wears: some, but not all. */
export const Minus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 12h12" />
  </Icon>
)

/** A ticked box, for the control that turns multi-select on. */
export const CheckSquare = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 11.5V19a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9" />
    <path d="m9 11 3 3 8-8" />
  </Icon>
)

export const Refresh = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12a9 9 0 1 1-2.64-6.36" />
    <path d="M21 3v6h-6" />
  </Icon>
)

export const Mic = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
    <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
    <path d="M12 19v3" />
  </Icon>
)

export const Heart = ({ filled = false, ...p }: IconProps & { filled?: boolean }) => (
  <Icon {...p}>
    <path
      d="M12 20s-7-4.35-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5c0 5.15-7 9.5-7 9.5Z"
      fill={filled ? 'currentColor' : 'none'}
    />
  </Icon>
)

export const ListMusic = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h11M3 12h8M3 18h6" />
    <path d="M17 17V8l4-1v8" />
    <circle cx="15.5" cy="17.5" r="2" />
  </Icon>
)

export const Sparkles = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    <path d="m6.3 6.3 2.4 2.4M15.3 15.3l2.4 2.4M17.7 6.3l-2.4 2.4M8.7 15.3l-2.4 2.4" />
  </Icon>
)

export const BarChart = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Icon>
)

export const Settings = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Icon>
)

export const Moon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </Icon>
)

export const Trash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h16" />
    <path d="M10 11v6M14 11v6" />
    <path d="M6 7l1 13h10l1-13" />
    <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </Icon>
)

export const More = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </Icon>
)

export const Grip = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="9" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="6" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="9" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="9" cy="18" r="1.3" fill="currentColor" stroke="none" />
    <circle cx="15" cy="18" r="1.3" fill="currentColor" stroke="none" />
  </Icon>
)

export const WifiOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="m2 2 20 20" />
    <path d="M8.5 16.5a5 5 0 0 1 7 0" />
    <path d="M5 12.9a10 10 0 0 1 5.2-2.7" />
    <path d="M2 8.8a15 15 0 0 1 4.6-2.8" />
    <path d="M22 8.8a15 15 0 0 0-9-3.7" />
    <path d="M19 12.9a10 10 0 0 0-2.2-1.6" />
    <circle cx="12" cy="20" r="0.6" fill="currentColor" />
  </Icon>
)

export const Clock = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </Icon>
)

export const ChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 6 6 6-6 6" />
  </Icon>
)

/** Focus: out to the words alone. */
export const Expand = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h6v6M10 20H4v-6M20 4l-6 6M4 20l6-6" />
  </Icon>
)

/** Back from Focus to the whole page. */
export const Collapse = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10h6V4M20 14h-6v6M10 10 4 4M14 14l6 6" />
  </Icon>
)

export const Speed = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
    <path d="m13.5 10.5 4-4" />
    <path d="M4.2 18a9 9 0 1 1 15.6 0" />
  </Icon>
)

export const Queue = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h13M3 12h13M3 18h8" />
    <path d="M18 14v7M14.5 17.5h7" />
  </Icon>
)

export const Tag = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 11V4a1 1 0 0 1 1-1h7l9 9-8 8-9-9Z" />
    <circle cx="7.5" cy="7.5" r="1.3" fill="currentColor" stroke="none" />
  </Icon>
)

/** The three animated bars shown next to whatever is currently playing. */
export const Equalizer = () => (
  <span className="equalizer" aria-label="Now playing">
    <span />
    <span />
    <span />
  </span>
)

/* ---- Lyrics+ ---- */

/** "Aa" — romanization. */
export const Romanize = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 17 7.5 6l4.5 11M4.6 13h5.8" />
    <path d="M15 11.2c1-.9 3.6-1 4.6.2.4.5.4 1.1.4 1.8V17" />
    <path d="M20 13.8c-1.4 0-4.4.1-4.4 1.9 0 1.6 2.4 1.9 4.4.4" />
  </Icon>
)

/* ---- devices and handoff ---- */

/** A laptop with a phone beside it — the devices / handoff button. */
export const Devices = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h10A1.5 1.5 0 0 1 15 6.5V14" />
    <path d="M1 17h15" />
    <rect x="17" y="8" width="6" height="11" rx="1.4" />
    <path d="M19.6 16.6h.8" />
  </Icon>
)

/** A phone with waves coming off it — remote control is on. */
export const Remote = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="3" width="10" height="18" rx="2" />
    <path d="M7.6 17.6h.8" />
    <path d="M16.5 8.5a5 5 0 0 1 0 7" />
    <path d="M19.5 5.5a9 9 0 0 1 0 13" />
  </Icon>
)

/* ---- Practice ---- */

/** A metronome — the practice panel. */
export const Metronome = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.5 3h5l4 18h-13z" />
    <path d="M6.2 16h11.6" />
    <path d="M12 15 16.5 6.5" />
  </Icon>
)

/* ---- brand ---- */

/**
 * The app mark: the same beamed pair of eighth notes as the app icon, drawn
 * as filled shapes rather than strokes so it stays solid next to the wordmark.
 */
export const BrandMark = ({ size = 22 }: { size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 512 512"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M186 168 L370 130 L370 190 L186 228 Z" />
    <rect x="186" y="168" width="26" height="180" rx="13" />
    <rect x="344" y="130" width="26" height="180" rx="13" />
    <ellipse cx="152" cy="348" rx="52" ry="39" transform="rotate(-22 152 348)" />
    <ellipse cx="310" cy="310" rx="52" ry="39" transform="rotate(-22 310 310)" />
  </svg>
)
