import { camelotFromKey, keyName, MOTION_RATE, type KeyMode } from '@selfmp3/shared'

/**
 * Signal processing for the analyser, as pure functions over PCM.
 *
 * Deliberately dependency-free: a native DSP module would drag a compiler
 * into `npm install` on the server, and at the scale of a personal library —
 * a couple of minutes of mono audio per song, analysed once, in the
 * background — plain TypeScript math finishes in well under a second.
 *
 * Nothing here knows about files or ffmpeg. The tests hand it synthesised
 * click tracks and chords, and that is the whole point of the split.
 */

export const ANALYSIS_SAMPLE_RATE = 22050

/** Frame/hop for the onset envelope. 256 at 22050 Hz is ~86 frames a second. */
const ONSET_FRAME = 1024
const ONSET_HOP = 256

/** A longer frame for chroma: 5.4 Hz per bin, enough to separate semitones above C2. */
const CHROMA_FRAME = 4096
const CHROMA_HOP = 2048

const MIN_BPM = 60
const MAX_BPM = 200

interface PcmFeatures {
  bpm: number | null
  /** 0–1, how strongly the beat lag stood out in the autocorrelation. */
  beatStrength: number
  energy: number
  key: string | null
  camelot: string | null
  danceability: number | null
}

// --- FFT --------------------------------------------------------------------

const twiddleCache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>()

function twiddles(n: number) {
  const cached = twiddleCache.get(n)
  if (cached) return cached

  const cos = new Float64Array(n / 2)
  const sin = new Float64Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((-2 * Math.PI * i) / n)
    sin[i] = Math.sin((-2 * Math.PI * i) / n)
  }

  const rev = new Uint32Array(n)
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }

  const entry = { cos, sin, rev }
  twiddleCache.set(n, entry)
  return entry
}

/** In-place iterative radix-2 FFT. `re.length` must be a power of two. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`fft size must be a power of two, got ${n}`)
  const { cos, sin, rev } = twiddles(n)

  for (let i = 0; i < n; i++) {
    const j = rev[i] ?? 0
    if (j > i) {
      const tr = re[i] ?? 0
      re[i] = re[j] ?? 0
      re[j] = tr
      const ti = im[i] ?? 0
      im[i] = im[j] ?? 0
      im[j] = ti
    }
  }

  for (let size = 2; size <= n; size *= 2) {
    const half = size / 2
    const step = n / size
    for (let start = 0; start < n; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step] ?? 1
        const wi = sin[k * step] ?? 0
        const a = start + k
        const b = a + half
        const br = re[b] ?? 0
        const bi = im[b] ?? 0
        const xr = br * wr - bi * wi
        const xi = br * wi + bi * wr
        const ar = re[a] ?? 0
        const ai = im[a] ?? 0
        re[a] = ar + xr
        im[a] = ai + xi
        re[b] = ar - xr
        im[b] = ai - xi
      }
    }
  }
}

function hann(n: number): Float64Array {
  const w = new Float64Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

/**
 * Walk a signal frame by frame and hand each magnitude spectrum to `fn`.
 * The spectrum buffer is reused, so callers must not keep a reference.
 */
function forEachSpectrum(
  pcm: Float32Array,
  frameSize: number,
  hop: number,
  fn: (magnitude: Float64Array) => void,
): void {
  if (pcm.length < frameSize) return
  const window = hann(frameSize)
  const re = new Float64Array(frameSize)
  const im = new Float64Array(frameSize)
  const magnitude = new Float64Array(frameSize / 2)

  for (let start = 0; start + frameSize <= pcm.length; start += hop) {
    for (let i = 0; i < frameSize; i++) {
      re[i] = (pcm[start + i] ?? 0) * (window[i] ?? 0)
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < frameSize / 2; k++) {
      const r = re[k] ?? 0
      const j = im[k] ?? 0
      magnitude[k] = Math.sqrt(r * r + j * j)
    }
    fn(magnitude)
  }
}

// --- onsets and tempo --------------------------------------------------------

interface OnsetEnvelope {
  readonly values: Float64Array
  /** Frames per second. */
  readonly frameRate: number
}

