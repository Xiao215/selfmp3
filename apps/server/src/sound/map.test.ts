import { describe, expect, it } from 'vitest'
import type { MapPlace } from '@selfmp3/shared'
import { projectSounds } from './map.js'
import { SOUND_DIMENSIONS, unit } from './vectors.js'

/**
 * Songs in clusters: each cluster a random direction, each song that
 * direction with noise of its own, so the songs of one cluster sound alike.
 */
function library(clusters: number, perCluster: number, seed = 1): Map<string, Float32Array> {
  let state = seed
  const random = (): number => {
    state = (state * 16807) % 2147483647
    return state / 2147483647 - 0.5
  }
  const centres = Array.from({ length: clusters }, () =>
    unit(Array.from({ length: SOUND_DIMENSIONS }, random)),
  )
  const songs = new Map<string, Float32Array>()
  centres.forEach((centre, c) => {
    for (let s = 0; s < perCluster; s++) {
      const noisy = Array.from(centre, value => value + random() * 0.08)
      songs.set(`audio/${c}-${String(s).padStart(3, '0')}.m4a`, unit(noisy))
    }
  })
  return songs
}

const clusterOf = (key: string): string => key.split('/')[1]!.split('-')[0]!
const distance = (a: MapPlace, b: MapPlace): number => Math.hypot(a.x - b.x, a.y - b.y)

describe('the sound map', () => {
  it('places every song in the unit square', async () => {
    const places = await projectSounds(library(4, 20))
    expect(places.size).toBe(80)
    for (const place of places.values()) {
      expect(place.x).toBeGreaterThanOrEqual(0)
      expect(place.x).toBeLessThanOrEqual(1)
      expect(place.y).toBeGreaterThanOrEqual(0)
      expect(place.y).toBeLessThanOrEqual(1)
    }
  })

  it('puts songs that sound alike together', async () => {
    const places = await projectSounds(library(6, 25))
    const entries = [...places.entries()]
    // Each song's nearest neighbour on the map is from its own cluster.
    let same = 0
    for (const [key, place] of entries) {
      let best: string | null = null
      let bestDistance = Infinity
      for (const [other, otherPlace] of entries) {
        if (other === key) continue
        const d = distance(place, otherPlace)
        if (d < bestDistance) {
          bestDistance = d
          best = other
        }
      }
      if (best && clusterOf(best) === clusterOf(key)) same++
    }
    expect(same / entries.length).toBeGreaterThan(0.95)
  })

  it('makes the same map from the same songs, in whatever order they come', async () => {
    const songs = library(4, 20)
    const reversed = new Map([...songs.entries()].reverse())
    const first = await projectSounds(songs)
    const again = await projectSounds(reversed)
    for (const [key, place] of first) expect(again.get(key)).toEqual(place)
  })

  it('holds still when a few songs are heard since', async () => {
    const all = library(6, 25)
    const before = new Map([...all.entries()].filter((_, index) => index % 15 !== 0))
    const first = await projectSounds(before)
    const second = await projectSounds(all, { previous: first })
    expect(second.size).toBe(all.size)

    const moves = [...first.entries()].map(([key, place]) => distance(place, second.get(key)!))
    moves.sort((a, b) => a - b)
    const median = moves[Math.floor(moves.length / 2)]!
    expect(median).toBeLessThan(0.05)

    // A map made from nothing may come out turned or flipped: the one made
    // from the last map does not.
    const fresh = await projectSounds(new Map([...all.entries()].reverse().slice(0, all.size - 3)))
    const freshMoves = [...first.keys()]
      .filter(key => fresh.has(key))
      .map(key => distance(first.get(key)!, fresh.get(key)!))
      .sort((a, b) => a - b)
    expect(median).toBeLessThan(freshMoves[Math.floor(freshMoves.length / 2)]!)
  })

  it('lands a song heard since beside the songs it sounds like', async () => {
    const all = library(5, 20)
    const newcomer = 'audio/2-007.m4a'
    const before = new Map([...all.entries()].filter(([key]) => key !== newcomer))
    const second = await projectSounds(all, { previous: await projectSounds(before) })
    const place = second.get(newcomer)!
    const own = [...second.entries()].filter(([key]) => clusterOf(key) === '2' && key !== newcomer)
    const others = [...second.entries()].filter(([key]) => clusterOf(key) !== '2')
    const mean = (rows: [string, MapPlace][]): number =>
      rows.reduce((sum, [, other]) => sum + distance(place, other), 0) / rows.length
    expect(mean(own)).toBeLessThan(mean(others) / 2)
  })

  it('handles a library of one or none', async () => {
    expect((await projectSounds(new Map())).size).toBe(0)
    const one = await projectSounds(new Map([['audio/a.m4a', unit([1, 0, 0])]]))
    expect(one.get('audio/a.m4a')).toEqual({ x: 0.5, y: 0.5 })
    const two = await projectSounds(
      new Map([
        ['audio/a.m4a', unit([1, 0, 0])],
        ['audio/b.m4a', unit([0, 1, 0])],
      ]),
    )
    expect(two.size).toBe(2)
  })
})
