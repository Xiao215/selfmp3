import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { serve, type StaticServer } from './server'

/**
 * Spike check 3, web half: at 1280 the same route files render as a sidebar,
 * and under 820 as a tab bar, with navigation working in both.
 *
 * The point is not that a sidebar can be drawn — it is that the sidebar and the
 * tab bar are the *same* `TabTrigger`s over the *same* routes, so adding a
 * screen is one file rather than two. So the test navigates in both shapes and
 * checks the content actually changed, not just that a nav element exists.
 *
 * The iOS half, real native tabs from these files, is .maestro/spike-tabs.yaml.
 */

let server: StaticServer

test.beforeAll(async () => {
  server = await serve({ dist: join(__dirname, '..', 'dist') })
})

test.afterAll(async () => {
  await server?.close()
})

test('the same routes render as a sidebar at 1280 and a tab bar at 375', async ({
  page,
}, testInfo) => {
  await page.goto(`${server.url}/spike-tabs`)
  await expect(page.getByTestId('spike-screen-library')).toBeVisible()

  const desktop = testInfo.project.name === 'desktop'
  const chrome = page.getByTestId('spike-chrome')
  await expect(chrome).toBeVisible()

  // One element, drawn two ways. A sidebar is a fixed-width column down the
  // side; a tab bar is a full-width row along the bottom. The computed style is
  // what separates them, and the box says where it actually ended up.
  const shape = await chrome.evaluate((el) => {
    const style = getComputedStyle(el)
    const box = el.getBoundingClientRect()
    return { flexDirection: style.flexDirection, width: box.width, left: box.left }
  })

  if (desktop) {
    expect(shape.flexDirection).toBe('column')
    expect(shape.width).toBe(220)
    // `row-reverse` has to put it on the left, not the right.
    expect(shape.left).toBe(0)
  } else {
    expect(shape.flexDirection).toBe('row')
    expect(shape.width).toBe(375)
  }
})

test('the triggers navigate, in whichever shape they are drawn', async ({ page }) => {
  await page.goto(`${server.url}/spike-tabs`)
  await expect(page.getByTestId('spike-screen-library')).toBeVisible()

  await page.getByTestId('spike-trigger-playlists').click()
  await expect(page.getByTestId('spike-screen-playlists')).toBeVisible()
  // A tab navigator keeps its screens mounted — that is what makes going back
  // to the library instant and its scroll position survive — so the check is
  // that the old screen is hidden, not that it is gone.
  await expect(page.getByTestId('spike-screen-library')).toBeHidden()

  // Back again, so this is a tab switch and not a one-way trip.
  await page.getByTestId('spike-trigger-library').click()
  await expect(page.getByTestId('spike-screen-library')).toBeVisible()
})
