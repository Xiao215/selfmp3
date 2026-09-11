import { useEffect, useId } from 'react'
import { createPortal } from 'react-dom'
import { formatBytes, formatDuration, formatRelative, type Song } from '@selfmp3/shared'
import { useOffline } from '../offline/OfflineProvider.js'
import { Cover } from './Cover.js'
import { EnergyWave, tempoMark } from './FeatureBadges.js'
import { X } from './Icons.js'

/**
 * Everything the app knows about one song, in plain words.
 *
 * The row keeps only what is useful while listening — the download mark,
 * ♩ = 130 and the energy wave. Anyone curious what those mean, what key a
 * song is in, how often it has been played or where the file came from opens
 * this from the song's ⋯ menu. Nothing here appears by accident.
 *
 * Grouped by what you would want the fact for: how it sounds, whether it is
 * on this device, your history with it, and the file itself.
 */
export function SongDetailsDialog({ song, onClose }: { song: Song; onClose: () => void }) {
  const offline = useOffline()
  const titleId = useId()

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const features = song.features
  const cached = offline.isCached(song.id)
  const downloading = offline.activeSongId === song.id
  const byline = [song.artist || 'Unknown artist', song.album, song.year]
    .filter(Boolean)
    .join(' · ')

  return createPortal(
    <div className="meta-backdrop" onClick={onClose}>
      <div
        className="details-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={event => event.stopPropagation()}
      >
        <header className="details-head">
          <Cover song={song} size={64} />
          <div className="details-titles">
            <h2 id={titleId}>{song.title}</h2>
            <p>{byline}</p>
          </div>
          <button
            type="button"
            className="icon-button details-close"
            onClick={onClose}
            aria-label="Close"
            autoFocus
          >
            <X size={16} />
          </button>
        </header>

        <div className="details-body">
          <section className="details-group" aria-label="Sound">
            <h3>Sound</h3>
            {features && (features.bpm != null || features.energy != null || features.key) ? (
              <dl className="details-facts">
                {features.bpm != null && (
                  <div>
                    <dt>Tempo</dt>
                    <dd>
                      <strong>{tempoMark(features.bpm)}</strong>
                      <span>
                        {Math.round(features.bpm)} beats a minute — {tempoWords(features.bpm)}.
                      </span>
                    </dd>
                  </div>
                )}
                {features.energy != null && (
                  <div>
                    <dt>Energy</dt>
                    <dd>
                      <strong className="details-energy">
                        <EnergyWave energy={features.energy} width={44} height={18} />
                        {Math.round(features.energy * 100)} of 100
                      </strong>
                      <span>How loud, busy and driving it feels. The wave grows with it.</span>
                    </dd>
                  </div>
                )}
                {features.key && (
                  <div>
                    <dt>Key</dt>
                    <dd>
                      <strong>{features.key}</strong>
                      <span>Auto-mix uses it to pick songs that blend into this one.</span>
                    </dd>
                  </div>
                )}
              </dl>
            ) : (
              <p className="details-empty">
                Not listened to yet. self.mp3 works out tempo, energy and key for every song in the
                background; this one hasn’t had its turn.
              </p>
            )}
          </section>

          <section className="details-group" aria-label="On this device">
            <h3>On this device</h3>
            <dl className="details-facts">
              <div>
                <dt>Offline</dt>
                <dd>
                  {!offline.supported ? (
                    <>
                      <strong>Not available here</strong>
                      <span>This browser can’t keep songs offline.</span>
                    </>
                  ) : downloading ? (
                    <strong>Downloading…</strong>
                  ) : cached ? (
                    <>
                      <strong>Downloaded · {formatBytes(song.sizeBytes)}</strong>
                      <span>Plays with no connection.</span>
                      <button
                        type="button"
                        className="button button-small details-action"
                        onClick={() => void offline.removeOne(song.id)}
                      >
                        Remove download
                      </button>
                    </>
                  ) : (
                    <>
                      <strong>Only on your Mac · {formatBytes(song.sizeBytes)}</strong>
                      <span>{notDownloadedNote(offline, song.id)}</span>
                      <button
                        type="button"
                        className="button button-small details-action"
                        onClick={() => void offline.downloadOne(song.id)}
                        disabled={!offline.serverReachable}
                      >
                        Download now
                      </button>
                    </>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          <section className="details-group" aria-label="History">
            <h3>History</h3>
            <dl className="details-facts">
              <div>
                <dt>Played</dt>
                <dd>
                  <strong>
                    {song.playCount === 0
                      ? 'Not yet'
                      : `${song.playCount} ${song.playCount === 1 ? 'time' : 'times'} · last ${formatRelative(song.lastPlayedAt)}`}
                  </strong>
                  {song.skipCount > 0 && (
                    <span>
                      Skipped {song.skipCount} {song.skipCount === 1 ? 'time' : 'times'}.
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Added</dt>
                <dd>
                  <strong>{formatDate(song.addedAt)}</strong>
                </dd>
              </div>
            </dl>
          </section>

          <section className="details-group" aria-label="File">
            <h3>File</h3>
            <dl className="details-facts">
              <div>
                <dt>Format</dt>
                <dd>
                  <strong>
                    {formatName(song.mime, song.path)} · {formatDuration(song.duration)}
                  </strong>
                  {song.missing && (
                    <span className="details-warn">
                      The file is missing from your library folder.
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt>Source</dt>
                <dd>
                  {song.sourceUrl ? (
                    <a href={song.sourceUrl} target="_blank" rel="noreferrer">
                      {sourceName(song.sourceUrl)}
                    </a>
                  ) : (
                    <strong>Your library folder</strong>
                  )}
                </dd>
              </div>
              {song.lyricsKind !== 'none' && (
                <div>
                  <dt>Lyrics</dt>
                  <dd>
                    <strong>{song.lyricsKind === 'synced' ? 'Synced' : 'Plain text'}</strong>
                  </dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** What will happen to a song that is not on this device, said plainly. */
function notDownloadedNote(offline: ReturnType<typeof useOffline>, songId: number): string {
  if (offline.isExcluded(songId))
    return 'You removed it from this device, so it stays off until you download it again.'
  if (!offline.prefs.auto) return 'Plays only while your Mac is reachable.'
  return offline.prefs.wifiOnly
    ? 'Downloads on its own over Wi-Fi, whenever your Mac is reachable.'
    : 'Downloads on its own whenever your Mac is reachable.'
}

/** A plain word for the pace, not an Italian one. */
function tempoWords(bpm: number): string {
  if (bpm < 70) return 'slow'
  if (bpm < 100) return 'relaxed'
  if (bpm < 125) return 'moderate'
  if (bpm < 150) return 'fast'
  return 'very fast'
}

/** The database's `YYYY-MM-DD HH:MM:SS` (UTC) as "10 Sep 2026". */
function formatDate(value: string): string {
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const FORMAT_BY_MIME: Record<string, string> = {
  'audio/mp4': 'AAC (.m4a)',
  'audio/mpeg': 'MP3',
  'audio/flac': 'FLAC',
  'audio/ogg': 'Ogg Vorbis',
  'audio/opus': 'Opus',
  'audio/wav': 'WAV',
  'audio/aac': 'AAC',
  'audio/webm': 'WebM',
}

function formatName(mime: string, path: string): string {
  const known = FORMAT_BY_MIME[mime]
  if (known) return known
  const extension = /\.([a-z0-9]+)$/i.exec(path)?.[1]
  return extension ? extension.toUpperCase() : mime
}

/** "YouTube Music" rather than music.youtube.com; the host for anything else. */
function sourceName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    if (host === 'music.youtube.com') return 'YouTube Music'
    if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com') return 'YouTube'
    return host
  } catch {
    return url
  }
}
