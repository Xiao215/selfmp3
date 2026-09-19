import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { ApiError, normaliseBaseUrl, radius, space, type } from '@selfmp3/client'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'

/**
 * Connecting to a server by typing its address: development builds only.
 *
 * Every device starts with Google, and the library is the bucket's. This stays
 * for the simulator tests, which cannot sign in to a Google account, and for
 * trying the app against a server on this Mac. It sits behind a quiet text
 * action on Welcome rather than on a page of its own, and a normal build never
 * draws it at all.
 *
 * The address is tested before it is saved, and the test hits `/api/health`,
 * which is the one route that stays open when a bearer token is configured.
 * That separates "wrong address" from "wrong token", which are otherwise the
 * same red line and half an hour of confusion.
 */
export function ServerAddress({
  centred,
}: {
  /** Under a centred footnote on a phone; at the column's edge on a computer. */
  centred: boolean
}): ReactNode {
  const { theme } = useUnistyles()
  const { connect } = useConnection()

  const [open, setOpen] = useState(false)
  const [address, setAddress] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const save = (): void => {
    const baseUrl = normaliseBaseUrl(address)
    if (!baseUrl) {
      setError('That does not look like an address. Try mac-mini.tail1234.ts.net')
      return
    }

    setBusy(true)
    setError(null)
    setNote(null)

    const candidate = { baseUrl, token: token.trim().length > 0 ? token.trim() : null }

    void (async () => {
      try {
        const health = await apiFor(candidate).health()
        // `/api/health` answers without a token and keeps the library's
        // details back from an asker who has not proved anything; the count
        // and the path arrive once the token below has been accepted.
        setNote(
          health.songCount === undefined
            ? `Reached self.mp3 ${health.version}`
            : `Found ${health.songCount} songs on ${health.libraryPath ?? 'this server'}`,
        )

        // /api/health is unauthenticated, so prove the token separately
        // rather than discovering it is wrong on the first real request.
        if (candidate.token) await apiFor(candidate).settings()

        // Connected, the app has a library, and the root layout takes it from
        // here: Welcome is only ever drawn without one.
        await connect(candidate)
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

  if (!open) {
    return (
      <View style={centred ? styles.toggleCentred : styles.toggle}>
        <Button
          testID="welcome-address-toggle"
          label="Connect to a server by address"
          variant="text"
          onPress={() => setOpen(true)}
        />
      </View>
    )
  }

  return (
    <View style={styles.form}>
      <TextInput
        testID="welcome-address"
        style={styles.input}
        value={address}
        onChangeText={setAddress}
        placeholder="Server address, e.g. mac-mini.tail1234.ts.net"
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel="Server address"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
        keyboardType="url"
        inputMode="url"
        returnKeyType="next"
      />
      <TextInput
        testID="welcome-token"
        style={styles.input}
        value={token}
        onChangeText={setToken}
        placeholder="Token, only if the server has one"
        placeholderTextColor={theme.colors.textMuted}
        accessibilityLabel="Token"
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        returnKeyType="go"
        onSubmitEditing={save}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      <Button testID="welcome-connect" label="Connect" onPress={save} busy={busy} />
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  toggle: { alignItems: 'flex-start' },
  toggleCentred: { alignItems: 'center' },
  form: { gap: space.sm },
  // A control on the ground: a control's fill, a pill, no edge.
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  error: { color: theme.colors.danger, fontSize: type.small },
  note: { color: theme.colors.good, fontSize: type.small },
}))
