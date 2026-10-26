import type { MapPlace } from '@selfmp3/shared'

/**
 * The sound map (docs/features/sound-map.md): every heard song folded from its
 * 768 numbers down to a place on a plane, so songs that sound alike sit
 * together and the library can be drawn.
 *
 * The fold is UMAP's (McInnes, Healy & Melville, 2018), written out here
 * rather than taken as a package: each song's fifteen nearest neighbours by
 * how they sound become a graph of weighted links, and a layout is pulled
 * along the links and pushed apart from random other songs until the
 * neighbourhoods hold. It keeps clusters and how they sit to each other,
 * which t-SNE does not, and it costs one pass over every pair of songs
 * (about a second for 1,500 songs on an M1) and a few hundred thousand small
 * steps, where t-SNE costs every pair on every step.
 *
 * The same songs always give the same map: songs are taken in key order and
 * the random draws come from a fixed seed. A map made again after a few songs
 * were heard starts from where every song sat before, moves them only a
 * little, and is then turned to lie as the old one did, so the regions stay
 * where they were.
 */

/** How many of a song's nearest neighbours it is linked to. */
const NEIGHBOURS = 15
/** Steps for a map from nothing, and for one that starts from the last map. */
const STEPS = 400
const STEPS_FROM_BEFORE = 100
/** A map starts from the last when at least this share of its songs were on it. */
const FROM_BEFORE_SHARE = 0.75
/** How hard the first step pulls; it eases to nothing by the last. */
const PULL = 1
const PULL_FROM_BEFORE = 0.05
/** Random songs each link pushes away from, per pull. */
const PUSHES = 5
/** UMAP's curve for a minimum distance of 0.1 and a spread of 1. */
const CURVE_A = 1.577
const CURVE_B = 0.8951
const SEED = 0x5eed_0a9
/** The layout's own units: UMAP scales its starting layout to ±10. */
const SPAN = 10
/** The middle of the map fills this much of the square; a far outlier is held at the edge. */
const MARGIN = 0.03
const KEEP_QUANTILE = 0.005

interface ProjectOptions {
  /** Where each song sat on the last map (0–1); the new map starts there. */
  readonly previous?: ReadonlyMap<string, MapPlace>
  /**
   * Waited on between steps so a fold never holds the server for long:
   * `setImmediate` on the server, nothing in a test.
   */
  readonly pause?: () => Promise<void>
}

/**
 * Every song's place, 0–1 on both axes, by the key it was given under. The
 * vectors are unit length (sound/vectors.ts) and all of one length.
 */
export async function projectSounds(
  songs: ReadonlyMap<string, Float32Array>,
  options: ProjectOptions = {},
): Promise<Map<string, MapPlace>> {
  const keys = [...songs.keys()].sort()
  const n = keys.length
  const out = new Map<string, MapPlace>()
  if (n === 0) return out
  if (n === 1) return out.set(keys[0]!, { x: 0.5, y: 0.5 })
  const pause = options.pause ?? (async () => {})
  const dims = songs.get(keys[0]!)!.length
  const data = new Float32Array(n * dims)
  keys.forEach((key, index) => data.set(songs.get(key)!, index * dims))

  const k = Math.min(NEIGHBOURS, n - 1)
  const near = await nearest(data, n, dims, k, pause)
  const links = linkWeights(near, n, k)

  // Most songs already placed: start where they were and settle gently. Many
  // heard since: a map from nothing, which is then turned to lie as the last.
  const previous = options.previous
  const before = previous ? keys.filter(key => previous.has(key)).length : 0
  const fromBefore = previous !== undefined && before >= Math.max(3, n * FROM_BEFORE_SHARE)
  const layout = fromBefore
    ? startFrom(previous, keys, near, k)
    : await principalStart(data, n, dims, pause)
  await settle(
    layout,
    links,
    n,
    fromBefore ? STEPS_FROM_BEFORE : STEPS,
    fromBefore ? PULL_FROM_BEFORE : PULL,
    pause,
  )
  if (previous !== undefined && before >= 3) alignTo(layout, keys, previous)
  const places = fit(layout, n)
  keys.forEach((key, index) => out.set(key, places[index]!))
  return out
}