/**
 * Spectral flux: how much each frame's spectrum grew over the previous one.
 *
 * Only increases count (half-wave rectified) — a note starting is an onset,
 * a note decaying is not. Log compression keeps a quiet hi-hat from being
 * drowned out by a loud bass note in the same frame.
 */
export function onsetEnvelope(pcm: Float32Array, sampleRate: number): OnsetEnvelope {
  const frameRate = sampleRate / ONSET_HOP
  const bins = ONSET_FRAME / 2
  // Ignore the top of the spectrum: above ~8 kHz there is mostly noise.
  const maxBin = Math.min(bins, Math.floor((8000 / sampleRate) * ONSET_FRAME))

  const flux: number[] = []
  const previous = new Float64Array(bins)
  let first = true

  forEachSpectrum(pcm, ONSET_FRAME, ONSET_HOP, magnitude => {
    let sum = 0
    for (let k = 1; k < maxBin; k++) {
      const value = Math.log1p(20 * (magnitude[k] ?? 0))
      const delta = value - (previous[k] ?? 0)
      if (delta > 0) sum += delta
      previous[k] = value
    }
    flux.push(first ? 0 : sum)
    first = false
  })

  return { values: Float64Array.from(flux), frameRate }
}

/** Normalised autocorrelation of a mean-removed signal, for lags 0..maxLag. */
export function autocorrelate(values: Float64Array, maxLag: number): Float64Array {
  const n = values.length
  let mean = 0
  for (let i = 0; i < n; i++) mean += values[i] ?? 0
  mean /= Math.max(1, n)

  const x = new Float64Array(n)
  let power = 0
  for (let i = 0; i < n; i++) {
    const v = (values[i] ?? 0) - mean
    x[i] = v
    power += v * v
  }

  const out = new Float64Array(maxLag + 1)
  if (power <= 0) return out
  for (let lag = 0; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += (x[i] ?? 0) * (x[i + lag] ?? 0)
    out[lag] = sum / power
  }
  return out
}

function interpolate(values: Float64Array, position: number): number {
  const lower = Math.floor(position)
  const upper = lower + 1
  if (lower < 0 || upper >= values.length) return 0
  const t = position - lower
  return (values[lower] ?? 0) * (1 - t) + (values[upper] ?? 0) * t
}

/**
 * Tempo from an onset envelope.
 *
 * A comb filter over the autocorrelation: each candidate tempo is scored by
 * the correlation at its beat lag and the next three multiples, so a real
 * pulse — which repeats at every bar as well as every beat — beats a lag
 * that only lines up once. A log-normal prior centred on 120 BPM breaks the
 * octave tie that any autocorrelation method has (is it 80 or 160?) toward
 * where people actually hear the beat.
 */
export function estimateTempo(envelope: OnsetEnvelope): { bpm: number | null; strength: number } {
  const { values, frameRate } = envelope
  const maxLag = Math.ceil((60 / MIN_BPM) * frameRate) * 4
  if (values.length < maxLag * 2) return { bpm: null, strength: 0 }

  const acf = autocorrelate(values, maxLag)

  const harmonicWeights = [1, 0.75, 0.5, 0.25]
  const rawScore = (bpm: number): number => {
    const lag = (60 / bpm) * frameRate
    let score = 0
    for (let h = 0; h < harmonicWeights.length; h++) {
      score += (harmonicWeights[h] ?? 0) * interpolate(acf, lag * (h + 1))
    }
    return score
  }
  const prior = (bpm: number): number => {
    const octaves = Math.log2(bpm / 120)
    return Math.exp(-0.5 * (octaves / 0.7) ** 2)
  }

  let bestBpm = 0
  let bestScore = -Infinity
  for (let bpm = MIN_BPM; bpm <= MAX_BPM; bpm += 0.5) {
    const score = rawScore(bpm) * prior(bpm)
    if (score > bestScore) {
      bestScore = score
      bestBpm = bpm
    }
  }

  const strength = Math.max(0, Math.min(1, interpolate(acf, (60 / bestBpm) * frameRate)))
  // Nothing periodic enough to call a beat — silence, speech, ambient.
  if (strength < 0.08) return { bpm: null, strength }

  // Octave correction: an extreme answer whose half or double is nearly as
  // good is almost always the other one.
  const raw = rawScore(bestBpm)
  if (bestBpm > 170 && rawScore(bestBpm / 2) >= raw * 0.8) bestBpm /= 2
  else if (bestBpm < 70 && bestBpm * 2 <= MAX_BPM && rawScore(bestBpm * 2) >= raw * 0.8) {
    bestBpm *= 2
  }

  // Parabolic refinement around the grid winner for sub-step precision.
  const step = 0.25
  const left = rawScore(bestBpm - step)
  const centre = rawScore(bestBpm)
  const right = rawScore(bestBpm + step)
  const denominator = left - 2 * centre + right
  if (denominator < 0) {
    const offset = (0.5 * (left - right)) / denominator
    if (Math.abs(offset) < 1) bestBpm += offset * step
  }

  return { bpm: Math.round(bestBpm * 10) / 10, strength }
}

