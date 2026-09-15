import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, Text, useWindowDimensions, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQueryClient } from '@tanstack/react-query'
import type { Playlist, SmartRules, Tag } from '@selfmp3/shared'
import { queryKeys, space, useUpdatePlaylist } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { Sheet } from '../../ui/components/Sheet'
import { SmartRuleBuilder } from './SmartRuleBuilder'

/** Save a live playlist's rules, and have its songs follow them. */
function useSaveRules(playlistId: number): (rules: SmartRules) => void {
  const client = useQueryClient()
  const updatePlaylist = useUpdatePlaylist()
  return useCallback(
    (rules: SmartRules) =>
      updatePlaylist.mutate(
        { id: playlistId, patch: { rules } },
        {
          onSuccess: () =>
            void client.invalidateQueries({ queryKey: queryKeys.playlistSongs(playlistId) }),
        },
      ),
    [client, updatePlaylist, playlistId],
  )
}

export const RULES_PANEL_WIDTH = 340

/**
 * A live playlist's rules, being edited, beside its songs: at desktop width
 * the song list stays on screen and changes as the rules do.
 */
export function RulesPanel({
  playlist,
  tags,
  onDone,
}: {
  playlist: Playlist
  tags: readonly Tag[]
  onDone: () => void
}): ReactNode {
  const save = useSaveRules(playlist.id)
  return (
    <View style={styles.panel} testID="rules-panel">
      <View style={styles.head}>
        <Text style={styles.title}>Rules</Text>
        <Button label="Done" variant="primary" onPress={onDone} />
      </View>
      <ScrollView contentContainerStyle={styles.panelBody} keyboardShouldPersistTaps="handled">
        <SmartRuleBuilder
          key={playlist.id}
          rules={playlist.rules ?? undefined}
          tags={tags}
          onChange={save}
          bare
          compact
        />
      </ScrollView>
    </View>
  )
}

/** The same, on a phone: a sheet over the songs, which are there again when it closes. */
export function RulesSheet({
  open,
  playlist,
  tags,
  onDone,
}: {
  open: boolean
  playlist: Playlist
  tags: readonly Tag[]
  onDone: () => void
}): ReactNode {
  const save = useSaveRules(playlist.id)
  const { height } = useWindowDimensions()
  return (
    <Sheet open={open} onClose={onDone} title="Rules" subtitle={playlist.name} testID="rules-sheet">
      <ScrollView
        style={{ maxHeight: height * 0.62 }}
        contentContainerStyle={styles.sheetBody}
        keyboardShouldPersistTaps="handled"
      >
        <SmartRuleBuilder
          key={playlist.id}
          rules={playlist.rules ?? undefined}
          tags={tags}
          onChange={save}
          bare
        />
      </ScrollView>
      <View style={styles.sheetFoot}>
        <Button label="Show songs" variant="primary" grow onPress={onDone} />
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create(theme => ({
  panel: {
    width: RULES_PANEL_WIDTH,
    backgroundColor: theme.colors.surface1,
    borderLeftWidth: 1,
    borderLeftColor: theme.colors.border,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingTop: 18,
    paddingBottom: space.md,
  },
  title: { color: theme.colors.textPrimary, fontSize: 16, fontWeight: '700' },
  panelBody: { paddingHorizontal: space.lg, paddingBottom: space.xl },
  sheetBody: { paddingHorizontal: space.sm, paddingBottom: space.sm },
  sheetFoot: { flexDirection: 'row', paddingHorizontal: space.sm, paddingTop: space.sm },
}))
