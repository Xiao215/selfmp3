import { useEffect, useState } from 'react'
import { formatBytes, type Settings } from '@selfmp3/shared'
import { useQuery } from '@tanstack/react-query'
import {
  queryKeys,
  useLibrary,
  useScanLibrary,
  useSettings,
  useUpdateSettings,
} from '../lib/queries.js'
import { FixCoversPanel } from '../components/FixCoversPanel.js'
import { useOffline } from '../offline/OfflineProvider.js'
import { api } from '../lib/api.js'
import { CheckCircle, CloudDownload, Refresh, Trash, X } from '../components/Icons.js'

/**
 * Settings.
 *
 * Split into what syncs and what does not: playback and import settings live
 * on the server so the Mac and the phone agree, while offline downloads are
 * per-device by definition — what you have cached on your phone is not a fact
 * about your library.
 */
export function SettingsView() {
  const { data: settings } = useSettings()
  const { data: library } = useLibrary()
  const updateSettings = useUpdateSettings()
  const scan = useScanLibrary()
  const offline = useOffline()

  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => api.health(),
    retry: false,
    staleTime: 60_000,
  })

  const [purging, setPurging] = useState(false)

  // Depend on the function, not the whole context object. The context identity
  // changes whenever usage updates, so depending on it here would loop:
  // refresh → new context → effect → refresh.
  const { refreshUsage } = offline
  useEffect(() => {
    void refreshUsage()
  }, [refreshUsage])

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    updateSettings.mutate({ [key]: value })
  }

  const songs = library?.songs ?? []
  const missingCount = songs.filter(song => song.missing).length
  const cachedCount = offline.cachedIds.size
  const syncing = offline.sync.status === 'syncing'

  return (
    <section className="view settings-view">
      <header className="view-head">
        <div className="view-titles">
          <h1>Settings</h1>
          <p className="view-sub">
            {health
              ? `self.mp3 ${health.version} · ${health.songCount} songs · ${health.storageDriver} storage`
              : 'Not connected to your library right now'}
          </p>
        </div>
      </header>

      {/* ---------------- offline ---------------- */}

      <section className="panel" id="offline">
        <header className="panel-head">
          <h2>Offline music</h2>
          <span className="hint">on this device</span>
        </header>

        <p className="panel-lead">
          Downloaded songs play with no connection at all — which is the point, since your Mac
          won&rsquo;t always be awake. Everything else needs the server.
        </p>

        <div className="offline-summary">
          <div className="offline-stat">
            <span className="offline-stat-value">{cachedCount}</span>
            <span className="offline-stat-label">of {songs.length} songs downloaded</span>
          </div>
          <div className="offline-stat">
            <span className="offline-stat-value">
              {offline.usage ? formatBytes(offline.usage.audioBytes) : '—'}
            </span>
            <span className="offline-stat-label">
              {offline.usage?.quotaBytes
                ? `of ~${formatBytes(offline.usage.quotaBytes)} available`
                : 'used'}
            </span>
          </div>
        </div>

        {songs.length > 0 && (
          <div
            className="offline-meter"
            role="progressbar"
            aria-valuenow={cachedCount}
            aria-valuemin={0}
            aria-valuemax={songs.length}
            aria-label="Songs downloaded"
          >
            <span style={{ width: `${(cachedCount / songs.length) * 100}%` }} />
          </div>
        )}

        {syncing && offline.sync.status === 'syncing' && (
          <div className="sync-progress">
            <div className="sync-progress-head">
              <span className="spinner" />
              <span>
                Downloading {offline.sync.progress.done} of {offline.sync.progress.total}
                {offline.sync.progress.currentTitle && ` — ${offline.sync.progress.currentTitle}`}
              </span>
            </div>
            <div className="offline-meter">
              <span
                style={{
                  width: `${
                    offline.sync.progress.total > 0
                      ? (offline.sync.progress.done / offline.sync.progress.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
            {offline.sync.progress.failed > 0 && (
              <p className="hint">{offline.sync.progress.failed} couldn’t be downloaded.</p>
            )}
          </div>
        )}

        {offline.sync.status === 'done' && (
          <p className="notice notice-good">
            <CheckCircle size={15} /> Downloaded {offline.sync.progress.done} songs.
            {offline.sync.progress.failed > 0 && ` ${offline.sync.progress.failed} failed.`}
          </p>
        )}

        {offline.sync.status === 'error' && (
          <p className="notice notice-error">{offline.sync.message}</p>
        )}

        <div className="button-row">
          {syncing ? (
            <button type="button" className="button" onClick={offline.cancelSync}>
              <X size={15} /> Stop downloading
            </button>
          ) : (
            <button
              type="button"
              className="button button-primary"
              onClick={() => void offline.syncAll(songs)}
              disabled={!offline.serverReachable || songs.length === 0}
            >
              <CloudDownload size={15} />
              {cachedCount === 0 ? 'Download everything' : 'Download what’s missing'}
            </button>
          )}

          {cachedCount > 0 && (
            <button
              type="button"
              className="button button-danger"
              onClick={() => {
                if (window.confirm('Remove all downloaded songs from this device?')) {
                  void offline.clearAll()
                }
              }}
            >
              <Trash size={15} /> Remove all downloads
            </button>
          )}
        </div>

        {!offline.persistent && (
          <p className="hint">
            This browser hasn’t marked your downloads as permanent, so it may clear them if
            storage runs low. Adding self.mp3 to your home screen usually fixes that.
          </p>
        )}
      </section>

      {/* ---------------- playback ---------------- */}

      {settings && (
        <section className="panel">
          <header className="panel-head">
            <h2>Playback</h2>
            <span className="hint">shared across your devices</span>
          </header>

          <label className="setting-row">
            <span className="setting-label">
              Crossfade
              <span className="setting-hint">
                Overlap the end of one track with the start of the next. Zero turns it off.
              </span>
            </span>
            <span className="setting-control">
              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={settings.crossfadeSeconds}
                style={
                  { '--progress': `${(settings.crossfadeSeconds / 12) * 100}%` } as React.CSSProperties
                }
                onChange={event => set('crossfadeSeconds', Number(event.target.value))}
              />
              <span className="setting-value">
                {settings.crossfadeSeconds === 0 ? 'off' : `${settings.crossfadeSeconds}s`}
              </span>
            </span>
          </label>

          <label className="setting-row">
            <span className="setting-label">
              Count a play after
              <span className="setting-hint">
                How much of a song you have to hear before it counts in your stats.
              </span>
            </span>
            <span className="setting-control">
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={settings.playThreshold}
                style={
                  { '--progress': `${settings.playThreshold * 100}%` } as React.CSSProperties
                }
                onChange={event => set('playThreshold', Number(event.target.value))}
              />
              <span className="setting-value">{Math.round(settings.playThreshold * 100)}%</span>
            </span>
          </label>

          <label className="setting-row setting-row-toggle">
            <span className="setting-label">
              Look up lyrics automatically
              <span className="setting-hint">
                Fetches synced lyrics from lrclib.net when a song is imported, and saves them
                next to the audio so they work offline.
              </span>
            </span>
            <input
              type="checkbox"
              className="toggle"
              checked={settings.autoFetchLyrics}
              onChange={event => set('autoFetchLyrics', event.target.checked)}
            />
          </label>
        </section>
      )}

      {/* ---------------- importing ---------------- */}

      {settings && (
        <section className="panel">
          <header className="panel-head">
            <h2>Importing</h2>
          </header>

          <label className="setting-row">
            <span className="setting-label">
              Downloads at once
              <span className="setting-hint">
                More is rarely faster and makes YouTube throttle. Two is a good default.
              </span>
            </span>
            <span className="setting-control">
              <select
                className="select"
                value={settings.importConcurrency}
                onChange={event => set('importConcurrency', Number(event.target.value))}
              >
                {[1, 2, 3, 4].map(value => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </span>
          </label>

          <label className="setting-row">
            <span className="setting-label">
              Rescan automatically
              <span className="setting-hint">
                Watch the library folder for files you dropped in by hand. Takes effect on
                restart.
              </span>
            </span>
            <span className="setting-control">
              <select
                className="select"
                value={settings.autoScanMinutes}
                onChange={event => set('autoScanMinutes', Number(event.target.value))}
              >
                <option value={0}>Never</option>
                <option value={5}>Every 5 minutes</option>
                <option value={15}>Every 15 minutes</option>
                <option value={60}>Every hour</option>
              </select>
            </span>
          </label>
        </section>
      )}

      {/* ---------------- library ---------------- */}

      <section className="panel">
        <header className="panel-head">
          <h2>Library</h2>
        </header>

        {health && (
          <p className="panel-lead">
            Your music lives at <code>{health.libraryPath}</code>. It is just a folder of files —
            copy it anywhere and you have a complete backup.
          </p>
        )}

        <div className="button-row">
          <button
            type="button"
            className="button"
            onClick={() => scan.mutate()}
            disabled={scan.isPending}
          >
            <Refresh size={15} /> {scan.isPending ? 'Scanning…' : 'Rescan library folder'}
          </button>
        </div>

        {scan.data && (
          <p className="hint">
            Found {scan.data.total} songs — {scan.data.added} new, {scan.data.updated} updated,{' '}
            {scan.data.removed} now missing. Took {Math.round(scan.data.durationMs)}ms.
          </p>
        )}

        <FixCoversPanel missingArt={songs.filter(song => !song.hasArt && !song.missing).length} />

        {missingCount > 0 && (
          <>
            <p className="notice notice-warn">
              {missingCount} {missingCount === 1 ? 'song is' : 'songs are'} in your library but
              the {missingCount === 1 ? 'file is' : 'files are'} gone. Their tags and play counts
              are kept in case the files come back.
            </p>
            <button
              type="button"
              className="button button-danger"
              disabled={purging}
              onClick={() => {
                if (
                  window.confirm(
                    `Permanently forget ${missingCount} missing songs, including their tags and play history?`,
                  )
                ) {
                  setPurging(true)
                  void api.purgeMissing().finally(() => setPurging(false))
                }
              }}
            >
              <Trash size={15} /> Forget missing songs
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <h2>Keyboard shortcuts</h2>
        </header>
        <dl className="shortcut-list">
          <div>
            <dt>
              <kbd>⌘</kbd> <kbd>K</kbd>
            </dt>
            <dd>Search everything</dd>
          </div>
          <div>
            <dt>
              <kbd>Space</kbd>
            </dt>
            <dd>Play / pause</dd>
          </div>
          <div>
            <dt>
              <kbd>←</kbd> <kbd>→</kbd>
            </dt>
            <dd>Skip back / forward 5 seconds</dd>
          </div>
          <div>
            <dt>
              <kbd>⇧</kbd> <kbd>←</kbd> / <kbd>→</kbd>
            </dt>
            <dd>Previous / next track</dd>
          </div>
          <div>
            <dt>
              <kbd>S</kbd>
            </dt>
            <dd>Shuffle</dd>
          </div>
          <div>
            <dt>
              <kbd>R</kbd>
            </dt>
            <dd>Repeat</dd>
          </div>
          <div>
            <dt>
              <kbd>L</kbd>
            </dt>
            <dd>Lyrics</dd>
          </div>
          <div>
            <dt>
              <kbd>Q</kbd>
            </dt>
            <dd>Queue</dd>
          </div>
        </dl>
      </section>
    </section>
  )
}
