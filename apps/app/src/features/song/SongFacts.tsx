import type { ReactNode } from 'react'
import { Linking, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatBytes, formatDuration, formatRelative, type Song } from '@selfmp3/shared'
import {
  formatAddedDate,
  formatName,
  isDownloaded,
  sourceName,
  space,
  tempoMark,
  tempoWords,
} from '@selfmp3/client'
import { useDownloadProgress, useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { useSongColor } from '../../ui/useSongColor'
import { Button } from '../../ui/components/Button'
import { EnergyWave } from '../../ui/components/EnergyWave'
import { label as labelText } from '../../ui/surfaces'

/**
 * Everything the app knows about one song, in plain words: the quiet end of
 * the song's own page, and the About tab on a computer's Now Playing page.
 *
 * Grouped by what you would want the fact for: how it sounds, whether it is on
 * this device, your history with it, and the file itself.
 *
 * "On this device" is the download queue's answer. The file's path and "Show
 * in Finder" belong to the server, and are left out.
 *
 * The song's page says the play count in a sentence of its own above, so it
 * asks for the facts without it (`plays={false}`); the About tab has no such
 * sentence and keeps it.
 */
export function SongFacts({ song, plays = true }: { song: Song; plays?: boolean }): ReactNode {
  const { theme } = useUnistyles()
  const artFor = useArt()
  // The energy wave and the source link are drawn in the song's own colour —
  // the one its cover gives the page around them — rather than this device's
  // accent, which read as a stray blue against the wash of the cover.
  const songColor = useSongColor(song, artFor(song))
  const { state: downloads, queue, installed } = useDownloads()
  const progress = useDownloadProgress()
  const features = song.audioFeatures
  const held = isDownloaded(downloads.index, song.id)
  const downloading = downloads.activeSongId === song.id
  const fraction =
    downloading && progress.totalBytes > 0
      ? Math.min(1, progress.bytesWritten / progress.totalBytes)
      : null
  const queued = !downloading && downloads.queue.includes(song.id)

  return (
    <View>
      <Group title="Sound">
        {features && (features.bpm != null || features.energy != null || features.key) ? (
          <>
            {features.bpm != null ? (
              <Fact label="Tempo">
                <Text style={styles.strong}>{tempoMark(features.bpm)}</Text>
                <Text style={styles.note}>
                  {Math.round(features.bpm)} beats a minute — {tempoWords(features.bpm)}.
                </Text>
              </Fact>
            ) : null}
            {features.energy != null ? (
              <Fact label="Energy">
                <View style={styles.inline}>
                  <EnergyWave
                    energy={features.energy}
                    width={44}
                    height={18}
                    color={songColor.color}
                  />
                  <Text style={styles.strong}>{Math.round(features.energy * 100)} of 100</Text>
                </View>
                <Text style={styles.note}>
                  How loud, busy and driving it feels. The wave grows with it.
                </Text>
              </Fact>
            ) : null}
            {features.key ? (
              <Fact label="Key">
                <Text style={styles.strong}>{features.key}</Text>
                <Text style={styles.note}>
                  Auto-mix uses it to pick songs that blend into this one.
                </Text>
              </Fact>
            ) : null}
          </>
        ) : (
          <Text style={styles.empty}>
            Not listened to yet. self.mp3 works out tempo, energy and key for every song in the
            background; this one hasn’t had its turn.
          </Text>
        )}
      </Group>

      {/* A browser streams; only an installed app keeps songs. */}
      {installed ? (
        <Group title="On this device">
          <Fact label="Offline">
            {downloading ? (
              <Text style={styles.strong}>
                {fraction === null
                  ? 'Downloading…'
                  : `Downloading · ${Math.round(fraction * 100)}%`}
              </Text>
            ) : held ? (
              <>
                <Text style={styles.strong}>Downloaded · {formatBytes(song.sizeBytes)}</Text>
                <Text style={styles.note}>Plays with no connection.</Text>
                <View style={styles.action}>
                  <Button label="Remove download" onPress={() => void queue.remove([song.id])} />
                </View>
              </>
            ) : (
              <>
                <Text style={styles.strong}>
                  Only on your server · {formatBytes(song.sizeBytes)}
                </Text>
                <Text style={styles.note}>
                  {queued ? 'Waiting to download.' : 'Plays only while your server is reachable.'}
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
                : `${song.playCount} ${song.playCount === 1 ? 'time' : 'times'} · last ${formatRelative(song.lastPlayedAt)}`}
            </Text>
          </Fact>
        ) : null}
        {song.skipCount > 0 ? (
          <Fact label="Skipped">
            <Text style={styles.strong}>
              {song.skipCount} {song.skipCount === 1 ? 'time' : 'times'}
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
          {song.missing ? (
            <Text style={[styles.note, { color: theme.colors.warning }]}>
              The file is missing from your library folder.
            </Text>
          ) : null}
        </Fact>
        <Fact label="Source">
          {song.sourceUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => void Linking.openURL(song.sourceUrl ?? '')}
            >
              <Text style={[styles.strong, { color: songColor.color }]}>
                {sourceName(song.sourceUrl)}
              </Text>
            </Pressable>
          ) : (
            <Text style={styles.strong}>Your library folder</Text>
          )}
        </Fact>
        {song.lyricsKind !== 'none' ? (
          <Fact label="Lyrics">
            <Text style={styles.strong}>
              {song.lyricsKind === 'synced' ? 'Synced' : 'Plain text'}
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

function Fact({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <View style={styles.factValue}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  // No side padding: the page it sits in has its own gutter.
  group: { gap: 10, paddingTop: space.md, paddingBottom: space.lg },
  // The groups are told apart by their labels and the room between them.
  groupTitle: labelText(theme.colors),
  fact: { flexDirection: 'row', gap: space.md },
  factLabel: { width: 76, color: theme.colors.textMuted, fontSize: 13.5 },
  factValue: { flex: 1, minWidth: 0, gap: 2, alignItems: 'flex-start' },
  strong: {
    color: theme.colors.textPrimary,
    fontSize: 13.5,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  note: { color: theme.colors.textMuted, fontSize: 12 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  action: { marginTop: 6 },
  empty: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
}))
