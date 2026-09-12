import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AppState,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import * as Linking from 'expo-linking'
import { SafeAreaView } from 'react-native-safe-area-context'
import { DoormanError, type CloudSession } from '@selfmp3/cloud'
import { formatSignInCode, SignInCodeSchema } from '@selfmp3/shared'
import { session as cloud } from '../src/cloud'
import { useConnection } from '../src/server/ConnectionProvider'
import { useRouter } from 'expo-router'
import { Button } from '../src/ui/components/Button'
import { colors, radius, space, type } from '../src/ui/theme'

/**
 * First run: sign in with Google.
 *
 * A phone has no page for the doorman to send Google back to, so it shows a
 * code once Google is done and this asks for it. That is not a lesser path
 * invented for native — it is the one an iPhone home-screen app already takes
 * when Google opens in a sheet whose storage is not the app's, and it is why
 * the doorman needed no changes at all to let a phone in.
 *
 * Starting a sign-in is deliberately not enough to claim it: a link somebody
 * sends you gets them nothing, because they never see your code.
 */

/** How often to ask the doorman whether Google has finished. */
const POLL_MS = 2_000

/** The code the doorman put in the address it sent us back to, if it did. */
function codeIn(url: string | null): string | null {
  if (!url) return null
  const raw = /(?:^|[#&?])signin-code=([0-9A-Za-z-]{1,32})/.exec(url)?.[1]
  if (raw === undefined) return null
  const parsed = SignInCodeSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

type Stage =
  | { readonly kind: 'idle'; readonly message: string | null }
  | { readonly kind: 'waiting' }
  | { readonly kind: 'code'; readonly error: string | null }

export default function SignInScreen({
  onSignedIn,
}: {
  onSignedIn?: (session: CloudSession) => void
}): ReactNode {
  const { signedInToCloud } = useConnection()
  const router = useRouter()
  const [stage, setStage] = useState<Stage>({ kind: 'idle', message: null })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const begin = useCallback((): void => {
    setStage({ kind: 'waiting' })
    void cloud.beginSignIn().catch((error: unknown) => {
      setStage({
        kind: 'idle',
        message: error instanceof Error ? error.message : 'Could not open Google.',
      })
    })
  }, [])

  /** Signed in: tell the app to answer from the bucket, and get out of the way. */
  const done = useCallback(
    (session: CloudSession): void => {
      onSignedIn?.(session)
      signedInToCloud()
      router.replace('/')
    },
    [onSignedIn, signedInToCloud, router],
  )

  /** Ask the doorman how it is going: now, and whenever the app comes back. */
  const check = useCallback(async (): Promise<void> => {
    const pending = await cloud.pendingSignIn()
    if (!pending) {
      setStage({ kind: 'idle', message: 'That took too long. Try again.' })
      return
    }
    try {
      const outcome = await cloud.claimSignIn(pending.attempt)
      if (outcome.status === 'code') setStage({ kind: 'code', error: null })
      else if (outcome.status === 'signed-in') done(outcome.session)
    } catch {
      // Offline, or the doorman is busy. The next look will say.
    }
  }, [done])

  useEffect(() => {
    if (stage.kind !== 'waiting') return
    // Off the effect body on purpose: the first look sets state, and doing
    // that synchronously here is a cascading render (and a lint error).
    const first = setTimeout(() => void check(), 0)
    const timer = setInterval(() => void check(), POLL_MS)
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') void check()
    })
    return () => {
      clearTimeout(first)
      clearInterval(timer)
      sub.remove()
    }
  }, [stage.kind, check])

  /** Claim the session with a code, whether it was typed or came in a link. */
  const claimWith = useCallback(
    async (raw: string): Promise<void> => {
      const parsed = SignInCodeSchema.safeParse(raw.trim())
      if (!parsed.success) {
        setStage({ kind: 'code', error: 'That does not look like the code.' })
        return
      }
      setBusy(true)
      try {
        const pending = await cloud.pendingSignIn()
        if (!pending) {
          setStage({ kind: 'idle', message: 'That took too long. Try again.' })
          return
        }
        const outcome = await cloud.claimSignIn(pending.attempt, parsed.data)
        if (outcome.status === 'signed-in') done(outcome.session)
        else setStage({ kind: 'code', error: 'Google hasn’t finished yet. Try again in a moment.' })
      } catch (error) {
        // A wrong code ends the attempt: the doorman spends it either way, so
        // there is nothing to try again with.
        if (error instanceof DoormanError && error.code === 'wrong_code') {
          setStage({ kind: 'idle', message: 'That wasn’t the code. Sign in again.' })
        } else {
          setStage({
            kind: 'code',
            error: error instanceof Error ? error.message : 'Could not sign in.',
          })
        }
      } finally {
        setBusy(false)
      }
    },
    [done],
  )

  /**
   * Coming back from Google.
   *
   * The doorman redirects to `selfmp3://sign-in#signin-code=…`, which reaches
   * the app either as the link that launched it or as one delivered while it
   * was already open — so both are watched. With nothing to read, the screen
   * falls back to asking for the code, which is what a doorman too old to
   * know this scheme will have shown.
   */
  useEffect(() => {
    let cancelled = false
    const take = (url: string | null): void => {
      const code = codeIn(url)
      if (!cancelled && code) void claimWith(code)
    }
    void Linking.getInitialURL().then(take)
    const sub = Linking.addEventListener('url', event => take(event.url))
    return () => {
      cancelled = true
      sub.remove()
    }
  }, [claimWith])

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.wordmark}>self.mp3</Text>
          <Text style={styles.blurb}>
            Your music, from the bucket that belongs to your Google account — on this phone,
            offline, with or without your Mac.
          </Text>

          {stage.kind === 'idle' && (
            <View>
              {stage.message ? <Text style={styles.error}>{stage.message}</Text> : null}
              <Button label="Sign in with Google" onPress={begin} />
            </View>
          )}

          {stage.kind === 'waiting' && (
            <View>
              <Text style={styles.label}>Waiting for Google…</Text>
              <Text style={styles.blurb}>
                Finish signing in, then come back here. Google will show you a short code.
              </Text>
              <Button
                label="I have the code"
                onPress={() => setStage({ kind: 'code', error: null })}
              />
            </View>
          )}

          {stage.kind === 'code' && (
            <View>
              <Text style={styles.label}>The code Google showed</Text>
              <TextInput
                style={styles.input}
                value={formatSignInCode(code)}
                onChangeText={next => setCode(next.replace(/[^0-9A-Za-z]/g, ''))}
                placeholder="XXXX-XXXX"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
              />
              {stage.error ? <Text style={styles.error}>{stage.error}</Text> : null}
              <Button label={busy ? 'Signing in…' : 'Continue'} onPress={() => void claimWith(code)} />
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  content: { padding: space.xl, gap: space.sm, flexGrow: 1, justifyContent: 'center' },
  wordmark: { color: colors.textPrimary, fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  blurb: {
    color: colors.textSecondary,
    fontSize: type.body,
    lineHeight: 21,
    marginBottom: space.lg,
  },
  label: { color: colors.textMuted, fontSize: type.small, fontWeight: '600', marginTop: space.md },
  input: {
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    color: colors.textPrimary,
    fontSize: type.body,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  error: { color: colors.danger, fontSize: type.small, marginBottom: space.md },
})
