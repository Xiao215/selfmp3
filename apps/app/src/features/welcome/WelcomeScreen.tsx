import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  AppState,
  Image,
  KeyboardAvoidingView,
  ScrollView,
  Text,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { DoormanError } from '@selfmp3/replica'
import { fonts, radius, space, tagColors, type } from '@selfmp3/client'
import { session as cloud } from '../../replica'
import { keptCovers } from '../../offline/covers'
import { deviceWord } from '../../ports/device'
import { keyboardAvoidBehavior } from '../../ports/keyboard'
import { onSignInCode } from '../../ports/signInReturn'
import { titleBarInset } from '../../ports/titleBarInset'
import { useConnection } from '../../connection/ConnectionProvider'
import { useLayout } from '../../shell/useLayout'
import { BrandMark } from '../../ui/components/BrandMark'
import { Button } from '../../ui/components/Button'
import { CoverLight } from '../../ui/components/CoverLight'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { floating, sectionTitle, serif } from '../../ui/surfaces'
import {
  afterCheck,
  copyFor,
  signInFailure,
  TOOK_TOO_LONG,
  type SignInStage,
} from '../signIn/signIn.model'
import { ServerAddress } from './ServerAddress'
import { WhitePill } from './WhitePill'
import {
  FAN_POSES,
  WELCOME_FAN,
  welcomeArt,
  welcomeFootnote,
  type WelcomeArt,
  type WelcomeTile,
} from './welcome.model'

/**
 * The way in (docs/ui-mock `P01`, `P02`, `C01`): one button, Continue with
 * Google, under a picture of what a library here is.
 *
 * The press opens Google — in the same tab on the web, in the person's own
 * browser everywhere else — and the doorman sends it back with the code that
 * claims the session inside the link. Nobody types anything: if the link never
 * makes it back, the page says so and starting again is the answer
 * (`signIn/signIn.model.ts`).
 *
 * Starting a sign-in is deliberately not enough to claim it: a link somebody
 * sends you gets them nothing, because the code only ever comes back to the
 * browser that signed in.
 *
 * Once signed in, this page does not route anywhere itself. The app now has a
 * library, and the root layout sends a device's first sign-in to First sync
 * and every other to Home, so that decision is made in one place.
 */

/** The page's own address in a browser; a phone has none. */
function pageOrigin(): string | null {
  return (globalThis as { location?: { origin?: string } }).location?.origin ?? null
}

/** How often to ask the doorman whether Google has finished. */
const POLL_MS = 2_000

/** A window wide enough for the text half's full margin. */
const ROOMY = 1100

