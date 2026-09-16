import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { radius, useLibrary, normaliseBaseUrl, ApiError } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { canConnectByAddress } from '../../ports/serverAddress'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { Refresh } from '../../ui/components/Icons'
import { ButtonRow, Details, Lead, Notice, Panel, partStyles, Row } from './SettingsParts'
import { type Confirming } from './settings.model'
import {} from '../metadata/metadata.model'

export function ConnectionPanel({
  anchor,
  onConfirm,
}: {
  anchor: (node: View | null) => void
  onConfirm: (what: Confirming) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const { connection, fromCloud } = useConnection()
  const library = useLibrary()
  return (
    <Panel title="Connection" hint="on this device" anchor={anchor}>
      {fromCloud ? (
        <Row label="Signed in" hint="With Google — the library is the bucket’s.">
          <Button
            label="Sign out"
            variant="danger"
            onPress={() => onConfirm('sign-out')}
            testID="cloud-sign-out"
          />
        </Row>
      ) : (
        <Row label="Address">
          <Text style={partStyles.valueText} numberOfLines={1}>
            {connection?.baseUrl ?? 'Not set'}
          </Text>
        </Row>
      )}
      {/*
        Folded away: a token and a library version are for someone working out
        why something is wrong, and the line under Settings' title already says
        whether the library can be reached.
      */}
      <Details>
        {fromCloud ? null : (
          <Row label="Token">
            <Text style={partStyles.valueText}>
              {connection?.token ? 'Saved in the keychain' : 'None'}
            </Text>
          </Row>
        )}
        <Row label="Library" last>
          <Text style={partStyles.valueText}>
            {library.isError
              ? library.data
                ? `Unreachable — showing the cached copy, ${library.data.songs.length} songs`
                : 'Unreachable, and nothing is cached yet'
              : library.data
                ? `${library.data.songs.length} songs · version ${library.data.version}`
                : 'Loading…'}
          </Text>
        </Row>
      </Details>
      <ButtonRow>
        <Button
          label="Refresh"
          icon={<Refresh size={15} color={theme.colors.textPrimary} />}
          onPress={() => void library.refetch()}
        />
      </ButtonRow>
      {canConnectByAddress ? <ServerSwitch /> : null}
    </Panel>
  )
}

/**
 * Connecting the installed app to a server by address, and going back.
 *
 * Only where a port says this device can: the desktop app, which may be sitting
 * beside the server or running on it. A phone and a browser tab never see this.
 *
 * **Switching answerers clears what has been downloaded**, and says so first. A
 * song's integer id belongs to whichever side answered — `docs/SYNC.md`,
 * "Identity" — so an index kept across a switch would offer the other side's
 * songs under this side's numbers, and play the wrong music. The permanent fix
 * is a `uid` shared across both, which is written up under "Later" in
 * docs/DESKTOP.md; until then the honest thing is to start again.
 */
function ServerSwitch(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { connect, fromCloud } = useConnection()
  const { removeAll } = useDownloads()

  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'to-server' | 'to-cloud' | null>(null)

  /** Tested before it is offered, so the confirmation is not about a typo. */
  const test = (): void => {
    const baseUrl = normaliseBaseUrl(address)
    if (!baseUrl) {
      setError('That does not look like an address. Try mac-mini.tail1234.ts.net')
      return
    }
    setBusy(true)
    setError(null)
    void (async () => {
      const candidate = { baseUrl, token: token.trim().length > 0 ? token.trim() : null }
      try {
        // `/api/health` answers without a token, so a wrong address and a wrong
        // token are two different messages rather than one red box.
        await apiFor(candidate).health()
        if (candidate.token) await apiFor(candidate).settings()
        setConfirming('to-server')
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) {
          setError('The server is there, but it rejected that token.')
        } else if (caught instanceof ApiError && caught.isOffline) {
          setError('Could not reach the server. Is Tailscale connected and the server running?')
        } else {
          setError(caught instanceof Error ? caught.message : 'Could not connect')
        }
      } finally {
        setBusy(false)
      }
    })()
  }

  const switchToServer = (): void => {
    const baseUrl = normaliseBaseUrl(address)
    if (!baseUrl) return
    void (async () => {
      await removeAll()
      await connect({ baseUrl, token: token.trim().length > 0 ? token.trim() : null })
      setOpen(false)
      router.replace('/')
    })()
  }

  const switchToCloud = (): void => {
    void (async () => {
      await removeAll()
      // Still connected to the server until signed in: say why sign-in is wanted.
      router.replace({ pathname: '/sign-in', params: { switching: '1' } })
    })()
  }

  return (
    <>
      {fromCloud ? (
        open ? (
          <>
            <Lead>
              The address of the computer running the server. On the machine itself, localhost:4600.
            </Lead>
            <TextInput
              style={styles.input}
              value={address}
              onChangeText={setAddress}
              placeholder="mac-mini.tail1234.ts.net"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
              testID="server-address"
            />
            <TextInput
              style={styles.input}
              value={token}
              onChangeText={setToken}
              placeholder="Token — leave empty for none"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              testID="server-token"
            />
            {error ? <Notice tone="error">{error}</Notice> : null}
            <ButtonRow>
              <Button label="Connect" variant="primary" busy={busy} onPress={test} />
              <Button label="Cancel" onPress={() => setOpen(false)} />
            </ButtonRow>
          </>
        ) : (
          <ButtonRow>
            <Button
              label="Connect to a server"
              onPress={() => setOpen(true)}
              testID="connect-to-server"
            />
          </ButtonRow>
        )
      ) : (
        <ButtonRow>
          <Button
            label="Use the cloud instead"
            onPress={() => setConfirming('to-cloud')}
            testID="use-the-cloud"
          />
        </ButtonRow>
      )}

      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming === 'to-cloud'
            ? 'Use the cloud library instead of this server?'
            : 'Use this server instead of the cloud library?'
        }
        body="Everything downloaded to this computer is removed first. A song’s number belongs to whichever side answered, so downloads cannot be carried across — they would play the wrong songs."
        confirmLabel={confirming === 'to-cloud' ? 'Switch to the cloud' : 'Switch to this server'}
        danger
        onConfirm={() => {
          const what = confirming
          setConfirming(null)
          if (what === 'to-cloud') switchToCloud()
          else switchToServer()
        }}
        onCancel={() => setConfirming(null)}
      />
    </>
  )
}

// ---------------------------------------------------------------- devices

const styles = StyleSheet.create(theme => ({
  /** The server address and token fields, the onboarding screen's own. */
  input: {
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
    color: theme.colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
}))
