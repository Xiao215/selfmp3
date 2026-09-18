import { useState } from 'react'
import type { ReactNode } from 'react'
import { KeyboardAvoidingView, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { apiFor } from '../../api/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { Button } from '../../ui/components/Button'
import { ApiError, normaliseBaseUrl, radius, space, type } from '@selfmp3/client'
import { keyboardAvoidBehavior } from '../../ports/keyboard'
import { pageTitle } from '../../ui/surfaces'

/**
 * First run: where is the server?
 *
 * The address is tested before it is saved, and the test hits `/api/health`,
 * which is the one route that stays open when a bearer token is configured.
 * That separates "wrong address" from "wrong token", which are otherwise the
 * same red box and half an hour of confusion.
 */
export function OnboardingScreen(): ReactNode {
  const { theme } = useUnistyles()
  const { connect } = useConnection()
  const router = useRouter()

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

        await connect(candidate)
        router.replace('/')
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

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={keyboardAvoidBehavior}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.wordmark}>self.mp3</Text>
          <Text style={styles.blurb}>
            Point this at the computer running the server. On a phone that means the Tailscale name,
            so it keeps working away from home.
          </Text>

          <Text style={styles.label}>Server address</Text>
          <TextInput
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            placeholder="mac-mini.tail1234.ts.net"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
            returnKeyType="next"
          />

          <Text style={styles.label}>Token (only if the server has one)</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="Leave empty for none"
            placeholderTextColor={theme.colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={save}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}

          <View style={styles.actions}>
            <Button label="Connect" onPress={save} variant="primary" busy={busy} />
          </View>

          <Text style={styles.footnote}>
            Both are stored in the device keychain, not in plain storage.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    padding: space.xl,
    gap: space.sm,
    flexGrow: 1,
    justifyContent: 'center',
  },
  wordmark: pageTitle(theme.colors),
  blurb: {
    color: theme.colors.textSecondary,
    fontSize: type.body,
    lineHeight: 21,
    marginBottom: space.lg,
  },
  label: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    fontWeight: '600',
    marginTop: space.md,
  },
  // A control on the ground: a control's fill, a pill, no edge.
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  error: {
    color: theme.colors.danger,
    fontSize: type.small,
    marginTop: space.md,
  },
  note: {
    color: theme.colors.good,
    fontSize: type.small,
    marginTop: space.md,
  },
  actions: {
    marginTop: space.xl,
  },
  footnote: {
    color: theme.colors.textMuted,
    fontSize: type.tiny,
    marginTop: space.lg,
    textAlign: 'center',
  },
}))
