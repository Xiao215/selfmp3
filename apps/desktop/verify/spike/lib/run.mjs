/**
 * Shared plumbing for the six spike checks.
 *
 * Each check is a runner (`N-name.mjs`) that spawns Electron on a main-process
 * script in `main/`, waits for one `SPIKE_RESULT <json>` line, and exits 0 or 1
 * on what it says. Nothing here is product code: the branch is thrown away once
 * the results are in `docs/universal-progress.md`.
 */
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const here = dirname(fileURLToPath(import.meta.url))
export const spikeDir = join(here, '..')
export const repoRoot = join(spikeDir, '..', '..', '..', '..')
export const electronBinary = join(repoRoot, 'node_modules', 'electron', 'dist', 'electron')

/**
 * Chromium refuses its sandbox as root, and this container is root; a Mac is
 * not. `--no-sandbox` is a fact about where the check ran, never something the
 * shipped shell asks for.
 */
const rootFlags = process.getuid?.() === 0 ? ['--no-sandbox'] : []

/** A private `userData` per run, so nothing leaks between checks. */
export function scratchUserData(name) {
  return mkdtempSync(join(tmpdir(), `selfmp3-spike-${name}-`))
}

export function launch(mainScript, { args = [], userData, env = {}, timeoutMs = 90_000 } = {}) {
  const child = spawn(
    electronBinary,
    [...rootFlags, mainScript, ...(userData ? [`--user-data=${userData}`] : []), ...args],
    { env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] },
  )

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => {
    stdout += chunk
  })
  child.stderr.on('data', chunk => {
    stderr += chunk
  })

  const finished = new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ code: null, timedOut: true, stdout, stderr })
    }, timeoutMs)
    child.on('exit', code => {
      clearTimeout(timer)
      resolve({ code, timedOut: false, stdout, stderr })
    })
  })

  return { child, finished }
}

export function resultFrom(stdout) {
  const line = stdout.split('\n').find(one => one.startsWith('SPIKE_RESULT '))
  if (!line) return null
  try {
    return JSON.parse(line.slice('SPIKE_RESULT '.length))
  } catch {
    return null
  }
}

/** Report a check's findings and exit with the code the gate reads. */
export function report(name, checks, extra = {}) {
  const failures = checks.filter(one => !one.ok)
  console.log(`\n${name}`)
  for (const one of checks) console.log(`  ${one.ok ? 'pass' : 'FAIL'}  ${one.what}${one.note ? ` — ${one.note}` : ''}`)
  for (const [key, value] of Object.entries(extra)) console.log(`  note  ${key}: ${value}`)
  console.log(failures.length === 0 ? '\nOK\n' : `\n${failures.length} failed\n`)
  process.exit(failures.length === 0 ? 0 : 1)
}

/**
 * A playable file without ffmpeg: PCM in a WAV container, which every Chromium
 * decodes. It is not the AAC the library holds — check 2 asks Chromium whether
 * it decodes that separately, with `canPlayType`, because this container has no
 * encoder to make one with.
 */
export function writeWav(path, { seconds = 3, hz = 440, rate = 44100 } = {}) {
  const frames = Math.floor(seconds * rate)
  const data = Buffer.alloc(frames * 4)
  for (let i = 0; i < frames; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * hz * i) / rate) * 12000)
    data.writeInt16LE(value, i * 4)
    data.writeInt16LE(value, i * 4 + 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  const whole = Buffer.concat([header, data])
  writeFileSync(path, whole)
  return whole
}
