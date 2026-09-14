import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatBytes, type Settings, type Song } from '@selfmp3/shared'
import {
  buildAccent,
  clientApi,
  deviceListView,
  downloadedCount,
  queryKeys,
  radius,
  relativeTime,
  staleIds,
  totalBytes,
  useAnalysisStatus,
  useScanLibrary,
  useSettings,
  useStartAnalysis,
  useUpdateSettings,
} from '@selfmp3/client'
import { useFixCovers, useFixCoversStatus, useLibrary, useManifest } from '../../api/queries'
import { useDownloads } from '../../offline/DownloadsProvider'
import { library as cloudLibrary, session as cloudSession } from '../../cloud'
import { clearCachedLibrary } from '../../offline/libraryCache'
import { setRomanizationOn, useRomanizationOn } from '../nowPlaying/romanizationPref'
import { clearCachedLyrics } from '../../offline/lyricsCache'
import { clearCachedPlaylists } from '../../offline/playlistCache'
import { installedApp } from '../../ports/install'
import { canConnectByAddress } from '../../ports/serverAddress'
import { clearRecent } from '../../ports/recentCopies'
import { apiFor, ApiError } from '../../api/client'
import { normaliseBaseUrl } from '../../server/connection'
import { useConnection } from '../../server/ConnectionProvider'
import { useLayout } from '../../shell/useLayout'
import { ACCENT_PRESETS, useAccent, type ThemeChoice } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { IconButton } from '../../ui/components/IconButton'
import { CloudDownload, Refresh, Sparkles, Trash, X } from '../../ui/components/Icons'
import { Select } from '../../ui/components/Select'
import { Slider } from '../../ui/components/Slider'
import { Toggle } from '../../ui/components/Toggle'
import { useDeviceContext } from '../devices/DevicesProvider'
import { finePointer } from '../../ports/pointer'
import {
  ButtonRow,
  Kbd,
  Lead,
  Meter,
  Notice,
  Panel,
  partStyles,
  Row,
  SliderSetting,
  StackedRows,
  Stats,
} from './SettingsParts'
import { CloudPanel } from './CloudPanel'
import { signOutOfCloud, signOutWarning } from './signOut'
import {
  accentName,
  activeSection,
  crossfadeLabel,
  healthLine,
  scanHint,
  sectionsFor,
  type SectionId,
} from './settings.model'
import {
  coverArtHint,
  coverProgress,
  coverResult,
  missingArtCount,
} from '../metadata/metadata.model'

/** At this width the index is a column beside the panels; below it, a row of chips. */
const INDEX_COLUMN = 1080

type Confirming = 'remove-downloads' | 'redo-analysis' | 'forget-missing' | 'sign-out' | null

/**
 * Settings: the web's `SettingsView`.
 *
 * What syncs and what does not, kept apart. Playback, importing and lyrics
 * live on the server so the Mac and every phone agree; downloads, the accent
 * and the theme belong to this device. The page carries its own index — a
 * column beside the panels on a wide screen, a sticky row of chips above them
 * on a narrow one — and every setting has the same anatomy.
 */