/**
 * Onset positions, in frames: local maxima that clear a moving threshold.
 * Used for beat regularity and for how "busy" a track is.
 */
function pickOnsets(envelope: OnsetEnvelope): number[] {
  const { values, frameRate } = envelope
  const n = values.length
  if (n === 0) return []

  let max = 0
  for (let i = 0; i < n; i++) max = Math.max(max, values[i] ?? 0)
  if (max <= 0) return []

  const window = Math.round(frameRate * 0.5)
  const minGap = Math.max(1, Math.round(frameRate * 0.05))
  const onsets: number[] = []
  let last = -Infinity

  for (let i = 1; i < n - 1; i++) {
    const v = values[i] ?? 0
    if (v <= (values[i - 1] ?? 0) || v < (values[i + 1] ?? 0)) continue

    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - window); j < Math.min(n, i + window); j++) {
      sum += values[j] ?? 0
      count++
    }
    const localMean = sum / Math.max(1, count)
    if (v < localMean * 1.5 + max * 0.05) continue
    if (i - last < minGap) continue

    onsets.push(i)
    last = i
  }
  return onsets
}

/**
 * Beat regularity, 0–1.
 *
 * Each gap between onsets is compared with the beat period. A gap that is a
 * clean multiple (or half) of the beat is "on the grid"; the score is the
 * fraction of gaps that are, blended with how strong the pulse was to begin
 * with. Four-on-the-floor scores near 1, rubato piano near 0.
 */
function beatRegularity(
  onsets: readonly number[],
  frameRate: number,
  bpm: number,
  strength: number,
): number {
  if (onsets.length < 4 || !(bpm > 0)) return 0
  const period = (60 / bpm) * frameRate
  const gridPoints = [0.5, 1, 1.5, 2, 3, 4]

  let regular = 0
  let total = 0
  for (let i = 1; i < onsets.length; i++) {
    const ratio = ((onsets[i] ?? 0) - (onsets[i - 1] ?? 0)) / period
    if (ratio > 4.5) continue
    total++
    let deviation = Infinity
    for (const point of gridPoints) deviation = Math.min(deviation, Math.abs(ratio - point))
    if (deviation <= 0.12) regular++
  }
  if (total === 0) return 0

  const regularity = regular / total
  return Math.max(0, Math.min(1, 0.5 * regularity + 0.5 * Math.min(1, strength * 1.5)))
}

// --- loudness and energy ------------------------------------------------------

export function rms(pcm: Float32Array): number {
  if (pcm.length === 0) return 0
  let sum = 0
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] ?? 0
    sum += v * v
  }
  return Math.sqrt(sum / pcm.length)
}

/**
 * Perceived energy, 0–1.
 *
 * Mostly level — RMS on a curve that puts a quiet acoustic recording around
 * 0.2 and a brickwalled club track near 1 — with a share for how many
 * onsets a second there are, so a loud drone still reads calmer than a loud
 * drum break at the same level.
 */
export function energyScore(pcm: Float32Array, onsetsPerSecond: number): number {
  const level = rms(pcm)
  if (level <= 0) return 0
  const db = 20 * Math.log10(level)
  const loud = clamp01((db + 32) / 24)
  const busy = clamp01(onsetsPerSecond / 6)
  return Math.round(clamp01(0.7 * loud + 0.3 * busy) * 1000) / 1000
}

