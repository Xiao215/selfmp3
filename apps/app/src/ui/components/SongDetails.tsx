import type { ReactNode } from 'react'
import { Linking, Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { formatBytes, formatDuration, formatRelative, type Song } from '@selfmp3/shared'
import {
  formatAddedDate,
  formatName,
  isDownloaded,
  oklchToHexAlpha,
  radius,
  sourceName,
  space,
  tempoMark,
  tempoWords,
} from '@selfmp3/client'
import { useDownloadProgress, useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { useOverlay } from '../../shell/Overlay'
import { useEscape } from '../../shell/useEscape'
import { useAccent } from '../accent'
import { Button } from './Button'
import { Cover } from './Cover'
import { EnergyWave } from './EnergyWave'
import { IconButton } from './IconButton'
import { X } from './Icons'

/**
 * Everything the app knows about one song, in plain words: the web's
 * `SongDetailsDialog`.
 *
 * Grouped by what you would want the fact for: how it sounds, whether it is on
 * this device, your history with it, and the file itself.
 *
 * "On this device" is the phone's answer, the download queue's, rather than
 * the browser cache's. The server-only half of the web's version — the file's
 * path and "Show in Finder" — belongs to the server, and is left out.
 */
export function SongDetails({ song, onClose }: { song: Song; onClose: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const artFor = useArt()
  useEscape(true, onClose, { layer: true })

  const byline = [song.artist || 'Unknown artist', song.album, song.year]
    .filter(Boolean)
    .join(' · ')

  useOverlay(
    <View
      style={[styles.backdrop, { backgroundColor: oklchToHexAlpha(0.1, 0.02, accent.hue, 0.6) }]}
    >
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      <View
        style={styles.dialog}
        role="dialog"
        aria-modal
        accessibilityViewIsModal
        testID="song-details"
      >
        <View style={styles.head}>
          <Cover uri={artFor(song)} title={song.album || song.title} size={64} />
          <View style={styles.titles}>
            <Text style={styles.title} accessibilityRole="header">
              {song.title}
            </Text>
            <Text style={styles.byline}>{byline}</Text>
          </View>
          <IconButton onPress={onClose} label="Close">
            <X size={16} color={theme.colors.textSecondary} />
          </IconButton>
        </View>
        <ScrollView>
          <SongDetailsBody song={song} />
        </ScrollView>
      </View>
    </View>,
    true,
  )

  return null
}

/**
 * The facts themselves, without the dialog around them: the dialog shows them,
 * and so does the About tab on a computer's Now Playing page.
 */
export function SongDetailsBody({ song }: { song: Song }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const { state: downloads, queue, installed } = useDownloads()
  const progress = useDownloadProgress()
  const features = song.features
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
                  <EnergyWave energy={features.energy} width={44} height={18} />
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
                    <Button label="Download now" onPress={() => queue.enqueue([song.id])} />
                  </View>
                )}
              </>
            )}
          </Fact>
        </Group>
      ) : null}

      <Group title="History">
        <Fact label="Played">
          <Text style={styles.strong}>
            {song.playCount === 0
              ? 'Not yet'
              : `${song.playCount} ${song.playCount === 1 ? 'time' : 'times'} · last ${formatRelative(song.lastPlayedAt)}`}
          </Text>
          {song.skipCount > 0 ? (
            <Text style={styles.note}>
              Skipped {song.skipCount} {song.skipCount === 1 ? 'time' : 'times'}.
            </Text>
          ) : null}
        </Fact>
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
              <Text style={[styles.strong, { color: accent.accent }]}>
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
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 460,
    maxHeight: 720,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.borderStrong,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingTop: 18,
    paddingRight: 14,
    paddingBottom: space.lg,
    paddingLeft: 18,
  },
  titles: { flex: 1, minWidth: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 17, fontWeight: '600', lineHeight: 21 },
  byline: { color: theme.colors.textSecondary, fontSize: 13, marginTop: 2 },
  group: {
    gap: 10,
    paddingTop: space.md,
    paddingHorizontal: 18,
    paddingBottom: space.lg,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  groupTitle: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.66,
  },
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
