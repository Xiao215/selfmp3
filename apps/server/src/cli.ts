#!/usr/bin/env node
import path from 'node:path'
import type { ImportShareResult, ScanResult } from '@selfmp3/shared'
import { formatBytes } from '@selfmp3/shared'
import { APP_NAME, APP_VERSION, REPO_ROOT } from './config.js'
import { ApiError, createClient, defaultBaseUrl } from './cli/api.js'
import { CliUsageError, USAGE, parseCli, type Command } from './cli/args.js'
import { backupTree } from './cli/backup.js'
import { runDoctor } from './cli/doctor.js'

/**
 * `selfmp3` — the command-line front door.
 *
 * Everything that needs the database goes through the running server's API;
 * the CLI itself only knows how to start the server, talk to it, and copy
 * files. That keeps one code path for every operation and means the CLI can
 * never corrupt a database the server has open.
 */

/* eslint-disable no-console -- a CLI's output *is* console output. */

const out = (line = ''): void => console.log(line)

/** Same defaults as config.ts, without creating the folders as a side effect. */
const dirs = {
  libraryDir: process.env['SELFMP3_LIBRARY_DIR'] ?? path.join(REPO_ROOT, 'library'),
  dataDir: process.env['SELFMP3_DATA_DIR'] ?? path.join(REPO_ROOT, 'data'),
}

const NOT_RUNNING = `the server is not running at %s.
Start it in another terminal with one of:
    selfmp3 start
    npm start
or pass --url if it lives somewhere else.`

async function run(command: Command, baseUrl: string, token: string | null): Promise<number> {
  const client = createClient(baseUrl, token)

  const requireServer = async () => {
    const health = await client.health()
    if (!health) {
      console.error(NOT_RUNNING.replace('%s', baseUrl))
      return null
    }
    return health
  }

  switch (command.name) {
    case 'version':
      out(APP_VERSION)
      return 0

    case 'help':
      out(USAGE)
      return 0

    case 'start':
      // main.js boots on import; env vars pass straight through.
      await import('./main.js')
      return 0

    case 'scan': {
      if (!(await requireServer())) return 1
      out('scanning…')
      const result = await client.post<ScanResult>('/library/scan')
      out(
        `done in ${Math.round(result.durationMs)} ms: ${result.added} added, ${result.updated} updated, ` +
          `${result.removed} missing, ${result.total} songs total`,
      )
      return 0
    }

    case 'import': {
      if (!(await requireServer())) return 1
      let failures = 0
      for (const url of command.urls) {
        try {
          const result = await client.post<ImportShareResult>('/import/share', { url })
          const what =
            result.kind === 'playlist' ? `playlist "${result.playlistTitle ?? ''}"` : 'track'
          const skipped = result.skipped ? ` (${result.skipped} already queued)` : ''
          out(`queued ${result.jobs.length} from ${what}${skipped}: ${url}`)
        } catch (error) {
          failures += 1
          console.error(`failed: ${url}\n    ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      if (failures === 0) out(`watch progress at ${baseUrl}/import`)
      return failures === 0 ? 0 : 1
    }

    case 'backup': {
      const dest = path.resolve(command.dest)
      out(`backing up to ${dest}`)
      let total = { files: 0, copied: 0, bytes: 0, copiedBytes: 0 }
      for (const [name, src] of [
        ['data', dirs.dataDir],
        ['library', dirs.libraryDir],
      ] as const) {
        const summary = await backupTree(src, path.join(dest, name), relative =>
          out(`  + ${name}/${relative}`),
        )
        out(
          `${name}/: ${summary.copied} of ${summary.files} files copied ` +
            `(${formatBytes(summary.copiedBytes)} of ${formatBytes(summary.bytes)})`,
        )
        total = {
          files: total.files + summary.files,
          copied: total.copied + summary.copied,
          bytes: total.bytes + summary.bytes,
          copiedBytes: total.copiedBytes + summary.copiedBytes,
        }
      }
      out()
      out(
        total.copied === 0
          ? `already up to date — ${total.files} files, ${formatBytes(total.bytes)}`
          : `copied ${formatBytes(total.copiedBytes)}; backup is ${total.files} files, ${formatBytes(total.bytes)}`,
      )
      return 0
    }

    case 'doctor': {
      out(`${APP_NAME} ${APP_VERSION}`)
      out()
      const lines = await runDoctor(client, dirs)
      for (const line of lines) {
        out(`  ${line.ok ? '✓' : '✗'} ${line.label.padEnd(8)} ${line.detail}`)
      }
      out()
      const broken = lines.filter(line => !line.ok).length
      out(broken === 0 ? 'everything looks fine.' : `${broken} thing(s) to look at.`)
      return broken === 0 ? 0 : 1
    }
  }
}

async function main(): Promise<void> {
  let parsed
  try {
    parsed = parseCli(process.argv.slice(2))
  } catch (error) {
    // parseArgs throws a plain Error for an unknown flag; treat it the same way.
    console.error(error instanceof Error ? error.message : String(error))
    console.error()
    console.error(USAGE)
    process.exitCode = 2
    return
  }

  try {
    process.exitCode = await run(parsed.command, parsed.url ?? defaultBaseUrl(), parsed.token)
  } catch (error) {
    if (error instanceof ApiError) console.error(`server said ${error.status}: ${error.message}`)
    else if (error instanceof CliUsageError) console.error(error.message)
    else console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

void main()
