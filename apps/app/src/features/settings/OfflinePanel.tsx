import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { plural, formatBytes } from '@selfmp3/shared'
import {
  downloadTally,
  space,
  staleDownloads,
  type,
  useLibrary,
  useManifest,
  type StaleDownloads,
} from '@selfmp3/client'
import { StyleSheet } from 'react-native-unistyles'
import { useDownloadProgress, useDownloads } from '../../offline/DownloadsProvider'
import { downloadsFolder } from '../../ports/downloadsFolder'
import { Button } from '../../ui/components/Button'
import { Cloud, CloudDownload, Wifi } from '../../ui/components/Icons'
import { Card, DangerButton, partStyles, Ring, Row, Tile } from './SettingsParts'
import { ProgressBar } from '../../ui/components/ProgressBar'
import { NoticeCard } from '../../ui/components/NoticeCard'
import type { Confirming } from './settings.model'
import { thisPlace } from '../../ports/place'

/**
 * What this device keeps (B, 2026-10-26): how much of the library is here, as
 * a ring and two numbers, and the one thing to do about the rest — a single
 * full-width button. Whether songs download by themselves and whether one not
 * here may stream are quick tiles at the top of the page (`DownloadTiles`);
 * removing everything is at the foot of the page with the other things that
 * cannot be undone (`RemoveAllFromDevice`). Its title names the device ("On
 * this phone", "On this computer"), so it needs no "on this device" beside it.
 */
export function OfflinePanel({ title }: { title: string }): ReactNode {
  const library = useLibrary()
  const manifest = useManifest()
  const place = thisPlace()
  const {
    state: downloads,
    queue,
    absentIds,
    absentBytes,
    requestDownload,
    removeFiles,
    removing,
  } = useDownloads()

  const tally = useTally()
  /*
   * What the disk says, on a device that has one to ask. Read once when the
   * panel appears and again whenever the queue settles or a removal ends,
   * which is when the numbers would otherwise be stale: "Remove all" never
   * touches the queue, and left "159.2 MB used" beside 0 songs.
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
  }, [settled, removing])
  // Every song not here, including ones removed by hand: this button is pressed on purpose.
  const missingBytes = absentBytes
  const stale = manifest.data ? staleDownloads(downloads.index, manifest.data) : null
  const activeSong =
    downloads.activeSongId === null
      ? null
      : library.data?.songs.find(song => song.id === downloads.activeSongId)
  const working = downloads.queue.length > 0
  // The disk, where there is one to ask. The index and the folder can disagree
  // — a `.part` left by an interrupted download, a cover kept beside a song —
  // and the folder is the one that is true.
  const used = onDisk === null ? tally.keptBytes : onDisk.songs + onDisk.covers
  const sizes = [
    `${formatBytes(used)} here`,
    missingBytes > 0 ? `${formatBytes(missingBytes)} to go` : null,
    onDisk ? `${formatBytes(onDisk.free)} free` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Card title={title}>
      <View style={styles.head}>
        <Ring
          fraction={tally.songs > 0 ? tally.here / tally.songs : 0}
          label={`Songs on this ${place}`}
        />
        <View style={styles.counts}>
          <Text style={styles.count}>
            {`${tally.here} of ${plural(tally.songs, 'song', 'songs')}`}
          </Text>
          <Text style={partStyles.hint}>{sizes}</Text>
        </View>
      </View>

      {working ? (
        <View style={partStyles.progress}>
          <Text style={partStyles.progressText} numberOfLines={1}>
            {downloads.paused ? 'Paused' : 'Downloading'}
            {activeSong ? ` — ${activeSong.title}` : ''} · {downloads.queue.length} left
          </Text>
          <DownloadMeter />
          <View style={styles.actions}>
            <Button
              label={downloads.paused ? 'Resume' : 'Pause'}
              grow
              onPress={() => (downloads.paused ? queue.resume() : queue.pause())}
            />
            <Button label="Stop" variant="text" onPress={() => queue.cancelAll()} />
          </View>
        </View>
      ) : (
        <View style={styles.actions}>
          <Button
            label={
              missingBytes === 0
                ? `Everything is on this ${place}`
                : tally.here === 0
                  ? 'Download everything'
                  : 'Download the rest'
            }
            icon={<CloudDownload tone={missingBytes === 0 ? 'textMuted' : 'onAccent'} />}
            variant="primary"
            grow
            disabled={missingBytes === 0}
            onPress={() => requestDownload(absentIds)}
          />
        </View>
      )}

      {downloads.error ? (
        <NoticeCard wash style={partStyles.notice} tone="error">
          {downloads.error}
        </NoticeCard>
      ) : null}
      {/*
       * Deleting files takes as long as it takes, and this and "Remove all"
       * act on overlapping sets. While either is running both say so and
       * neither fires: pressing "Remove all" a second time would start a
       * second pass over an index the first is still rewriting. `removing` is
       * the provider's, so the state survives this card and covers the
       * removal the confirmation dialog starts.
       */}
      {stale !== null && stale.all.length > 0 ? (
        <Row label="Leftover files" hint={staleHint(stale)} last={!downloadsFolder.path}>
          <Button
            label={
              removing
                ? 'Removing…'
                : stale.changed.length === 0
                  ? 'Remove leftover files'
                  : 'Remove out-of-date files'
            }
            variant="text"
            busy={removing}
            onPress={() => void removeFiles([...stale.all])}
          />
        </Row>
      ) : null}
      {downloadsFolder.path ? (
        <Row label="Folder" last>
          <Text style={styles.path} numberOfLines={1} ellipsizeMode="middle">
            {downloadsFolder.path}
          </Text>
          <Button
            label="Show"
            variant="text"
            onPress={() => void downloadsFolder.reveal()}
            testID="reveal-downloads"
          />
        </Row>
      ) : null}
    </Card>
  )
}

