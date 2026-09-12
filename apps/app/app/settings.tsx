import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import { SafeAreaView } from 'react-native-safe-area-context'
import { formatBytes } from '@selfmp3/shared'
import { useLibrary, useManifest } from '../src/api/queries'
import {
  bytesToDownload,
  downloadedCount,
  staleIds,
  totalBytes,
  buildAccent,
  colors,
  radius,
  space,
  type,
} from '@selfmp3/client'
import { useDownloads } from '../src/offline/DownloadsProvider'
import { useConnection } from '../src/server/ConnectionProvider'
import { ACCENT_PRESETS, useAccent } from '../src/ui/accent'
import { BrandMark } from '../src/ui/components/BrandMark'
import { Button } from '../src/ui/components/Button'

/** Server, downloads, about — the three things worth a settings screen. */
export default function SettingsScreen(): ReactNode {
  const { connection, fromCloud, disconnect } = useConnection()
  const library = useLibrary()
  const manifest = useManifest()
  const { state: downloads, queue: downloadQueue } = useDownloads()
  const router = useRouter()
  const accent = useAccent()
  const [busy, setBusy] = useState(false)

  const songIds = useMemo(
    () => (library.data?.songs ?? []).filter(song => !song.missing).map(song => song.id),
    [library.data],
  )

  const everythingBytes = manifest.data
    ? bytesToDownload(downloads.index, manifest.data, songIds)
    : 0
  const stale = manifest.data ? staleIds(downloads.index, manifest.data) : []
  const active = downloads.activeSongId
  const activeSong = active === null ? null : library.data?.songs.find(song => song.id === active)

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Settings</Text>
        <Text style={styles.sub}>Server, downloads, and how this phone looks</Text>

        <Section title={fromCloud ? 'Library' : 'Server'}>
          {fromCloud ? (
            <Row label="Signed in" value="With Google — the library is the bucket's" />
          ) : (
            <>
              <Row label="Address" value={connection?.baseUrl ?? 'Not set'} />
              <Row label="Token" value={connection?.token ? 'Saved in the keychain' : 'None'} />
            </>
          )}
          <Row
            label="Library"
            value={
              library.data
                ? `${library.data.songs.length} songs · version ${library.data.version}`
                : library.isError
                  ? 'Unreachable — showing the cached copy'
                  : 'Loading…'
            }
          />
          <View style={styles.actions}>
            <Button label="Refresh" onPress={() => void library.refetch()} />
            <Button
              label="Change server"
              variant="danger"
              onPress={() => {
                Alert.alert(
                  'Change server',
                  'Downloads stay on the phone. You will need the address again.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Change',
                      style: 'destructive',
                      onPress: () => {
                        void disconnect().then(() => router.replace('/onboarding'))
                      },
                    },
                  ],
                )
              }}
            />
          </View>
        </Section>

        <Section title="Downloads">
          <Row
            label="On this phone"
            value={`${downloadedCount(downloads.index)} songs · ${formatBytes(totalBytes(downloads.index))}`}
          />
          <Row
            label="Not downloaded"
            value={
              manifest.data
                ? `${songIds.length - downloadedCount(downloads.index)} songs · ${formatBytes(everythingBytes)}`
                : 'Needs the server'
            }
          />
          {stale.length > 0 ? (
            <Row label="Out of date" value={`${stale.length} files changed on the server`} />
          ) : null}

          {downloads.queue.length > 0 ? (
            <View style={styles.progressBlock}>
              <Text style={styles.progressLabel} numberOfLines={1}>
                {activeSong ? activeSong.title : 'Preparing…'} · {downloads.queue.length} left
              </Text>
              <View style={styles.progressTrack}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${
                        downloads.totalBytes > 0
                          ? Math.min(100, (downloads.bytesWritten / downloads.totalBytes) * 100)
                          : 0
                      }%`,
                      backgroundColor: accent.accent,
                    },
                  ]}
                />
              </View>
            </View>
          ) : null}

          {downloads.error ? <Text style={styles.error}>{downloads.error}</Text> : null}

          <View style={styles.actions}>
            <Button
              label={
                everythingBytes > 0
                  ? `Download everything (${formatBytes(everythingBytes)})`
                  : 'Everything is downloaded'
              }
              variant="primary"
              disabled={everythingBytes === 0 || !manifest.data}
              onPress={() => downloadQueue.enqueue(songIds)}
            />
            {downloads.queue.length > 0 ? (
              <>
                <Button
                  label={downloads.paused ? 'Resume' : 'Pause'}
                  onPress={() =>
                    downloads.paused ? downloadQueue.resume() : downloadQueue.pause()
                  }
                />
                <Button label="Stop" onPress={() => downloadQueue.cancelAll()} />
              </>
            ) : null}
            {stale.length > 0 ? (
              <Button
                label="Remove out-of-date files"
                busy={busy}
                onPress={() => {
                  setBusy(true)
                  void downloadQueue.remove(stale).finally(() => setBusy(false))
                }}
              />
            ) : null}
            <Button
              label="Delete all downloads"
              variant="danger"
              disabled={downloadedCount(downloads.index) === 0}
              onPress={() => {
                Alert.alert('Delete all downloads', 'The library itself is not touched.', [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: () => {
                      void downloadQueue.removeAll()
                    },
                  },
                ])
              }}
            />
          </View>
        </Section>

        <Section title="Appearance">
          <View style={styles.accentRow}>
            <View style={styles.accentLabel}>
              <BrandMark size={20} />
              <Text style={styles.rowLabel}>Accent</Text>
            </View>
            <View style={styles.swatches}>
              {ACCENT_PRESETS.map(preset => (
                <Pressable
                  key={preset.hue}
                  onPress={() => accent.setHue(preset.hue)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={preset.name}
                  accessibilityState={{ selected: accent.hue === preset.hue }}
                  style={[
                    styles.swatch,
                    { backgroundColor: buildAccent(preset.hue).accent },
                    accent.hue === preset.hue && [
                      styles.swatchOn,
                      { borderColor: colors.textPrimary },
                    ],
                  ]}
                />
              ))}
            </View>
          </View>
          <Text style={styles.note}>
            This phone&rsquo;s colour, kept on this phone. The Mac and any other device keep their
            own.
          </Text>
        </Section>

        <Section title="About">
          <Row label="Version" value={String(Constants.expoConfig?.version ?? '1.0.0')} />
          <Text style={styles.note}>
            Gapless playback is handled by the native player. Crossfade is not: the web app overlaps
            two audio elements to do it, and there is no equivalent here — the `crossfadeSeconds`
            setting on the server has no effect on this app.
          </Text>
        </Section>
      </ScrollView>
    </SafeAreaView>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }): ReactNode {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }): ReactNode {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface0,
  },
  content: {
    paddingHorizontal: space.lg,
    paddingTop: 18,
    paddingBottom: space.xl,
  },
  heading: {
    color: colors.textPrimary,
    fontSize: type.large,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  sub: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 3,
    marginBottom: 22,
  },
  section: {
    marginBottom: space.xl,
  },
  sectionTitle: {
    color: colors.textMuted,
    fontSize: type.tiny,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: space.sm,
  },
  card: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
    gap: space.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: space.md,
  },
  rowLabel: {
    color: colors.textMuted,
    fontSize: type.small,
  },
  rowValue: {
    color: colors.textPrimary,
    fontSize: type.small,
    flexShrink: 1,
    textAlign: 'right',
  },
  actions: {
    gap: space.sm,
    marginTop: space.sm,
  },
  progressBlock: {
    gap: space.xs,
    marginTop: space.xs,
  },
  progressLabel: {
    color: colors.textSecondary,
    fontSize: type.small,
  },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.surface3,
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
  },
  accentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    gap: space.md,
  },
  accentLabel: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatches: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  swatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  swatchOn: { borderWidth: 2 },
  error: {
    color: colors.danger,
    fontSize: type.small,
  },
  note: {
    color: colors.textMuted,
    fontSize: type.small,
    lineHeight: 18,
  },
})
