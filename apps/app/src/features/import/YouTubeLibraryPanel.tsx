import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { extractUrls, isYouTubeUrl } from '@selfmp3/shared'
import { radius, space } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { ListMusic } from '../../ui/components/Icons'

/**
 * "Import a YouTube playlist": the web's `YouTubeLibraryPanel`, without the
 * signed-in half.
 *
 * YouTube login cookies are off for now, so Liked Music and private playlists
 * don't resolve and nothing here offers them. A public playlist link goes
 * through the normal fetch, review and import. Nothing downloads from here.
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
  const { wide } = useLayout()
  const [playlistText, setPlaylistText] = useState('')
  const pastedLinks = extractUrls(playlistText).filter(isYouTubeUrl)

  return (
    <View style={styles.panel}>
      <Text style={styles.title} accessibilityRole="header">
        Import a YouTube playlist
      </Text>
      <Text style={styles.lead}>Public playlists only: paste the link, then review before anything downloads.</Text>

      <View style={styles.source}>
        <ListMusic size={16} color={accent.accent} />
        <View style={styles.sourceText}>
          <Text style={styles.sourceTitle}>A playlist</Text>
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
  strong: { color: theme.colors.textPrimary, fontWeight: '600' },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  source: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginTop: 4,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
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
