import { useEffect, useRef, useState } from 'react'
import { formatBytes, type OfflineScope, type Settings, type Song } from '@selfmp3/shared'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import {
  queryKeys,
  useAnalysisStatus,
  useLibrary,
  useScanLibrary,
  useSettings,
  useStartAnalysis,
  useUpdateSettings,
} from '../lib/queries.js'
import { FixCoversPanel } from '../components/FixCoversPanel.js'
import { useOffline } from '../offline/OfflineProvider.js'
import { OfflineAutoStatus } from '../offline/OfflineStatus.js'
import { connectionKind } from '../offline/autoDownload.js'
import { api } from '../lib/api.js'
import { CheckCircle, CloudDownload, Refresh, Sparkles, Trash, X } from '../components/Icons.js'
import { LyricsSettings } from '../components/LyricsSettings.js'
import { Select } from '../components/Select.js'
import { DevicesSettings } from '../devices/DevicesSettings.js'
import { CloudSettings } from '../cloud/CloudSettings.js'
import { CloudAccountSettings } from '../cloud/CloudGate.js'
import { CLOUD } from '../lib/platform.js'

/**
 * Settings.
 *
 * Split into what syncs and what does not: playback and import settings live
 * on the server so the Mac and the phone agree, while offline downloads are
 * per-device by definition — what you have cached on your phone is not a fact
 * about your library.
 *
 * Eleven groups is more than anyone scrolls through looking for one switch, so
 * the page carries its own index: a sticky list on the left at desktop width,
 * a scrollable chip row above the panels on anything narrower. Every group is
 * one `<section class="panel">` with an id, and every setting inside it has the
 * same anatomy — name, one quiet line of explanation, control on the right.
 */

/** The index, in page order. `mac`: the section acts on the Mac, so the web build has none. */
const ALL_SECTIONS: ReadonlyArray<{ id: string; label: string; mac?: boolean }> = [
  { id: 'playback', label: 'Playback' },
  { id: 'offline', label: 'Offline music' },
  { id: 'importing', label: 'Importing', mac: true },
  { id: 'library', label: 'Library', mac: true },
  { id: 'cloud', label: 'Cloud' },
  { id: 'lyrics', label: 'Lyrics', mac: true },
  { id: 'devices', label: 'Devices', mac: true },
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Shortcuts' },
]
const SECTIONS = ALL_SECTIONS.filter(section => !CLOUD || !section.mac)

/** A starting point for the accent, so the slider is not the only way in. */
/**
 * The accent hue slider.
 *
 * Dragging one of these fires an event per pixel crossed, and each one used to
 * be a write to the Mac: a single drag across the strip sent hundreds of PATCHes
 * and the thumb jumped backwards whenever a stale reply landed under the
 * pointer. The colour follows the drag locally, and only where the drag stops
 * is saved.
 */
function AccentHueSlider({ hue, onPick }: { hue: number; onPick: (hue: number) => void }) {
  const [dragging, setDragging] = useState<number | null>(null)
  const shown = dragging ?? hue

  const commit = (): void => {
    if (dragging !== null && dragging !== hue) onPick(dragging)
    setDragging(null)
  }

  return (
    <input
      type="range"
      className="accent-slider"
      min={0}
      max={359}
      step={1}
      value={shown}
      aria-label="Accent hue"
      onChange={event => setDragging(Number(event.target.value))}
      onPointerUp={commit}
      onPointerCancel={commit}
      onBlur={commit}
      onKeyUp={commit}
    />
  )
}