// --- key ---------------------------------------------------------------------

/** Krumhansl-Kessler tonal hierarchies: how much each scale degree "belongs". */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]

/** Twelve-bin pitch-class energy summed over the whole clip. */
export function chroma(pcm: Float32Array, sampleRate: number): Float64Array {
  const out = new Float64Array(12)
  const binHz = sampleRate / CHROMA_FRAME
  // C2 up to ~C7: below that the bins cannot separate semitones, above it
  // there is little but overtones and cymbals.
  const minBin = Math.ceil(65 / binHz)
  const maxBin = Math.min(CHROMA_FRAME / 2 - 1, Math.floor(2100 / binHz))

  const pitchClassOfBin = new Int8Array(maxBin + 1)
  const binsOfPitchClass = new Float64Array(12)
  for (let k = minBin; k <= maxBin; k++) {
    const midi = 12 * Math.log2((k * binHz) / 440) + 69
    const pc = ((Math.round(midi) % 12) + 12) % 12
    pitchClassOfBin[k] = pc
    binsOfPitchClass[pc] = (binsOfPitchClass[pc] ?? 0) + 1
  }

  forEachSpectrum(pcm, CHROMA_FRAME, CHROMA_HOP, magnitude => {
    for (let k = minBin; k <= maxBin; k++) {
      const pc = pitchClassOfBin[k] ?? 0
      // Log compression so a single loud bass note does not decide the key.
      out[pc] = (out[pc] ?? 0) + Math.log1p(10 * (magnitude[k] ?? 0))
    }
  })
  // A mean per bin, not a sum. The bins are evenly spaced in Hz, so between
  // C2 and C7 some pitch classes get twice as many as others (B 40, C♯ 20);
  // summed, that tilt alone correlated best with A minor, and every song in
  // a library came out 8A.
  for (let pc = 0; pc < 12; pc++) {
    const bins = binsOfPitchClass[pc] ?? 0
    out[pc] = bins > 0 ? (out[pc] ?? 0) / bins : 0
  }
  return out
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length
  let meanA = 0
  let meanB = 0
  for (let i = 0; i < n; i++) {
    meanA += a[i] ?? 0
    meanB += b[i] ?? 0
  }
  meanA /= n
  meanB /= n
  let num = 0
  let denA = 0
  let denB = 0
  for (let i = 0; i < n; i++) {
    const da = (a[i] ?? 0) - meanA
    const db = (b[i] ?? 0) - meanB
    num += da * db
    denA += da * da
    denB += db * db
  }
  const den = Math.sqrt(denA * denB)
  return den > 0 ? num / den : 0
}

interface KeyEstimate {
  pitchClass: number
  mode: KeyMode
  /** Correlation with the winning profile, -1..1. */
  confidence: number
}

/**
 * Krumhansl-Schmuckler: correlate the chroma with each of the 24 key
 * profiles and take the best. Returns null when nothing fits — a flat
 * chroma (noise, speech, silence) correlates with nothing.
 */
export function estimateKey(chromaVector: Float64Array): KeyEstimate | null {
  const observed = Array.from(chromaVector)
  const total = observed.reduce((sum, v) => sum + v, 0)
  if (total <= 0) return null

  let best: KeyEstimate | null = null
  for (const mode of ['major', 'minor'] as const) {
    const profile = mode === 'major' ? MAJOR_PROFILE : MINOR_PROFILE
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = observed.map((_, i) => profile[(((i - tonic) % 12) + 12) % 12] ?? 0)
      const score = correlation(observed, rotated)
      if (!best || score > best.confidence) best = { pitchClass: tonic, mode, confidence: score }
    }
  }

  if (!best || best.confidence < 0.25) return null
  return best
}

// --- everything at once ---------------------------------------------------------

