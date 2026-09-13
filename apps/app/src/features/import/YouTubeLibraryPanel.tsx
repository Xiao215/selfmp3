import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { extractUrls, isYouTubeUrl, YT_LIKED_MUSIC_URL, type YtCookieTest } from '@selfmp3/shared'
import { clientApi, radius, space } from '@selfmp3/client'
import { useSettings } from '../../api/queries'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { CheckCircle, Heart, ListMusic, X } from '../../ui/components/Icons'

const BROWSER_NAMES: Record<string, string> = {
  chrome: 'Chrome',
  safari: 'Safari',
  firefox: 'Firefox',
  brave: 'Brave',
  edge: 'Edge',
  chromium: 'Chromium',
}

/**
 * "Import my YouTube Music library": the web's `YouTubeLibraryPanel`.
 *
 * Liked Music and private playlists only resolve when yt-dlp is signed in, so
 * this says whether cookies are set up, proves it with Test, and offers the
 * quick sources, which go through the normal fetch, review and import. Nothing
 * downloads from here.
 */
export function YouTubeLibraryPanel({
  onImport,
  busy,
}: {
  onImport: (links: string) => void
  busy: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const { wide } = useLayout()
  const { data: settings } = useSettings()
  const [playlistText, setPlaylistText] = useState('')
  const [result, setResult] = useState<YtCookieTest | null>(null)

  const test = useMutation({
    mutationFn: () => clientApi().ytCookieTest(),
    onSuccess: setResult,
    onError: (err: Error) =>
      setResult({
        ok: false,
        source: 'none',
        count: null,
        playlistTitle: null,
        error: err.message,
      }),
  })

  const source = settings?.ytCookieSource ?? 'none'
  const configured = source !== 'none'
  const sourceLabel =
    source === 'browser'
      ? `cookies from ${BROWSER_NAMES[settings?.ytCookieBrowser ?? 'chrome'] ?? 'your browser'}`
      : source === 'file'
        ? `cookies from ${settings?.ytCookieFile.split('/').pop() || 'a file'}`
        : 'not signed in'
  const pastedLinks = extractUrls(playlistText).filter(isYouTubeUrl)

  return (
    <View style={styles.panel}>
      <Text style={styles.title} accessibilityRole="header">
        Import my YouTube Music library
      </Text>
      <Text style={styles.lead}>
        Liked Music and private playlists need YouTube to see you as signed in. yt-dlp can borrow
        the login cookies from your browser, or read a cookies.txt file.
      </Text>

      {/* A coloured dot is not a status: the state is spelled out, and the dot only reinforces it. */}
      <View style={[styles.status, configured && styles.statusOn, !wide && styles.statusWrap]}>
        <View style={[styles.dot, configured && styles.dotOn]} />
        <Text style={styles.statusText}>
          <Text style={styles.strong}>{configured ? 'Signed in' : 'Not signed in'}</Text>
          {configured
            ? ` — using ${sourceLabel}. `
            : ' — public playlists still work; Liked Music won’t. '}
          <Text
            style={[styles.link, { color: accent.accent }]}
            onPress={() => router.push('/settings')}
            accessibilityRole="link"
          >
            {configured ? 'change in Settings' : 'set cookies up in Settings'}
          </Text>
        </Text>
        <Button
          label={test.isPending ? 'Testing…' : 'Test'}
          onPress={() => test.mutate()}
          disabled={test.isPending}
        />
      </View>

      {source === 'browser' && settings?.ytCookieBrowser === 'safari' ? (
        <Text style={styles.hint}>
          Safari keeps its cookies in a file macOS protects. The process running self.mp3 (Terminal,
          or node) needs <Text style={styles.strong}>Full Disk Access</Text> in System Settings →
          Privacy & Security for this to work.
        </Text>
      ) : null}

      {result ? (
        <View style={[styles.notice, result.ok ? styles.noticeGood : styles.noticeError]}>
          {result.ok ? <CheckCircle size={15} color={theme.colors.good} /> : null}
          <Text style={styles.noticeText}>
            {result.ok
              ? `Signed in. ${result.playlistTitle ?? 'Liked Music'} has ${result.count} ${
                  result.count === 1 ? 'track' : 'tracks'
                }.`
              : result.error}
          </Text>
          <IconButton onPress={() => setResult(null)} label="Dismiss">
            <X size={15} color={theme.colors.textMuted} />
          </IconButton>
        </View>
      ) : null}

      <View style={[styles.sources, wide && styles.sourcesWide]}>
        <Pressable
          style={({ pressed }) => [
            styles.source,
            wide && styles.sourceWide,
            pressed && styles.sourcePressed,
            busy && styles.disabled,
          ]}
          onPress={() => onImport(YT_LIKED_MUSIC_URL)}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Liked Music"
        >
          <Heart size={16} color={accent.accent} filled />
          <View style={styles.sourceText}>
            <Text style={styles.sourceTitle}>Liked Music</Text>
            <Text style={styles.hint}>
              Every song you’ve thumbed up. Reviewed before anything downloads.
            </Text>
          </View>
        </Pressable>

        <View style={[styles.source, wide && styles.sourceWide]}>
          <ListMusic size={16} color={accent.accent} />
          <View style={styles.sourceText}>
            <Text style={styles.sourceTitle}>A playlist of yours</Text>
            {/* Fetch beside the box when there is room, as on the web; under it on a phone. */}
            <View style={[styles.fetchRow, wide && styles.fetchRowWide]}>
              <TextInput
                style={[styles.input, wide && styles.inputWide]}
                value={playlistText}
                onChangeText={setPlaylistText}
                placeholder="https://music.youtube.com/playlist?list=PL…"
                placeholderTextColor={theme.colors.textMuted}
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                accessibilityLabel="Playlist link"
              />
              <View style={styles.fetch}>
                <Button
                  label="Fetch"
                  onPress={() => onImport(pastedLinks.join('\n'))}
                  disabled={busy || pastedLinks.length === 0}
                />
              </View>
            </View>
          </View>
        </View>
      </View>

      <Text style={styles.hint}>
        Tick <Text style={styles.strong}>also create playlist</Text> on the review screen to get a
        playlist here with the same name.
      </Text>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  panel: {
    marginTop: 30,
    padding: 18,
    gap: 10,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  title: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  lead: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  statusOn: { borderColor: theme.colors.good },
  statusWrap: { flexWrap: 'wrap' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.textMuted },
  dotOn: { backgroundColor: theme.colors.good },
  statusText: { flex: 1, minWidth: 180, color: theme.colors.textSecondary, fontSize: 13 },
  strong: { color: theme.colors.textPrimary, fontWeight: '600' },
  link: { textDecorationLine: 'underline' },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingLeft: 12,
    paddingRight: 4,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  noticeGood: { borderColor: theme.colors.good, backgroundColor: theme.colors.surface0 },
  noticeError: { borderColor: theme.colors.danger, backgroundColor: theme.colors.surface0 },
  noticeText: { flex: 1, color: theme.colors.textPrimary, fontSize: 13 },
  sources: { gap: 10, marginTop: 4 },
  sourcesWide: { flexDirection: 'row', alignItems: 'stretch' },
  source: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  sourceWide: { flex: 1, minWidth: 0 },
  sourcePressed: { borderColor: theme.colors.borderStrong },
  disabled: { opacity: 0.6 },
  sourceText: { flex: 1, minWidth: 0, gap: 4 },
  sourceTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  input: {
    minHeight: 44,
    paddingHorizontal: 10,
    paddingVertical: 6,
    color: theme.colors.textPrimary,
    fontSize: 11,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  fetchRow: { gap: space.xs },
  fetchRowWide: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  inputWide: { flex: 1, minWidth: 0 },
  fetch: { alignSelf: 'flex-end' },
}))
