import { spawn } from 'node:child_process'

/**
 * Running ffmpeg once, the way every caller here wants it: never through a
 * shell, so a song's path is only ever an argument; killed past a deadline,
 * so a file that hangs it cannot hang the caller; and with the end of what it
 * said on stderr kept, which is where both its errors and its summaries go.
 */

interface FfmpegOptions {
  readonly timeoutMs: number
  /** What a run killed at the deadline is reported as. */
  readonly timeoutMessage: string
  /** Each piece of stdout, as ffmpeg writes it. */
  readonly onStdout?: (chunk: Buffer) => void
  /** How much of stderr to keep, counted back from its end. */
  readonly stderrTail?: number
}

interface FfmpegResult {
  /** The exit code; null when it was ended by a signal. */
  readonly code: number | null
  /** The last `stderrTail` characters it wrote there. */
  readonly stderr: string
}

const DEFAULT_STDERR_TAIL = 4096

/**
 * Resolves once ffmpeg has exited, whatever its code; rejects when it could
 * not be run at all, or ran past the deadline and was killed.
 */
export function runFfmpeg(args: readonly string[], options: FfmpegOptions): Promise<FfmpegResult> {
  const tail = options.stderrTail ?? DEFAULT_STDERR_TAIL
  return new Promise<FfmpegResult>((resolve, reject) => {
    const child = spawn('ffmpeg', [...args], { shell: false, windowsHide: true })
    let stderr = ''
    let settled = false

    const settle = (finish: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      finish()
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      settle(() => reject(new Error(options.timeoutMessage)))
    }, options.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      if (!settled) options.onStdout?.(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString('utf8')).slice(-tail)
    })
    child.on('error', error =>
      settle(() => reject(new Error(`could not run ffmpeg: ${error.message}`))),
    )
    child.on('close', code => settle(() => resolve({ code, stderr })))
  })
}

/** The reason ffmpeg gave for failing: its last line on stderr, or its exit code. */
export function ffmpegFailure(result: FfmpegResult): Error {
  return new Error(result.stderr.trim().split('\n').pop() || `ffmpeg exited with ${result.code}`)
}
