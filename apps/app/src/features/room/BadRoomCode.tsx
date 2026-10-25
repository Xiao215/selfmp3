import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- one field drawn as six boxes, which carry its focus ring themselves
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import {
  normalizeRoomCode,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  RoomCodeSchema,
} from '@selfmp3/shared'
import { fonts, radius, space, type } from '@selfmp3/client'
import { useLayoutValue } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { bodyText, pageFrame, pageTitle } from '../../ui/surfaces'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { People } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { SafeAreaView } from '../../ui/components/SafeAreaView'

/** What was typed, as far as it can be a code: letters and digits, six at most. */
function codeChars(input: string): string {
  return normalizeRoomCode(input)
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, ROOM_CODE_LENGTH)
}

/**
 * `/join/<code>` with a code that cannot be one (AK1): a dead end in the
 * middle of the page, as a gone link's and an unknown address's are — a
 * round picture, what is wrong, how a code looks — with the six boxes
 * filled with what came in, so a code mistyped by one letter is put right
 * here rather than asked for again. Join goes on once it is a code.
 *
 * A letter a code never uses (0, O, 1, I, L, U) is drawn in red, since that
 * is usually the one to fix.
 */
export function BadRoomCode({ given, back }: { given: string; back: boolean }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const wide = useLayoutValue(layout => layout.wide)
  const input = useRef<TextInput>(null)
  const [code, setCode] = useState(() => codeChars(given))
  const [focused, setFocused] = useState(false)
  const valid = RoomCodeSchema.safeParse(code).success

  const join = (): void => {
    if (!valid) return
    router.replace({ pathname: '/join/[code]', params: { code } })
  }

  const box = (index: number): ReactNode => {
    const char = code[index] ?? ''
    // Where the next letter goes, while the field has the focus.
    const next = focused && index === Math.min(code.length, ROOM_CODE_LENGTH - 1)
    return (
      <View key={index} style={[styles.box, next && { borderColor: accent.accent }]}>
        <Text style={[styles.char, char && !ROOM_CODE_ALPHABET.includes(char) && styles.misread]}>
          {char}
        </Text>
      </View>
    )
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <View style={[styles.page, pageFrame(wide)]} testID="bad-room-code">
        {back ? <BackButton to="/" /> : null}
        <View style={styles.middle}>
          <View style={styles.badge}>
            <People size={30} color={theme.colors.textMuted} />
          </View>
          <View style={styles.words}>
            <Text style={styles.title} accessibilityRole="header">
              That isn’t a room code
            </Text>
            <Text style={styles.line}>Codes are six letters and digits, like KQ7 482.</Text>
          </View>
          <Press
            feedback="dim"
            onPress={() => input.current?.focus()}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.boxes}
          >
            {[0, 1, 2].map(box)}
            <View style={styles.split} />
            {[3, 4, 5].map(box)}
            {/* The field itself, over the boxes and see-through: a tap lands
                in it, and typing, pasting and deleting are a field's own. */}
            <TextInput
              ref={input}
              value={code}
              onChangeText={next => setCode(codeChars(next))}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onSubmitEditing={join}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="join"
              maxLength={9}
              caretHidden
              selectionColor="transparent"
              accessibilityLabel="Room code"
              testID="bad-code-field"
              style={styles.input}
            />
          </Press>
          <Button
            label="Join"
            variant="primary"
            disabled={!valid}
            onPress={join}
            testID="bad-code-join"
          />
        </View>
      </View>
    </SafeAreaView>
  )
}

const BOX_WIDTH = 42
const BOX_HEIGHT = 52

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flex: 1 },
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    paddingBottom: space.xl,
  },
  badge: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface1,
  },
  words: { alignItems: 'center', gap: space.sm, maxWidth: 400 },
  title: { ...pageTitle(theme.colors), textAlign: 'center' },
  line: { ...bodyText(theme.colors), textAlign: 'center' },
  boxes: { flexDirection: 'row', alignItems: 'center', gap: space.tight, marginTop: space.xs },
  box: {
    width: BOX_WIDTH,
    height: BOX_HEIGHT,
    borderRadius: radius.field,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface2,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  split: { width: space.sm },
  char: { color: theme.colors.textPrimary, fontFamily: fonts.display, fontSize: type.large },
  misread: { color: theme.colors.danger },
  input: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0,
    color: 'transparent',
    fontSize: type.body,
    _web: { outlineStyle: 'none' },
  },
}))