/**
 * The page's two quick tiles for what this device keeps: songs downloading by
 * themselves on Wi-Fi, and playing one that is not here by streaming it.
 */
export function DownloadTiles(): ReactNode {
  const { prefs, setPrefs } = useDownloads()
  return (
    <>
      <Tile
        icon={<Wifi tone={prefs.autoOnWifi ? 'accent' : 'textMuted'} />}
        label="Wi-Fi downloads"
        state={prefs.autoOnWifi ? 'New songs, by themselves' : 'Off'}
        on={prefs.autoOnWifi}
        onPress={() => setPrefs({ autoOnWifi: !prefs.autoOnWifi })}
        testID="setting-auto-download"
      />
      <Tile
        icon={<Cloud tone={prefs.streamUndownloaded ? 'accent' : 'textMuted'} />}
        label="Stream the rest"
        state={prefs.streamUndownloaded ? 'Plays what isn’t here' : 'Only what’s here'}
        on={prefs.streamUndownloaded}
        onPress={() => setPrefs({ streamUndownloaded: !prefs.streamUndownloaded })}
        testID="setting-stream"
      />
    </>
  )
}

/**
 * "Remove all from this phone", at the foot of the page: in red, asked about
 * first, and there only while this device keeps anything at all.
 */
export function RemoveAllFromDevice({
  onConfirm,
}: {
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const { removing } = useDownloads()
  const tally = useTally()
  const place = thisPlace()
  if (tally.kept === 0) return null
  return (
    <DangerButton
      label={removing ? 'Removing…' : `Remove all from this ${place}`}
      disabled={removing}
      onPress={() => onConfirm('remove-downloads')}
    />
  )
}

/**
 * The library's songs against what this device holds.
 *
 * Counted against the library in front of you, not against the index. A song
 * removed anywhere — here, or on another device an hour ago — is out of
 * `songIds` as soon as the library says so, and out of these numbers with it;
 * the entry it may have left behind is `kept`'s business and the leftovers
 * row's.
 */
function useTally() {
  const library = useLibrary()
  const { state } = useDownloads()
  const songIds = useMemo(() => (library.data?.songs ?? []).map(song => song.id), [library.data])
  return downloadTally(state.index, songIds)
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
    <ProgressBar
      fraction={progress.totalBytes > 0 ? progress.bytesWritten / progress.totalBytes : 0}
      label="This download"
    />
  )
}

const styles = StyleSheet.create(theme => ({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.lg, paddingTop: space.md },
  counts: { flex: 1, minWidth: 0, gap: 3 },
  count: { color: theme.colors.textPrimary, fontSize: type.title, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  path: { flexShrink: 1, color: theme.colors.textSecondary, fontSize: type.sub },
}))
