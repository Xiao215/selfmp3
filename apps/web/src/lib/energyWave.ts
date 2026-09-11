/**
 * The energy waveform: a small sine drawn straight from a song's energy.
 *
 * The analyser stores energy as one number from 0 to 1 (see `energyScore` in
 * the server's dsp.ts). Both things the eye reads in the wave — how tall it
 * is and how tightly it is packed — are continuous in that number, so there
 * are no steps, thresholds or level names to maintain: 0.62 and 0.66 draw
 * slightly different waves, and a better analyser changes the drawing without
 * anyone touching this file. Calm is a low, slow swell; intense is tall and
 * dense.
 */

export interface WaveShape {
  /** Peak distance from the centre line, in the drawing's own units. */
  readonly amplitude: number
  /** Full periods across the width. */
  readonly cycles: number
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0

/**
 * Height leaves room for the stroke; the floor keeps a quiet song from
 * drawing a flat line, which would read as "no data" rather than "calm".
 */
export function waveShape(energy: number, height: number, strokeWidth = 1.5): WaveShape {
  const e = clamp01(energy)
  const room = height / 2 - strokeWidth / 2 - 0.25
  return {
    amplitude: room * (0.15 + 0.85 * e),
    cycles: 1 + 2.5 * e,
  }
}

/** The SVG path, sampled every half unit: smooth at any size the app draws it. */
export function energyWavePath(energy: number, width: number, height: number): string {
  const { amplitude, cycles } = waveShape(energy, height)
  const middle = height / 2
  const steps = Math.max(2, Math.round(width * 2))
  let path = ''
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * width
    const y = middle - amplitude * Math.sin((2 * Math.PI * cycles * x) / width)
    path += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
  }
  return path
}
