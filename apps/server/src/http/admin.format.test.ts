import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { formatBytes, formatRelative, plural } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'

/**
 * The admin page's copies of three shared formatters, held to the originals.
 *
 * `public/admin.js` is plain browser JavaScript with no build step — that is
 * the point of it — so it cannot import `@selfmp3/shared` and spells
 * `formatBytes`, `formatRelative` and `plural` out again. Two copies drift:
 * the page once said `kB` where the app said `KB`, and "3 minutes ago" where
 * the app said "3m ago". So the page's block is read as text, evaluated, and
 * compared with the package over a table of inputs.
 */

const ADMIN_JS = fileURLToPath(new URL('../../public/admin.js', import.meta.url))

function adminFormatters(): {
  formatBytes: (bytes: number) => string
  formatRelative: (at: string | null, now?: Date) => string
  plural: (count: number, one: string, many: string) => string
} {
  const text = readFileSync(ADMIN_JS, 'utf8')
  const start = text.indexOf('shaping numbers')
  const end = text.indexOf('/** Text into markup.')
  if (start < 0 || end < start) throw new Error('admin.js has moved its formatters')
  const block = text.slice(text.indexOf('\n', start), end)
  // The block declares three functions and nothing else; this runs it as a
  // script body and hands them back.
  return new Function(`${block}\nreturn { formatBytes, formatRelative, plural }`)() as ReturnType<
    typeof adminFormatters
  >
}

const admin = adminFormatters()

describe('admin.js formatBytes', () => {
  it('agrees with @selfmp3/shared', () => {
    const inputs = [
      -1,
      0,
      1,
      512,
      1023,
      1024,
      1536,
      10_240,
      1_048_576,
      1_536_000,
      5_400_000_000,
      1_099_511_627_776,
      2 ** 45,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]
    for (const bytes of inputs) {
      expect(admin.formatBytes(bytes), String(bytes)).toBe(formatBytes(bytes))
    }
  })
})

describe('admin.js formatRelative', () => {
  it('agrees with @selfmp3/shared', () => {
    const now = new Date('2026-09-23T12:00:00Z')
    const inputs: (string | null)[] = [
      null,
      '',
      'not a date',
      '2026-09-23T12:00:00Z',
      '2026-09-23T12:00:30Z',
      '2026-09-23T11:59:00Z',
      '2026-09-23T11:15:00Z',
      '2026-09-23T09:00:00Z',
      '2026-09-22T13:00:00Z',
      '2026-09-17T12:00:00Z',
      '2026-09-16T12:00:00Z',
      '2026-01-01T00:00:00Z',
      '2026-09-23 11:30:00',
      '2026-09-20 12:00:00',
      '2027-01-01T00:00:00Z',
    ]
    for (const at of inputs) {
      expect(admin.formatRelative(at, now), String(at)).toBe(formatRelative(at, now))
    }
  })
})

describe('admin.js plural', () => {
  it('agrees with @selfmp3/shared', () => {
    for (const count of [0, 1, 2, 13]) {
      expect(admin.plural(count, 'song', 'songs')).toBe(plural(count, 'song', 'songs'))
    }
  })
})
