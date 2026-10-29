import type { ReactNode } from 'react'
import { Circle, Path, Rect, Svg } from 'react-native-svg'
import { useUnistyles } from 'react-native-unistyles'
import { withAlpha } from '@selfmp3/client'

/**
 * Faint pictures of what an empty page becomes, drawn where `EmptyState`'s
 * round icon would be (J1 of the Oct 27 review): an empty page shows its own
 * shape in outline, so the words under it only have to say what fills it.
 *
 * Shapes and nothing else — no songs, no names, no covers — so they can never
 * be mistaken for something that is there. A screen reader skips them:
 * `EmptyState` hides the view they sit in.
 */

/** The sound map's sky, with no songs in it yet: a few empty places, two drawn lines, stars. */
export function GhostSky(): ReactNode {
  const { theme } = useUnistyles()
  const place = withAlpha(theme.colors.textPrimary, 0.1)
  const edge = withAlpha(theme.colors.textPrimary, 0.22)
  const line = withAlpha(theme.colors.textPrimary, 0.18)
  const star = withAlpha(theme.colors.textPrimary, 0.4)
  const places: readonly [number, number, number][] = [
    [26, 30, 18],
    [62, 52, 14],
    [44, 92, 16],
    [170, 22, 15],
    [200, 64, 18],
    [158, 98, 13],
    [108, 120, 12],
  ]
  return (
    <Svg width={240} height={150} viewBox="0 0 240 150">
      <Path
        d="M35 39 L69 59 L52 100"
        stroke={line}
        strokeWidth={1}
        strokeDasharray="3 4"
        fill="none"
      />
      <Path
        d="M177 29 L209 73 L164 104"
        stroke={line}
        strokeWidth={1}
        strokeDasharray="3 4"
        fill="none"
      />
      {places.map(([x, y, size]) => (
        <Rect
          key={`${x}-${y}`}
          x={x}
          y={y}
          width={size}
          height={size}
          rx={size * 0.22}
          fill={place}
          stroke={edge}
          strokeWidth={0.8}
        />
      ))}
      <Circle cx={120} cy={30} r={1.4} fill={star} />
      <Circle cx={96} cy={78} r={1.1} fill={star} />
      <Circle cx={226} cy={120} r={1.3} fill={star} />
      <Circle cx={12} cy={128} r={1} fill={star} />
      <Circle cx={140} cy={62} r={0.9} fill={star} />
    </Svg>
  )
}

/** Liked with nothing liked: the heart, in outline. */
export function HeartOutline(): ReactNode {
  const { theme } = useUnistyles()
  return (
    <Svg width={112} height={112} viewBox="0 0 24 24">
      <Path
        d="M12 20s-7-4.35-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5c0 5.15-7 9.5-7 9.5Z"
        fill={withAlpha(theme.colors.danger, 0.08)}
        stroke={withAlpha(theme.colors.danger, 0.6)}
        strokeWidth={0.6}
        strokeDasharray="1.1 0.9"
        strokeLinecap="round"
      />
    </Svg>
  )
}

/** A link's page before there is one: a card with a cover, a name and a play button, in outline. */
export function LinkPageOutline(): ReactNode {
  const { theme } = useUnistyles()
  const edge = withAlpha(theme.colors.textPrimary, 0.24)
  const fill = withAlpha(theme.colors.textPrimary, 0.06)
  const bar = withAlpha(theme.colors.textPrimary, 0.14)
  return (
    <Svg width={180} height={128} viewBox="0 0 180 128">
      <Rect
        x={1}
        y={1}
        width={178}
        height={126}
        rx={16}
        fill={fill}
        stroke={edge}
        strokeDasharray="4 4"
      />
      <Rect x={16} y={18} width={64} height={64} rx={8} fill={bar} />
      <Rect x={92} y={26} width={66} height={10} rx={5} fill={bar} />
      <Rect x={92} y={44} width={44} height={8} rx={4} fill={bar} />
      <Circle cx={108} cy={72} r={10} fill={bar} />
      <Rect x={16} y={98} width={148} height={6} rx={3} fill={bar} />
    </Svg>
  )
}