/** Each song's `k` nearest by how they sound: indices, and the distance to each, nearest first. */
async function nearest(
  data: Float32Array,
  n: number,
  dims: number,
  k: number,
  pause: () => Promise<void>,
): Promise<{ index: Int32Array; distance: Float64Array }> {
  const index = new Int32Array(n * k).fill(-1)
  const closeness = new Float64Array(n * k).fill(-Infinity)
  const keep = (row: number, other: number, value: number): void => {
    const base = row * k
    if (value <= closeness[base + k - 1]!) return
    let at = k - 1
    while (at > 0 && closeness[base + at - 1]! < value) {
      closeness[base + at] = closeness[base + at - 1]!
      index[base + at] = index[base + at - 1]!
      at--
    }
    closeness[base + at] = value
    index[base + at] = other
  }
  for (let i = 0; i < n; i++) {
    const a = i * dims
    for (let j = i + 1; j < n; j++) {
      const b = j * dims
      let sum = 0
      for (let d = 0; d < dims; d++) sum += data[a + d]! * data[b + d]!
      keep(i, j, sum)
      keep(j, i, sum)
    }
    if (i % 8 === 7) await pause()
  }
  // Unit vectors: the straight-line distance is √(2 − 2·cosine).
  const distance = new Float64Array(n * k)
  for (let at = 0; at < n * k; at++) distance[at] = Math.sqrt(Math.max(0, 2 - 2 * closeness[at]!))
  return { index, distance }
}

/** A link between two songs and how much it pulls (0–1). */
interface Links {
  readonly from: Int32Array
  readonly to: Int32Array
  readonly weight: Float64Array
}

/**
 * UMAP's fuzzy neighbourhoods: each song's links fall off from its nearest
 * neighbour at a rate chosen so they add up to log₂ k, which makes a sparse
 * region's songs reach as far as a dense one's. A link either side makes is
 * kept (a + b − ab), in both directions.
 */
function linkWeights(
  near: { index: Int32Array; distance: Float64Array },
  n: number,
  k: number,
): Links {
  const target = Math.log2(k)
  const weights = new Map<number, number>()
  let meanDistance = 0
  for (let at = 0; at < n * k; at++) meanDistance += near.distance[at]!
  meanDistance /= n * k
  for (let i = 0; i < n; i++) {
    const base = i * k
    let rho = 0
    for (let at = 0; at < k; at++) {
      const distance = near.distance[base + at]!
      if (distance > 0) {
        rho = distance
        break
      }
    }
    let low = 0
    let high = Infinity
    let sigma = 1
    for (let step = 0; step < 64; step++) {
      let sum = 0
      for (let at = 0; at < k; at++) {
        sum += Math.exp(-Math.max(0, near.distance[base + at]! - rho) / sigma)
      }
      if (Math.abs(sum - target) < 1e-5) break
      if (sum > target) {
        high = sigma
        sigma = (low + high) / 2
      } else {
        low = sigma
        sigma = high === Infinity ? sigma * 2 : (low + high) / 2
      }
    }
    sigma = Math.max(sigma, 1e-3 * meanDistance)
    for (let at = 0; at < k; at++) {
      const j = near.index[base + at]!
      if (j < 0) continue
      const weight = Math.exp(-Math.max(0, near.distance[base + at]! - rho) / sigma)
      const pair = i < j ? i * n + j : j * n + i
      const other = weights.get(pair)
      weights.set(pair, other === undefined ? weight : other + weight - other * weight)
    }
  }
  const pairs = [...weights.entries()].sort((a, b) => a[0] - b[0])
  const from = new Int32Array(pairs.length * 2)
  const to = new Int32Array(pairs.length * 2)
  const weight = new Float64Array(pairs.length * 2)
  pairs.forEach(([pair, value], at) => {
    const i = Math.floor(pair / n)
    const j = pair % n
    from[at * 2] = i
    to[at * 2] = j
    from[at * 2 + 1] = j
    to[at * 2 + 1] = i
    weight[at * 2] = value
    weight[at * 2 + 1] = value
  })
  return { from, to, weight }
}

/**
 * A first map from nothing: the two directions the songs differ along most
 * (principal components, by power iteration from fixed starting vectors),
 * scaled to ±10. The settling pulls neighbourhoods together from there.
 */
