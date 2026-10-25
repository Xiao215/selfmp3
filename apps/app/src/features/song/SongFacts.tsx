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
  tempoMark,
  tempoWords,
  type,
} from '@selfmp3/client'
import { useDownloadProgress, useDownloads } from '../../offline/DownloadsProvider'
import { useDownloadRemoval } from '../../offline/useDownloadRemoval'
import { useArt } from '../../offline/useArt'
import { useSongColor } from '../../ui/useSongColor'
import { Button } from '../../ui/components/Button'
import { CloudRemove } from '../../ui/components/Icons'
import { EnergyWave } from '../../ui/components/EnergyWave'
import { label as labelText } from '../../ui/surfaces'
import { useLayout } from '../../shell/useLayout'
import { tip } from '../../ui/tip'
import { onThisDevice } from '../settings/settings.model'
import { Press } from '../../ui/components/Press'
import { thisPlace } from '../../ports/place'

/**
 * Everything the app knows about one song, in plain words: the quiet end of
 * the song's own page, and the Details tab on a computer's Now Playing page.
 *
 * Grouped by what you would want the fact for: how it sounds, whether it is on
 * this device, your history with it, and the file itself.
 *
 * "On this phone" (or computer) is the download queue's answer. The file's path and "Show
 * in Finder" belong to the server, and are left out.
 *
 * The song's page says the play count in a sentence of its own above, so it
 * asks for the facts without it (`plays={false}`); the Details tab has no such
 * sentence and keeps it.
 */
export function SongFacts({ song, plays = true }: { song: Song; plays?: boolean }): ReactNode {
  const artFor = useArt()
  // The energy wave and the source link are drawn in the song's own colour —
  // the one its cover gives the page around them — rather than this device's
  // accent, which would read as a stray blue against the wash of the cover.
  const songColor = useSongColor(song, artFor(song))
  const { state: downloads, queue, installed } = useDownloads()
  // The same removal as the song's menu: by hand, with an Undo.
  const removeDownloads = useDownloadRemoval()
  const progress = useDownloadProgress()
  const features = song.audioFeatures
  const held = isDownloaded(downloads.index, song.id)
  const downloading = downloads.activeSongId === song.id
  const fraction =
    downloading && progress.totalBytes > 0
      ? Math.min(1, progress.bytesWritten / progress.totalBytes)
      : null
  const queued = !downloading && downloads.queue.includes(song.id)
  const place = thisPlace()
  const { finePointer } = useLayout()

  return (
    <View>
      {/* A song not listened to yet has no Sound at all, rather than a sentence saying so. */}
      {features && (features.bpm != null || features.energy != null || features.key) ? (
        <Group title="Sound">
          {features.bpm != null ? (
            <Fact label="Tempo">
              <Text style={styles.strong}>{tempoMark(features.bpm)}</Text>
              <Text style={styles.note}>
                {Math.round(features.bpm)} beats a minute — {tempoWords(features.bpm)}.
              </Text>
            </Fact>
          ) : null}
          {features.energy != null ? (
            <Fact label="Energy" caption={finePointer ? ENERGY_TIP : null}>
              <View style={styles.inline}>
                <EnergyWave
                  energy={features.energy}
                  width={44}
                  height={18}
                  color={songColor.color}
                />
                <Text style={styles.strong}>{Math.round(features.energy * 100)} of 100</Text>
              </View>
            </Fact>
          ) : null}
          {features.key ? (
            <Fact label="Key" caption={finePointer ? KEY_TIP : null}>
              <Text style={styles.strong}>{features.key}</Text>
            </Fact>
          ) : null}
        </Group>
      ) : null}

      {/* A browser streams; only an installed app keeps songs. */}
      {installed ? (
        <Group title={onThisDevice(place)}>
          <Fact label="Status">
            {downloading ? (
              <Text style={styles.strong}>
                {fraction === null
                  ? 'Downloading…'
                  : `Downloading · ${Math.round(fraction * 100)}%`}
              </Text>
            ) : held ? (
              <>
                <Text style={styles.strong}>
                  On this {place} · {formatBytes(song.sizeBytes)}
                </Text>
                <Text style={styles.note}>Plays with no connection.</Text>
                <View style={styles.action}>
                  {/* The cloud, not a bare word: this undoes the download, and
                      the icon says which of the two it is at a glance. */}
                  <Button
                    label={`Remove from this ${place}`}
                    icon={<CloudRemove tone="textPrimary" />}
                    onPress={() => removeDownloads([song.id])}
                  />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.strong}>
                  Not on this {place} · {formatBytes(song.sizeBytes)}
                </Text>
                <Text style={styles.note}>
                  {queued ? 'Waiting to download.' : 'Plays only while your library is reachable.'}
                </Text>
                {queued ? null : (
                  <View style={styles.action}>
                    <Button label="Download" onPress={() => queue.enqueue([song.id])} />
                  </View>
                )}
              </>
            )}
          </Fact>
        </Group>
      ) : null}

      <Group title="History">
        {plays ? (
          <Fact label="Played">
            <Text style={styles.strong}>
              {song.playCount === 0
                ? 'Not yet'
                : `${plural(song.playCount, 'time', 'times')} · last ${formatRelative(song.lastPlayedAt)}`}
            </Text>
          </Fact>
        ) : null}
        <Fact label="Added">
          <Text style={styles.strong}>{formatAddedDate(song.addedAt)}</Text>
        </Fact>
      </Group>

      <Group title="File">
        <Fact label="Format">
          <Text style={styles.strong}>
            {formatName(song.mime, song.path)} · {formatDuration(song.duration)}
          </Text>
        </Fact>
        <Fact label="Source">
          {song.sourceUrl ? (
            <Press
              feedback="dim"
              accessibilityRole="link"
              onPress={() => void Linking.openURL(song.sourceUrl ?? '')}
            >
              <Text style={[styles.strong, { color: songColor.color }]}>
                {sourceName(song.sourceUrl)}
              </Text>
            </Press>
          ) : (
            <Text style={styles.strong}>Your library folder</Text>
          )}
        </Fact>
        {song.lyricsKind !== 'none' ? (
          <Fact label="Lyrics">
            <Text style={styles.strong}>
              {song.lyricsKind === 'synced' ? 'Timed' : 'Plain text'}
            </Text>
          </Fact>
        ) : null}
      </Group>
    </View>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <View style={styles.group} accessibilityLabel={title}>
      <Text style={styles.groupTitle}>{title.toUpperCase()}</Text>
      {children}
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

function Fact({
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
    <View style={styles.fact}>
      <Text style={styles.factLabel} {...tip(caption)}>
        {label}
      </Text>
      <View style={styles.factValue}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  // No side padding: the page it sits in has its own gutter.
  group: { gap: space.snug, paddingTop: space.md, paddingBottom: space.lg },
  // The groups are told apart by their labels and the room between them.
  groupTitle: labelText(theme.colors),
  fact: { flexDirection: 'row', gap: space.md },
  factLabel: { width: 76, color: theme.colors.textMuted, fontSize: type.sub },
  factValue: { flex: 1, minWidth: 0, gap: 2, alignItems: 'flex-start' },
  strong: {
    color: theme.colors.textPrimary,
    fontSize: type.sub,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  note: { color: theme.colors.textMuted, fontSize: type.small },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
  action: { marginTop: space.tight },
}))