const ACCENT_PRESETS: ReadonlyArray<{ hue: number; name: string }> = [
  { hue: 268, name: 'Violet' },
  { hue: 220, name: 'Blue' },
  { hue: 190, name: 'Teal' },
  { hue: 150, name: 'Green' },
  { hue: 60, name: 'Amber' },
  { hue: 20, name: 'Red' },
  { hue: 330, name: 'Pink' },
]

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
  const analysis = useAnalysisStatus(true)
  const startAnalysis = useStartAnalysis()
  const { active, go } = useActiveSection(SECTIONS, settings !== undefined)
  const indexRef = useRef<HTMLElement>(null)

  // At narrow widths the index is a horizontal chip row, and the chip for the
  // section you are reading is often scrolled out of it. Nudge it back —
  // sideways only: scrollIntoView would also scroll the page to "reveal" it.
  useEffect(() => {
    const nav = indexRef.current
    if (!active || !nav || nav.scrollWidth <= nav.clientWidth) return
    const chip = nav.querySelector<HTMLElement>(`[data-section="${active}"]`)
    if (!chip) return
    nav.scrollTo({
      left: chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2,
      behavior: 'smooth',
    })
  }, [active])

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
  const analyzedCount = songs.filter(song => song.features !== null).length
  const cachedCount = offline.cachedIds.size
  const syncing = offline.sync.status === 'syncing'

  return (
    <section className="view settings-view">
      {/*
        The title lives in the layout's right column, beside the index rather
        than above it, so the index starts at the top of the page and stays
        there. Above both, the index started lower and slid up the moment the
        page scrolled — which clicking an entry always does.
      */}
      <div className="settings-layout">
        <header className="view-head settings-head">
          <div className="view-titles">
            <h1>Settings</h1>
            <p className="view-sub">
              {health
                ? `self.mp3 ${health.version} · ${health.songCount} songs · ${health.storageDriver} storage`
                : 'Not connected to your library right now'}
            </p>
          </div>
        </header>

        <nav className="settings-index" aria-label="Settings sections" ref={indexRef}>
          <span className="settings-index-title">On this page</span>
          {SECTIONS.map(section => (
            <a
              key={section.id}
              href={`#${section.id}`}
              data-section={section.id}
              aria-current={active === section.id ? 'true' : undefined}
              onClick={event => {
                event.preventDefault()
                go(section.id)
              }}
            >
              {section.label}
            </a>
          ))}
        </nav>

        <div className="settings-panels">
          {/* ---------------- playback ---------------- */}

          {settings && (
            <section className="panel" id="playback">
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
                      {
                        '--progress': `${(settings.crossfadeSeconds / 12) * 100}%`,
                      } as React.CSSProperties
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
                <span className="setting-control">
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={settings.autoFetchLyrics}
                    onChange={event => set('autoFetchLyrics', event.target.checked)}
                  />
                </span>
              </label>
            </section>
          )}

          {/* ---------------- offline ---------------- */}

          <section className="panel" id="offline">
            <header className="panel-head">
              <h2>Offline music</h2>
              <span className="hint">on this device</span>
            </header>

            {offline.holdsLibrary ? (
              <LibraryOnThisDevice songs={songs} />
            ) : (
              <>
                {CLOUD ? (
                  <p className="panel-lead">
                    Songs stream from your bucket, so nothing is kept here unless you ask for it.
                    One you listen to all the way through is kept for a while — the next play costs
                    nothing, and works with no connection. Downloading a song by hand keeps it for
                    good.
                  </p>
                ) : (
                  <p className="panel-lead">
                    Downloaded songs play with no connection at all — which is the point, since your
                    Mac won&rsquo;t always be awake. New songs download on their own; plays you make
                    offline are kept here and sent to your Mac when it&rsquo;s back.
                  </p>
                )}

                {!offline.supported && (
                  <p className="notice notice-warn">
                    This browser can&rsquo;t keep songs offline here. Open self.mp3 over HTTPS — the
                    Tailscale address from the setup guide — and add it to your home screen.
                  </p>
                )}

                <label className="setting-row setting-row-toggle">
                  <span className="setting-label">
                    Download automatically
                    {CLOUD ? (
                      <span className="setting-hint">
                        Keeps a copy of your whole library in this browser. Worth it on a phone with
                        self.mp3 on its home screen, and a lot of storage anywhere else. A song you
                        remove by hand stays removed.
                      </span>
                    ) : (
                      <span className="setting-hint">
                        Keeps this device in step with your library whenever your Mac is reachable.
                        A song you remove by hand stays removed.
                      </span>
                    )}
                  </span>
                  <span className="setting-control">
                    <input
                      type="checkbox"
                      className="toggle"
                      checked={offline.prefs.auto}
                      disabled={!offline.supported}
                      onChange={event => offline.setPrefs({ auto: event.target.checked })}
                    />
                  </span>
                </label>

                <label className="setting-row setting-row-toggle">
                  <span className="setting-label">
                    Only on Wi-Fi
                    <span className="setting-hint">
                      {connectionKind() === 'unknown'
                        ? 'This browser can’t tell Wi-Fi from mobile data, so it asks before downloading.'
                        : 'Waits for Wi-Fi rather than using mobile data.'}
                    </span>
                  </span>
                  <span className="setting-control">
                    <input
                      type="checkbox"
                      className="toggle"
                      checked={offline.prefs.wifiOnly}
                      disabled={!offline.supported || !offline.prefs.auto}
                      onChange={event => offline.setPrefs({ wifiOnly: event.target.checked })}
                    />
                  </span>
                </label>

                <div className="setting-row">
                  <span className="setting-label">
                    Keep offline
                    <span className="setting-hint">
                      Only songs in a playlist, if this device is short on space.
                    </span>
                  </span>
                  <span className="setting-control">
                    <Select<OfflineScope>
                      value={offline.prefs.scope}
                      onChange={scope => offline.setPrefs({ scope })}
                      options={[
                        { value: 'library', label: 'Every song' },
                        { value: 'playlists', label: 'Songs in playlists' },
                      ]}
                      label="Keep offline"
                      align="end"
                    />
                  </span>
                </div>

                <OfflineAutoStatus />

                {offline.pendingListens > 0 && (
                  <p className="hint">
                    {offline.pendingListens === 1
                      ? '1 play from while you were offline is'
                      : `${offline.pendingListens} plays from while you were offline are`}{' '}
                    waiting to be sent to your Mac.
                  </p>
                )}

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
                        {offline.sync.progress.currentTitle &&
                          ` — ${offline.sync.progress.currentTitle}`}
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

                {offline.sync.status === 'done' && offline.sync.progress.total > 0 && (
                  <p className="notice notice-good">
                    <CheckCircle size={15} /> Downloaded {offline.sync.progress.done}{' '}
                    {offline.sync.progress.done === 1 ? 'song' : 'songs'}.
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
                      onClick={() => void offline.downloadNow()}
                      disabled={
                        !offline.supported || !offline.serverReachable || songs.length === 0
                      }
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
                        if (
                          window.confirm(
                            offline.prefs.auto
                              ? 'Remove all downloaded songs from this device? Automatic downloads will be turned off too, or they would just come back.'
                              : 'Remove all downloaded songs from this device?',
                          )
                        ) {
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
              </>
            )}
          </section>

          {/* ---------------- importing ---------------- */}

          {settings && !CLOUD && (
            <section className="panel" id="importing">
              <header className="panel-head">
                <h2>Importing</h2>
                <span className="hint">shared across your devices</span>
              </header>

              <div className="setting-row">
                <span className="setting-label">
                  Downloads at once
                  <span className="setting-hint">
                    More is rarely faster and makes YouTube throttle. Two is a good default.
                  </span>
                </span>
                <span className="setting-control">
                  <Select<number>
                    value={settings.importConcurrency}
                    onChange={value => set('importConcurrency', value)}
                    options={[1, 2, 3, 4].map(value => ({ value, label: String(value) }))}
                    label="Downloads at once"
                    align="end"
                  />
                </span>
              </div>

              <div className="setting-row">
                <span className="setting-label">
                  Rescan automatically
                  <span className="setting-hint">
                    Watch the library folder for files you dropped in by hand. Takes effect on
                    restart.
                  </span>
                </span>
                <span className="setting-control">
                  <Select<number>
                    value={settings.autoScanMinutes}
                    onChange={value => set('autoScanMinutes', value)}
                    options={[
                      { value: 0, label: 'Never' },
                      { value: 5, label: 'Every 5 minutes' },
                      { value: 15, label: 'Every 15 minutes' },
                      { value: 60, label: 'Every hour' },
                    ]}
                    label="Rescan automatically"
                    align="end"
                  />
                </span>
              </div>

              {/* ---- import suite: folder watching + YouTube cookies ---- */}

              <label className="setting-row setting-row-toggle">
                <span className="setting-label">
                  Watch the library folder
                  <span className="setting-hint">
                    Rescan the moment a file is added, removed or renamed — drag something into the
                    folder in Finder and it shows up here. No timer needed.
                  </span>
                </span>
                <span className="setting-control">
                  <input
                    type="checkbox"
                    className="toggle"
                    checked={settings.watchLibrary}
                    onChange={event => set('watchLibrary', event.target.checked)}
                  />
                </span>
              </label>

              <div className="setting-row" id="youtube">
                <span className="setting-label">
                  YouTube login cookies
                  <span className="setting-hint">
                    Lets yt-dlp see Liked Music and private playlists. “Browser” borrows the login
                    from a browser on this Mac; “File” reads a Netscape cookies.txt.
                  </span>
                </span>
                <span className="setting-control">
                  <Select<Settings['ytCookieSource']>
                    value={settings.ytCookieSource}
                    onChange={value => set('ytCookieSource', value)}
                    options={[
                      { value: 'none', label: 'Off' },
                      { value: 'browser', label: 'From a browser' },
                      { value: 'file', label: 'From a cookies.txt file' },
                    ]}
                    label="YouTube login cookies"
                    align="end"
                  />
                </span>
              </div>

              {settings.ytCookieSource === 'browser' && (
                <div className="setting-row">
                  <span className="setting-label">
                    Browser
                    <span className="setting-hint">
                      Must be signed in to YouTube Music.
                      {settings.ytCookieBrowser === 'safari' &&
                        ' Safari’s cookie file is protected by macOS: give the process running self.mp3 (Terminal or node) Full Disk Access in System Settings → Privacy & Security.'}
                      {settings.ytCookieBrowser !== 'safari' &&
                        ' Chromium browsers may ask for keychain access the first time; Firefox needs to be closed while cookies are read.'}
                    </span>
                  </span>
                  <span className="setting-control">
                    <Select<Settings['ytCookieBrowser']>
                      value={settings.ytCookieBrowser}
                      onChange={value => set('ytCookieBrowser', value)}
                      options={[
                        { value: 'chrome', label: 'Chrome' },
                        { value: 'safari', label: 'Safari' },
                        { value: 'firefox', label: 'Firefox' },
                        { value: 'brave', label: 'Brave' },
                        { value: 'edge', label: 'Edge' },
                        { value: 'chromium', label: 'Chromium' },
                      ]}
                      label="Browser"
                      align="end"
                    />
                  </span>
                </div>
              )}

              {settings.ytCookieSource === 'file' && (
                <label className="setting-row">
                  <span className="setting-label">
                    Cookies file
                    <span className="setting-hint">
                      Full path to a Netscape-format cookies.txt exported from a browser where you
                      are logged in to YouTube Music.
                    </span>
                  </span>
                  <span className="setting-control">
                    <input
                      key={settings.ytCookieFile}
                      className="input setting-input-path"
                      defaultValue={settings.ytCookieFile}
                      placeholder="/Users/you/cookies.txt"
                      spellCheck={false}
                      onBlur={event => {
                        if (event.target.value.trim() !== settings.ytCookieFile) {
                          set('ytCookieFile', event.target.value.trim())
                        }
                      }}
                    />
                  </span>
                </label>
              )}
            </section>
          )}

          {/* ---------------- library ---------------- */}

          {!CLOUD && (
            <section className="panel" id="library">
              <header className="panel-head">
                <h2>Library</h2>
                <span className="hint">{songs.length} songs</span>
              </header>

              {health?.libraryPath !== undefined && (
                <p className="panel-lead">
                  Your music lives at <code>{health.libraryPath}</code>. It is just a folder of
                  files — copy it anywhere and you have a complete backup.
                </p>
              )}

              <div className="setting-row">
                <span className="setting-label">
                  Rescan the folder
                  <span className="setting-hint">
                    {scan.data
                      ? `Last scan found ${scan.data.total} songs — ${scan.data.added} new, ${scan.data.updated} updated, ${scan.data.removed} now missing.`
                      : 'Pick up files you added, renamed or deleted outside self.mp3.'}
                  </span>
                </span>
                <span className="setting-control">
                  <button
                    type="button"
                    className="button"
                    onClick={() => scan.mutate()}
                    disabled={scan.isPending}
                  >
                    <Refresh size={15} /> {scan.isPending ? 'Scanning…' : 'Rescan'}
                  </button>
                </span>
              </div>

              <FixCoversPanel
                missingArt={songs.filter(song => !song.hasArt && !song.missing).length}
              />

              <div className="setting-row">
                <span className="setting-label">
                  Audio analysis
                  <span className="setting-hint">
                    Works out each song&rsquo;s tempo, key, energy and loudness from the file
                    itself, on this Mac. It powers smart-playlist rules, &ldquo;similar songs&rdquo;
                    and auto-mix. {analyzedCount} of {songs.length} songs analysed.
                  </span>
                </span>
                <span className="setting-control">
                  <button
                    type="button"
                    className="button"
                    onClick={() => startAnalysis.mutate(false)}
                    disabled={analysis.data?.running || startAnalysis.isPending}
                  >
                    <Sparkles size={15} />{' '}
                    {analysis.data?.running ? 'Analysing…' : 'Analyse new songs'}
                  </button>
                  {analyzedCount > 0 && !analysis.data?.running && (
                    <button
                      type="button"
                      className="button"
                      data-tip="Throw away existing analysis and redo every song"
                      onClick={() => {
                        if (window.confirm('Throw away existing analysis and redo every song?')) {
                          startAnalysis.mutate(true)
                        }
                      }}
                    >
                      <Refresh size={15} /> Redo all
                    </button>
                  )}
                </span>
              </div>

              {analysis.data?.running && (
                <div className="sync-progress" aria-live="polite">
                  <div className="sync-progress-head">
                    <span className="spinner" />
                    <span>
                      Analysing{analysis.data.current ? ` — ${analysis.data.current.title}` : '…'}
                      {analysis.data.pending > 0 && ` · ${analysis.data.pending} to go`}
                    </span>
                  </div>
                </div>
              )}

              {missingCount > 0 && (
                <div className="setting-row setting-row-stacked">
                  <p className="notice notice-warn">
                    <span>
                      {missingCount} {missingCount === 1 ? 'song is' : 'songs are'} in your library
                      but the {missingCount === 1 ? 'file is' : 'files are'} gone. Their tags and
                      play counts are kept in case the files come back.
                    </span>
                  </p>
                  <span className="setting-control">
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
                  </span>
                </div>
              )}
            </section>
          )}

          {/* ---------------- cloud ---------------- */}

          {CLOUD ? <CloudAccountSettings /> : <CloudSettings />}

          {/* ---------------- lyrics+ ---------------- */}

          {settings && !CLOUD && <LyricsSettings settings={settings} onSet={set} />}

          {/* ---------------- devices ---------------- */}

          {!CLOUD && <DevicesSettings />}

          {/* ---------------- appearance ---------------- */}

          {settings && (
            <section className="panel" id="appearance">
              <header className="panel-head">
                <h2>Appearance</h2>
                <span className="hint">shared across your devices</span>
              </header>

              <div className="setting-row">
                <span className="setting-label">
                  Theme
                  <span className="setting-hint">
                    “System” follows this device’s own light and dark setting, and changes with it.
                    Your accent colour holds either way.
                  </span>
                </span>
                <span className="setting-control">
                  <Select<Settings['theme']>
                    value={settings.theme}
                    onChange={value => set('theme', value)}
                    options={[
                      { value: 'dark', label: 'Dark' },
                      { value: 'light', label: 'Light' },
                      { value: 'system', label: 'System' },
                    ]}
                    label="Theme"
                    align="end"
                  />
                </span>
              </div>

              <div className="setting-row">
                <span className="setting-label">
                  Accent colour
                  <span className="setting-hint">
                    Drives every colour in the app — the surfaces are tinted from it too, so a
                    change is felt rather than spotted.{' '}
                    {ACCENT_PRESETS.find(p => p.hue === settings.accentHue)?.name ??
                      `Hue ${settings.accentHue}°`}
                    .
                  </span>
                </span>
                <span className="setting-control accent-control">
                  <span className="accent-swatches">
                    {ACCENT_PRESETS.map(preset => (
                      <button
                        key={preset.hue}
                        type="button"
                        className="accent-swatch"
                        style={{ '--swatch-hue': preset.hue } as React.CSSProperties}
                        aria-label={preset.name}
                        aria-pressed={settings.accentHue === preset.hue}
                        data-tip={preset.name}
                        onClick={() => set('accentHue', preset.hue)}
                      />
                    ))}
                  </span>
                  <AccentHueSlider
                    hue={settings.accentHue}
                    onPick={hue => set('accentHue', hue)}
                  />
                </span>
              </div>
            </section>
          )}

          {/* ---------------- shortcuts ---------------- */}

          <section className="panel" id="shortcuts">
            <header className="panel-head">
              <h2>Keyboard shortcuts</h2>
              <span className="hint">on a Mac</span>
            </header>
            <p className="hint">Everything else is done with the mouse.</p>
            <dl className="shortcut-list">
              <div>
                <dt>
                  <kbd>⌘</kbd> <kbd>K</kbd>
                </dt>
                <dd>Search everything</dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </section>
  )
}

/**
 * The offline panel on the computer the library lives on.
 *
 * Same question as on any device — how much of the library is here? — with
 * the answer every other device is working towards: all of it, as files.
 * Nothing to switch on, nothing to download.
 */
function LibraryOnThisDevice({ songs }: { songs: readonly Song[] }) {
  const present = songs.filter(song => !song.missing)
  const bytes = present.reduce((sum, song) => sum + song.sizeBytes, 0)
  const missing = songs.length - present.length

  return (
    <>
      <p className="panel-lead">
        Your library lives on this computer, so every song is already on this device as a file in
        your library folder — they play with no connection at all, and there&rsquo;s nothing to
        download. Downloads are for your phone and other computers.
      </p>

      <div className="offline-summary">
        <div className="offline-stat">
          <span className="offline-stat-value">{present.length}</span>
          <span className="offline-stat-label">of {songs.length} songs on this device</span>
        </div>
        <div className="offline-stat">
          <span className="offline-stat-value">{formatBytes(bytes)}</span>
          <span className="offline-stat-label">in your library folder</span>
        </div>
      </div>

      {missing > 0 && (
        <p className="hint">
          {missing === 1 ? '1 song’s file is' : `${missing} songs’ files are`} missing from the
          folder — Settings → Library can rescan or forget them.
        </p>
      )}
    </>
  )
}

/** How far below the top of the page a section counts as the one being read. */
const READING_LINE = 96

/** Keys that scroll the page, when nothing editable has focus. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '])

/** The element that actually scrolls: `.app-main`, or the document. */
function scrollParentOf(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return document.scrollingElement as HTMLElement
}

/**
 * Which section the reader is looking at, and a way to go to one.
 *
 * Normally it is the last section whose top has passed a line near the top of
 * the page. But the last few sections are short, and the page runs out before
 * their tops ever reach that line — so over the final screenful the line
 * slides down to the bottom edge, and each of them gets its turn on the way
 * down instead of the highlight leaping from the middle to the last one.
 *
 * Choosing a section in the index sets it outright and holds it there until
 * the reader scrolls for themselves: the page may not be able to bring a short
 * last section to the top, and the highlight must not then settle on
 * whichever section geometry prefers.
 */
function useActiveSection(
  sections: ReadonlyArray<{ id: string }>,
  ready: boolean,
): { active: string | null; go: (id: string) => void } {
  const [active, setActive] = useState<string | null>(null)
  const pinned = useRef(false)
  const location = useLocation()
  const ids = sections.map(section => section.id).join(',')

  useEffect(() => {
    // Half the panels only exist once the settings have loaded.
    if (!ready) return
    const elements = ids
      .split(',')
      .map(id => document.getElementById(id))
      .filter((element): element is HTMLElement => element !== null)
    const first = elements[0]
    if (!first) return
    const scroller = scrollParentOf(first)

    const pick = (): void => {
      if (pinned.current) return
      const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top
      const view = scroller.clientHeight
      const remaining = scroller.scrollHeight - view - scroller.scrollTop
      const approach = Math.max(0, Math.min(1, 1 - remaining / view))
      const line = top + READING_LINE + (view - READING_LINE) * approach

      let current = first
      for (const element of elements) {
        if (element.getBoundingClientRect().top <= line) current = element
      }
      setActive(current.id)
    }

    let frame = 0
    const schedule = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(pick)
    }
    const release = (): void => {
      if (!pinned.current) return
      pinned.current = false
      schedule()
    }
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
      if (SCROLL_KEYS.has(event.key)) release()
    }
    // Dragging the scrollbar lands on the scrolling element itself.
    const onPointer = (event: PointerEvent): void => {
      if (event.target === scroller) release()
    }

    const events = scroller === document.scrollingElement ? window : scroller
    pick()
    events.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('wheel', release, { passive: true })
    window.addEventListener('touchmove', release, { passive: true })
    window.addEventListener('keydown', onKey)
    scroller.addEventListener('pointerdown', onPointer)
    return () => {
      cancelAnimationFrame(frame)
      events.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('wheel', release)
      window.removeEventListener('touchmove', release)
      window.removeEventListener('keydown', onKey)
      scroller.removeEventListener('pointerdown', onPointer)
    }
  }, [ids, ready])

  const go = (id: string, smooth = true): void => {
    const element = document.getElementById(id)
    if (!element) return
    pinned.current = true
    setActive(id)
    // Scroll the one scrolling element by hand: scrollIntoView also nudges
    // every ancestor that can scroll, even ones that are only overflow-hidden.
    const scroller = scrollParentOf(element)
    const top = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top
    const margin = parseFloat(getComputedStyle(element).scrollMarginTop) || 0
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    scroller.scrollTo({
      top: scroller.scrollTop + element.getBoundingClientRect().top - top - margin,
      behavior: smooth && !reduced ? 'smooth' : 'auto',
    })
    history.replaceState(history.state, '', `#${id}`)
  }

  // Arriving with a section in the address (the offline pill links to
  // #offline) goes straight to it, once there is something to go to. Keyed on
  // the navigation rather than the hash, so following the same link twice
  // still goes there the second time.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (ready && id && ids.split(',').includes(id)) go(id, false)
  }, [location.key, ready, ids])

  return { active, go }
}
