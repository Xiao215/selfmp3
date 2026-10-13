import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { darkPalette } from '@selfmp3/client'
import * as shared from '@selfmp3/shared'

/*
 * The home-screen widget is Swift, drawn by an Xcode target the app's own
 * code never runs in: its colours reach it as an asset catalogue written at
 * prebuild from `expo-target.config.js`, which reads @selfmp3/shared. A hex
 * copied into the Swift is one that drifts from the app, so the Swift may name
 * only the catalogue's colours, and the catalogue must be the app's.
 */
const target = new URL('../../targets/widget/', import.meta.url)
/** The config's colours, by the @selfmp3/shared constant each one names. */
function configColours(): Record<string, string> {
  const text = readFileSync(new URL('expo-target.config.js', target), 'utf8')
  const block = /colors: \{([^}]*)\}/.exec(text)?.[1] ?? ''
  return Object.fromEntries(
    [...block.matchAll(/([$\w]+): (NATIVE_\w+)/g)].map(([, key, name]) => [
      key,
      (shared as unknown as Record<string, string>)[name ?? ''] ?? name,
    ]),
  )
}
const swift = readFileSync(new URL('SelfMp3Widget.swift', target), 'utf8')

describe('the widget’s colours', () => {
  it('are the dark palette’s, the theme the widget is drawn in', () => {
    const dark = darkPalette()
    expect(configColours()).toEqual({
      $accent: dark.accent,
      $widgetBackground: dark.surface1,
      inkPrimary: dark.textPrimary,
      inkSecondary: dark.textSecondary,
      ground: dark.surface0,
      raised: dark.surface3,
    })
  })

  it('are named in the Swift, never written there', () => {
    expect(swift).not.toMatch(/Color\(hex: "#/)
    const named = [...swift.matchAll(/Color\("([^"]+)"\)/g)].map(match => match[1])
    expect(named.length).toBeGreaterThan(0)
    for (const name of named) expect(Object.keys(configColours()), name).toContain(name)
  })
})
