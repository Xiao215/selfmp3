/**
 * Spike check 3 — Now Playing and the media keys.
 *
 * Two halves, and only one of them can run away from a Mac. The API half —
 * metadata with artwork, the action handlers, a position, and Electron leaving
 * Chromium's `HardwareMediaKeyHandling` on — runs anywhere. The half that
 * matters to a person, the Control Center panel and the keyboard's play/pause
 * key, is macOS and a human finger; pass `--interactive` on a Mac and the
 * window stays up for 60 seconds waiting for the key.
 */
import { cpSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, resultFrom, report, scratchUserData, spikeDir, writeWav } from './lib/run.mjs'

const interactive = process.argv.includes('--interactive')
const stage = mkdtempSync(join(tmpdir(), 'selfmp3-spike-3-'))
const media = mkdtempSync(join(tmpdir(), 'selfmp3-spike-3-media-'))
cpSync(join(spikeDir, 'page'), stage, { recursive: true })
mkdirSync(join(media, 'songs'), { recursive: true })
writeWav(join(media, 'songs', '1.wav'), { seconds: 120, hz: 440 })

const { finished } = launch(join(spikeDir, 'main', '3-now-playing.cjs'), {
  args: [`--web-root=${stage}`, `--media-root=${media}`, ...(interactive ? ['--wait=60'] : [])],
  userData: scratchUserData('3'),
  timeoutMs: interactive ? 150_000 : 90_000,
})
const { stdout, stderr, timedOut } = await finished
const result = resultFrom(stdout)

if (!result?.page) {
  console.error(stderr.split('\n').slice(-25).join('\n'))
  console.error(timedOut ? 'timed out' : `no page result: ${JSON.stringify(result)}`)
  process.exit(1)
}

const page = result.page
const onMac = result.platform === 'darwin'
const registered = Object.values(page.actions ?? {}).filter(one => one === 'registered').length

const checks = [
  { ok: page.hasMediaSession === true, what: 'navigator.mediaSession exists in this Electron' },
  { ok: page.playing === true, what: 'the page is actually making sound, which is what publishes a session', note: page.playError ?? '' },
  { ok: page.metadataTitle === 'Spike song', what: 'metadata takes', note: String(page.metadataTitle) },
  { ok: (page.artworkCount ?? 0) === 2, what: 'artwork is carried on the metadata', note: `${page.artworkCount} sizes` },
  { ok: registered === 6, what: 'play, pause, next, previous, seekto and stop all register', note: `${registered}/6` },
  { ok: page.positionState === 'set', what: 'setPositionState is accepted (the scrubber in Control Center)', note: String(page.positionState) },
  { ok: page.playbackState === 'playing', what: 'playbackState reads back' },
  { ok: result.hardwareMediaKeysDisabled === false, what: 'HardwareMediaKeyHandling is left on, so the keys reach the page' },
]

if (interactive && onMac) {
  checks.push({
    ok: (result.pressed ?? []).length > 0,
    what: 'the keyboard play/pause key reached the page',
    note: JSON.stringify(result.pressed ?? []),
  })
}

report('3 — Now Playing and the media keys', checks, {
  'platform': result.platform,
  'the OS half': onMac
    ? interactive
      ? 'run here'
      : 'not run — pass --interactive on a Mac, and look at Control Center while it is up'
    : 'NOT RUNNABLE off macOS: the Control Center panel, its artwork, and a real media key are Xiao\'s to confirm',
})