/** Run the whole PCM pipeline. Loudness is not here: ffmpeg measures it. */
export function analyzePcm(pcm: Float32Array, sampleRate: number): PcmFeatures {
  const envelope = onsetEnvelope(pcm, sampleRate)
  const tempo = estimateTempo(envelope)
  const onsets = pickOnsets(envelope)
  const seconds = pcm.length / sampleRate
  const onsetsPerSecond = seconds > 0 ? onsets.length / seconds : 0

  const key = estimateKey(chroma(pcm, sampleRate))

  return {
    bpm: tempo.bpm,
    beatStrength: tempo.strength,
    energy: energyScore(pcm, onsetsPerSecond),
    key: key ? keyName(key.pitchClass, key.mode) : null,
    camelot: key ? camelotFromKey(key.pitchClass, key.mode) : null,
    danceability:
      tempo.bpm === null
        ? null
        : Math.round(beatRegularity(onsets, envelope.frameRate, tempo.bpm, tempo.strength) * 1000) /
          1000,
  }
}

// --- the motion curve ------------------------------------------------------------

/**
 * The rate the whole song is decoded at for its motion curve. Half the
 * analysis rate: loudness and onsets need nothing above 5.5 kHz, and a
 * fifteen-minute song is then 40 MB of float PCM at worst rather than 80 —
 * though `MotionBuilder` never holds more than one onset window of it.
 */
export const MOTION_SAMPLE_RATE = 11025

/** The quietest level the loudness byte can say; anything below is 0. */
const MOTION_FLOOR_DB = -60

/** Onset strength at this percentile of the song is 255: a few peaks clip, the rest has room. */
const MOTION_ONSET_PERCENTILE = 0.98

/** A motion curve before it is written down: one byte a frame of each. */
export interface MotionCurveData {
  /** Frames per second. */
  readonly rate: number
  /** Seconds covered. */
  readonly duration: number
  readonly loudness: Uint8Array
  readonly onset: Uint8Array
}

/**
 * Builds a song's motion curve from PCM handed over in pieces, as ffmpeg
 * streams it, so a whole song never has to sit in memory at once.
 *
 * Loudness is RMS per 50 ms frame. Onsets are the same spectral flux as
 * `onsetEnvelope` — the same ~46 ms window and ~86 Hz hop, whatever the
 * sample rate — with each 50 ms frame taking the strongest flux whose window
 * is centred in it, so a hit is one tall frame rather than smeared over two.
 * Only the per-frame numbers are kept, and the onsets are scaled by the
 * song's own 98th percentile at the end: a gentle song's hits are as visible
 * as a loud one's, and its quiet passages still read quiet through loudness.
 */
export class MotionBuilder {
  readonly #sampleRate: number
  readonly #frameSize: number
  readonly #hop: number
  readonly #maxBin: number
  readonly #window: Float64Array
  readonly #re: Float64Array
  readonly #im: Float64Array
  readonly #previous: Float64Array
  /** The last `frameSize` samples, filled up to `#fill`. */
  readonly #buffer: Float32Array
  #fill = 0
  #spectra = 0

  /** Samples seen so far. */
  #samples = 0
  /** The loudness frame the next sample falls in, and the first sample of the frame after it. */
  #frame = 0
  #nextBoundary: number
  #sumSquares = 0
  #count = 0
  readonly #loudness: number[] = []
  readonly #onset: number[] = []

  constructor(sampleRate: number) {
    this.#sampleRate = sampleRate
    // 1024/256 at 22050 Hz, 512/128 at 11025 Hz: the same span of time either way.
    this.#frameSize = 2 ** Math.round(Math.log2((ONSET_FRAME * sampleRate) / ANALYSIS_SAMPLE_RATE))
    this.#hop = this.#frameSize / (ONSET_FRAME / ONSET_HOP)
    const bins = this.#frameSize / 2
    this.#maxBin = Math.min(bins, Math.floor((8000 / sampleRate) * this.#frameSize))
    this.#window = hann(this.#frameSize)
    this.#re = new Float64Array(this.#frameSize)
    this.#im = new Float64Array(this.#frameSize)
    this.#previous = new Float64Array(bins)
    this.#buffer = new Float32Array(this.#frameSize)
    this.#nextBoundary = this.#boundary(1)
  }

