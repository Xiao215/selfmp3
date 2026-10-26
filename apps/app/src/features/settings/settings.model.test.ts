import { describe, expect, it } from 'vitest'
import { ApiError } from '@selfmp3/client'

import {
  activeSection,
  ALL_SECTIONS,
  crossfadeLabel,
  devicePlace,
  downloadHint,
  healthLine,
  indexIdFor,
  landingOffset,
  RECENT_DEVICE_WINDOW_MS,
  scanHint,
  sectionsFor,
  settingsIndex,
  splitDevices,
} from './settings.model'

const ALL_LABEL = (id: string): string | undefined =>
  ALL_SECTIONS.find(section => section.id === id)?.label

const TOPS = [
  { id: 'a', top: 0 },
  { id: 'b', top: 600 },
  { id: 'c', top: 1200 },
  { id: 'd', top: 1500 },
]

describe('settings', () => {
  it('shows what the server acts on to every device, which reaches the server for it', () => {
    const ids = sectionsFor().map(section => section.id)
    expect(ids).toEqual(expect.arrayContaining(['devices', 'smart', 'library', 'importing']))
    // The server's own page connects its bucket; a device's is under Account.
    expect(ids).not.toContain('cloud')
    expect(sectionsFor()).toHaveLength(9)
    expect(sectionsFor({ installed: false }).map(section => section.id)).not.toContain('offline')
  })

  it('leaves Playback out where the engine cannot crossfade, which is all it holds', () => {
    expect(sectionsFor({ crossfade: true }).map(section => section.id)).toContain('playback')
    expect(sectionsFor({ crossfade: false }).map(section => section.id)).not.toContain('playback')
  })

  it('lists keyboard shortcuts only where there are keys to press', () => {
    const ids = (device: Parameters<typeof sectionsFor>[0]) =>
      sectionsFor(device).map(section => section.id)
    // A browser tab, and an iPad with no keyboard attached: nothing to list.
    expect(ids({ installed: false, keyboard: false, shell: false })).not.toContain('shortcuts')
    expect(ids({ installed: true, keyboard: false, shell: false })).not.toContain('shortcuts')
    // The installed app's menu, and an iPad with a keyboard attached.
    expect(ids({ installed: true, keyboard: true, shell: true })).toContain('shortcuts')
    expect(ids({ installed: true, keyboard: true, shell: false })).toContain('shortcuts')
    expect(ALL_LABEL('shortcuts')).toBe('Keyboard shortcuts')
  })

  it('leads with About, then the account and the look, then what this device keeps', () => {
    expect(sectionsFor().map(section => section.label)).toEqual([
      'About',
      'Account',
      'Appearance',
      'On this phone',
      'Devices',
      'Playback',
      'Smart features',
      'Library',
      'Importing',
    ])
    const computer = sectionsFor({
      shell: true,
      place: devicePlace('desktop', true),
    })
    expect(computer.find(section => section.id === 'offline')?.label).toBe('On this computer')
    expect(devicePlace('phone', true)).toBe('phone')
    expect(devicePlace('phone', true, true)).toBe('iPad')
    expect(devicePlace('phone', false, true)).toBe('browser')
    expect(devicePlace('other', true)).toBe('computer')
    // A tab keeps what it has in the browser, not on the device it runs on.
    expect(devicePlace('desktop', false)).toBe('browser')
    expect(devicePlace('phone', false)).toBe('browser')
  })

  it('puts what runs the server under one Advanced chip at the end (O1)', () => {
    const sections = sectionsFor({ shell: true, keyboard: true })
    expect(settingsIndex(sections).map(section => section.label)).toEqual([
      'About',
      'Account',
      'Appearance',
      'On this phone',
      'Devices',
      'Playback',
      'Smart features',
      'Keyboard shortcuts',
      'Advanced',
    ])
    expect(indexIdFor('importing', sections)).toBe('advanced')
    expect(indexIdFor('desktop', sections)).toBe('advanced')
    expect(indexIdFor('smart', sections)).toBe('smart')
    // Library and Importing are on every device, so Advanced is never empty.
    expect(settingsIndex(sectionsFor()).at(-1)?.id).toBe('advanced')
  })

  it('shows the desktop section only where there is a shell to ask', () => {
    expect(sectionsFor().map(section => section.id)).not.toContain('desktop')
    expect(sectionsFor({ shell: true }).map(section => section.id)).toContain('desktop')
  })

  it('offers the Mac app only to a browser tab on a Mac, in the desktop section\u2019s place', () => {
    expect(sectionsFor().map(section => section.id)).not.toContain('getApp')
    const tab = sectionsFor({
      installed: false,
      place: 'computer',
      offered: true,
    }).map(section => section.id)
    expect(tab).toContain('getApp')
    expect(tab).not.toContain('desktop')
    expect(tab.at(-1)).toBe('getApp')
    expect(ALL_LABEL('getApp')).toBe('Mac app')
  })

  it('tells a browser that cannot name its chip how to find out', () => {
    const base = { loading: false, error: false, version: '1.0.0', offers: 2 }
    expect(downloadHint({ ...base, chip: 'arm64' })).toMatch(/^Version 1\.0\.0\. /)
    expect(downloadHint({ ...base, chip: 'arm64' })).not.toContain('About This Mac')
    expect(downloadHint({ ...base, chip: null })).toContain('About This Mac')
    expect(downloadHint({ ...base, offers: 0, chip: null })).toBe('No release yet.')
    expect(downloadHint({ ...base, loading: true, chip: null })).toBe('Finding the latest version…')
    expect(downloadHint({ ...base, error: true, chip: null })).toContain('releases page')
  })

  it('picks the last section past the reading line', () => {
    expect(activeSection(TOPS, 0, 800, 2400)).toBe('a')
    expect(activeSection(TOPS, 520, 800, 2400)).toBe('b')
  })

  it('lands a chosen section under whatever covers the top, and past the reading line', () => {
    // Beside the index column: under the page's 28pt top padding.
    expect(landingOffset(1250, 28)).toBe(1222)
    // Narrow: under the sticky chips (53pt) and their 14pt gap.
    expect(landingOffset(1780, 67)).toBe(1713)
    // Near the start the page cannot scroll above itself.
    expect(landingOffset(40, 67)).toBe(0)
    // Once there, the scroll-spy agrees it is the section being read.
    const tops = [
      { id: 'a', top: 0 },
      { id: 'b', top: 1250 },
      { id: 'c', top: 1900 },
    ]
    expect(activeSection(tops, landingOffset(1250, 67), 800, 3200)).toBe('b')
  })

  it('gives the short last sections their turn over the final screenful', () => {
    // At the very bottom the line is the bottom edge, so the last section wins.
    expect(activeSection(TOPS, 1600, 800, 2400)).toBe('d')
    expect(activeSection([], 0, 800, 2400)).toBeNull()
    // Two short sections at the foot that never reach the line: each is lit
    // on the way to the bottom, after the one above them has had its turn.
    const short = [
      { id: 'a', top: 0 },
      { id: 'b', top: 600 },
      { id: 'c', top: 2300 },
      { id: 'd', top: 2350 },
    ]
    expect(activeSection(short, 1100, 800, 2400)).toBe('b')
    expect(activeSection(short, 1560, 800, 2400)).toBe('c')
    expect(activeSection(short, 1600, 800, 2400)).toBe('d')
  })

  it('keeps a chosen section lit when the last one is tall enough to reach the line', () => {
    // Playback, Smart features, then an Advanced taller than the screen: landing
    // on Playback and nudging the page must not light the section after it.
    const tall = [
      { id: 'a', top: 0 },
      { id: 'playback', top: 2000 },
      { id: 'smart', top: 2300 },
      { id: 'advanced', top: 2500 },
    ]
    const landed = landingOffset(2000, 28)
    expect(activeSection(tall, landed, 900, 3500)).toBe('playback')
    expect(activeSection(tall, landed + 8, 900, 3500)).toBe('playback')
    expect(activeSection(tall, landingOffset(2300, 28) + 8, 900, 3500)).toBe('smart')
    expect(activeSection(tall, 2600, 900, 3500)).toBe('advanced')
  })

  it('words the rows', () => {
    expect(crossfadeLabel(0)).toBe('Off')
    expect(crossfadeLabel(4)).toBe('4s')
  })

  it('says nothing while it checks, and which side it could not reach', () => {
    expect(healthLine(undefined, { loading: true })).toBeNull()
    expect(healthLine(undefined, { error: true })).toBe('Can’t reach your library')
    const capped = new ApiError(502, 'cap exceeded', 'bucket_cap_exceeded')
    const now = new Date('2026-10-08T04:00:00Z')
    expect(healthLine(undefined, { error: capped, now })).toBe(
      'Storage allowance used up · resets in about 20 hours',
    )
  })

  it('says the bucket is refusing over a doorman that answered, shorter on a phone', () => {
    const doorman = { ok: true as const, version: 'web', uptimeSeconds: 0 }
    const now = new Date('2026-10-08T04:00:00Z')
    expect(healthLine(doorman, {})).toBeNull()
    expect(healthLine(doorman, { capped: true, now })).toBe(
      'Storage allowance used up · resets in about 20 hours',
    )
    expect(healthLine(doorman, { capped: true, compact: true, now })).toBe(
      'Storage allowance used up · 20 h left',
    )
  })

  it('keeps this device, what is online and the last week, and folds the rest away', () => {
    const now = 100 * RECENT_DEVICE_WINDOW_MS
    const row = (id: string, ageMs: number, online = false, copies: string[] = []) => ({
      device: { id, online, lastSeenAt: now - ageMs },
      ids: [id, ...copies],
    })
    const rows = [
      row('me', 30 * RECENT_DEVICE_WINDOW_MS),
      row('phone', 0, true),
      // The newest of a name's folded copies is a device in use; the rest are stale.
      row('mac', RECENT_DEVICE_WINDOW_MS - 1, false, ['mac-2', 'mac-3']),
      row('old', RECENT_DEVICE_WINDOW_MS + 1, false, ['old-2']),
    ]
    const { recent, olderIds } = splitDevices(rows, 'me', now)
    expect(recent.map(entry => entry.device.id)).toEqual(['me', 'phone', 'mac'])
    expect(recent.find(entry => entry.device.id === 'mac')?.ids).toEqual(['mac'])
    expect(olderIds).toEqual(['mac-2', 'mac-3', 'old', 'old-2'])
  })

  it('says nothing over a library that answered, only when it is not connected', () => {
    expect(healthLine(undefined)).toBe('Not connected to your library right now')
    expect(
      healthLine({
        ok: true,
        version: '1.0.0',
        uptimeSeconds: 5,
        songCount: 13,
      }),
    ).toBeNull()
    expect(scanHint({ added: 1, updated: 2, total: 13, durationMs: 40 })).toBe(
      'Last scan: 1 new, 2 updated.',
    )
  })
})
