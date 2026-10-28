import { describe, expect, it } from 'vitest'
import { ANDROID_DOWNLOAD_URL, fetchAndroidLatest } from './androidApp.js'
import { fetchIosLatest, type IosLatest } from './iosApp.js'
import {
  BUILD_ANNOUNCE_GAP_MS,
  BUILD_INSTALL_WATCH_MS,
  INSTALL_PAGE_URL,
  announcesBuild,
  installOutcome,
  isNewerBuild,
  type PhoneBuild,
} from './phoneBuilds.js'

const latest = (build: number): PhoneBuild => ({
  version: '1.0.0',
  build,
  commit: 'abc1234',
  publishedAt: '2026-10-24T00:00:00Z',
})

const answer = (status: number, body: unknown = {}): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch

describe('the phone app for friends', () => {
  it('keeps every build at one address, on a release of its own per phone', () => {
    expect(INSTALL_PAGE_URL).toBe('https://xiao215.github.io/selfmp3/install/')
    expect(ANDROID_DOWNLOAD_URL).toBe(
      'https://github.com/Xiao215/selfmp3/releases/download/android/selfmp3.apk',
    )
  })

  it('offers a build only when it is later than this one', () => {
    expect(isNewerBuild(latest(120), 119)).toBe(true)
    expect(isNewerBuild(latest(120), 120)).toBe(false)
    expect(isNewerBuild(latest(120), 121)).toBe(false)
    expect(isNewerBuild(null, 1)).toBe(false)
    expect(isNewerBuild(latest(120), Number.NaN)).toBe(false)
  })

  it('tells, on starting again, whether the build handed to the system went in', () => {
    const tried = { build: 120, at: 0 }
    expect(installOutcome(tried, 120, 60_000)).toBe('in')
    expect(installOutcome(tried, 121, 60_000)).toBe('in')
    expect(installOutcome(tried, 119, 60_000)).toBe('not-in')
    expect(installOutcome(tried, 119, BUILD_INSTALL_WATCH_MS + 1)).toBeNull()
    expect(installOutcome(null, 119, 0)).toBeNull()
    expect(installOutcome(tried, Number.NaN, 0)).toBeNull()
  })

  it('says a newer build is ready at most once a day, and each build once', () => {
    const day = BUILD_ANNOUNCE_GAP_MS
    expect(announcesBuild(120, null, 0)).toBe(true)
    expect(announcesBuild(121, { build: 120, at: 0 }, day - 1)).toBe(false)
    expect(announcesBuild(121, { build: 120, at: 0 }, day)).toBe(true)
    expect(announcesBuild(120, { build: 120, at: 0 }, day * 3)).toBe(false)
  })

  it('reads the release’s build, and takes no release or a strange answer as none', async () => {
    await expect(fetchAndroidLatest(answer(200, latest(7)))).resolves.toEqual(latest(7))
    await expect(fetchAndroidLatest(answer(404))).resolves.toBeNull()
    await expect(fetchAndroidLatest(answer(200, { build: 'seven' }))).resolves.toBeNull()
    await expect(fetchAndroidLatest(answer(503))).rejects.toThrow('503')
  })

  it('wants the iPhones an iPhone build lists, which an Android build has none of', async () => {
    const ios: IosLatest = { ...latest(7), devices: ['a'] }
    await expect(fetchIosLatest(answer(200, ios))).resolves.toEqual(ios)
    await expect(fetchIosLatest(answer(200, latest(7)))).resolves.toBeNull()
  })
})