export function SettingsScreen(): ReactNode {
  const { theme } = useUnistyles()
  const { fromCloud } = useConnection()
  const romanizationOn = useRomanizationOn()
  const { width, wide } = useLayout()
  const settings = useSettings()
  const updateSettings = useUpdateSettings()
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => clientApi().health(),
    retry: false,
    staleTime: 60_000,
  })

  // A mouse or trackpad stands in for a keyboard: a phone has no ⌘K to explain.
  const sections = sectionsFor(fromCloud, installedApp, finePointer)
  const column = width >= INDEX_COLUMN
  const scrollRef = useRef<ScrollView>(null)
  const tops = useRef(new Map<SectionId, number>())
  const panelsTop = useRef(0)
  const metrics = useRef({ view: 0, content: 0 })
  const pinned = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [active, setActive] = useState<SectionId>('playback')
  const accent = useAccent()
  const chipsRef = useRef<ScrollView>(null)
  const chipAt = useRef(new Map<SectionId, { x: number; width: number }>())
  const chipsWidth = useRef(0)

  // At narrow widths the chip for the section being read is often scrolled out
  // of its row. Bring it back — sideways only, as the web does.
  useEffect(() => {
    const chip = chipAt.current.get(active)
    if (!chip || chipsWidth.current === 0) return
    chipsRef.current?.scrollTo({
      x: Math.max(0, chip.x - (chipsWidth.current - chip.width) / 2),
      animated: true,
    })
  }, [active])
  const [confirming, setConfirming] = useState<Confirming>(null)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    updateSettings.mutate({ [key]: value } as Partial<Settings>)
  }
  const onTop = (id: SectionId, top: number): void => {
    tops.current.set(id, top)
  }

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    // Chosen from the index: held until the jump has landed.
    if (pinned.current !== null) return
    const list = sections.map(section => ({
      id: section.id,
      top: panelsTop.current + (tops.current.get(section.id) ?? Number.POSITIVE_INFINITY),
    }))
    const next = activeSection(
      list,
      event.nativeEvent.contentOffset.y,
      metrics.current.view,
      metrics.current.content,
    )
    if (next !== null && next !== active) setActive(next)
  }

  const go = (id: SectionId): void => {
    const top = tops.current.get(id)
    if (top === undefined) return
    setActive(id)
    if (pinned.current !== null) clearTimeout(pinned.current)
    pinned.current = setTimeout(() => {
      pinned.current = null
    }, 900)
    scrollRef.current?.scrollTo({ y: Math.max(0, panelsTop.current + top - 28), animated: true })
  }

  const index = sections.map(section => {
    const on = active === section.id
    return (
      <Pressable
        key={section.id}
        onPress={() => go(section.id)}
        onLayout={
          column
            ? undefined
            : event => {
                const { x, width: chipWidth } = event.nativeEvent.layout
                chipAt.current.set(section.id, { x, width: chipWidth })
              }
        }
        accessibilityRole="link"
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [
          column ? styles.indexItem : styles.chip,
          on &&
            (column
              ? [styles.indexItemOn, { borderLeftColor: accent.accent }]
              : { borderColor: accent.accent }),
          pressed && styles.indexPressed,
        ]}
      >
        <Text style={[styles.indexText, on && styles.indexTextOn]}>{section.label}</Text>
      </Pressable>
    )
  })

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onLayout={event => {
          metrics.current.view = event.nativeEvent.layout.height
        }}
        onContentSizeChange={(_, height) => {
          metrics.current.content = height
        }}
        stickyHeaderIndices={column ? undefined : [1]}
        contentContainerStyle={[
          styles.content,
          column ? styles.contentColumn : styles.contentNarrow,
        ]}
      >
        <View style={styles.head}>
          <Text style={[styles.title, !wide && styles.titleNarrow]} accessibilityRole="header">
            Settings
          </Text>
          <Text style={styles.sub}>{healthLine(health.data)}</Text>
        </View>

        {column ? null : (
          <View
            style={[
              styles.chipBar,
              // Colours inline, not only from the sheet: a sticky header is
              // re-parented into ScrollView's own animated wrapper, which
              // Unistyles' live update does not reach, so the strip would keep
              // the last theme's ground.
              { backgroundColor: theme.colors.surface0, borderBottomColor: theme.colors.border },
            ]}
          >
            <ScrollView
              ref={chipsRef}
              onLayout={event => {
                chipsWidth.current = event.nativeEvent.layout.width
              }}
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chips}
            >
              {index}
            </ScrollView>
          </View>
        )}

        <StackedRows value={!wide}>
          <View
            style={styles.panels}
            onLayout={event => {
              panelsTop.current = event.nativeEvent.layout.y
            }}
          >
            {settings.data ? (
              <Panel
                title="Playback"
                hint="shared across your devices"
                onTop={top => onTop('playback', top)}
              >
                <Row
                  label="Crossfade"
                  hint="Overlap the end of one track with the start of the next. Zero turns it off."
                >
                  <SliderSetting
                    value={settings.data.crossfadeSeconds}
                    min={0}
                    max={12}
                    step={1}
                    label="Crossfade"
                    format={crossfadeLabel}
                    onCommit={value => set('crossfadeSeconds', value)}
                  />
                </Row>
                <Row
                  label="Look up lyrics automatically"
                  hint="Fetches synced lyrics from lrclib.net when a song is imported, and saves them next to the audio so they work offline."
                  last
                >
                  <Toggle
                    value={settings.data.autoFetchLyrics}
                    onChange={value => set('autoFetchLyrics', value)}
                    label="Look up lyrics automatically"
                  />
                </Row>
              </Panel>
            ) : null}

            {/* A browser streams and keeps nothing: only an installed app has offline music. */}
            {installedApp ? (
              <OfflinePanel onTop={top => onTop('offline', top)} onConfirm={setConfirming} />
            ) : null}

            {settings.data && !fromCloud ? (
              <ImportingPanel
                settings={settings.data}
                set={set}
                onTop={top => onTop('importing', top)}
              />
            ) : null}

            {fromCloud ? null : (
              <LibraryPanel
                libraryPath={health.data?.libraryPath}
                onTop={top => onTop('library', top)}
                onConfirm={setConfirming}
              />
            )}

            {fromCloud ? null : <CloudPanel onTop={top => onTop('cloud', top)} />}

            <ConnectionPanel onTop={top => onTop('connection', top)} onConfirm={setConfirming} />

            {fromCloud ? null : (
              <Panel title="Lyrics" hint="on this device" onTop={top => onTop('lyrics', top)}>
                <Row
                  label="Show pinyin / romaji"
                  hint="A romanized line under each Chinese or Japanese lyric. It is made on your server and kept with the words, so this only chooses whether to draw it."
                  last
                >
                  <Toggle
                    value={romanizationOn}
                    onChange={setRomanizationOn}
                    label="Show pinyin / romaji"
                  />
                </Row>
              </Panel>
            )}

            {fromCloud ? null : <DevicesPanel onTop={top => onTop('devices', top)} />}

            <AppearancePanel onTop={top => onTop('appearance', top)} />

            {finePointer ? (
              <Panel
                title="Keyboard shortcuts"
                hint="on the server"
                onTop={top => onTop('shortcuts', top)}
              >
                <Text style={partStyles.hint}>Everything else is done with the mouse.</Text>
                <View style={styles.shortcut}>
                  <View style={styles.keys}>
                    <Kbd>⌘</Kbd>
                    <Kbd>K</Kbd>
                  </View>
                  <Text style={partStyles.hint}>Search everything</Text>
                </View>
              </Panel>
            ) : null}

            <Panel title="About" onTop={top => onTop('about', top)}>
              <Row label="Version" last>
                <Text style={styles.valueText}>
                  {String(Constants.expoConfig?.version ?? '1.0.0')}
                </Text>
              </Row>
              <Text style={partStyles.hint}>
                Crossfade is the web app&rsquo;s: it overlaps two audio elements to do it, and this
                app plays gapless instead, so the crossfade setting above has no effect here yet.
              </Text>
            </Panel>
          </View>
        </StackedRows>
      </ScrollView>

      {column ? (
        <View style={styles.indexColumn} accessibilityLabel="Settings sections">
          <Text style={styles.indexTitle}>ON THIS PAGE</Text>
          {index}
        </View>
      ) : null}

      <Confirmations confirming={confirming} onDone={() => setConfirming(null)} />
    </SafeAreaView>
  )
}

