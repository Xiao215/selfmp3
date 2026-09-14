/**
 * Spike check 2 — the engine plays and analyses from `app://`.
 *
 * Bundles `apps/app/src/ports/engine.web.ts` as it stands (it imports only
 * types, so esbuild can take it alone), serves two generated files under
 * `app://selfmp3/_media/songs/`, and asks the engine to play, seek across a
 * range boundary, crossfade into the second, and hand the analyser real
 * samples through `crossOrigin = 'use-credentials'`.
 */
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { launch, resultFrom, report, scratchUserData, spikeDir, repoRoot, writeWav } from './lib/run.mjs'

const stage = mkdtempSync(join(tmpdir(), 'selfmp3-spike-2-'))
const media = mkdtempSync(join(tmpdir(), 'selfmp3-spike-2-media-'))

cpSync(join(spikeDir, 'page'), stage, { recursive: true })
execFileSync(
  join(repoRoot, 'node_modules', '.bin', 'esbuild'),
  [
    join(repoRoot, 'apps', 'app', 'src', 'ports', 'engine.web.ts'),
    '--bundle',
    '--format=iife',
    '--global-name=SpikeEngine',
    '--target=chrome152',
    `--outfile=${join(stage, 'engine.bundle.js')}`,
  ],
  { stdio: 'inherit' },
)

// Long enough that a seek near the end lands outside what has been buffered,
// which is what makes the second range request happen at all.
mkdirSync(join(media, 'songs'), { recursive: true })
writeWav(join(media, 'songs', '1.wav'), { seconds: 120, hz: 440 })
writeWav(join(media, 'songs', '2.wav'), { seconds: 30, hz: 660 })
writeFileSync(join(stage, 'placeholder'), '')

const { finished } = launch(join(spikeDir, 'main', '2-engine.cjs'), {
  args: [`--web-root=${stage}`, `--media-root=${media}`],
  userData: scratchUserData('2'),
  timeoutMs: 150_000,
})
const { stdout, stderr, timedOut } = await finished
const result = resultFrom(stdout)

if (!result?.page) {
  console.error(stderr.split('\n').slice(-25).join('\n'))
  console.error(timedOut ? 'timed out' : `no page result: ${JSON.stringify(result)}`)
  process.exit(1)
}

const page = result.page
const rangesWithOffset = (result.rangeHeaders ?? []).filter(one => !/^bytes=0-$/.test(one))

report('2 — the engine plays and analyses from app://', [
  { ok: page.codecs.aac !== '', what: 'Chromium decodes AAC (the library\'s own format)', note: `canPlayType → ${JSON.stringify(page.codecs.aac)}` },
  { ok: page.codecs.mp3 !== '', what: 'Chromium decodes MP3', note: `canPlayType → ${JSON.stringify(page.codecs.mp3)}` },
  { ok: page.playing === true, what: 'load() and play() work cold, with no gesture', note: `t=${page.afterPlay?.currentTime?.toFixed?.(2)}` },
  { ok: (page.errors ?? []).length === 0, what: 'the engine reported no error', note: JSON.stringify(page.errors) },
  { ok: (result.statuses ?? []).includes(206), what: 'the media handler answered 206', note: JSON.stringify(result.statuses) },
  { ok: rangesWithOffset.length > 0, what: 'a seek asked for a range with an offset', note: JSON.stringify(rangesWithOffset.slice(0, 4)) },
  { ok: page.seeked === true, what: 'the playhead landed where it was sent', note: `t=${page.afterSeek?.toFixed?.(2)} of ${page.duration}` },
  { ok: page.analyserMade === true, what: 'the analyser was built' },
  { ok: (page.analyserPeak ?? 0) > 0, what: 'the analyser reads real samples (CORS satisfied)', note: `peak bin ${page.analyserPeak}` },
  { ok: page.crossfaded === true && page.stillAdvancing === true, what: 'crossfade handed over and the next song keeps playing', note: JSON.stringify(page.afterCrossfade) },
  { ok: page.preservesPitch === true && page.rate === 1.25, what: 'rate and pitch lock take', note: `rate ${page.rate}` },
], {
  'state trace': JSON.stringify(page.trace),
  // Not a desktop question and not part of the verdict: `engine.web.ts` reports
  // `playing: false` after a crossfade, because the outgoing element fires
  // `pause` at its natural end (which the HTML spec requires) a moment before
  // the fade timer swaps the elements, and nothing sets the flag back. The
  // music is audibly playing; only the flag is wrong. Written up in the
  // progress file; fixed in phase 4, where the flag drives Now Playing.
  'playing flag survived the handover': String(page.playingFlagSurvived),
})
