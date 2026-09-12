import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { ensureTones } from './fixtures/tones'
import { serve, type StaticServer } from './server'

/**
 * Spike check 4: the existing web audio engine runs inside the Metro web build.
 *
 * This is one of the two checks docs/UNIVERSAL.md says the plan depends on — if
 * it fails there is no universal app and the migration stops at phase 1. So it
 * asserts the engine's actual behaviour, not just that the page loaded:
 * that it plays, that it preloads the next track into its second element
 * (which is what makes gapless possible at all), and that a crossfade really
 * does have both elements sounding at once.
 *
 * The harness route is app/spike-engine.web.tsx, which imports
 * apps/web/src/player/engine.ts by relative path and unchanged.
 */

let server: StaticServer

test.beforeAll(async () => {
  // The tones are git-ignored (`*.wav`), so a fresh checkout has none.
  ensureTones()
  server = await serve({ dist: join(__dirname, '..', 'dist') })
})

test.afterAll(async () => {
  await server?.close()
})

test('the engine loads, plays and reports progress', async ({ page }) => {
  await page.goto(`${server.url}/spike-engine`)
  await page.waitForFunction(() => Boolean(globalThis.__spikeEngine))

  const played = await page.evaluate(async () => {
    const engine = globalThis.__spikeEngine!
    engine.configure({ crossfadeSeconds: 0, gapless: true })
    await engine.load(1, { autoplay: true })

    // Give it real playing time rather than trusting the state flag alone.
    await new Promise((r) => setTimeout(r, 700))
    return {
      playing: engine.state.playing,
      currentTime: engine.state.currentTime,
      duration: engine.state.duration,
      error: engine.state.error,
    }
  })

  expect(played.error).toBeNull()
  expect(played.playing).toBe(true)
  // Two seconds of tone; the metadata has to have been read for this to be set.
  expect(played.duration).toBeGreaterThan(1.5)
  expect(played.currentTime).toBeGreaterThan(0.3)
})

test('the next track is preloaded into the second element', async ({ page }) => {
  await page.goto(`${server.url}/spike-engine`)
  await page.waitForFunction(() => Boolean(globalThis.__spikeEngine))

  const preloaded = await page.evaluate(async () => {
    const engine = globalThis.__spikeEngine!
    engine.configure({ crossfadeSeconds: 0, gapless: true })
    await engine.load(1, { autoplay: true })

    // The engine preloads once it knows the track's duration; wait for the
    // second element to be given a source rather than guessing at a delay.
    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const sources = (globalThis.__spikeAudio ?? []).map((a) => a.getAttribute('src'))
      if (sources.filter(Boolean).length >= 2) return sources
      await new Promise((r) => setTimeout(r, 100))
    }
    return (globalThis.__spikeAudio ?? []).map((a) => a.getAttribute('src'))
  })

  // Two elements, the first on tone A and the second already holding tone B.
  expect(preloaded.filter(Boolean)).toHaveLength(2)
  expect(preloaded.join(' ')).toContain('tone-a.wav')
  expect(preloaded.join(' ')).toContain('tone-b.wav')
})

test('a crossfade has both elements sounding at once', async ({ page }) => {
  await page.goto(`${server.url}/spike-engine`)
  await page.waitForFunction(() => Boolean(globalThis.__spikeEngine))

  const overlap = await page.evaluate(async () => {
    const engine = globalThis.__spikeEngine!
    // A one-second fade on a two-second tone: the overlap is unmistakable.
    engine.configure({ crossfadeSeconds: 1, gapless: true })
    await engine.load(1, { autoplay: true })

    let bothSounding = false
    let ramped = false

    const deadline = Date.now() + 8000
    while (Date.now() < deadline) {
      const elements = globalThis.__spikeAudio ?? []
      const sounding = elements.filter((a) => !a.paused && a.currentTime > 0)
      if (sounding.length === 2) {
        bothSounding = true
        // Equal-power ramp: during the fade neither is at full volume.
        if (sounding.some((a) => a.volume > 0 && a.volume < 1)) ramped = true
      }
      if (bothSounding && ramped) break
      await new Promise((r) => setTimeout(r, 50))
    }

    return { bothSounding, ramped, error: engine.state.error }
  })

  expect(overlap.error).toBeNull()
  expect(overlap.bothSounding).toBe(true)
  expect(overlap.ramped).toBe(true)
})
