import { Fragment } from 'react'
import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { plural, formatBytes, formatDuration, formatRelative, type Song } from '@selfmp3/shared'
import {
  formatAddedDate,
  formatName,
  isDownloaded,
  sourceName,
  space,
  textStyle,
  type,
} from '@selfmp3/client'
import { useDownloadProgress, useDownloads } from '../../offline/DownloadsProvider'
import { useDownloadRemoval } from '../../offline/useDownloadRemoval'
import { useArt } from '../../offline/useArt'
import { useSongColor } from '../../ui/useSongColor'
import { Button } from '../../ui/components/Button'
import { CloudRemove } from '../../ui/components/Icons'
import { EnergyWave } from '../../ui/components/EnergyWave'
import { card, serif } from '../../ui/surfaces'
import { useLayoutFlags } from '../../shell/useLayout'
import { tip } from '../../ui/tip'
import { onThisDevice } from '../settings/settings.model'
import { thisPlace } from '../../ports/place'

/**
 * How a song sounds, as three tiles across: Tempo ("120 bpm"), Key and
 * Energy with its wave (F1, 2026-10-25). The tempo was said three times
 * ("tempo 120", "♩ = 120", "120 beats a minute — moderate"); this is the
 * once. Nothing at all for a song the analyser has not reached.
 */
export function SoundStrip({ song }: { song: Song }): ReactNode {
  const artFor = useArt()
  // The wave is drawn in the song's own colour, the one its cover gives the
  // page around it, rather than this device's accent.
  const songColor = useSongColor(song, artFor(song))
  const { wide, finePointer } = useLayoutFlags()
  const features = song.audioFeatures
  if (!features || (features.bpm == null && features.energy == null && !features.key)) return null
  const figure = wide ? styles.figure : styles.figureSmall
  return (
    <View style={styles.strip} accessibilityLabel="Sound" testID="song-sound">
      {features.bpm != null ? (
        <SoundTile label="Tempo">
          <View style={styles.withUnit}>
            <Text style={figure}>{Math.round(features.bpm)}</Text>
            <Text style={styles.unit}>bpm</Text>
          </View>
        </SoundTile>
      ) : null}
      {features.key ? (
        <SoundTile label="Key" caption={finePointer ? KEY_TIP : null}>
          <Text style={figure} numberOfLines={1}>
            {features.key}
          </Text>
        </SoundTile>
      ) : null}
      {features.energy != null ? (
        <SoundTile label="Energy" caption={finePointer ? ENERGY_TIP : null}>
          <View style={styles.inline}>
            <Text style={figure}>{Math.round(features.energy * 100)}</Text>
            <EnergyWave
              energy={features.energy}
              width={wide ? 56 : 36}
              height={18}
              color={songColor.color}
            />
          </View>
        </SoundTile>
      ) : null}
    </View>
  )
}

function SoundTile({
  label,
  caption = null,
  children,
}: {
  label: string
  /** A hover caption on the label, on a computer. */
  caption?: string | null
  children: ReactNode
}): ReactNode {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel} {...tip(caption)}>
        {label}
      </Text>
      {children}
    </View>
  )
}

/**
 * The rest of what the app knows about a song, as one quiet line: "AAC · 4:26
 * · From YouTube Music · Timed lyrics · Added Sep 14, 2026", with `end` (Fix
 * song info…) beside it. It was two tables, History and File, for one or two
 * facts each (F1). The end of the song's own page, and of the Details tab on
 * a computer's Now Playing.
 *
 * "On this phone" (or computer) is the download queue's answer, in a line of
 * its own above, where an installed app keeps songs. The file's path and
 * "Show in Finder" belong to the server, and are left out.
 *
 * The song's page says the plays elsewhere, so it asks for the line without
 * them (`plays={false}`); the Details tab has nowhere else and keeps them.
 */
