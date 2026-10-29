import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../ui/components/Button'
import { Sparkle } from '../../ui/components/Icons'
import { useServerApi } from '../../connection/useServerApi'
import { useServerSettings } from './useServerSettings'
import { ServerAway } from '../../connection/ServerAway'
import { Card, SettingsWaiting, Tile } from './SettingsParts'
import { reachedConnection, viaKey } from '../../connection/via'
import { textStyle, iconSize, space } from '@selfmp3/client'

/**
 * Smart features (docs/features/ai.md), in Settings: one switch for all of
 * them — song names and tags go to the model, never audio — as one of the
 * quick tiles, and what Ask has been asked to remember, on a page of its own.
 *
 * The switch is the library's setting, which the server acts on — it refuses
 * every smart feature while it is off, and reads the notes with each
 * request — so it is read from and written to the server itself, and waits
 * for its answer. With no model set up on the server none of them can do
 * anything, so the tile says so instead of being a switch (C2).
 */
function useSmart() {
  const server = useServerApi()
  const { settings, failed, retry, set } = useServerSettings(
    server.api,
    server.via?.baseUrl ?? null,
  )
  const via = reachedConnection(server.reach)?.baseUrl ?? null
  const setup = useQuery({
    queryKey: viaKey(via, 'ai', 'setup'),
    queryFn: () => server.api!.aiSetup(),
    enabled: server.api !== null,
    retry: false,
  })
  return { server, settings, failed, retry, set, noModel: setup.data?.address === null }
}

/** The Smart features tile: on, off, or why it can be neither just now. */
export function SmartTile(): ReactNode {
  const { server, settings, failed, retry, set, noModel } = useSmart()
  const icon = (
    <Sparkle size={iconSize.medium} tone={settings?.smartFeatures ? 'accent' : 'textMuted'} />
  )
  if (server.reach.state !== 'reachable') {
    return (
      <Tile
        icon={icon}
        label="Smart features"
        state={server.reach.state === 'looking' ? 'Looking…' : 'Can’t reach'}
        on={false}
        role="button"
        disabled={server.reach.state === 'looking'}
        onPress={server.reach.lookAgain}
        testID="smart-features"
      />
    )
  }
  if (!settings) {
    return (
      <Tile
        icon={icon}
        label="Smart features"
        state={failed ? 'Can’t reach' : 'Loading…'}
        on={false}
        role="button"
        disabled={!failed}
        onPress={retry}
        testID="smart-features"
      />
    )
  }
  if (noModel) {
    return (
      <Tile
        icon={icon}
        label="Smart features"
        state="Not set up"
        on={false}
        role="button"
        disabled
        onPress={() => undefined}
        testID="smart-features"
      />
    )
  }
  return (
    <Tile
      icon={icon}
      label="Smart features"
      state={settings.smartFeatures ? 'On' : 'Off'}
      on={settings.smartFeatures}
      onPress={() => set('smartFeatures', !settings.smartFeatures)}
      testID="smart-features"
    />
  )
}

/** How many things Ask remembers, once the server has said: the row into the page. */
export function useAskNotesCount(): number | null {
  const { settings } = useSmart()
  return settings ? settings.smartNotes.length : null
}

/**
 * What Ask remembers (Settings › What Ask remembers): how you want things
 * done, saved from an Ask answer and sent with every request, each with
 * Remove.
 */
export function RememberedCard(): ReactNode {
  const { server, settings, failed, retry, set } = useSmart()
  const notes = settings?.smartNotes ?? []
  return (
    <Card>
      {server.reach.state !== 'reachable' ? (
        <ServerAway reach={server.reach} need="ai" row testID="smart-server" />
      ) : !settings ? (
        <SettingsWaiting failed={failed} onRetry={retry} />
      ) : notes.length === 0 ? (
        <Text style={styles.nothing}>
          Nothing yet. When an Ask answer offers to remember how you want something done, it shows
          up here.
        </Text>
      ) : (
        notes.map((note, index) => (
          <View key={note} style={styles.note} testID="smart-note">
            <Text style={styles.noteText}>{note}</Text>
            <Button
              label="Remove"
              variant="text"
              onPress={() =>
                set(
                  'smartNotes',
                  notes.filter((_, at) => at !== index),
                )
              }
              testID="smart-note-forget"
            />
          </View>
        ))
      )}
    </Card>
  )
}

const styles = StyleSheet.create(theme => ({
  nothing: { color: theme.colors.textMuted, ...textStyle('sub'), paddingTop: space.md },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.md,
  },
  noteText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    ...textStyle('body'),
  },
}))
