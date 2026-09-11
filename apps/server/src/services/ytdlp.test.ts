import { describe, expect, it } from 'vitest'
import { parseProgress, run } from './ytdlp.js'

/**
 * A stand-in for yt-dlp, run as a real child process: progress on stdout, the
 * way yt-dlp prints it, with a line split across two writes and the last one
 * left without a newline.
 */
const FAKE_DOWNLOAD = `
process.stdout.write('[download] Destination: song.m4a\\n')
process.stdout.write('[download]  12.5% of 3.29MiB at 1.00MiB/s ETA 00:03\\n[download]  6')
process.stdout.write('0.0% of 3.29MiB at 1.00MiB/s ETA 00:01\\n')
process.stderr.write('WARNING: something to mention\\n')
process.stdout.write('[download] 100% of 3.29MiB in 00:00:02')
`

describe('run', () => {
  it('hands over whole lines from stdout as well as stderr', async () => {
    const lines: string[] = []
    const result = await run(process.execPath, ['-e', FAKE_DOWNLOAD], {
      onLine: line => lines.push(line),
    })

    expect(result.code).toBe(0)
    expect(lines).toContain('WARNING: something to mention')
    expect(lines.map(parseProgress).filter(percent => percent !== null)).toEqual([12.5, 60, 100])
  })
})

describe('parseProgress', () => {
  it('reads the percentage and ignores every other line', () => {
    expect(parseProgress('[download]  42.1% of 4.03MiB at 2.00MiB/s ETA 00:01')).toBe(42.1)
    expect(parseProgress('[download] 100% of 3.29MiB in 00:00:00 at 8.00MiB/s')).toBe(100)
    expect(parseProgress('[download] Destination: song.m4a')).toBeNull()
    expect(parseProgress('[ExtractAudio] Destination: song.m4a')).toBeNull()
  })
})
