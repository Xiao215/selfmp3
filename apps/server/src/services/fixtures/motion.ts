import { MotionBuilder, type MotionCurveData } from '../dsp.js'

/**
 * A whole song's motion curve from PCM already in hand: `MotionBuilder` in one
 * go, for tests. The server itself only ever feeds a builder as ffmpeg decodes.
 */
export function motionFromPcm(pcm: Float32Array, sampleRate: number): MotionCurveData {
  const builder = new MotionBuilder(sampleRate)
  builder.push(pcm)
  return builder.finish()
}