async function principalStart(
  data: Float32Array,
  n: number,
  dims: number,
  pause: () => Promise<void>,
): Promise<Float64Array> {
  const mean = new Float64Array(dims)
  for (let i = 0; i < n; i++) for (let d = 0; d < dims; d++) mean[d]! += data[i * dims + d]! / n
  const components: Float64Array[] = []
  const layout = new Float64Array(n * 2)
  for (let c = 0; c < 2; c++) {
    let v = new Float64Array(dims)
    for (let d = 0; d < dims; d++) v[d] = Math.cos((d + 1) * (c + 1) * 0.7)
    const scores = new Float64Array(n)
    for (let step = 0; step < 60; step++) {
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let d = 0; d < dims; d++) sum += (data[i * dims + d]! - mean[d]!) * v[d]!
        scores[i] = sum
      }
      const next = new Float64Array(dims)
      for (let i = 0; i < n; i++) {
        const score = scores[i]!
        for (let d = 0; d < dims; d++) next[d]! += (data[i * dims + d]! - mean[d]!) * score
      }
      for (const done of components) {
        let along = 0
        for (let d = 0; d < dims; d++) along += next[d]! * done[d]!
        for (let d = 0; d < dims; d++) next[d]! -= along * done[d]!
      }
      let length = 0
      for (let d = 0; d < dims; d++) length += next[d]! * next[d]!
      length = Math.sqrt(length)
      if (length === 0) break
      for (let d = 0; d < dims; d++) next[d]! /= length
      v = next
      await pause()
    }
    components.push(v)
    for (let i = 0; i < n; i++) {
      let sum = 0
      for (let d = 0; d < dims; d++) sum += (data[i * dims + d]! - mean[d]!) * v[d]!
      layout[i * 2 + c] = sum
    }
  }
  let largest = 0
  for (const value of layout) largest = Math.max(largest, Math.abs(value))
  const random = seeded(SEED + 1)
  for (let at = 0; at < layout.length; at++) {
    // A hair of noise, so two songs that sound exactly alike can be told apart.
    layout[at] = (largest > 0 ? (layout[at]! / largest) * SPAN : 0) + (random() - 0.5) * 1e-4
  }
  return layout
}

/**
 * A map that starts from the last one: each song where it was, and a song
 * heard since amid the neighbours it has there.
 */
function startFrom(
  previous: ReadonlyMap<string, MapPlace>,
  keys: readonly string[],
  near: { index: Int32Array },
  k: number,
): Float64Array {
  const n = keys.length
  const layout = new Float64Array(n * 2)
  const placed = new Uint8Array(n)
  let cx = 0
  let cy = 0
  let count = 0
  keys.forEach((key, index) => {
    const place = previous.get(key)
    if (!place) return
    layout[index * 2] = (place.x * 2 - 1) * SPAN
    layout[index * 2 + 1] = (place.y * 2 - 1) * SPAN
    placed[index] = 1
    cx += layout[index * 2]!
    cy += layout[index * 2 + 1]!
    count++
  })
  cx /= count
  cy /= count
  const random = seeded(SEED + 2)
  for (let index = 0; index < n; index++) {
    if (placed[index]) continue
    let x = 0
    let y = 0
    let found = 0
    for (let at = 0; at < k; at++) {
      const j = near.index[index * k + at]!
      if (j < 0 || !placed[j]) continue
      x += layout[j * 2]!
      y += layout[j * 2 + 1]!
      found++
    }
    layout[index * 2] = (found > 0 ? x / found : cx) + (random() - 0.5) * 0.1
    layout[index * 2 + 1] = (found > 0 ? y / found : cy) + (random() - 0.5) * 0.1
  }
  return layout
}

/** UMAP's layout steps: pull along links, push from random songs, gentler each step. */
async function settle(
  layout: Float64Array,
  links: Links,
  n: number,
  steps: number,
  pull: number,
  pause: () => Promise<void>,
): Promise<void> {
  const count = links.weight.length
  if (count === 0) return
  let heaviest = 0
  for (const weight of links.weight) heaviest = Math.max(heaviest, weight)
  // A link is used every `every` steps: the heaviest every step, a light one rarely.
  const every = new Float64Array(count)
  const next = new Float64Array(count)
  const pushEvery = new Float64Array(count)
  const nextPush = new Float64Array(count)
  for (let at = 0; at < count; at++) {
    const weight = links.weight[at]!
    every[at] = weight > heaviest / steps ? heaviest / weight : -1
    next[at] = every[at]!
    pushEvery[at] = every[at]! / PUSHES
    nextPush[at] = pushEvery[at]!
  }
  const random = seeded(SEED)
  const a = CURVE_A
  const b = CURVE_B
  const clip = (value: number): number => (value > 4 ? 4 : value < -4 ? -4 : value)
  for (let step = 0; step < steps; step++) {
    const rate = pull * (1 - step / steps)
    for (let at = 0; at < count; at++) {
      if (every[at]! < 0 || next[at]! > step) continue
      const i = links.from[at]!
      const j = links.to[at]!
      let dx = layout[i * 2]! - layout[j * 2]!
      let dy = layout[i * 2 + 1]! - layout[j * 2 + 1]!
      let d2 = dx * dx + dy * dy
      if (d2 > 0) {
        const coef = (-2 * a * b * Math.pow(d2, b - 1)) / (a * Math.pow(d2, b) + 1)
        const gx = clip(coef * dx) * rate
        const gy = clip(coef * dy) * rate
        layout[i * 2]! += gx
        layout[i * 2 + 1]! += gy
        layout[j * 2]! -= gx
        layout[j * 2 + 1]! -= gy
      }
      next[at]! += every[at]!
      const pushes = Math.floor((step - nextPush[at]!) / pushEvery[at]!)
      for (let push = 0; push < pushes; push++) {
        const other = Math.floor(random() * n)
        if (other === i) continue
        dx = layout[i * 2]! - layout[other * 2]!
        dy = layout[i * 2 + 1]! - layout[other * 2 + 1]!
        d2 = dx * dx + dy * dy
        const coef = d2 > 0 ? (2 * b) / ((0.001 + d2) * (a * Math.pow(d2, b) + 1)) : 0
        layout[i * 2]! += (coef > 0 ? clip(coef * dx) : 4) * rate
        layout[i * 2 + 1]! += (coef > 0 ? clip(coef * dy) : 4) * rate
      }
      nextPush[at]! += pushes * pushEvery[at]!
    }
    if (step % 8 === 7) await pause()
  }
}

