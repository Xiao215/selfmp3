import { useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the bar is its own field, the words and the wait drawn in one place
import { Animated, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useMutation } from '@tanstack/react-query'
import { failureText, motion, radius, space, type, iconSize } from '@selfmp3/client'
import {
  ASK_OBJECT_SONGS,
  ASK_TEXT_MAX,
  type AskTurnInput,
  type DescribeResult,
  type Understanding,
} from '@selfmp3/shared'
import { useAccent } from '../../ui/accent'
import { ChevronRight, Sparkle } from '../../ui/components/Icons'
import { useFade } from '../../ui/motion'
import { StopButton } from './StopButton'
import { IconButton } from '../../ui/components/IconButton'
import { changeAnswer, shownOnServer, understandingOf, useKeptAnswer } from './answers.store'
import { newTicket, useAskProgress } from './useAskProgress'
import { noServerToAsk } from '../../connection/via'
import { useSmartServer } from './useSmartServer'
import { StatusLine } from '../../ui/components/StatusLine'
import { Spinner } from '../../ui/components/Spinner'
import { NO_AUTOFILL } from '../../ui/noAutofill'

/**
 * "Change it" (docs/features/ai.md): an answer to Ask changed in your own
 * words — "10 首", "不要动漫的", "calmer" — rather than asked again from
 * nothing, under the head of the answer's own page. The words are asked as a
 * follow-up with the list on the screen, and the reply's list takes its place. In Ask itself the one
 * field changes a list while it wears the list's chip (B1, 2026-10-26).
 *
 * One quiet field. While the change is worked on, the field itself says what
 * is happening, in the same place, so nothing jumps; when it lands, the list
 * is the new one and the field is empty again, ready for the next. No
 * suggested changes: what to say is yours.
 */
export function ChangeIt({ answerId }: { answerId: string }): ReactNode {
  const server = useSmartServer()
  const answer = useKeptAnswer(answerId)
  const [said, setSaid] = useState('')
  const [ticket, setTicket] = useState<string | null>(null)
  // The change on its way, to be given up on: its request is dropped, and the server stops with it.
  const stopping = useRef<AbortController | null>(null)
  const input = useRef<TextInput>(null)

  const change = useMutation({
    mutationFn: async (words: string) => {
      if (!server.api || !answer) throw noServerToAsk()
      const name = newTicket()
      setTicket(name)
      const controller = new AbortController()
      stopping.current = controller
      // Asked as a follow-up about this list, on the screen: Ask keeps the songs that still fit.
      const reply = await server.api.ask(
        words,
        { playing: null, screen: CHANGED },
        name,
        [
          changedTurn(
            answer.text,
            understandingOf(answer),
            answer.result,
            shownOnServer(answer, server.onServer),
          ),
        ],
        controller.signal,
      )
      const songs = reply.cards.find(card => card.kind === 'songs')
      if (songs?.kind === 'songs') return songs.describe
      const said = reply.cards.flatMap(card =>
        card.kind === 'explore' ? [card.say] : card.kind === 'clarify' ? [card.question] : [],
      )
      throw new Error(
        [reply.say, ...said].filter(Boolean).join(' ') || 'That didn’t change the songs.',
      )
    },
    onSuccess: result => {
      changeAnswer(answerId, result)
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
      <ChangeField
        value={said}
        onChangeText={setSaid}
        onSend={send}
        onStop={stop}
        working={working}
        doing={doing}
        words={change.variables ?? ''}
        placeholder="Change these songs…"
        label="Change this answer"
        sendLabel="Change it"
        inputRef={input}
        testID="change-it"
      />
      {change.error ? (
        <StatusLine>{failureText('Couldn’t change it', change.error)}</StatusLine>
      ) : null}
    </View>
  )
}

/** The handle the list being changed goes as: the one turn before the change. */
const CHANGED = 't1.1'

/**
 * The list on the page as the turn a change follows: what was asked, and the
 * songs shown, by the server's ids in their order, with what the list was
 * made from, so the songs that still fit stay where they are.
 */
function changedTurn(
  asked: string,
  understanding: Understanding,
  result: DescribeResult,
  shown: readonly number[],
): AskTurnInput {
  const why = new Map(result.picks.map(pick => [pick.songId, pick.why]))
  const songIds = shown.slice(0, ASK_OBJECT_SONGS)
  return {
    asked: asked.slice(0, ASK_TEXT_MAX),
    answered: `Showed ${songIds.length} songs (“${understanding.name}”)`,
    objects: [
      {
        handle: CHANGED,
        kind: 'songs',
        label: understanding.name,
        songIds,
        why: songIds.map(id => (why.get(id) ?? null)?.slice(0, 140) ?? null),
        understanding,
      },
    ],
  }
}

/**
 * The field a change is said in: one line with a send button that appears
 * once there are words, and while the change is worked on, what is happening
 * in the same place, so nothing jumps; with `onStop`, the send button's place
 * holds a Stop while it does. Under the head of an answer's page.
 */
function ChangeField({
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
        focused && !working && { borderColor: accent.accent },
        working && styles.fieldWorking,
      ]}
    >
      <Animated.View style={[styles.layer, fieldStyle]} pointerEvents={working ? 'none' : 'auto'}>
        <Sparkle size={iconSize.button} />
        <TextInput
          {...NO_AUTOFILL}
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
          style={styles.input}
        />
        <Animated.View style={sendStyle} pointerEvents={value.trim() ? 'auto' : 'none'}>
          <IconButton
            label={sendLabel}
            filled="accent"
            size={36}
            onPress={onSend}
            testID={`${testID}-send`}
          >
            <ChevronRight size={iconSize.field} color={theme.colors.onPrimary} />
          </IconButton>
        </Animated.View>
      </Animated.View>
      <Animated.View
        style={[styles.layer, !onStop && styles.workLayer, workStyle]}
        pointerEvents={working ? 'box-none' : 'none'}
        accessibilityLiveRegion="polite"
        aria-hidden={!working}
      >
        <Spinner />
        <Text style={styles.doing} numberOfLines={1} testID={`${testID}-working`}>
          {working ? doing : ''}
        </Text>
        <Text style={styles.words} numberOfLines={1}>
          {working ? `“${words}”` : ''}
        </Text>
        {onStop ? (
          <View style={styles.stop}>
            <StopButton onPress={onStop} size={36} testID={`${testID}-stop`} />
          </View>
        ) : null}
      </Animated.View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm },
  field: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.surface3,
  },
  fieldWorking: { backgroundColor: theme.colors.surface2, borderColor: theme.colors.surface2 },
  layer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.snug,
    paddingLeft: 18,
    paddingRight: space.sm,
  },
  workLayer: { paddingRight: 18 },
  stop: { marginLeft: 'auto' },
  input: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    paddingVertical: space.sm,
  },
  doing: { color: theme.colors.textPrimary, fontSize: type.sub, fontWeight: '500', flexShrink: 0 },
  words: { color: theme.colors.textMuted, fontSize: type.sub, flexShrink: 1 },
}))