export function SongFacts({
  song,
  plays = true,
  end,
}: {
  song: Song
  plays?: boolean
  end?: ReactNode
}): ReactNode {
  const artFor = useArt()
  // The source link is in the song's own colour, as the wave is.
  const songColor = useSongColor(song, artFor(song))
  const { installed } = useDownloads()
  const parts: ReactNode[] = [
    `${formatName(song.mime, song.path)} · ${formatDuration(song.duration)}`,
    song.sourceUrl ? (
      <Text key="source">
        From{' '}
        <Text
          accessibilityRole="link"
          style={{ color: songColor.color }}
          onPress={() => void Linking.openURL(song.sourceUrl ?? '')}
        >
          {sourceName(song.sourceUrl)}
        </Text>
      </Text>
    ) : (
      'From your library folder'
    ),
    song.lyricsKind === 'none' ? null : song.lyricsKind === 'synced' ? 'Timed lyrics' : 'Lyrics',
    `Added ${formatAddedDate(song.addedAt)}`,
    plays
      ? song.playCount === 0
        ? 'Not played yet'
        : `Played ${plural(song.playCount, 'time', 'times')} · last ${formatRelative(song.lastPlayedAt)}`
      : null,
  ].filter(part => part !== null)

  return (
    <View style={styles.facts} testID="song-facts">
      {/* A browser streams; only an installed app keeps songs. */}
      {installed ? <OnThisDevice song={song} /> : null}
      <View style={styles.lineRow}>
        <Text style={styles.line}>
          {parts.map((part, index) => (
            <Fragment key={index}>
              {index > 0 ? ' · ' : null}
              {part}
            </Fragment>
          ))}
        </Text>
        {end}
      </View>
    </View>
  )
}

/** Whether the song is kept here, and the button that changes it. */
function OnThisDevice({ song }: { song: Song }): ReactNode {
  const { state: downloads, queue } = useDownloads()
  // The same removal as the song's menu: by hand, with an Undo.
  const removeDownloads = useDownloadRemoval()
  const progress = useDownloadProgress()
  const held = isDownloaded(downloads.index, song.id)
  const downloading = downloads.activeSongId === song.id
  const fraction =
    downloading && progress.totalBytes > 0
      ? Math.min(1, progress.bytesWritten / progress.totalBytes)
      : null
  const queued = !downloading && downloads.queue.includes(song.id)
  const place = thisPlace()
  return (
    <View style={styles.lineRow} accessibilityLabel={onThisDevice(place)}>
      <Text style={styles.line}>
        {downloading
          ? fraction === null
            ? 'Downloading…'
            : `Downloading · ${Math.round(fraction * 100)}%`
          : held
            ? `On this ${place} · ${formatBytes(song.sizeBytes)} · plays with no connection`
            : queued
              ? `Waiting to download · ${formatBytes(song.sizeBytes)}`
              : `Not on this ${place} · ${formatBytes(song.sizeBytes)}`}
      </Text>
      {downloading || queued ? null : held ? (
        // The cloud, not a bare word: this undoes the download, and the icon
        // says which of the two it is at a glance.
        <Button
          label={`Remove from this ${place}`}
          icon={<CloudRemove tone="textPrimary" />}
          onPress={() => removeDownloads([song.id])}
        />
      ) : (
        <Button label="Download" onPress={() => queue.enqueue([song.id])} />
      )}
    </View>
  )
}

/*
 * What Energy and Key mean, for whoever wonders: a hover caption on the label
 * with a mouse, and nothing on a touch screen, where a note under every song's
 * numbers was read once and then only in the way.
 */
const ENERGY_TIP = 'How loud, busy and driving it feels. The wave grows with it.'
const KEY_TIP = 'Auto-mix uses it to pick songs that blend into this one.'

const styles = StyleSheet.create(theme => ({
  strip: { flexDirection: 'row', gap: space.snug },
  tile: { ...card(theme.colors), flex: 1, minWidth: 0, gap: 2, padding: space.roomy },
  tileLabel: { color: theme.colors.textSecondary, fontSize: type.small },
  figure: serif(theme.colors, 'page'),
  figureSmall: serif(theme.colors, 'large'),
  withUnit: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  unit: { color: theme.colors.textSecondary, fontSize: type.sub },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
  facts: { gap: space.md },
  // The line and what sits beside it; a phone wraps the button under the words.
  lineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  line: { flexShrink: 1, color: theme.colors.textMuted, ...textStyle('sub') },
}))