export function WelcomeScreen(): ReactNode {
  const { theme } = useUnistyles()
  const { wide, finePointer, width } = useLayout()
  const { signedInToCloud } = useConnection()
  const [stage, setStage] = useState<SignInStage>({ kind: 'idle', message: null })
  const [kept, setKept] = useState<readonly string[] | null>(null)

  // What this device kept from before. Until it answers, nothing is drawn
  // above the words rather than tiles that a moment later become covers.
  useEffect(() => {
    let cancelled = false
    void keptCovers(WELCOME_FAN + 1).then(found => {
      if (!cancelled) setKept(found)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const begin = useCallback((): void => {
    setStage({ kind: 'waiting', googleDoneAt: null })
    void cloud.beginSignIn().catch((error: unknown) => {
      setStage({ kind: 'idle', message: signInFailure(error, pageOrigin()) })
    })
  }, [])

  /** Ask the doorman how it is going: now, and whenever the app comes back. */
  const check = useCallback(async (): Promise<void> => {
    const pending = await cloud.pendingSignIn()
    if (!pending) {
      setStage(current => afterCheck(current, 'gone', Date.now()))
      return
    }
    try {
      const outcome = await cloud.claimSignIn(pending.attempt)
      if (outcome.status === 'signed-in') signedInToCloud()
      else {
        const attempt = outcome.status === 'code' ? 'done' : 'pending'
        setStage(current => afterCheck(current, attempt, Date.now()))
      }
    } catch {
      // Offline, or the doorman is busy. The next look will say.
    }
  }, [signedInToCloud])

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
        if (outcome.status === 'signed-in') signedInToCloud()
        else setStage({ kind: 'idle', message: 'Google hasn’t finished yet. Try again.' })
      } catch (error) {
        // A refused code ends the attempt: the doorman spends it either way.
        setStage({
          kind: 'idle',
          message:
            error instanceof DoormanError && error.code === 'wrong_code'
              ? 'That sign-in didn’t go through. Try again.'
              : signInFailure(error, pageOrigin()),
        })
      }
    },
    [signedInToCloud],
  )

  /**
   * Coming back from Google.
   *
   * The doorman sends the browser back to `selfmp3://welcome#signin-code=…` —
   * this site's own `/welcome` on the web — and `ports/signInReturn` keeps the
   * code until this page is listening, whether the link launched the app or
   * arrived while it was open.
   */
  useEffect(
    () =>
      onSignInCode('welcome', code => {
        // Said before the claim starts, not after: the poll is also running, and
        // it learns "finished" from the doorman a moment earlier.
        setStage({ kind: 'claiming' })
        void claimWith(code)
      }),
    [claimWith],
  )

  const copy = copyFor(stage)
  const busy = stage.kind === 'waiting' || stage.kind === 'claiming'
  const art = kept === null ? null : welcomeArt(kept)
  const device = deviceWord({ wide, finePointer })
  // Two halves on a wide screen. An iPad in portrait is barely past the
  // breakpoint, so the text half's margin and the button give way there.
  const margin = width >= ROOMY ? 96 : 48
  const pill = Math.min(320, width / 2 - margin * 2)

  const words = (
    <View style={styles.words}>
      <View style={styles.brand}>
        <BrandMark size={22} />
        <Text style={styles.brandName}>self.mp3</Text>
      </View>
      <Text style={[styles.headline, wide && styles.headlineWide]} accessibilityRole="header">
        {copy.lead}
        {'\n'}
        {copy.rest}
        <Text style={styles.mark}>{copy.mark}</Text>
      </Text>
      {copy.body ? <Text style={[styles.body, wide && styles.bodyWide]}>{copy.body}</Text> : null}
      {busy ? <ActivityIndicator color={theme.colors.accent} style={styles.spinner} /> : null}
    </View>
  )

  const actions =
    stage.kind === 'claiming' ? null : (
      <View style={styles.actions}>
        {stage.kind === 'idle' && stage.message ? (
          <Text style={styles.error}>{stage.message}</Text>
        ) : null}
        {stage.kind === 'idle' || stage.kind === 'lost' ? (
          <WhitePill
            testID="welcome-google"
            label={stage.kind === 'idle' ? 'Continue with Google' : 'Try again'}
            google={stage.kind === 'idle'}
            width={wide ? pill : undefined}
            onPress={begin}
          />
        ) : (
          <Button label="Open Google again" onPress={begin} />
        )}
        {stage.kind === 'idle' ? (
          <Text style={[styles.footnote, wide && styles.footnoteWide]}>
            {welcomeFootnote(device)}
          </Text>
        ) : (
          <Button label="Cancel" onPress={() => setStage({ kind: 'idle', message: null })} />
        )}
        {/* The simulator tests' way in; a normal build has none. */}
        {__DEV__ && stage.kind === 'idle' ? <ServerAddress centred={!wide} /> : null}
      </View>
    )

  if (wide) {
    return (
      <SafeAreaView style={styles.screen}>
        <KeyboardAvoidingView style={styles.halves} behavior={keyboardAvoidBehavior}>
          <View style={styles.artHalf}>
            {art ? <Art art={art} ground={theme.colors.surface0} wide /> : null}
          </View>
          <ScrollView
            style={styles.screen}
            contentContainerStyle={[styles.textHalf, { paddingHorizontal: margin }]}
            keyboardShouldPersistTaps="handled"
          >
            {words}
            {actions}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    )
  }

  return (
    <View style={styles.screen}>
      {art?.kind === 'covers' ? (
        <CoverLight color={theme.colors.surface0} art={art.backdrop} blur={40} />
      ) : null}
      <SafeAreaView style={styles.clear}>
        <KeyboardAvoidingView style={styles.clear} behavior={keyboardAvoidBehavior}>
          <ScrollView contentContainerStyle={styles.narrow} keyboardShouldPersistTaps="handled">
            {art ? <Art art={art} ground={theme.colors.surface0} wide={false} /> : null}
            {words}
            {actions}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  )
}

/** Above the words: the invented tiles, or the covers this device kept. */
function Art({
  art,
  ground,
  wide,
}: {
  art: WelcomeArt
  /** The page's ground, for the cover light to fade into. */
  ground: string
  wide: boolean
}): ReactNode {
  if (art.kind === 'tiles') {
    return (
      <View style={[styles.tiles, wide && styles.tilesWide]} aria-hidden>
        {art.tiles.map(tile => (
          <Tile key={tile.name} tile={tile} wide={wide} />
        ))}
      </View>
    )
  }
  const size = wide ? 170 : 92
  const fan = (
    <View style={[styles.fan, wide && styles.fanWide]} aria-hidden>
      {art.fan.map((uri, index) => {
        const pose = FAN_POSES[index] ?? { tilt: 0, lift: 0 }
        const shape = { width: size, height: size, borderRadius: wide ? 26 : radius.card }
        // The shadow and the lie on a view around the picture: an image casts
        // no shadow of its own on every platform.
        return (
          <View
            key={uri}
            style={[
              styles.fanCover,
              shape,
              {
                transform: [
                  { rotate: `${pose.tilt}deg` },
                  { translateY: pose.lift * (wide ? 2 : 1) },
                ],
              },
            ]}
          >
            <Image source={{ uri }} resizeMode="cover" style={shape} />
          </View>
        )
      })}
    </View>
  )
  if (!wide) return fan
  // On a computer the covers get a half of the window, lit by the backdrop.
  return (
    <View style={styles.coversHalf}>
      <CoverLight color={ground} art={art.backdrop} blur={36} />
      {fan}
    </View>
  )
}

/** An invented tag, drawn as Home's tiles are: the tag's own fill and ink. */
function Tile({ tile, wide }: { tile: WelcomeTile; wide: boolean }): ReactNode {
  const colours = tagColors(tile.hue)
  return (
    <View
      style={[
        styles.tile,
        wide && styles.tileWide,
        {
          backgroundColor: colours.tile,
          transform: [{ rotate: `${tile.tilt}deg` }, { translateY: tile.lift }],
        },
      ]}
    >
      <Text style={[styles.tileName, { color: colours.tileInk }]} numberOfLines={1}>
        {tile.name}
      </Text>
      {/* Where a real tile has its songs, three small squares of the tile's ink. */}
      <View style={styles.tileSquares}>
        {[0.28, 0.18, 0.1].map(opacity => (
          <View
            key={opacity}
            style={[styles.tileSquare, { backgroundColor: colours.tileInk, opacity }]}
          />
        ))}
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  clear: { flex: 1 },
  // The page sits at the foot of the display, where a thumb is (`P01`). The
  // Mac's traffic lights sit over the top of a narrow window; the mark is far
  // below them, but a page that scrolls up under them keeps clear anyway.
  narrow: {
    flexGrow: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 28,
    paddingTop: space.xl + titleBarInset,
    paddingBottom: 60,
    gap: 22,
  },
  halves: { flex: 1, flexDirection: 'row' },
  artHalf: { flex: 1, overflow: 'hidden' },
  textHalf: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 26,
  },
  words: { gap: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  brandName: sectionTitle(theme.colors),
  // A welcome, so the serif: one weight, never bolded.
  headline: { ...serif(theme.colors, 44), lineHeight: 44, letterSpacing: -0.6 },
  headlineWide: { fontSize: 60, lineHeight: 60, letterSpacing: -1 },
  mark: { fontFamily: fonts.serifItalic, color: theme.colors.accent },
  body: { color: theme.colors.textSecondary, fontSize: 16, lineHeight: 23 },
  bodyWide: { fontSize: 17, lineHeight: 26, maxWidth: 420 },
  spinner: { alignSelf: 'flex-start', marginTop: space.sm },
  actions: { gap: space.lg },
  error: { color: theme.colors.danger, fontSize: type.body },
  footnote: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    lineHeight: 17,
    textAlign: 'center',
  },
  footnoteWide: { fontSize: 13, lineHeight: 19, maxWidth: 420, textAlign: 'left' },
  tiles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 8,
    rowGap: 10,
    marginHorizontal: -20,
    marginBottom: 18,
  },
  // On a computer the tiles fill their half of the window, centred in it.
  tilesWide: {
    flex: 1,
    alignContent: 'center',
    columnGap: 14,
    rowGap: 18,
    // Narrow enough that an iPad's half still takes two tiles abreast.
    marginHorizontal: 24,
    marginBottom: 0,
  },
  tile: {
    width: 118,
    height: 84,
    borderRadius: radius.card,
    padding: 12,
    justifyContent: 'space-between',
    ...floating(theme.colors),
  },
  tileWide: { width: 170, height: 120, padding: 16 },
  tileName: { fontFamily: fonts.display, fontSize: 18, letterSpacing: -0.2 },
  tileSquares: { flexDirection: 'row', gap: 3 },
  tileSquare: { width: 16, height: 16, borderRadius: 4 },
  fan: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  fanWide: { gap: 18, marginBottom: 0 },
  fanCover: floating(theme.colors),
  coversHalf: { flex: 1, alignItems: 'center', justifyContent: 'center' },
}))
