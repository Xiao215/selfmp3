/**
 * Spike check 6 — resume.
 *
 * A download is interrupted around 40% and taken up again from the `.part`
 * file's size with a `Range:` request; the finished file's SHA-256 has to match
 * the whole. The plan runs this against the dev server's `/api/stream/<id>`;
 * there is no dev library in this container, so it runs against a small Node
 * server answering ranges the same way (`apps/server/src/http/range.ts` is the
 * rule both will share once phase 3 moves it to `packages/shared`).
 */
import { createServer } from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launch, resultFrom, report, scratchUserData, spikeDir } from './lib/run.mjs'

const body = randomBytes(6 * 1024 * 1024)
const expected = createHash('sha256').update(body).digest('hex')

const server = createServer((request, response) => {
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Content-Type', 'audio/mp4')
  if (!match) {
    response.writeHead(200, { 'Content-Length': String(body.length) })
    response.end(body)
    return
  }
  const start = Number(match[1])
  const end = match[2] === '' ? body.length - 1 : Math.min(Number(match[2]), body.length - 1)
  response.writeHead(206, {
    'Content-Range': `bytes ${start}-${end}/${body.length}`,
    'Content-Length': String(end - start + 1),
  })
  response.end(body.subarray(start, end + 1))
})

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const url = `http://127.0.0.1:${server.address().port}/api/stream/1`
const dir = mkdtempSync(join(tmpdir(), 'selfmp3-spike-6-'))

const { finished } = launch(join(spikeDir, 'main', '6-resume.cjs'), {
  args: [`--url=${url}`, `--dir=${dir}`, `--stop-at=${Math.floor(body.length * 0.4)}`],
  userData: scratchUserData('6'),
  timeoutMs: 90_000,
})
const { stdout, stderr, timedOut } = await finished
server.close()

const result = resultFrom(stdout)
if (!result) {
  console.error(stderr.split('\n').slice(-25).join('\n'))
  console.error(timedOut ? 'timed out' : 'no result line')
  process.exit(1)
}

const { first = {}, second = {} } = result

report('6 — resume', [
  { ok: first.aborted === true, what: 'the first pass was cut off mid-stream', note: `${first.onDisk} of ${body.length} bytes` },
  { ok: first.onDisk > 0 && first.onDisk < body.length, what: 'a partial .part was left behind', note: `${((first.onDisk / body.length) * 100).toFixed(0)}%` },
  { ok: second.resumeFrom === first.onDisk, what: 'the second pass asked from exactly where the .part ended', note: String(second.requested) },
  { ok: second.status === 206, what: 'the server answered 206', note: String(second.contentRange) },
  { ok: second.wouldHaveCorrupted !== true, what: 'nothing was appended blindly to a 200' },
  { ok: result.finalBytes === body.length, what: 'the finished file is the whole length', note: `${result.finalBytes} bytes` },
  { ok: result.sha256 === expected, what: 'and its SHA-256 matches the original', note: String(result.sha256).slice(0, 16) },
  { ok: result.partGone === true, what: 'the .part is renamed away, not left beside it' },
], { 'against': 'a local range server — the dev library the plan names is not in this container' })