/**
 * The new map turned, flipped if need be, scaled and moved to lie over the
 * last one as closely as it can (two-dimensional Procrustes), so a song heard
 * since does not spin the whole map. Left in the last map's 0–1 units.
 */
function alignTo(
  layout: Float64Array,
  keys: readonly string[],
  previous: ReadonlyMap<string, MapPlace>,
): void {
  const shared: [number, MapPlace][] = []
  keys.forEach((key, index) => {
    const place = previous.get(key)
    if (place) shared.push([index, place])
  })
  let px = 0
  let py = 0
  let qx = 0
  let qy = 0
  for (const [index, place] of shared) {
    px += layout[index * 2]!
    py += layout[index * 2 + 1]!
    qx += place.x
    qy += place.y
  }
  px /= shared.length
  py /= shared.length
  qx /= shared.length
  qy /= shared.length
  const fitWith = (flip: 1 | -1) => {
    let dotSum = 0
    let crossSum = 0
    let spread = 0
    for (const [index, place] of shared) {
      const x = layout[index * 2]! - px
      const y = (layout[index * 2 + 1]! - py) * flip
      const u = place.x - qx
      const v = place.y - qy
      dotSum += x * u + y * v
      crossSum += x * v - y * u
      spread += x * x + y * y
    }
    return {
      flip,
      angle: Math.atan2(crossSum, dotSum),
      strength: Math.hypot(dotSum, crossSum),
      spread,
    }
  }
  const plain = fitWith(1)
  const flipped = fitWith(-1)
  const best = flipped.strength > plain.strength ? flipped : plain
  const scale = best.spread > 0 ? best.strength / best.spread : 1
  const cos = Math.cos(best.angle) * scale
  const sin = Math.sin(best.angle) * scale
  for (let index = 0; index < keys.length; index++) {
    const x = layout[index * 2]! - px
    const y = (layout[index * 2 + 1]! - py) * best.flip
    layout[index * 2] = qx + x * cos - y * sin
    layout[index * 2 + 1] = qy + x * sin + y * cos
  }
}

/**
 * The layout into the unit square, its shape kept and centred. The middle
 * 99 % of songs on each axis decide the scale, so one song far from the rest
 * does not shrink everything else to a corner; it is held at the edge.
 */
function fit(layout: Float64Array, n: number): MapPlace[] {
  const range = (axis: 0 | 1): [number, number] => {
    const values = Array.from({ length: n }, (_, index) => layout[index * 2 + axis]!).sort(
      (a, b) => a - b,
    )
    const cut = Math.floor(n * KEEP_QUANTILE)
    return [values[cut]!, values[n - 1 - cut]!]
  }
  const [x0, x1] = range(0)
  const [y0, y1] = range(1)
  const width = x1 - x0
  const height = y1 - y0
  const scale = (1 - 2 * MARGIN) / Math.max(width, height, 1e-9)
  const offsetX = 0.5 - ((x0 + x1) / 2) * scale
  const offsetY = 0.5 - ((y0 + y1) / 2) * scale
  const clamp = (value: number): number => Math.min(1, Math.max(0, value))
  return Array.from({ length: n }, (_, index) => ({
    x: clamp(layout[index * 2]! * scale + offsetX),
    y: clamp(layout[index * 2 + 1]! * scale + offsetY),
  }))
}

/** A small, fast, seeded random source (mulberry32): the same seed, the same draws. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