// ---------------------------------------------------------------- offline

function OfflinePanel({
  onTop,
  onConfirm,
}: {
  onTop: (top: number) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const { fromCloud } = useConnection()
  const library = useLibrary()
  const manifest = useManifest()
  const {
    state: downloads,
    queue,
    prefs,
    setPrefs,
    missingIds,
    situation,
    requestDownload,
  } = useDownloads()
  const [busy, setBusy] = useState(false)

  const songIds = useMemo(
    () => (library.data?.songs ?? []).filter(song => !song.missing).map(song => song.id),
    [library.data],
  )
  const held = downloadedCount(downloads.index)
  const missingBytes = situation.missingBytes
  const stale = manifest.data ? staleIds(downloads.index, manifest.data) : []
  const activeSong =
    downloads.activeSongId === null
      ? null
      : library.data?.songs.find(song => song.id === downloads.activeSongId)
  const working = downloads.queue.length > 0

  return (
    <Panel title="Offline music" hint="on this device" onTop={onTop}>
      <Lead>
        {fromCloud
          ? 'A library in the cloud plays from this device, so its songs are downloaded here first. Plays you make offline are kept and sent when you are back online.'
          : 'Downloaded songs play with no connection at all — which is the point, since your server won’t always be reachable. Plays you make offline are kept here and sent to your server when it’s back.'}
      </Lead>

      <Row
        label="Download automatically on Wi-Fi"
        hint="Keeps this device in step with your library on Wi-Fi. On mobile data it asks first, anything over 500 MB waits for you, and a song you remove by hand stays removed."
      >
        <Toggle
          value={prefs.autoOnWifi}
          onChange={autoOnWifi => setPrefs({ autoOnWifi })}
          label="Download automatically on Wi-Fi"
          testID="setting-auto-download"
        />
      </Row>
      <Row
        label="Play songs that aren’t downloaded"
        hint={
          fromCloud
            ? 'A library in the cloud can’t stream yet, so only downloaded songs play.'
            : 'Streams them from your server while it’s reachable. Off, only what is on this device plays.'
        }
        last
      >
        <Toggle
          value={prefs.streamUndownloaded && !fromCloud}
          disabled={fromCloud}
          onChange={streamUndownloaded => setPrefs({ streamUndownloaded })}
          label="Play songs that aren’t downloaded"
          testID="setting-stream"
        />
      </Row>

      <Stats
        items={[
          { value: String(held), label: `of ${songIds.length} songs downloaded` },
          { value: formatBytes(totalBytes(downloads.index)), label: 'used' },
        ]}
      />
      {songIds.length > 0 ? (
        <Meter fraction={held / songIds.length} label="Songs downloaded" />
      ) : null}

      {working ? (
        <View style={styles.progress}>
          <Text style={styles.progressText} numberOfLines={1}>
            {downloads.paused ? 'Paused' : 'Downloading'}
            {activeSong ? ` — ${activeSong.title}` : ''} · {downloads.queue.length} left
          </Text>
          <Meter
            fraction={downloads.totalBytes > 0 ? downloads.bytesWritten / downloads.totalBytes : 0}
          />
        </View>
      ) : null}

      {downloads.error ? <Notice tone="error">{downloads.error}</Notice> : null}
      {stale.length > 0 ? (
        <Text style={partStyles.hint}>
          {stale.length} downloaded {stale.length === 1 ? 'file has' : 'files have'} changed on the
          server since.
        </Text>
      ) : null}

      <ButtonRow>
        {working ? (
          <>
            <Button
              label={downloads.paused ? 'Resume' : 'Pause'}
              onPress={() => (downloads.paused ? queue.resume() : queue.pause())}
            />
            <Button
              label="Stop downloading"
              icon={<X size={15} color={theme.colors.textPrimary} />}
              onPress={() => queue.cancelAll()}
            />
          </>
        ) : (
          <Button
            label={
              missingBytes === 0
                ? 'Everything is downloaded'
                : `${held === 0 ? 'Download everything' : 'Download what’s missing'} (${formatBytes(missingBytes)})`
            }
            icon={
              <CloudDownload
                size={15}
                color={missingBytes === 0 ? theme.colors.textMuted : theme.colors.onAccent}
              />
            }
            variant="primary"
            disabled={missingBytes === 0}
            onPress={() => requestDownload(missingIds)}
          />
        )}
        {stale.length > 0 ? (
          <Button
            label="Remove out-of-date files"
            busy={busy}
            onPress={() => {
              setBusy(true)
              void queue.remove(stale).finally(() => setBusy(false))
            }}
          />
        ) : null}
        {held > 0 ? (
          <Button
            label="Remove all downloads"
            icon={<Trash size={15} color={theme.colors.danger} />}
            variant="danger"
            onPress={() => onConfirm('remove-downloads')}
          />
        ) : null}
      </ButtonRow>
    </Panel>
  )
}

// -------------------------------------------------------------- importing

function ImportingPanel({
  settings,
  set,
  onTop,
}: {
  settings: Settings
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  onTop: (top: number) => void
}): ReactNode {
  return (
    <Panel title="Importing" hint="shared across your devices" onTop={onTop}>
      <Row
        label="Downloads at once"
        hint="More is rarely faster and makes YouTube throttle. Two is a good default."
      >
        <Select<number>
          value={settings.importConcurrency}
          onChange={value => set('importConcurrency', value)}
          options={[1, 2, 3, 4].map(value => ({ value, label: String(value) }))}
          label="Downloads at once"
        />
      </Row>
      <Row
        label="Watch the library folder"
        hint="Rescan the moment a file is added, removed or renamed — drag something into the folder in Finder and it shows up here. No timer needed."
        last
      >
        <Toggle
          value={settings.watchLibrary}
          onChange={value => set('watchLibrary', value)}
          label="Watch the library folder"
        />
      </Row>
    </Panel>
  )
}

// ---------------------------------------------------------------- library

function LibraryPanel({
  libraryPath,
  onTop,
  onConfirm,
}: {
  libraryPath: string | undefined
  onTop: (top: number) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const library = useLibrary()
  const scan = useScanLibrary()
  const analysis = useAnalysisStatus(true)
  const startAnalysis = useStartAnalysis()
  const songs = library.data?.songs ?? []
  const analysed = songs.filter(song => song.features !== null).length
  const missing = songs.filter(song => song.missing).length
  const running = analysis.data?.running === true

  return (
    <Panel title="Library" hint={`${songs.length} songs`} onTop={onTop}>
      {libraryPath !== undefined ? (
        <Lead>
          Your music lives at <Text style={partStyles.code}>{libraryPath}</Text>. It is just a
          folder of files — copy it anywhere and you have a complete backup.
        </Lead>
      ) : null}
      <Row label="Rescan the folder" hint={scanHint(scan.data)}>
        <Button
          label={scan.isPending ? 'Scanning…' : 'Rescan'}
          icon={<Refresh size={15} color={theme.colors.textPrimary} />}
          disabled={scan.isPending}
          onPress={() => scan.mutate()}
        />
      </Row>
      <Row
        label="Audio analysis"
        hint={`Works out each song’s tempo, key, energy and loudness from the file itself, on your server. It powers smart-playlist rules, “similar songs” and auto-mix. ${analysed} of ${songs.length} songs analysed.`}
      >
        <Button
          label={running ? 'Analysing…' : 'Analyse new songs'}
          icon={<Sparkles size={15} color={theme.colors.textPrimary} />}
          disabled={running || startAnalysis.isPending}
          onPress={() => startAnalysis.mutate(false)}
        />
        {analysed > 0 && !running ? (
          <Button
            label="Redo all"
            icon={<Refresh size={15} color={theme.colors.textPrimary} />}
            onPress={() => onConfirm('redo-analysis')}
          />
        ) : null}
      </Row>
      {running ? (
        <View style={styles.progress} accessibilityLiveRegion="polite">
          <Text style={styles.progressText}>
            Analysing{analysis.data?.current ? ` — ${analysis.data.current.title}` : '…'}
            {analysis.data && analysis.data.pending > 0 ? ` · ${analysis.data.pending} to go` : ''}
          </Text>
        </View>
      ) : null}
      <CoverArtRow songs={songs} last={missing === 0} />
      {missing > 0 ? (
        <View>
          <Notice tone="warn">
            {missing} {missing === 1 ? 'song is' : 'songs are'} in your library but the{' '}
            {missing === 1 ? 'file is' : 'files are'} gone. Their tags and play counts are kept in
            case the files come back.
          </Notice>
          <ButtonRow>
            <Button
              label="Forget missing songs"
              icon={<Trash size={15} color={theme.colors.danger} />}
              variant="danger"
              onPress={() => onConfirm('forget-missing')}
            />
          </ButtonRow>
        </View>
      ) : null}
    </Panel>
  )
}

/**
 * "Find missing cover art": the web's `FixCoversPanel`. The pass runs on the
 * Mac; this starts, stops and watches it, so leaving Settings interrupts
 * nothing. Covers land one at a time, so the library is refetched as they do.
 */
function CoverArtRow({ songs, last }: { songs: readonly Song[]; last: boolean }): ReactNode {
  const { theme } = useUnistyles()
  const client = useQueryClient()
  const { data: status } = useFixCoversStatus()
  const fixCovers = useFixCovers()
  const missingArt = missingArtCount(songs)
  const running = status?.status === 'running'
  const result = status ? coverResult(status) : null

  const found = status?.found ?? 0
  const state = status?.status
  useEffect(() => {
    if (found > 0 || state === 'done' || state === 'cancelled') {
      void client.invalidateQueries({ queryKey: queryKeys.library })
    }
  }, [client, found, state])

  return (
    <>
      <Row
        label="Cover art"
        hint={coverArtHint(missingArt)}
        last={last && !running && result === null}
      >
        {running ? (
          <Button
            label="Stop looking"
            icon={<X size={15} color={theme.colors.textPrimary} />}
            disabled={fixCovers.isPending}
            onPress={() => fixCovers.mutate('cancel')}
          />
        ) : (
          <Button
            label="Find missing art"
            icon={<Sparkles size={15} color={theme.colors.textPrimary} />}
            disabled={fixCovers.isPending || missingArt === 0}
            onPress={() => fixCovers.mutate('start')}
          />
        )}
      </Row>
      {status && running ? (
        <View style={styles.progress} accessibilityLiveRegion="polite">
          <Text style={styles.progressText}>{coverProgress(status)}</Text>
        </View>
      ) : null}
      {result ? <Notice tone="good">{result}</Notice> : null}
    </>
  )
}

// ------------------------------------------------------------- connection

function ConnectionPanel({
  onTop,
  onConfirm,
}: {
  onTop: (top: number) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const { connection, fromCloud } = useConnection()
  const library = useLibrary()
  return (
    <Panel title="Connection" hint="on this device" onTop={onTop}>
      {fromCloud ? (
        <Row label="Signed in" hint="With Google — the library is the bucket’s.">
          <Button
            label="Sign out"
            variant="danger"
            onPress={() => onConfirm('sign-out')}
            testID="cloud-sign-out"
          />
        </Row>
      ) : (
        <>
          <Row label="Address">
            <Text style={styles.valueText} numberOfLines={1}>
              {connection?.baseUrl ?? 'Not set'}
            </Text>
          </Row>
          <Row label="Token">
            <Text style={styles.valueText}>
              {connection?.token ? 'Saved in the keychain' : 'None'}
            </Text>
          </Row>
        </>
      )}
      <Row label="Library" last>
        <Text style={styles.valueText}>
          {library.isError
            ? library.data
              ? `Unreachable — showing the cached copy, ${library.data.songs.length} songs`
              : 'Unreachable, and nothing is cached yet'
            : library.data
              ? `${library.data.songs.length} songs · version ${library.data.version}`
              : 'Loading…'}
        </Text>
      </Row>
      <ButtonRow>
        <Button
          label="Refresh"
          icon={<Refresh size={15} color={theme.colors.textPrimary} />}
          onPress={() => void library.refetch()}
        />
      </ButtonRow>
      {canConnectByAddress ? <ServerSwitch /> : null}
    </Panel>
  )
}

/**
 * Connecting the installed app to a server by address, and going back.
 *
 * Only where a port says this device can: the desktop app, which may be sitting
 * beside the server or running on it. A phone and a browser tab never see this.
 *
 * **Switching answerers clears what has been downloaded**, and says so first. A
 * song's integer id belongs to whichever side answered — `docs/SYNC.md`,
 * "Identity" — so an index kept across a switch would offer the other side's
 * songs under this side's numbers, and play the wrong music. The permanent fix
 * is a `uid` shared across both, which is written up under "Later" in
 * docs/DESKTOP.md; until then the honest thing is to start again.
 */
function ServerSwitch(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { connect, fromCloud } = useConnection()
  const { removeAll } = useDownloads()

  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'to-server' | 'to-cloud' | null>(null)

  /** Tested before it is offered, so the confirmation is not about a typo. */
  const test = (): void => {
    const baseUrl = normaliseBaseUrl(address)
    if (!baseUrl) {
      setError('That does not look like an address. Try mac-mini.tail1234.ts.net')
      return
    }
    setBusy(true)
    setError(null)
    void (async () => {
      const candidate = { baseUrl, token: token.trim().length > 0 ? token.trim() : null }
      try {
        // `/api/health` answers without a token, so a wrong address and a wrong
        // token are two different messages rather than one red box.
        await apiFor(candidate).health()
        if (candidate.token) await apiFor(candidate).settings()
        setConfirming('to-server')
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          setError('The server is there, but it rejected that token.')
        } else if (caught instanceof ApiError && caught.isOffline) {
          setError('Could not reach the server. Is Tailscale connected and the server running?')
        } else {
          setError(caught instanceof Error ? caught.message : 'Could not connect')
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const switchToServer = (): void => {
    const baseUrl = normaliseBaseUrl(address)
    if (!baseUrl) return
    void (async () => {
      await removeAll()
      await connect({ baseUrl, token: token.trim().length > 0 ? token.trim() : null })
      setOpen(false)
      router.replace('/')
    })()
  }

  const switchToCloud = (): void => {
    void (async () => {
      await removeAll()
      router.replace('/sign-in')
    })()
  }

  return (
    <>
      {fromCloud ? (
        open ? (
          <>
            <Lead>
              The address of the computer running the server. On the machine itself,
              localhost:4600.
            </Lead>
            <TextInput
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              placeholder="mac-mini.tail1234.ts.net"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              testID="server-address"
            />
            <TextInput
              style={styles.input}
              value={token}
              onChangeText={setToken}
              placeholder="Token — leave empty for none"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              testID="server-token"
            />
            {error ? <Notice tone="error">{error}</Notice> : null}
            <ButtonRow>
              <Button label="Connect" variant="primary" busy={busy} onPress={test} />
              <Button label="Cancel" onPress={() => setOpen(false)} />
            </ButtonRow>
          </>
        ) : (
          <ButtonRow>
            <Button
              label="Connect to a server"
              onPress={() => setOpen(true)}
              testID="connect-to-server"
            />
          </ButtonRow>
        )
      ) : (
        <ButtonRow>
          <Button
            label="Use the cloud instead"
            onPress={() => setConfirming('to-cloud')}
            testID="use-the-cloud"
          />
        </ButtonRow>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming === 'to-cloud'
            ? 'Use the cloud library instead of this server?'
            : 'Use this server instead of the cloud library?'
        }
        body="Everything downloaded to this computer is removed first. A song’s number belongs to whichever side answered, so downloads cannot be carried across — they would play the wrong songs."
        confirmLabel={confirming === 'to-cloud' ? 'Switch to the cloud' : 'Switch to this server'}
        danger
        onConfirm={() => {
          const what = confirming
          setConfirming(null)
          if (what === 'to-cloud') switchToCloud()
          else switchToServer()
        }}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}

// ---------------------------------------------------------------- devices

function DevicesPanel({ onTop }: { onTop: (top: number) => void }): ReactNode {
  const { theme } = useUnistyles()
  const { deviceId, name, rename, devices, connected } = useDeviceContext()
  const client = useQueryClient()
  const [draft, setDraft] = useState<{ text: string; from: string } | null>(null)
  const [showOlder, setShowOlder] = useState(false)
  const shown = draft && draft.from === name ? draft.text : name
  // Offline devices that share a name folded into one row, this device and
  // what was seen in the last day first, the rest behind a button.
  const view = useMemo(() => deviceListView(devices, deviceId), [devices, deviceId])
  const rows = showOlder ? [...view.recent, ...view.older] : view.recent

  const forget = (ids: readonly string[]): void => {
    void Promise.all(
      ids.map(id =>
        clientApi()
          .forgetDevice(id)
          .catch(() => undefined),
      ),
    ).then(() => client.invalidateQueries({ queryKey: queryKeys.devices }))
  }

  return (
    <Panel title="Devices" hint={connected ? 'live updates' : 'polling'} onTop={onTop}>
      <Lead>
        Every device you open self.mp3 on shows up here and can hand playback to any of the others.
        Nothing is stored beyond a name and what was last playing.
      </Lead>
      <Row label="This device’s name" hint="Shown on your other devices when handing off.">
        <TextInput
          style={partStyles.input}
          value={shown}
          maxLength={60}
          accessibilityLabel="This device’s name"
          onChangeText={text => setDraft({ text, from: name })}
          onEndEditing={() => {
            if (draft && draft.text.trim() && draft.text !== name) rename(draft.text.trim())
            setDraft(null)
          }}
        />
      </Row>
      <View style={styles.devices}>
        {rows.map(({ device, ids }, position) => (
          <View
            key={device.id}
            style={[styles.device, position === rows.length - 1 && styles.deviceLast]}
          >
            <View style={[styles.dot, device.online && { backgroundColor: theme.colors.good }]} />
            <View style={styles.deviceName}>
              <Text style={styles.deviceText} numberOfLines={1}>
                {device.name}
              </Text>
              {device.id === deviceId ? <Text style={styles.deviceTag}>this device</Text> : null}
              {ids.length > 1 ? <Text style={styles.deviceTag}>{`×${ids.length}`}</Text> : null}
            </View>
            <Text style={styles.deviceWhen}>
              {device.online ? 'online' : `last seen ${relativeTime(device.lastSeenAt)}`}
            </Text>
            <IconButton
              onPress={() => forget(ids)}
              label={
                ids.length > 1 ? `Forget ${device.name} (${ids.length})` : `Forget ${device.name}`
              }
              size={28}
            >
              <Trash size={14} color={theme.colors.textMuted} />
            </IconButton>
          </View>
        ))}
        {devices.length === 0 ? (
          <Text style={partStyles.hint}>No devices registered yet.</Text>
        ) : null}
        {view.older.length > 0 ? (
          <View style={styles.devicesMore}>
            <Button
              label={
                showOlder
                  ? 'Show fewer devices'
                  : `Show ${view.older.length} older ${view.older.length === 1 ? 'device' : 'devices'}`
              }
              onPress={() => setShowOlder(open => !open)}
            />
          </View>
        ) : null}
      </View>
    </Panel>
  )
}

// ------------------------------------------------------------- appearance

function AppearancePanel({ onTop }: { onTop: (top: number) => void }): ReactNode {
  const { theme: ui } = useUnistyles()
  const accent = useAccent()
  const chooseTheme = (choice: ThemeChoice): void => {
    accent.setTheme(choice)
  }
  return (
    <Panel title="Appearance" hint="on this device" onTop={onTop}>
      <Row
        label="Theme"
        hint={`“System” follows this device’s own light and dark setting, and changes with it. Your accent colour holds either way.`}
      >
        <Select<ThemeChoice>
          value={accent.theme}
          onChange={chooseTheme}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
          label="Theme"
        />
      </Row>
      <Row
        label="Accent colour"
        hint={`Drives every colour in the app — the surfaces are tinted from it too, so a change is felt rather than spotted. ${accentName(accent.hue, ACCENT_PRESETS)}.`}
        last
      >
        <View style={styles.swatches}>
          {ACCENT_PRESETS.map(preset => (
            <Pressable
              key={preset.hue}
              onPress={() => accent.setHue(preset.hue)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={preset.name}
              accessibilityState={{ selected: accent.hue === preset.hue }}
              style={[
                styles.swatch,
                { backgroundColor: buildAccent(preset.hue).accent },
                accent.hue === preset.hue && { borderColor: ui.colors.textPrimary },
              ]}
            />
          ))}
        </View>
        <Slider
          value={accent.hue}
          min={0}
          max={359}
          step={1}
          label="Accent hue"
          hue
          width={156}
          onChange={accent.setHue}
        />
      </Row>
    </Panel>
  )
}

// ---------------------------------------------------------- confirmations

function Confirmations({
  confirming,
  onDone,
}: {
  confirming: Confirming
  onDone: () => void
}): ReactNode {
  const router = useRouter()
  const client = useQueryClient()
  const { signedOutOfCloud } = useConnection()
  const { removeAll, queue: downloadQueue } = useDownloads()
  const startAnalysis = useStartAnalysis()

  const dialogs: Record<
    Exclude<Confirming, null>,
    { title: string; body: string; label: string; run: () => void }
  > = {
    'remove-downloads': {
      title: 'Remove all downloaded songs from this device?',
      body: 'The library itself is not touched. Downloading automatically is turned off too, or they would just come back.',
      label: 'Remove all downloads',
      run: () => void removeAll(),
    },
    'redo-analysis': {
      title: 'Throw away existing analysis and redo every song?',
      body: 'Tempo, key, energy and loudness are worked out again from each file.',
      label: 'Redo all',
      run: () => startAnalysis.mutate(true),
    },
    'sign-out': {
      title: 'Sign out?',
      body: signOutWarning(cloudLibrary.pendingCloudChanges()),
      label: 'Sign out',
      run: () =>
        void signOutOfCloud({
          sendPendingChanges: () => cloudLibrary.flushCloudChanges(),
          endSession: async () => {
            const session = await cloudSession.loadSession()
            if (session) await cloudSession.signOut(session)
          },
          forgetLibrary: () => cloudLibrary.forgetCloudLibrary(),
          removeDownloads: () => {
            // The copies kept for having been played go with the downloads.
            clearRecent()
            return downloadQueue.removeAll()
          },
          forgetSavedLibrary: async () => {
            await clearCachedLibrary()
            clearCachedPlaylists()
            clearCachedLyrics()
          },
          done: () => {
            signedOutOfCloud()
            router.replace('/sign-in')
          },
        }),
    },
    'forget-missing': {
      title: 'Permanently forget missing songs?',
      body: 'Their tags and play history go with them.',
      label: 'Forget missing songs',
      run: () =>
        void clientApi()
          .purgeMissing()
          .then(() => client.invalidateQueries({ queryKey: queryKeys.library })),
    },
  }
  const dialog = confirming === null ? null : dialogs[confirming]

  return (
    <ConfirmDialog
      open={dialog !== null}
      title={dialog?.title ?? ''}
      body={dialog?.body ?? ''}
      confirmLabel={dialog?.label ?? ''}
      danger
      onConfirm={() => {
        dialog?.run()
        onDone()
      }}
      onCancel={onDone}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentColumn: { paddingTop: 28, paddingLeft: 32 + 172 + 32, paddingRight: 32 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  head: { marginBottom: 20 },
  title: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700', letterSpacing: -0.4 },
  titleNarrow: { fontSize: 22 },
  sub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4 },
  panels: { gap: 14, maxWidth: 780 },
  indexColumn: { position: 'absolute', top: 28, left: 32, width: 172, gap: 1 },
  indexTitle: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    paddingTop: 4,
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  indexItem: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.sm,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
  },
  indexItemOn: { backgroundColor: theme.colors.surface1 },
  indexPressed: { backgroundColor: theme.colors.surface1 },
  indexText: { color: theme.colors.textMuted, fontSize: 13 },
  indexTextOn: { color: theme.colors.textPrimary, fontWeight: '600' },
  chipBar: {
    marginHorizontal: -16,
    paddingVertical: 10,
    marginBottom: 14,
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  chips: { gap: 6, paddingHorizontal: 16 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  valueText: { color: theme.colors.textPrimary, fontSize: 13 },
  /** The server address and token fields, the onboarding screen's own. */
  input: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
    color: theme.colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  progress: { marginVertical: 14, gap: 8 },
  progressText: { color: theme.colors.textSecondary, fontSize: 13 },
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 5 },
  keys: { flexDirection: 'row', gap: 3, minWidth: 92 },
  devices: { marginTop: 6 },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  deviceLast: { borderBottomWidth: 0 },
  devicesMore: { paddingTop: 10, alignItems: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: theme.colors.borderStrong },
  deviceName: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 7 },
  deviceText: { color: theme.colors.textPrimary, fontSize: 13, flexShrink: 1 },
  deviceTag: {
    color: theme.colors.textMuted,
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    backgroundColor: theme.colors.surface3,
    overflow: 'hidden',
  },
  deviceWhen: { color: theme.colors.textMuted, fontSize: 12 },
  swatches: { flexDirection: 'row', gap: 6 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
}))
