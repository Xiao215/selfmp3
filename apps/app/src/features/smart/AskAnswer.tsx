import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { plural, type AskAnswer as Answer } from '@selfmp3/shared'
import { failureText, radius, space, useLibrary } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Play, Sparkle } from '../../ui/components/Icons'
import { placePath, rangeWords } from './smart.model'
import { LibraryAnswer } from './LibraryAnswer'
import { PlaylistSongsAnswer } from './PlaylistSongsAnswer'
import { PlaylistsAnswer } from './PlaylistsAnswer'
import { SongsAnswerCard } from './SongsAnswerCard'
import { TagsReview } from './TagsReview'
import { TidyReview } from './TidyReview'
import type { AnswerKeys } from './answerKeys'
import { Working } from './Working'
import { newTicket, useAskProgress } from './useAskProgress'
import { useSmartServer } from './useSmartServer'

/**
 * The answer to an Ask in the Search box (S1, docs/features/ai.md), drawn in
 * place of the results. One request, one answer you act on: every answer is a
 * proposal with its own button, and nothing changes until it is pressed.
 */
export function AskAnswer({
  text,
  onDone,
  onOpenPage = onDone,
  listHeight = 300,
  onKeys,
  onAsk,
}: {
  text: string
  onDone: () => void
  /** Asks something else in the same box: a dead end's suggestions. */
  onAsk?: (text: string) => void
  /**
   * Before an answer opens as a page of its own. Search's page stays under it,
   * so Back finds the question; the palette closes, as it does for any page.
   */
  onOpenPage?: () => void
  /** How tall a long answer's list may grow before it scrolls. */
  listHeight?: number
  /** For an answer that takes keys while the box keeps the focus (Tidy up's, the tags'). */
  onKeys?: (keys: AnswerKeys | null) => void
}): ReactNode {
  const server = useSmartServer()
  const player = usePlayer()
  // What "this" meant when it was asked (A8): the song playing then, not whichever comes next.
  const [playingHere] = useState(() => player.current?.id ?? null)
  const playing = playingHere === null ? null : (server.onServer(playingHere) ?? null)
  const via = server.reach.state === 'reachable' ? server.reach.connection.baseUrl : null
  // Names this asking, so how it is going can be asked after while it runs.
  // `text` is why a new one is made: each new question is a new request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ticket = useMemo(() => newTicket(), [text])
  const answer = useQuery({
    queryKey: ['via-server', via, 'ai', 'ask', text, playing],
    queryFn: () => server.api!.ask(text, playing, ticket),
    enabled: server.api !== null,
    retry: false,
    staleTime: 10 * 60_000,
  })
  const live = useAskProgress(ticket, answer.isPending)

  if (server.reach.state !== 'reachable') {
    return <ServerAway reach={server.reach} need="ai" testID="ask-server" />
  }
  if (answer.isPending) {
    return (
      <View style={styles.body}>
        <Working
          steps={[
            { doing: 'Reading what you asked', done: 'Read what you asked' },
            { doing: 'Working on the answer', after: 3000 },
          ]}
          live={live}
          testID="ask-waiting"
        />
      </View>
    )
  }
  if (answer.error) {
    return (
      <View style={styles.body}>
        <Text style={styles.error}>{failureText('Couldn’t answer that', answer.error)}</Text>
        <View style={styles.actions}>
          <Button label="Try again" onPress={() => void answer.refetch()} />
        </View>
      </View>
    )
  }
  return (
    <View style={styles.body} testID={`ask-answer-${answer.data.kind}`}>
      <Drawn
        answer={answer.data}
        text={text}
        onDone={onDone}
        onOpenPage={onOpenPage}
        listHeight={listHeight}
        onKeys={onKeys}
        onAsk={onAsk}
      />
    </View>
  )
}

