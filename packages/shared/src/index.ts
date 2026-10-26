/**
 * @selfmp3/shared — the contract between the server and every client.
 *
 * If a value crosses the network, its schema lives here. The server validates
 * incoming requests against these schemas and every client parses responses
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
export * from './privacy.js'
export * from './rest.js'
export * from './bucketGuide.js'
export * from './publicPage.js'
export * from './schemas/settings.js'
export * from './schemas/metadata.js'
export * from './schemas/lyrics.js'
export * from './schemas/motion.js'
export * from './schemas/audioFeatures.js'
export * from './schemas/devices.js'
export * from './schemas/wrapped.js'
export * from './schemas/gems.js'
export * from './schemas/cloud.js'
export * from './schemas/artist.js'
export * from './origins.js'
export * from './coverArt.js'
export * from './schemas/doorman.js'
export * from './schemas/hub.js'
export * from './schemas/sync.js'
export * from './schemas/ai.js'
export * from './schemas/room.js'
export * from './schemas/shared.js'
export * from './schemas/share.js'
export * from './schemas/admin.js'

export * from './format.js'
export * from './range.js'
export * from './apiWire.js'
export * from './doormanWire.js'
export * from './doormanClient.js'
export * from './bucketRefusal.js'
export * from './lrc.js'
export * from './fuzzy.js'
export * from './links.js'
export * from './importFailure.js'
export * from './titles.js'
export * from './tidy.js'
export * from './script.js'
export * from './lrcBuild.js'
export * from './audioFeatures.js'
export * from './devices.js'
export * from './personality.js'
export * from './queue.js'
export * from './songSort.js'
export * from './artists.js'
export * from './searchNames.js'
export * from './artistJoins.js'
export * from './outbox.js'
export * from './plays.js'
export * from './cloud.js'
export * from './releases.js'
export * from './iosApp.js'
export * from './installPage.js'
export * from './hlc.js'
export * from './sync.js'
export * from './editRules.js'
export * from './smartRules.js'
export * from './gems.js'
export * from './coverTone.js'
export * from './theme.js'
export * from './math.js'
export * from './dates.js'
export * from './errors.js'
export * from './throttle.js'
export * from './exhaustive.js'
export * from './room.js'
export * from './soundVectors.js'
export * from './sharedPlaylist.js'
export * from './shareLink.js'

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
