import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { formatBytes } from '@selfmp3/shared'
import type { ServerClient } from './api.js'

const exec = promisify(execFile)

/**
 * `selfmp3 doctor`: the five things that are usually wrong when something does
 * not work, each on one line with a tick or a cross. Mirrors scripts/doctor.sh
 * but runs anywhere node does — including inside the Docker image.
 */

export interface DoctorLine {
  readonly ok: boolean
  readonly label: string
  readonly detail: string
}

async function toolVersion(bin: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await exec(bin, [...args], { timeout: 10_000 })
    return stdout.split('\n')[0]?.trim() || null
  } catch {
    return null
  }
}

/** Total bytes under a folder, plus how many files. Missing folder counts as empty. */
export async function folderSize(dir: string): Promise<{ bytes: number; files: number }> {
  let bytes = 0
  let files = 0
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true, recursive: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const stat = await fs.promises.stat(path.join(entry.parentPath, entry.name))
      bytes += stat.size
      files += 1
    }
  } catch {
    // Not there yet — that is a finding, not an error.
  }
  return { bytes, files }
}

export async function runDoctor(
  client: ServerClient,
  dirs: { libraryDir: string; dataDir: string },
): Promise<DoctorLine[]> {
  const lines: DoctorLine[] = []

  const nodeMajor = Number(process.versions.node.split('.')[0])
  lines.push({
    ok: nodeMajor >= 22,
    label: 'node',
    detail: nodeMajor >= 22 ? `v${process.versions.node}` : `v${process.versions.node} (need 22+)`,
  })

  const ytdlp = await toolVersion('yt-dlp', ['--version'])
  lines.push({
    ok: ytdlp !== null,
    label: 'yt-dlp',
    detail: ytdlp ?? 'not found — imports will not work (brew install yt-dlp)',
  })

  const ffmpeg = await toolVersion('ffmpeg', ['-version'])
  lines.push({
    ok: ffmpeg !== null,
    label: 'ffmpeg',
    detail: ffmpeg?.replace(/^ffmpeg version (\S+).*$/, '$1') ?? 'not found (brew install ffmpeg)',
  })

  const health = await client.health()
  lines.push({
    ok: health !== null,
    label: 'server',
    detail: health
      ? `${client.baseUrl} — v${health.version}, ${health.songCount} songs, up ${Math.round(health.uptimeSeconds / 60)} min`
      : `${client.baseUrl} — not running (selfmp3 start)`,
  })

  for (const [label, dir] of [
    ['library', dirs.libraryDir],
    ['data', dirs.dataDir],
  ] as const) {
    const exists = fs.existsSync(dir)
    const size = await folderSize(dir)
    lines.push({
      ok: exists,
      label,
      detail: exists
        ? `${dir} — ${size.files} files, ${formatBytes(size.bytes)}`
        : `${dir} — missing (created on first start)`,
    })
  }

  return lines
}
