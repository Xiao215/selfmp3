import { Link } from 'react-router-dom'
import { useOffline } from './OfflineProvider.js'
import { CloudDownload, Downloaded, WifiOff } from '../components/Icons.js'

/**
 * How offline state shows up outside the settings page.
 *
 * Three sizes of the same facts: a mark on every song row (is this one on the
 * device?), a one-line pill under a list's title (is anything happening?), and
 * a sentence with a button in Settings (why not, and what to do about it).
 */

/**
 * The tiny sign beside each song: on this device, or on its way.
 *
 * A song that is not downloaded carries no mark at all, the way every music
 * app people already know does it. With the Mac out of reach such a row is
 * dimmed instead, which is the moment the difference actually matters.
 */
export function OfflineMark({ songId }: { songId: number }) {
  const offline = useOffline()
  if (!offline.supported) return null

  const progress = offline.progressOf(songId)
  if (progress !== undefined) {
    const percent = progress === null ? null : Math.round(progress * 100)
    return (
      <span
        className="offline-mark is-downloading"
        title={percent === null ? 'Downloading' : `Downloading · ${percent}%`}
        role="img"
        aria-label={percent === null ? 'Downloading' : `Downloading, ${percent}%`}
      >
        <ProgressRing fraction={progress} />
      </span>
    )
  }

  if (offline.isCached(songId)) {
    // One meaning on every device: this song is here. Only the reason differs.
    return (
      <span
        className="offline-mark is-cached"
        title={
          offline.holdsLibrary
            ? 'On this device — a file in your library folder'
            : 'On this device — downloaded, plays offline'
        }
        role="img"
        aria-label="On this device"
      >
        <Downloaded size={13} />
      </span>
    )
  }

  return null
}

/** Circumference of the ring below, for the dash that draws the filled part. */
const RING = 2 * Math.PI * 8.5

/**
 * A ring that fills clockwise as the bytes arrive, the same size as the disc
 * it turns into. With no size to measure against, a quarter arc spins.
 */
export function ProgressRing({ fraction }: { fraction: number | null }) {
  return (
    <svg
      className={`progress-ring ${fraction === null ? 'is-indeterminate' : ''}`}
      viewBox="0 0 24 24"
      width={13}
      height={13}
      aria-hidden="true"
    >
      <circle className="progress-ring-track" cx="12" cy="12" r="8.5" />
      <circle
        className="progress-ring-fill"
        cx="12"
        cy="12"
        r="8.5"
        strokeDasharray={`${(fraction ?? 0.25) * RING} ${RING}`}
        transform="rotate(-90 12 12)"
      />
    </svg>
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
