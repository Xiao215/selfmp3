/**
 * Formatting helpers shared by the server (log lines, scan summaries) and the
 * web app. Pure functions, no dependencies, fully unit tested.
 */

/** `254` -> `4:14`, `3801` -> `1:03:21`. Non-finite input yields `0:00`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}

/** `4320` -> `1 hr 12 min`. Used for playlist and library totals. */
export function formatLongDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min'
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h} hr ${m} min`
}

/** `1536000` -> `1.5 MB`. Binary units, one decimal, no trailing `.0`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / Math.pow(1024, exponent)
  const unit = units[exponent] ?? 'B'
  const rounded = exponent === 0 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '')
  return `${rounded} ${unit}`
}

/** Relative time that degrades gracefully: `just now`, `4h ago`, `12 Mar`. */
export function formatRelative(iso: string | null, now = new Date()): string {
  if (!iso) return 'never'
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z')
  const ms = now.getTime() - then.getTime()
  if (!Number.isFinite(ms)) return 'never'
  if (ms < 0) return 'just now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/**
 * Strip characters that are illegal or awkward in filenames on macOS, Linux
 * and Windows, collapse whitespace, and keep the result short enough that the
 * full path stays under typical limits even in a deeply nested library.
 */
export function sanitizeFilename(name: string, maxLength = 120): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    // Trim before taking the dots off, or " .hidden" keeps its dot through the
    // guard and is trimmed into a dotfile afterwards; then again, since taking
    // the dots off ". x" leaves a space at the front.
    .trim()
    .replace(/^\.+/, '')
    .trim()
  return cleaned.slice(0, maxLength).trim()
}

/** Deterministic hue from any string, so a tag's colour is stable forever. */
export function hueFromString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0
  }
  return Math.abs(hash) % 360
}

/** `["a","b","c"]` -> `a, b and c`. */
export function joinWithAnd(items: readonly string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1] ?? ''}`
}
