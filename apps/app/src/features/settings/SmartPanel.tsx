import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../ui/components/Button'
import { Toggle } from '../../ui/components/Toggle'
import { Sparkle } from '../../ui/components/Icons'
import { useServerApi } from '../../connection/useServerApi'
import { useServerSettings } from './useServerSettings'
import { ServerAway } from '../../connection/ServerAway'
import { Panel, Row, SettingsWaiting } from './SettingsParts'
import { reachedConnection, viaKey } from '../../connection/via'
import { textStyle, iconSize, space } from '@selfmp3/client'

/**
 * Smart features (docs/features/ai.md), in Settings: one switch, on or off,
 * for all of them — song names and tags go to the model, never audio — and
 * what Ask has been asked to remember, each with Remove.
 *
 * The switch is the library's setting, which the server acts on — it refuses
 * every smart feature while it is off, and reads the notes with each
 * request — so it is read from and written to the server itself, and waits
 * for its answer. With no model set up on the server none of them can do
 * anything, so the switch is dimmed and says so.
 */
export function SmartPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
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
  const noModel = setup.data?.address === null
  const notes = settings?.smartNotes ?? []
  return (
    <Panel title="Smart features" mark={<Sparkle size={iconSize.small} />} anchor={anchor}>
      {server.reach.state !== 'reachable' ? (
        <ServerAway reach={server.reach} need="ai" row testID="smart-server" />
      ) : settings ? (
        <>
          <Row
            label="Use smart features"
            hint={
              noModel
                ? 'Your server has no model set up.'
                : 'Song names and tags only. Never audio.'
            }
            last={notes.length === 0}
          >
            <Toggle
              value={settings.smartFeatures}
              onChange={value => set('smartFeatures', value)}
              label="Use smart features"
              disabled={noModel}
              testID="smart-features"
            />
          </Row>
          {notes.length > 0 ? (
            <Row label="What Ask remembers" hint="Sent with every request." />
          ) : null}
          {notes.map((note, index) => (
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
          ))}
        </>
      ) : (
        <SettingsWaiting failed={failed} onRetry={retry} />
      )}
    </Panel>
  )
}

const styles = StyleSheet.create(theme => ({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    paddingVertical: 2,
    borderLeftWidth: 2,
    borderLeftColor: theme.colors.surface3,
  },
  noteText: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    ...textStyle('sub'),
  },
}))
