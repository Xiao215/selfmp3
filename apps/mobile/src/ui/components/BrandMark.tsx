import { View } from 'react-native'
import { useAccent } from '../accent'

/**
 * The app mark: the beamed pair of eighth notes, in this device's accent.
 *
 * The web app draws it as an SVG path (components/Icons.tsx). There is no SVG
 * renderer in this app and adding one is a native module — a rebuild of the
 * dev client for one small drawing — so the same shape is laid out with plain
 * views instead: two rounded stems, two rotated ellipses for the noteheads,
 * and a rotated bar for the beam.
 *
 * The geometry is the SVG's 512-unit viewBox scaled by `size`, so the two
 * marks stay the same drawing rather than two things that resemble each other.
 */

/** The web mark's viewBox, which every figure below is a fraction of. */
const BOX = 512

export function BrandMark({ size = 22, color }: { size?: number; color?: string }) {
  const accent = useAccent()
  const ink = color ?? accent.accent
  const u = (units: number): number => (units / BOX) * size

  return (
    <View style={{ width: size, height: size }} accessible={false}>
      {/*
        The beam.

        In the SVG this is the quad (186,168)-(370,130)-(370,190)-(186,228):
        vertical ends, slanting down to the left. A rotated rectangle can be
        the same shape, but its figures are not the quad's — the height here
        is the *perpendicular* thickness, 60·cos(11.67°), and the width is the
        length along the slant rather than the horizontal span. Both are then
        centred on the quad's centreline, since a rotation turns about the
        centre.
      */}
      <View
        style={{
          position: 'absolute',
          left: u(184.06),
          top: u(149.62),
          width: u(187.88),
          height: u(58.76),
          backgroundColor: ink,
          transform: [{ rotate: '-11.669deg' }],
        }}
      />
      {/* Stems. */}
      <View
        style={{
          position: 'absolute',
          left: u(186),
          top: u(168),
          width: u(26),
          height: u(180),
          borderRadius: u(13),
          backgroundColor: ink,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: u(344),
          top: u(130),
          width: u(26),
          height: u(180),
          borderRadius: u(13),
          backgroundColor: ink,
        }}
      />
      {/* Noteheads: ellipses, leaning the way a written note does. */}
      <Notehead ink={ink} u={u} cx={152} cy={348} />
      <Notehead ink={ink} u={u} cx={310} cy={310} />
    </View>
  )
}

function Notehead({
  ink,
  u,
  cx,
  cy,
}: {
  ink: string
  u: (units: number) => number
  cx: number
  cy: number
}) {
  const rx = 52
  const ry = 39
  return (
    <View
      style={{
        position: 'absolute',
        left: u(cx - rx),
        top: u(cy - ry),
        width: u(rx * 2),
        height: u(ry * 2),
        // Half the smaller side is what makes a view an ellipse rather than a
        // rounded rectangle; React Native has no separate x and y radius.
        borderRadius: u(ry),
        backgroundColor: ink,
        transform: [{ rotate: '-22deg' }],
      }}
    />
  )
}
