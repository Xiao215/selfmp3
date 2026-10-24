import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../ui/components/Button'
import { Toggle } from '../../ui/components/Toggle'
import { Check, Sparkle, X } from '../../ui/components/Icons'
import { modelHop, serverHop, type Hop } from '../smart/smart.model'
import { useSmartServer } from '../smart/useSmartServer'
import { useServerApi } from '../../connection/useServerApi'
import { useServerSettings } from './useServerSettings'
import { ServerAway } from '../../connection/ServerAway'
import { Panel, Row, SettingsWaiting } from './SettingsParts'
import { reachedConnection, viaKey } from '../../connection/via'
import { type, textStyle, iconSize, space } from '@selfmp3/client'
import { hint, textColumn } from '../../ui/surfaces'

/**
 * Smart features (docs/features/ai.md), in Settings.
 *
 * Each feature, and what of the library it shows the model, in a line: said
 * here because "the model sees your library" is too vague to agree to, and
 * each one sees less than that.
 */
const SWITCHES: readonly {
  key:
    | 'smartAsk'
    | 'smartTidy'
    | 'smartTags'
    | 'smartWritten'
    | 'smartMetadata'
    | 'smartImport'
    | 'smartWeb'
  label: string
  sees: string
}[] = [
  {
    key: 'smartAsk',
    label: 'Ask in Search',
    sees: 'Sends your words and the songs that fit.',
  },
  {
    key: 'smartTidy',
    label: 'Tidy up',
    sees: 'Sends the names of the songs in question.',
  },
  {
    key: 'smartTags',
    label: 'Tags',
    sees: 'Sends your tags and the songs in question.',
  },
  {
    key: 'smartWritten',
    label: 'The Report in words',
    sees: 'Sends the Report’s numbers and names.',
  },
  {
    key: 'smartMetadata',
    label: 'Fix song info',
    sees: 'Sends the song’s names and catalogue matches.',
  },
  {
    key: 'smartImport',
    label: 'Names at import',
    sees: 'Sends the names of the songs you’re importing.',
  },
  {
    key: 'smartWeb',
    label: 'Search the web',
    sees: 'Off by default. Sends names to a search engine.',
  },
]

/**
 * Smart features' switches, and what Ask remembers: using the features. Where
 * the server asks a model, and the Test, are running it, and sit under
 * Advanced (`SmartModelPanel`, O1).
 *
 * The switches are the library's settings, which the server acts on — it
 * refuses a feature that is off, and searches the web or reads the notes per
 * request — so they are read from and written to the server itself. The
 * switches wait for its answer.
 */
export function SmartPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const server = useServerApi()
  const { settings, failed, retry, set } = useServerSettings(
    server.api,
    server.via?.baseUrl ?? null,
  )
  return (
    <Panel
      title="Smart features"
      mark={<Sparkle size={iconSize.small} />}
      hint="through your library’s computer"
      anchor={anchor}
    >
      {server.reach.state !== 'reachable' ? (
        <ServerAway reach={server.reach} need="ai" row testID="smart-server" />
      ) : (
        <>
          {settings ? null : <SettingsWaiting failed={failed} onRetry={retry} />}
          {settings
            ? SWITCHES.map(each => (
                <Row key={each.key} label={each.label} hint={each.sees}>
                  <Toggle
                    value={settings[each.key]}
                    onChange={value => set(each.key, value)}
                    label={each.label}
                  />
                </Row>
              ))
            : null}
          {settings ? (
            <Row
              label="What Ask remembers"
              hint={
                settings.smartNotes.length === 0
                  ? 'Nothing yet. Ask offers to remember standing requests.'
                  : 'Sent with every request.'
              }
              last={settings.smartNotes.length === 0}
            />
          ) : null}
          {settings?.smartNotes.map((note, index) => (
            <View key={note} style={styles.note} testID="smart-note">
              <Text style={styles.noteText}>{note}</Text>
              <Button
                label="Remove"
                variant="text"
                onPress={() =>
                  set(
                    'smartNotes',
                    settings.smartNotes.filter((_, at) => at !== index),
                  )
                }
                testID="smart-note-forget"
              />
            </View>
          ))}
        </>
      )}
    </Panel>
  )
}

