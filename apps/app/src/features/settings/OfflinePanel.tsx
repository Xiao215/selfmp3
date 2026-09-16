import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
import { formatBytes } from '@selfmp3/shared'
import { downloadedCount, staleIds, totalBytes, useLibrary, useManifest } from '@selfmp3/client'
import { useDownloadProgress, useDownloads } from '../../offline/DownloadsProvider'
import { downloadsFolder } from '../../ports/downloadsFolder'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'
import { CloudDownload, Trash, X } from '../../ui/components/Icons'
import { Toggle } from '../../ui/components/Toggle'
import { ButtonRow, Lead, Meter, Notice, Panel, partStyles, Row, Stats } from './SettingsParts'
import { type Confirming } from './settings.model'
import {} from '../metadata/metadata.model'

export function OfflinePanel({
  anchor,
  onConfirm,
}: {
  anchor: (node: View | null) => void
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
    absentIds,
    absentBytes,
    requestDownload,
  } = useDownloads()
  const [busy, setBusy] = useState(false)

  const songIds = useMemo(
    () => (library.data?.songs ?? []).filter(song => !song.missing).map(song => song.id),
    [library.data],
  )
  const held = downloadedCount(downloads.index)
  /*
   * What the disk says, on a device that has one to ask. Read once when the
   * panel appears and again whenever the queue settles, which is when the
   * numbers would otherwise be stale.
   */
  const [onDisk, setOnDisk] = useState<{ songs: number; covers: number; free: number } | null>(null)
  const settled = downloads.queue.length === 0
  useEffect(() => {
    let cancelled = false
    void downloadsFolder.usage().then(next => {
      if (!cancelled) setOnDisk(next)
    })
    return () => {
      cancelled = true
    }
  }, [settled])
  // Every song not here, including ones removed by hand: this button is pressed on purpose.
  const missingBytes = absentBytes
  const stale = manifest.data ? staleIds(downloads.index, manifest.data) : []
  const activeSong =
    downloads.activeSongId === null
      ? null
      : library.data?.songs.find(song => song.id === downloads.activeSongId)
  const working = downloads.queue.length > 0

  return (
    <Panel title="Offline music" hint="on this device" anchor={anchor}>
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
          // The disk, where there is one to ask. The index and the folder can
          // disagree — a `.part` left by an interrupted download, a cover kept
          // beside a song — and the folder is the one that is true.
          {
            value: formatBytes(
              onDisk === null ? totalBytes(downloads.index) : onDisk.songs + onDisk.covers,
            ),
            label: 'used',
          },
          ...(onDisk ? [{ value: formatBytes(onDisk.free), label: 'free on this disk' }] : []),
        ]}
      />
      {downloadsFolder.path ? (
        <Row label="Folder" hint={downloadsFolder.path}>
          <Button
            label="Reveal in Finder"
            onPress={() => void downloadsFolder.reveal()}
            testID="reveal-downloads"
          />
        </Row>
      ) : null}
      {songIds.length > 0 ? (
        <Meter fraction={held / songIds.length} label="Songs downloaded" />
      ) : null}

      {working ? (
        <View style={partStyles.progress}>
          <Text style={partStyles.progressText} numberOfLines={1}>
            {downloads.paused ? 'Paused' : 'Downloading'}
            {activeSong ? ` — ${activeSong.title}` : ''} · {downloads.queue.length} left
          </Text>
          <DownloadMeter />
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
            onPress={() => requestDownload(absentIds)}
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

/** The running download's bar, on its own so the bytes redraw it and not the whole panel. */
function DownloadMeter(): ReactNode {
  const progress = useDownloadProgress()
  return (
    <Meter fraction={progress.totalBytes > 0 ? progress.bytesWritten / progress.totalBytes : 0} />
  )
}

// -------------------------------------------------------------- importing