  /** The first sample of loudness frame `frame`. */
  #boundary(frame: number): number {
    return Math.ceil((frame * this.#sampleRate) / MOTION_RATE)
  }

  push(chunk: Float32Array): void {
    let at = 0
    while (at < chunk.length) {
      // Loudness, sample by sample into the current frame.
      const take = Math.min(chunk.length - at, this.#frameSize - this.#fill)
      for (let i = 0; i < take; i++) {
        const v = chunk[at + i] ?? 0
        if (this.#samples >= this.#nextBoundary) this.#closeLoudnessFrame()
        this.#sumSquares += v * v
        this.#count++
        this.#samples++
      }
      // Onsets, a window at a time.
      this.#buffer.set(chunk.subarray(at, at + take), this.#fill)
      this.#fill += take
      at += take
      if (this.#fill === this.#frameSize) {
        this.#spectrum()
        this.#buffer.copyWithin(0, this.#hop)
        this.#fill -= this.#hop
      }
    }
  }

  #closeLoudnessFrame(): void {
    this.#loudness[this.#frame] = this.#count > 0 ? this.#sumSquares / this.#count : -1
    this.#sumSquares = 0
    this.#count = 0
    this.#frame++
    this.#nextBoundary = this.#boundary(this.#frame + 1)
    // A frame can hold no samples when a boundary falls between two of them.
    while (this.#samples >= this.#nextBoundary) {
      this.#loudness[this.#frame] = -1
      this.#frame++
      this.#nextBoundary = this.#boundary(this.#frame + 1)
    }
  }

  #spectrum(): void {
    const size = this.#frameSize
    const re = this.#re
    const im = this.#im
    for (let i = 0; i < size; i++) {
      re[i] = (this.#buffer[i] ?? 0) * (this.#window[i] ?? 0)
      im[i] = 0
    }
    fft(re, im)

    let flux = 0
    for (let k = 1; k < this.#maxBin; k++) {
      const r = re[k] ?? 0
      const j = im[k] ?? 0
      const value = Math.log1p(20 * Math.sqrt(r * r + j * j))
      const delta = value - (this.#previous[k] ?? 0)
      if (delta > 0) flux += delta
      this.#previous[k] = value
    }
    if (this.#spectra === 0) flux = 0

    const centre = this.#spectra * this.#hop + size / 2
    const frame = Math.floor((centre * MOTION_RATE) / this.#sampleRate)
    if (flux > (this.#onset[frame] ?? 0)) this.#onset[frame] = flux
    this.#spectra++
  }

  finish(): MotionCurveData {
    if (this.#count > 0) this.#closeLoudnessFrame()
    const duration = this.#samples / this.#sampleRate
    const frames = Math.ceil(duration * MOTION_RATE - 1e-9)

    const loudness = new Uint8Array(frames)
    let last = 0
    for (let i = 0; i < frames; i++) {
      const meanSquare = this.#loudness[i] ?? -1
      if (meanSquare < 0) {
        // An empty frame says what the one before it said.
        loudness[i] = last
        continue
      }
      const db = meanSquare > 0 ? 10 * Math.log10(meanSquare) : -Infinity
      last = Math.round(clamp01((db - MOTION_FLOOR_DB) / -MOTION_FLOOR_DB) * 255)
      loudness[i] = last
    }

    const raw = new Float64Array(frames)
    for (let i = 0; i < frames; i++) raw[i] = this.#onset[i] ?? 0
    const sorted = Float64Array.from(raw).sort()
    let scale = sorted[Math.floor(MOTION_ONSET_PERCENTILE * (frames - 1))] ?? 0
    // Mostly silence with a few hits: the hits themselves set the scale.
    if (scale <= 1e-9) scale = sorted[frames - 1] ?? 0
    const onset = new Uint8Array(frames)
    if (scale > 1e-9) {
      for (let i = 0; i < frames; i++) {
        onset[i] = Math.round(clamp01((raw[i] ?? 0) / scale) * 255)
      }
    }

    return { rate: MOTION_RATE, duration, loudness, onset }
  }
}

/** A whole song's motion curve from PCM already in hand: `MotionBuilder` in one go. */
export function motionFromPcm(pcm: Float32Array, sampleRate: number): MotionCurveData {
  const builder = new MotionBuilder(sampleRate)
  builder.push(pcm)
  return builder.finish()
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
