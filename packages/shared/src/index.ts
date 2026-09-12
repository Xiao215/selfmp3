/**
 * @selfmp3/shared — the contract between the server and every client.
 *
 * If a value crosses the network, its schema lives here. The server validates
 * incoming requests against these schemas and the web app parses responses
 * with the same ones, so a mismatch is a compile error rather than a runtime
 * surprise on a phone somewhere.
 */

export * from './schemas/common.js'
export * from './schemas/song.js'
export * from './schemas/tag.js'
export * from './schemas/smart.js'
export * from './schemas/playlist.js'
export * from './schemas/import.js'
export * from './schemas/stats.js'
export * from './schemas/library.js'
export * from './schemas/settings.js'
export * from './schemas/migrate.js'
export * from './schemas/metadata.js'
export * from './schemas/lyrics.js'
export * from './schemas/features.js'
export * from './schemas/devices.js'
export * from './schemas/wrapped.js'
export * from './schemas/gems.js'
export * from './schemas/cloud.js'
export * from './schemas/doorman.js'
export * from './schemas/sync.js'

export * from './format.js'
export * from './lrc.js'
export * from './fuzzy.js'
export * from './links.js'
export * from './script.js'
export * from './lrcBuild.js'
export * from './features.js'
export * from './devices.js'
export * from './personality.js'
export * from './transpose.js'
export * from './queue.js'
export * from './songSort.js'
export * from './outbox.js'
export * from './cloud.js'
export * from './hlc.js'
export * from './sync.js'
export * from './smartRules.js'

/** Bumped when the wire format changes in a way old clients cannot handle. */
export const API_VERSION = 1

/** Audio file extensions the scanner will pick up. */
export const AUDIO_EXTENSIONS = [
  '.m4a',
  '.mp3',
  '.opus',
  '.ogg',
  '.oga',
  '.flac',
  '.wav',
  '.aac',
  '.webm',
] as const

export type AudioExtension = (typeof AUDIO_EXTENSIONS)[number]

/** Sidecar lyric files, checked in this order next to each audio file. */
export const LYRIC_EXTENSIONS = ['.lrc', '.txt'] as const

const MIME_BY_EXTENSION: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.opus': 'audio/opus',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.webm': 'audio/webm',
}

export function mimeForExtension(extension: string): string {
  return MIME_BY_EXTENSION[extension.toLowerCase()] ?? 'application/octet-stream'
}
