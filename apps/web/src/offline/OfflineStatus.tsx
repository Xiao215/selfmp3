import { Link } from 'react-router-dom'
import { useOffline } from './OfflineProvider.js'
import { CloudDownload, Downloaded, NotDownloaded, WifiOff } from '../components/Icons.js'

/**
 * How offline state shows up outside the settings page.
 *
 * Three sizes of the same facts: a mark on every song row (is this one on the
 * device?), a one-line pill under a list's title (is anything happening?), and
 * a sentence with a button in Settings (why not, and what to do about it).
 */

/**
 * The tiny sign beside each song: on this device, on its way, or not here.
 *
 * Drawn in the row's secondary colour except when downloaded, where it takes
 * the accent — with automatic downloads on, most rows carry the solid mark, so
 * the rare hollow one is the thing that stands out.
 */
export function OfflineMark({ songId }: { songId: number }) {
  const offline = useOffline()
  if (!offline.supported) return null

  if (offline.activeSongId === songId) {
    return (
      <span
        className="offline-mark is-downloading"
        title="Downloading to this device"
        role="img"
        aria-label="Downloading"
      >
        <span className="offline-mark-ring" aria-hidden="true" />
      </span>
    )
  }

  if (offline.isCached(songId)) {
    return (
      <span
        className="offline-mark is-cached"
        title="Downloaded — plays offline"
        role="img"
        aria-label="Downloaded"
      >
        <Downloaded size={13} />
      </span>
    )
  }

  return (
    <span
      className="offline-mark is-missing"
      title="Not downloaded to this device"
      role="img"
      aria-label="Not downloaded"
    >
      <NotDownloaded size={13} />
    </span>
  )
}

/**
 * A one-line status for the top of a list, shown only when there is
 * something to say: downloading, waiting for Wi-Fi, full, or offline.
 */
export function OfflinePill() {
  const offline = useOffline()

  if (!offline.serverReachable) {
    return (
      <Link to="/settings#offline" className="offline-pill is-offline">
        <WifiOff size={13} /> Offline · {offline.cachedIds.size} downloaded
      </Link>
    )
  }

  if (offline.sync.status === 'syncing') {
    const { done, total } = offline.sync.progress
    return (
      <Link to="/settings#offline" className="offline-pill is-busy">
        <span className="spinner spinner-tiny" aria-hidden="true" /> Downloading{' '}
        {Math.min(done + 1, total)} of {total}
      </Link>
    )
  }

  const auto = offline.auto
  if (auto.kind === 'waiting') {
    return (
      <span className="offline-pill">
        <CloudDownload size={13} />
        {auto.missing} to download
        {auto.reason === 'metered' ? ' on Wi-Fi' : ''}
        <button type="button" className="link-button" onClick={() => void offline.downloadNow()}>
          {auto.reason === 'metered' ? 'Download now' : 'Download'}
        </button>
      </span>
    )
  }

  if (auto.kind === 'storage-full') {
    return (
      <Link to="/settings#offline" className="offline-pill is-warn">
        <CloudDownload size={13} /> Storage full · {auto.missing} not downloaded
      </Link>
    )
  }

  return null
}

/** The Settings version: the same states, in sentences, with the way out. */
export function OfflineAutoStatus() {
  const offline = useOffline()
  const auto = offline.auto
  const syncing = offline.sync.status === 'syncing'

  if (syncing || !offline.serverReachable) return null

  if (auto.kind === 'waiting') {
    return (
      <div className="notice">
        <span>
          {auto.missing === 1 ? '1 song is' : `${auto.missing} songs are`} waiting to download.{' '}
          {auto.reason === 'metered'
            ? 'You’re on mobile data, so they’ll come down on Wi-Fi.'
            : 'This browser can’t tell whether you’re on Wi-Fi, so it’s asking first.'}
        </span>
        <button
          type="button"
          className="button button-small"
          onClick={() => void offline.downloadNow()}
        >
          <CloudDownload size={13} /> Download now
        </button>
      </div>
    )
  }

  if (auto.kind === 'storage-full') {
    return (
      <p className="notice notice-warn">
        This device is nearly full, so{' '}
        {auto.missing === 1 ? '1 song wasn’t' : `${auto.missing} songs weren’t`} downloaded. Keep
        only songs in playlists, or remove some downloads.
      </p>
    )
  }

  return null
}