function Drawn({
  answer,
  text,
  onDone,
  onOpenPage,
  listHeight,
  onKeys,
  onAsk,
}: {
  answer: Answer
  text: string
  onDone: () => void
  onOpenPage: () => void
  listHeight: number
  onKeys?: (keys: AnswerKeys | null) => void
  onAsk?: (text: string) => void
}): ReactNode {
  const router = useRouter()
  switch (answer.kind) {
    case 'songs':
      return <SongsAnswerCard answer={answer} text={text} onPlayed={onDone} onOpen={onOpenPage} />
    case 'find':
      return <Found answer={answer} onDone={onDone} />
    case 'tags':
      return (
        <TagsReview review={answer.review} height={listHeight} onClose={onDone} onKeys={onKeys} />
      )
    case 'tidy':
      return (
        <TidyReview result={answer.tidy} height={listHeight} onClose={onDone} onKeys={onKeys} />
      )
    case 'playlists':
      return <PlaylistsAnswer answer={answer} onDone={onDone} />
    case 'playlistSongs':
      return (
        <PlaylistSongsAnswer answer={answer} height={listHeight} onDone={onDone} onKeys={onKeys} />
      )
    case 'library':
      return <LibraryAnswer answer={answer} height={listHeight} onDone={onDone} />
    case 'stats':
      return (
        <>
          <Text style={styles.head}>
            {plural(answer.plays, 'play', 'plays')} · {Math.round(answer.minutes)} min in{' '}
            {rangeWords(answer.range)}
          </Text>
          {answer.items.map((item, index) => (
            <Text key={item.label} style={styles.line} numberOfLines={1}>
              {index + 1}. {item.label}
              <Text style={styles.muted}> · {plural(item.plays, 'play', 'plays')}</Text>
            </Text>
          ))}
          <View style={styles.actions}>
            <Button
              label="Open Stats"
              onPress={() => {
                onDone()
                router.navigate('/stats')
              }}
            />
          </View>
        </>
      )
    case 'open':
      return (
        <>
          <Text style={styles.line}>{answer.say}</Text>
          <View style={styles.actions}>
            <Button
              label={`Open ${answer.place[0]!.toUpperCase()}${answer.place.slice(1)}`}
              onPress={() => {
                onDone()
                router.navigate(placePath(answer.place))
              }}
            />
          </View>
        </>
      )
    case 'none':
      return (
        <>
          <Text style={styles.line}>{answer.say}</Text>
          {onAsk && answer.try.length > 0 ? (
            <View style={styles.tries}>
              <Text style={styles.muted}>Try</Text>
              {answer.try.map(each => (
                <Pressable
                  key={each}
                  onPress={() => onAsk(each)}
                  accessibilityRole="button"
                  accessibilityLabel={`Ask: ${each}`}
                  style={({ pressed }) => [styles.try, pressed && styles.pressed]}
                  testID="ask-try"
                >
                  <Sparkle size={13} />
                  <Text style={styles.tryText} numberOfLines={2}>
                    {each}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </>
      )
  }
}

/** A half-remembered song: the few that fit, best first. Pressing one plays them from it. */
function Found({
  answer,
  onDone,
}: {
  answer: Extract<Answer, { kind: 'find' }>
  onDone: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const server = useSmartServer()
  const player = usePlayer()
  const { data: library } = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)
  const songsById = new Map((library?.songs ?? []).map(song => [song.id, song]))
  const found = answer.picks.flatMap(pick => {
    const id = server.onDevice(pick.songId)
    const song = id === undefined ? undefined : songsById.get(id)
    return song ? [{ song, why: pick.why }] : []
  })
  if (found.length === 0) {
    return <Text style={styles.line}>No song of yours fits that. Try other words for it.</Text>
  }
  const ids = found.map(each => each.song.id)
  return (
    <>
      <Text style={styles.head}>{found.length === 1 ? 'Found one' : `Found ${found.length}`}</Text>
      {found.map(({ song, why }, index) => (
        <Pressable
          key={song.id}
          onPress={() => {
            player.playFrom(ids, index, {
              source: { kind: 'songs', origin: 'found', name: 'Search' },
            })
            onDone()
          }}
          accessibilityRole="button"
          accessibilityLabel={`Play ${song.title}`}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <Cover uri={artFor(song)} title={song.album || song.title} size={36} />
          <View style={styles.text}>
            <Text style={styles.title} numberOfLines={1}>
              {song.title}
              <Text style={styles.muted}> · {song.artist || 'Unknown artist'}</Text>
            </Text>
            <Text style={styles.why} numberOfLines={1}>
              {why ?? ''}
            </Text>
          </View>
          <Play size={14} color={theme.colors.textSecondary} />
        </Pressable>
      ))}
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.sm, paddingHorizontal: space.md, paddingVertical: space.sm },
  head: { color: theme.colors.textPrimary, fontSize: 15.5, fontWeight: '600' },
  line: { color: theme.colors.textSecondary, fontSize: 13.5, lineHeight: 19 },
  muted: { color: theme.colors.textMuted, fontSize: 12.5, fontWeight: '400' },
  error: { color: theme.colors.danger, fontSize: 12.5 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
    paddingHorizontal: space.xs,
    borderRadius: radius.coverSm,
  },
  text: { flex: 1, minWidth: 0 },
  title: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  why: { color: theme.colors.textMuted, fontSize: 11.5 },
  tries: { gap: 6, marginTop: space.xs },
  try: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  tryText: { flexShrink: 1, color: theme.colors.textPrimary, fontSize: 13 },
  pressed: { opacity: 0.6 },
}))
