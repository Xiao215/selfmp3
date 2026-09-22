import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { plural, formatBytes } from '@selfmp3/shared'
import {
  downloadTally,
  LARGE_SYNC_BYTES,
  staleDownloads,
  useLibrary,
  useManifest,
  type StaleDownloads,
} from '@selfmp3/client'
import { useDownloadProgress, useDownloads } from '../../offline/DownloadsProvider'
import { downloadsFolder } from '../../ports/downloadsFolder'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'
import { CloudDownload, Trash, X } from '../../ui/components/Icons'
import { Toggle } from '../../ui/components/Toggle'
import { ButtonRow, Lead, Meter, Notice, Panel, partStyles, Row, Stats } from './SettingsParts'
import { type Confirming } from './settings.model'

/**
 * What this device keeps: whether songs download by themselves, whether one
 * not here may stream, and the storage they take. Its title names the device
 * ("On this phone", "On this computer"), so it needs no "on this device" beside it.
 */
export function OfflinePanel({
  title,
  anchor,
  onConfirm,
}: {
  title: string
  anchor: (node: View | null) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
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
    removeFiles,
    removing,
  } = useDownloads()

  const songIds = useMemo(
    () => (library.data?.songs ?? []).filter(song => !song.missing).map(song => song.id),
    [library.data],
  )
  /*
   * Counted against the library in front of you, not against the index. A song
   * removed anywhere — here, or on another device an hour ago — is out of
   * `songIds` as soon as the library says so, and out of these numbers with
   * it; the entry it may have left behind is `tally.kept`'s business and the
   * leftovers line's, below.
   */
  const tally = downloadTally(downloads.index, songIds)
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
  const stale = manifest.data ? staleDownloads(downloads.index, manifest.data) : null
  const activeSong =
    downloads.activeSongId === null
      ? null
      : library.data?.songs.find(song => song.id === downloads.activeSongId)
  const working = downloads.queue.length > 0

  return (
    <Panel title={title} anchor={anchor}>
      <Lead>
        {fromCloud
          ? 'A library in the cloud plays from this device, so its songs are downloaded here first. Plays you make offline are kept and sent when you are back online.'
          : 'Downloaded songs play with no connection at all — which is the point, since your server won’t always be reachable. Plays you make offline are kept here and sent to your server when it’s back.'}
      </Lead>

      <Row
        label="Download automatically on Wi-Fi"
        hint={`Keeps this device in step with your library on Wi-Fi. On mobile data it asks first, anything over ${formatBytes(LARGE_SYNC_BYTES)} waits for you, and a song you remove by hand stays removed.`}
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
          { value: String(tally.here), label: `of ${tally.songs} songs downloaded` },
          // The disk, where there is one to ask. The index and the folder can
          // disagree — a `.part` left by an interrupted download, a cover kept
          // beside a song — and the folder is the one that is true.
          {
            value: formatBytes(onDisk === null ? tally.keptBytes : onDisk.songs + onDisk.covers),
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
      {tally.songs > 0 ? (
        <Meter fraction={tally.here / tally.songs} label="Songs downloaded" />
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
      {stale !== null && stale.all.length > 0 ? (
        <Text style={partStyles.hint}>{staleHint(stale)}</Text>
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
              icon={<X size={15} tone="textPrimary" />}
              onPress={() => queue.cancelAll()}
            />
          </>
        ) : (
          <Button
            label={
              missingBytes === 0
                ? 'Everything is downloaded'
                : `${tally.here === 0 ? 'Download everything' : 'Download what’s missing'} (${formatBytes(missingBytes)})`
            }
            icon={<CloudDownload size={15} tone={missingBytes === 0 ? 'textMuted' : 'onAccent'} />}
            variant="primary"
            disabled={missingBytes === 0}
            onPress={() => requestDownload(absentIds)}
          />
        )}
        {/*
         * Deleting files takes as long as it takes, and the two buttons that
         * do it act on overlapping sets. While either is running both say so
         * and neither fires: pressing "Remove all downloads" a second time
         * used to start a second pass over an index the first was still
         * rewriting. `removing` is the provider's, so the state survives this
         * panel and covers the removal the confirmation dialog starts.
         */}
        {stale !== null && stale.all.length > 0 ? (
          <Button
            label={
              removing
                ? 'Removing…'
                : stale.changed.length === 0
                  ? 'Remove leftover files'
                  : 'Remove out-of-date files'
            }
            busy={removing}
            onPress={() => void removeFiles([...stale.all])}
          />
        ) : null}
        {tally.kept > 0 ? (
          <Button
            label={removing ? 'Removing…' : 'Remove all downloads'}
            icon={<Trash size={15} tone="danger" />}
            variant="danger"
            busy={removing}
            onPress={() => onConfirm('remove-downloads')}
          />
        ) : null}
      </ButtonRow>
    </Panel>
  )
}

/**
 * The line above "Remove…", which has to name the right reason.
 *
 * A song that left the library and a song whose audio was replaced both leave
 * a file worth deleting, but only the second changed. Saying "changed on the
 * server" about a library that was replaced described a thing that never
 * happened, in numbers large enough to be alarming.
 */
function staleHint(stale: StaleDownloads): string {
  const files = (count: number): string => `${plural(count, 'file', 'files')}`
  const gone = stale.gone.length
  const changed = stale.changed.length
  const room = `, using ${formatBytes(stale.bytes)}`
  const forGone = `${files(gone)} here ${
    gone === 1 ? 'is for a song' : 'are for songs'
  } this library no longer has`
  const replaced = `${changed === 1 ? 'has' : 'have'} been replaced since ${
    changed === 1 ? 'it was' : 'they were'
  } downloaded`
  if (changed === 0) return `${forGone}${room}.`
  if (gone === 0) return `${files(changed)} here ${replaced}${room}.`
  return `${forGone}, and ${changed === 1 ? 'one more' : `${changed} more`} ${replaced}${room}.`
}

/** The running download's bar, on its own so the bytes redraw it and not the whole panel. */
function DownloadMeter(): ReactNode {
  const progress = useDownloadProgress()
  return (
    <Meter fraction={progress.totalBytes > 0 ? progress.bytesWritten / progress.totalBytes : 0} />
  )
}
