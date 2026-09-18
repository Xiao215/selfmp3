import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, AppState, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { DoormanError, type CloudSession } from '@selfmp3/replica'
import { space, type } from '@selfmp3/client'
import { session as cloud } from '../../replica'
import { onSignInCode } from '../../ports/signInReturn'
import { titleBarInset } from '../../ports/titleBarInset'
import { useConnection } from '../../connection/ConnectionProvider'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { BrandMark } from '../../ui/components/BrandMark'
import { Button } from '../../ui/components/Button'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { sectionTitle, serif } from '../../ui/surfaces'
import { afterCheck, copyFor, FOOTNOTE, TOOK_TOO_LONG, type SignInStage } from './signIn.model'

/**
 * First run: sign in with Google.
 *
 * One door. The press opens Google — in the same tab on the web, in the
 * person's own browser everywhere else — and the doorman sends it back with the
 * code that claims the session inside the link. Nobody types anything: if the
 * link never makes it back, the screen says so and starting again is the answer
 * (`signIn.model.ts`).
 *
 * Starting a sign-in is deliberately not enough to claim it: a link somebody
 * sends you gets them nothing, because the code only ever comes back to the
 * browser that signed in.
 */

/** How often to ask the doorman whether Google has finished. */
const POLL_MS = 2_000

export function SignInScreen({
  onSignedIn,
}: {
  onSignedIn?: (session: CloudSession) => void
}): ReactNode {
  const accent = useAccent()
  const { wide } = useLayout()
  const { signedInToCloud } = useConnection()
  const router = useRouter()
  const [stage, setStage] = useState<SignInStage>({ kind: 'idle', message: null })

  const begin = useCallback((): void => {
    setStage({ kind: 'waiting', googleDoneAt: null })
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
      setStage(current => afterCheck(current, 'gone', Date.now()))
      return
    }
    try {
      const outcome = await cloud.claimSignIn(pending.attempt)
      if (outcome.status === 'signed-in') done(outcome.session)
      else {
        const attempt = outcome.status === 'code' ? 'done' : 'pending'
        setStage(current => afterCheck(current, attempt, Date.now()))
      }
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

  /** Claim the session with the code the link brought. */
  const claimWith = useCallback(
    async (code: string): Promise<void> => {
      try {
        const pending = await cloud.pendingSignIn()
        if (!pending) {
          setStage({ kind: 'idle', message: TOOK_TOO_LONG })
          return
        }
        const outcome = await cloud.claimSignIn(pending.attempt, code)
        if (outcome.status === 'signed-in') done(outcome.session)
        else setStage({ kind: 'idle', message: 'Google hasn’t finished yet. Try again.' })
      } catch (error) {
        // A refused code ends the attempt: the doorman spends it either way.
        setStage({
          kind: 'idle',
          message:
            error instanceof DoormanError && error.code === 'wrong_code'
              ? 'That sign-in didn’t go through. Try again.'
              : error instanceof Error
                ? error.message
                : 'Could not sign in.',
        })
      }
    },
    [done],
  )

  /**
   * Coming back from Google.
   *
   * The doorman sends the browser back to `selfmp3://sign-in#signin-code=…` —
   * this site's own `/sign-in` on the web — and `ports/signInReturn` keeps the
   * code until this screen is listening, whether the link launched the app or
   * arrived while it was open.
   */
  useEffect(
    () =>
      onSignInCode('sign-in', code => {
        // Said before the claim starts, not after: the poll is also running, and
        // it learns "finished" from the doorman a moment earlier.
        setStage({ kind: 'claiming' })
        void claimWith(code)
      }),
    [claimWith],
  )

  const copy = copyFor(stage)
  const busy = stage.kind === 'waiting' || stage.kind === 'claiming'

  return (
    <SafeAreaView style={styles.screen}>
      <View style={[styles.frame, wide && styles.frameWide]}>
        <View style={styles.brand}>
          <BrandMark size={wide ? 26 : 24} />
          <Text style={styles.brandName}>self.mp3</Text>
        </View>

        <View style={styles.middle}>
          <Text style={[styles.headline, wide && styles.headlineWide]} accessibilityRole="header">
            {copy.lead}
            {'\n'}
            <Text style={{ color: accent.accent }}>{copy.accent}</Text>
          </Text>
          {copy.body ? <Text style={styles.body}>{copy.body}</Text> : null}
          {busy ? <ActivityIndicator color={accent.accent} style={styles.spinner} /> : null}
        </View>

        {stage.kind === 'idle' && stage.message ? (
          <Text style={styles.error}>{stage.message}</Text>
        ) : null}

        {stage.kind === 'claiming' ? null : (
          <View style={[styles.actions, wide && styles.actionsWide]}>
            {stage.kind === 'idle' || stage.kind === 'lost' ? (
              <View style={wide ? styles.primaryWide : undefined}>
                <Button
                  testID="sign-in-google"
                  label={stage.kind === 'idle' ? 'Continue with Google' : 'Try again'}
                  variant="primary"
                  onPress={begin}
                />
              </View>
            ) : (
              <Button label="Open Google again" onPress={begin} />
            )}
            {stage.kind === 'idle' ? (
              <Text style={[styles.footnote, !wide && styles.footnoteCentred]}>{FOOTNOTE}</Text>
            ) : (
              <Button label="Cancel" onPress={() => setStage({ kind: 'idle', message: null })} />
            )}
          </View>
        )}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  // The Mac's traffic lights sit over the top of the page; a narrow Mac window
  // is still this layout, so the mark starts below them. Zero everywhere else.
  frame: {
    flex: 1,
    paddingHorizontal: space.xl,
    paddingTop: space.lg + titleBarInset,
    paddingBottom: space.xl,
  },
  // Deep enough at the top that the Mac's traffic lights sit clear of the mark.
  frameWide: { paddingHorizontal: 56, paddingTop: 56, paddingBottom: 48 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  // The name beside the mark is set as a section's title is: the display face at 18.
  brandName: sectionTitle(theme.colors),
  middle: { flex: 1, justifyContent: 'center', gap: space.lg, maxWidth: 640 },
  // A welcome, so the serif: one weight, never bolded.
  headline: { ...serif(theme.colors, 44), lineHeight: 46, letterSpacing: -0.6 },
  headlineWide: { fontSize: 60, lineHeight: 62, letterSpacing: -0.8 },
  body: { color: theme.colors.textSecondary, fontSize: type.title, lineHeight: 24, maxWidth: 420 },
  spinner: { alignSelf: 'flex-start' },
  error: { color: theme.colors.danger, fontSize: type.body, marginBottom: space.md },
  actions: { gap: space.md },
  actionsWide: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  primaryWide: { width: 260 },
  footnote: { color: theme.colors.textMuted, fontSize: type.small },
  footnoteCentred: { textAlign: 'center' },
}))
