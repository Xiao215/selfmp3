/** Spike check 6 — an interrupted download resumes from the `.part`. */
const { app, net } = require('electron')
const { createWriteStream, statSync, renameSync, existsSync, createReadStream } = require('node:fs')
const { createHash } = require('node:crypto')
const { join } = require('node:path')

const userData = process.argv.find(one => one.startsWith('--user-data='))?.slice('--user-data='.length)
if (userData) app.setPath('userData', userData)
const url = process.argv.find(one => one.startsWith('--url='))?.slice('--url='.length)
const dir = process.argv.find(one => one.startsWith('--dir='))?.slice('--dir='.length)
const stopAt = Number(process.argv.find(one => one.startsWith('--stop-at='))?.slice('--stop-at='.length) ?? 0)

const part = join(dir, 'song.m4a.part')
const whole = join(dir, 'song.m4a')

/**
 * One pass of the download the shell's `files.download` will do: `net.fetch`
 * with a `Range:` when there is already a `.part`, appending to it, and
 * renaming only when the whole file is there. `stopAfter` aborts mid-stream,
 * which is the interruption being simulated.
 */
async function fetchInto({ from, stopAfter }) {
  const resumeFrom = existsSync(part) ? statSync(part).size : 0
  const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {}
  const controller = new AbortController()
  const response = await net.fetch(from, { headers, signal: controller.signal })

  const out = {
    resumeFrom,
    requested: headers.Range ?? null,
    status: response.status,
    contentRange: response.headers.get('Content-Range'),
  }

  // A server that answers 200 to a ranged request is sending the whole file
  // again, and appending it would corrupt what is on disk.
  if (resumeFrom > 0 && response.status !== 206) {
    out.wouldHaveCorrupted = true
    return out
  }

  const sink = createWriteStream(part, { flags: resumeFrom > 0 ? 'a' : 'w' })
  let written = resumeFrom
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    sink.write(Buffer.from(value))
    written += value.byteLength
    if (stopAfter && written >= stopAfter) {
      out.aborted = true
      await controller.abort()
      break
    }
  }
  await new Promise(resolve => sink.end(resolve))
  out.onDisk = statSync(part).size
  return out
}

function sha256(path) {
  return new Promise(resolve => {
    const hash = createHash('sha256')
    createReadStream(path)
      .on('data', chunk => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

app.whenReady().then(async () => {
  const result = {}
  try {
    result.first = await fetchInto({ from: url, stopAfter: stopAt })
    result.second = await fetchInto({ from: url })
    renameSync(part, whole)
    result.finalBytes = statSync(whole).size
    result.sha256 = await sha256(whole)
    result.partGone = !existsSync(part)
  } catch (error) {
    result.threw = String(error)
  }
  console.log('SPIKE_RESULT ' + JSON.stringify(result))
  app.exit(0)
})