/**
 * Where your server asks a model, and a Test that goes the whole way, a leg
 * at a time — this device to your server, then your server to the model — so
 * "couldn't reach" says which of the two.
 *
 * The address is the server's (`SELFMP3_AI_BASE_URL` in its `.env`), shown
 * here and not edited: it sits beside the key, which never leaves the server.
 */
export function SmartModelPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const server = useSmartServer()
  const queryClient = useQueryClient()
  const via = reachedConnection(server.reach)?.baseUrl ?? null
  const setupKey = viaKey(via, 'ai', 'setup')
  const setup = useQuery({
    queryKey: setupKey,
    queryFn: () => server.api!.aiSetup(),
    enabled: server.api !== null,
    retry: false,
  })
  const [testing, setTesting] = useState(false)
  const [hops, setHops] = useState<readonly Hop[] | null>(null)

  const test = async (): Promise<void> => {
    const api = server.api
    if (!api) return
    setTesting(true)
    setHops(null)
    const started = Date.now()
    try {
      const fresh = await api.aiSetup()
      queryClient.setQueryData(setupKey, fresh)
      const first = serverHop({ ms: Date.now() - started })
      setHops([first])
      setHops([first, modelHop(await api.checkAi())])
    } catch (error) {
      setHops(previous => [...(previous ?? []), serverHop({ error })])
    } finally {
      setTesting(false)
    }
  }

  return (
    <Panel
      title="Model"
      mark={<Sparkle size={iconSize.small} />}
      hint="for smart features"
      anchor={anchor}
    >
      {server.reach.state !== 'reachable' ? (
        <ServerAway reach={server.reach} need="ai" row testID="smart-server" />
      ) : (
        <>
          <Row label="Model address" hint={addressHint(setup.data, setup.error)}>
            {setup.data?.address ? (
              <Text style={styles.address} numberOfLines={1} selectable testID="smart-address">
                {setup.data.address}
              </Text>
            ) : null}
          </Row>
          {setup.data?.address ? (
            <Row label="Models" hint="Fast, then smart">
              <Text style={styles.address}>
                {setup.data.models.fast === setup.data.models.smart
                  ? setup.data.models.fast
                  : `${setup.data.models.fast} · ${setup.data.models.smart}`}
              </Text>
            </Row>
          ) : null}
          <Row
            label="Test the connection"
            hint="This device to your server, then to the model."
            last={hops === null}
          >
            <Button
              label="Test"
              busy={testing}
              onPress={() => void test()}
              disabled={server.api === null}
              testID="smart-test"
            />
          </Row>
          {hops ? (
            <View style={styles.hops} accessibilityLiveRegion="polite" testID="smart-result">
              {hops.map(hop => (
                <View key={hop.line} style={styles.hop}>
                  <View style={styles.hopMark}>
                    {hop.ok ? (
                      <Check size={iconSize.field} tone="good" />
                    ) : (
                      <X size={iconSize.field} tone="danger" />
                    )}
                  </View>
                  <View style={styles.hopText}>
                    <Text style={[styles.hopLine, !hop.ok && styles.hopFailed]}>{hop.line}</Text>
                    {hop.detail ? (
                      <Text style={styles.hopDetail} selectable>
                        {hop.detail}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
              {testing ? <Text style={styles.hopDetail}>Asking the model…</Text> : null}
            </View>
          ) : null}
        </>
      )}
    </Panel>
  )
}

function addressHint(
  data: { address: string | null } | undefined,
  error: unknown,
): string | undefined {
  if (error) return serverHop({ error }).line
  if (!data) return undefined
  if (data.address === null) {
    return 'Not set up: SELFMP3_AI_BASE_URL in the server’s .env.'
  }
  return 'From SELFMP3_AI_BASE_URL.'
}

const styles = StyleSheet.create(theme => ({
  address: {
    color: theme.colors.textSecondary,
    fontSize: type.sub,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
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
  hops: { gap: space.sm, paddingTop: space.xs },
  hop: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  hopMark: { paddingTop: 2 },
  hopText: textColumn,
  hopLine: { color: theme.colors.textPrimary, ...textStyle('sub') },
  hopFailed: { color: theme.colors.danger },
  hopDetail: hint(theme.colors),
}))
