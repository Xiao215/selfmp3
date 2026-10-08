import { useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { ActivityIndicator, Animated, Pressable, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useMutation } from '@tanstack/react-query'
import { ApiError, failureText, motion, radius, space } from '@selfmp3/client'
import { useAccent } from '../../ui/accent'
import { ChevronRight, Sparkle } from '../../ui/components/Icons'
import { useArrival, useFade } from '../../ui/motion'
import { StopButton } from './StopButton'
import { changeAnswer, showAnswerStep, useKeptAnswer } from './answers.store'
import { newTicket, useAskProgress } from './useAskProgress'
import { useSmartServer } from './useSmartServer'

/**
 * "Change it" (docs/features/ai.md): an answer to Ask changed in your own
 * words — "10 首", "不要动漫的", "calmer" — rather than asked again from
 * nothing. Under the answer's card in Search and under its page's head.
 *
 * One quiet field. While the change is worked on, the field itself says what
 * is happening, in the same place, so nothing jumps; when it lands, the words
 * you typed join the trail above it and the field is empty again, ready for
 * the next. The trail is every version, its names pressable: back to an
 * earlier one, or forward again. No suggested changes: what to say is yours.
 */
export function ChangeIt({
  answerId,
  trail = true,
  large = false,
}: {
  answerId: string
  /** The versions before this one, pressable. Search shows them; the answer's page does not. */
  trail?: boolean
  /** The page's bar: the width of the head, and a size to match it. */
  large?: boolean
}): ReactNode {
  const server = useSmartServer()
  const answer = useKeptAnswer(answerId)
  const [said, setSaid] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  // The change on its way, to be given up on: its request is dropped, and the server stops with it.
  const stopping = useRef<AbortController | null>(null)
  const input = useRef<TextInput>(null)
  // How many versions there were when this was drawn, so only a new one arrives.
  const [stepsAtStart] = useState(() => answer?.steps.length ?? 1)

  const change = useMutation({
    mutationFn: async (words: string) => {
      if (!server.api || !answer) throw new ApiError(0, 'no server to ask', 'offline')
      const shown = (answer.order ?? answer.result.picks.map(pick => pick.songId)).flatMap(id => {
        // The order you set is in this device's ids; the picks are the server's.
        const serverId = answer.order ? server.onServer(id) : id
        return serverId === undefined ? [] : [serverId]
      })
      const name = newTicket()
      setTicket(name)
      const controller = new AbortController()
      stopping.current = controller
      return {
        words,
        result: await server.api.refineAnswer(
          {
            text: answer.text,
            understanding: answer.result.understanding,
            change: words,
            shown,
            ticket: name,
          },
          controller.signal,
        ),
      }
    },
    onSuccess: ({ words, result }) => {
      changeAnswer(answerId, words, result)
      setSaid('')
      // A browser takes the focus off a field on Enter; the next change is likely.
      input.current?.focus()
    },
  })
  const working = change.isPending
  const live = useAskProgress(ticket, working)
  // The stage running now, or the last one done while the next is on its way.
  const running = live ? [...live].reverse().find(step => !step.done) : undefined
  const doing =
    running?.text ?? (live && live.length > 0 ? 'Getting it ready' : 'Reading what to change')

  if (!answer) return null
  const send = (): void => {
    const words = said.trim()
    if (!words || working || !server.api) return
    change.mutate(words)
  }
  const stop = (): void => {
    stopping.current?.abort()
    setSaid(change.variables ?? '')
    change.reset()
    input.current?.focus()
  }

  return (
    <View style={styles.body} testID="change-it">
      {trail && answer.steps.length > 1 ? (
        <View style={styles.trail} accessibilityRole="list" accessibilityLabel="Versions">
          {answer.steps.map((step, index) => (
            <TrailStep
              key={index}
              first={index === 0}
              label={step.said ?? step.result.understanding.name}
              current={index === answer.at}
              later={index > answer.at}
              fresh={index >= stepsAtStart && index === answer.steps.length - 1}
              onPress={() => showAnswerStep(answerId, index)}
            />
          ))}
        </View>
      ) : null}

      <ChangeField
        value={said}
        onChangeText={setSaid}
        onSend={send}
        onStop={stop}
        working={working}
        doing={doing}
        words={change.variables ?? ''}
        placeholder={large ? 'Change these songs…' : 'Change it…'}
        label="Change this answer"
        sendLabel="Change it"
        large={large}
        inputRef={input}
        testID="change-it"
      />
      {change.error ? (
        <Text style={styles.error}>{failureText('Couldn’t change it', change.error)}</Text>
      ) : null}
    </View>
  )
}

/**
 * The field a change is said in: one line with a send button that appears
 * once there are words, and while the change is worked on, what is happening
 * in the same place, so nothing jumps; with `onStop`, the send button's place
 * holds a Stop while it does. "Change it" under a song answer and
 * the follow-up under every other answer (`AskAnswer`) are this field.
 */
export function ChangeField({
  value,
  onChangeText,
  onSend,
  onStop,
  working,
  doing,
  words,
  placeholder,
  label,
  sendLabel = 'Send',
  large = false,
  inputRef,
  testID,
}: {
  value: string
  onChangeText: (value: string) => void
  onSend: () => void
  /** Gives up on the change being worked on, its words back in the field. */
  onStop?: () => void
  working: boolean
  /** The stage running now, said while working. */
  doing: string
  /** The words being worked on, quoted after it. */
  words: string
  placeholder: string
  /** What a screen reader calls the field, and its send button. */
  label: string
  sendLabel?: string
  /** The page's bar: the width of the head, and a size to match it. */
  large?: boolean
  inputRef?: RefObject<TextInput | null>
  testID: string
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const [focused, setFocused] = useState(false)
  const fieldIn = useFade(!working, motion.base, motion.fast)
  const workIn = useFade(working, motion.base, motion.fast)
  const sendIn = useFade(value.trim().length > 0 && !working, motion.fast, motion.fast)
  const fieldStyle = useMemo(() => ({ opacity: fieldIn }), [fieldIn])
  const workStyle = useMemo(() => ({ opacity: workIn }), [workIn])
  const sendStyle = useMemo(
    () => ({
      opacity: sendIn,
      transform: [{ scale: sendIn.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
    }),
    [sendIn],
  )

  return (
    <View
      style={[
        styles.field,
        large && styles.fieldLarge,
        focused && !working && { borderColor: accent.accent },
        working && styles.fieldWorking,
      ]}
    >
      <Animated.View
        style={[styles.layer, large && styles.layerLarge, fieldStyle]}
        pointerEvents={working ? 'none' : 'auto'}
      >
        <Sparkle size={large ? 15 : 12} />
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSend}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={!working}
          placeholder={placeholder}
          placeholderTextColor={theme.colors.textMuted}
          returnKeyType="send"
          blurOnSubmit={false}
          accessibilityLabel={label}
          testID={`${testID}-input`}
          style={[styles.input, large && styles.inputLarge]}
        />
        <Animated.View style={sendStyle} pointerEvents={value.trim() ? 'auto' : 'none'}>
          <Pressable
            onPress={onSend}
            accessibilityRole="button"
            accessibilityLabel={sendLabel}
            style={({ pressed }) => [
              styles.send,
              large && styles.sendLarge,
              { backgroundColor: accent.accent },
              pressed && styles.pressed,
            ]}
            testID={`${testID}-send`}
          >
            <ChevronRight size={14} color={theme.colors.onPrimary} />
          </Pressable>
        </Animated.View>
      </Animated.View>
      <Animated.View
        style={[styles.layer, large && styles.layerLarge, !onStop && styles.workLayer, workStyle]}
        pointerEvents={working ? 'box-none' : 'none'}
        accessibilityLiveRegion="polite"
        aria-hidden={!working}
      >
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
        <Text style={styles.doing} numberOfLines={1} testID={`${testID}-working`}>
          {working ? doing : ''}
        </Text>
        <Text style={styles.words} numberOfLines={1}>
          {working ? `“${words}”` : ''}
        </Text>
        {onStop ? (
          <View style={styles.stop}>
            <StopButton onPress={onStop} size={large ? 36 : 28} testID={`${testID}-stop`} />
          </View>
        ) : null}
      </Animated.View>
    </View>
  )
}

/** One version in the trail: the answer's name first, then what each change said. */
export function TrailStep({
  first,
  label,
  current,
  later,
  fresh,
  onPress,
}: {
  first: boolean
  label: string
  current: boolean
  /** After the one showing: there to go forward to again. */
  later: boolean
  /** Just made: it arrives, the rest are simply there. */
  fresh: boolean
  onPress: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const arrival = useArrival(0, fresh)
  return (
    <Animated.View style={[styles.step, arrival]}>
      {first ? (
        <Sparkle size={11} color={theme.colors.textMuted} />
      ) : (
        <Text style={styles.arrow}>→</Text>
      )}
      <Pressable
        onPress={onPress}
        disabled={current}
        accessibilityRole="button"
        accessibilityState={{ selected: current }}
        accessibilityLabel={current ? `${label}, showing` : `Back to ${label}`}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text
          style={[styles.stepText, current && styles.stepCurrent, later && styles.stepLater]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  )
}

const FIELD_HEIGHT = 40

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  trail: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 6, rowGap: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%' },
  arrow: { color: theme.colors.textMuted, fontSize: 12 },
  stepText: { color: theme.colors.textMuted, fontSize: 12.5, maxWidth: 220 },
  stepCurrent: { color: theme.colors.textPrimary, fontWeight: '600' },
  stepLater: { opacity: 0.55 },
  field: {
    height: FIELD_HEIGHT,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
  },
  fieldLarge: {
    height: 52,
    backgroundColor: theme.colors.surface1,
    borderColor: theme.colors.surface3,
  },
  inputLarge: { fontSize: 15.5 },
  sendLarge: { width: 36, height: 36 },
  fieldWorking: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.surface2 },
  layer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: 14,
    paddingRight: 6,
  },
  layerLarge: { paddingLeft: 18, paddingRight: 8, gap: 10 },
  workLayer: { paddingRight: 18 },
  stop: { marginLeft: 'auto' },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: 14,
    paddingVertical: 8,
  },
  send: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doing: { color: theme.colors.textPrimary, fontSize: 13.5, fontWeight: '500', flexShrink: 0 },
  words: { color: theme.colors.textMuted, fontSize: 13, flexShrink: 1 },
  pressed: { opacity: 0.6 },
  error: { color: theme.colors.danger, fontSize: 12.5 },
}))
