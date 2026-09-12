import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { serve, type StaticServer } from './server'

/**
 * Companion to spike check 5 — not one of the six, and not in the gate list.
 *
 * Check 5 is "a `'use dom'` component draws the song visual on iOS", and only a
 * simulator can answer it. But if that flow fails on the Mac, the useful next
 * question is whether the drawing is broken or the webview is, and there is no
 * way to tell after the fact. So this asserts the drawing itself paints here,
 * in a browser, where the component is ordinary React DOM.
 *
 * A red Maestro run with this green means the webview. A red run with this red
 * means the canvas code, and the simulator was never the problem.
 */

let server: StaticServer

test.beforeAll(async () => {
  server = await serve({ dist: join(__dirname, '..', 'dist') })
})

test.afterAll(async () => {
  await server?.close()
})

test('the song visual paints to a canvas', async ({ page }) => {
  await page.goto(`${server.url}/spike-dom`)

  const status = page.locator('[data-testid="spike-canvas-status"]')
  await expect(status).toHaveText('canvas-painted', { timeout: 10_000 })

  // And it is a drawing, not a flat fill: sample a few points and require more
  // than one colour among them.
  const distinct = await page.locator('[data-testid="spike-canvas"]').evaluate(
    (canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d')!
      const seen = new Set<string>()
      for (const [x, y] of [
        [10, 10],
        [150, 150],
        [150, 60],
        [60, 240],
        [290, 290],
      ]) {
        const { data } = ctx.getImageData(x, y, 1, 1)
        seen.add(`${data[0]},${data[1]},${data[2]}`)
      }
      return seen.size
    },
  )

  expect(distinct).toBeGreaterThan(1)
})
