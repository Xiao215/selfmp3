import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../ui/components/Button'
import { Check, Refresh, Sparkle, X } from '../../ui/components/Icons'
import { modelHop, serverHop, type Hop } from '../smart/smart.model'
import { useSmartServer } from '../smart/useSmartServer'
import { Panel, Row } from './SettingsParts'

/**
 * Smart features (docs/features/ai.md): where your server asks a model, and a
 * Test that goes the whole way, a leg at a time — this device to your server,
 * then your server to the model — so "couldn't reach" says which of the two.
 *
 * The address is the server's (`SELFMP3_AI_BASE_URL` in its `.env`), shown
 * here and not edited: it sits beside the key, which never leaves the server.
 */
export function SmartPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const server = useSmartServer()
  const queryClient = useQueryClient()
  const via = server.reach.state === 'reachable' ? server.reach.connection.baseUrl : null
  const setupKey = ['via-server', via, 'ai', 'setup']
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
      title="Smart features"
      mark={<Sparkle size={12} />}
      hint="on your server"
      anchor={anchor}
    >
      {server.reach.state !== 'reachable' ? (
        <Row
          label="Your server"
          hint={
            server.reach.state === 'looking'
              ? 'Looking for your server…'
              : 'Isn’t answering, so smart features can’t be used from here. It answers on the same Wi‑Fi, or over Tailscale.'
          }
          last
        >
          {server.reach.state === 'away' ? (
            <Button
              label="Look again"
              icon={<Refresh size={13} tone="textPrimary" />}
              onPress={server.reach.lookAgain}
              testID="smart-look-again"
            />
          ) : null}
        </Row>
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
            <Row label="Models" hint="Quick jobs like planning, then judging and picking">
              <Text style={styles.address}>
                {setup.data.models.fast === setup.data.models.smart
                  ? setup.data.models.fast
                  : `${setup.data.models.fast} · ${setup.data.models.smart}`}
              </Text>
            </Row>
          ) : null}
          <Row
            label="Test the connection"
            hint="One small request: this device to your server, then your server to the model."
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
                    {hop.ok ? <Check size={14} tone="good" /> : <X size={14} tone="danger" />}
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
    return 'Not set up. Set SELFMP3_AI_BASE_URL in your server’s .env to an endpoint that speaks OpenAI’s chat completions, then restart it.'
  }
  return 'Set by SELFMP3_AI_BASE_URL in your server’s .env.'
}

const styles = StyleSheet.create(theme => ({
  address: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  hops: { gap: 8, paddingTop: 4 },
  hop: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  hopMark: { paddingTop: 2 },
  hopText: { flex: 1, minWidth: 0, gap: 2 },
  hopLine: { color: theme.colors.textPrimary, fontSize: 13, lineHeight: 19 },
  hopFailed: { color: theme.colors.danger },
  hopDetail: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
}))
