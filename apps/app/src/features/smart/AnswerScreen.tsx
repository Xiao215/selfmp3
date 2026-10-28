import { useMemo, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { formatLongDuration, plural, type Understanding } from '@selfmp3/shared'
import { failureText, type, useLibrary, textStyle, tracking, space } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer, usePlayerCommands } from '../../player/PlayerProvider'
import { useSelection } from '../../selection/useSelection'
import { useLayoutFlags } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { ListHead, listHeadText } from '../../ui/components/ListHead'
import { ListMusic } from '../../ui/components/Icons'
import { MoreMenu } from '../../ui/components/MoreMenu'
import { PlayShuffle } from '../../ui/components/PlayShuffle'
import { BackButton } from '../../ui/components/BackButton'
import { MissingPage } from '../../ui/components/MissingPage'
import { OrderedSongList } from '../../ui/components/OrderedSongList'
import { useListActions } from '../../ui/components/useListActions'
import { useListSelectionBar } from '../../ui/components/useListSelectionBar'
import { useSongsById } from '../../ui/songsById'
import { useSongColor } from '../../ui/useSongColor'
import type { ListSource } from '../lists/lists.model'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { changeAnswer, editAnswer, reorderAnswer, useKeptAnswer } from './answers.store'
import { usePlayAsItComes, useSaveAnswer } from './useAnswerLead'
import { AskedLabel, AskedTitle } from './AskedTitle'
import { ChangeIt } from './ChangeIt'
import { answerSongs, describeNotes, parts } from './smart.model'
import { noServerToAsk } from '../../connection/via'
import { useSmartServer } from './useSmartServer'
import { StatusLine } from '../../ui/components/StatusLine'

/**
 * An answer to Ask as a page of its own, `/answer?id=…` (docs/features/lists.md,
 * C1). A list of songs like any other: the head a tag's or a playlist's page
 * has, lit by its covers, and the same rows a playlist draws
 * (`OrderedSongList`) — select them, hold one to move it, its ⋯ for the song.
 * Nothing here is a row of its own.
 *
 * The head is Play, Shuffle and Different songs; the ⋯ holds what every
 * list's does — Select songs, Play next, Add to Up next — and Save as playlist
 * for an answer you already trust.
 * Otherwise nothing asks you to keep it before you have heard it: played, it
 * is Up next by the name of your question, and Save is there. The order you
 * put it in is the order it plays and saves in, for as long as the app is open.
 *
 * What it understood is shown as chips; taking one away picks again at once
 * from what is left, where the songs shown that still fit can stay.
 */
export function AnswerScreen(): ReactNode {
  const { id } = useLocalSearchParams<{ id?: string }>()
  return <AnswerView id={id} />
}

/**
 * An answer's songs and head: its own page's, and Ask's stage when the answer
 * is a list (R1, 2026-10-26). On the stage the question is the title, in the
 * serif, and the list's own name joins the line under it; the corner holds
 * Ask's way back and what was said before, and Ask's field asks about the
 * list, so it has no Change it of its own.
 *
 * On the stage it does what the words led with ("Play now, rest proposes",
 * 2026-10-27): a list asked to play starts playing as it comes, once, as a
 * playback answer is carried out (`playNow`, the first such list of a
 * reply); a list asked to keep leads with one Save, as a playlist by its
 * name, of exactly the songs shown. Beside a reply's other cards it has no
 * title of its own: the cards stand under the question.
 */
export function AnswerView({
  id,
  asked,
  said,
  top,
  lead: ledWith,
  playNow = false,
}: {
  id: string | undefined
  /** On Ask's stage: what was asked, as the title; null beside a reply's cards, which carry it. */
  asked?: string | null
  /** On Ask's stage: the reply's own words, when it had some, under the title. */
  said?: string | null
  /** On Ask's stage: the way back and the trail, in the corner. */
  top?: ReactNode
  /** On Ask's stage: what the words asked for the list, to play it now or keep it. */
  lead?: 'play' | 'save'
  /** On Ask's stage: played as it comes. */
  playNow?: boolean
}): ReactNode {
  const router = useRouter()
  const { wide } = useLayoutFlags()
  const kept = useKeptAnswer(id)
  const server = useSmartServer()
  const player = usePlayerCommands()
  const { data: library } = useLibrary()
  const byId = useSongsById()
  const artFor = useArt()
  const heroRef = useRef<View>(null)
  const fly = useFlyToUpNext()

  const result = kept?.result
  const order = kept?.order ?? null
  const songs = useMemo(
    () => (result ? answerSongs(result, order, server.onDevice, byId) : []),
    [result, order, byId, server.onDevice],
  )
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const selection = useSelection(ids)
  // Add to Up next adds, as everywhere: it had played the answer next (T-383).
  const listActions = useListActions(ids, {
    heroRef,
    selection,
    togetherAs: result?.understanding.name ?? 'Ask',
  })
  // Always mounted, told when to show (as on a tag's page).
  const bar = useListSelectionBar({ songs, selection, scope: 'in this answer', wide })
  const lead = useMemo(() => songs.find(song => song.hasArt) ?? songs[0] ?? null, [songs])
  const light = useSongColor(lead, lead ? artFor(lead) : null)

  // The answer it was asked for goes with the request: the list beside Ask
  // can be another one by the time the new songs come.
  const again = useMutation({
    mutationFn: (asked: {
      answerId: string
      text: string
      understanding: Understanding
      avoid: number[]
    }) => {
      if (!server.api) throw noServerToAsk()
      return server.api.describePlaylist({
        text: asked.text,
        understanding: asked.understanding,
        avoid: asked.avoid,
      })
    },
    onSuccess: (answer, asked) => changeAnswer(asked.answerId, answer, asked.understanding),
  })

  usePlayAsItComes(kept?.id, ids, playNow)
  const { save, saving, saved } = useSaveAnswer(result, ids)

  if (!kept || !result) {
    if (asked !== undefined) return null
    return (
      <MissingPage
        testID="answer-gone"
        title="This answer is gone"
        line="Answers are kept while the app is open. Ask again and it will pick again."
        back="/search"
        action={{ label: 'Search', onPress: () => router.replace('/search') }}
      />
    )
  }

  const edited = kept.edited
  const understanding = edited ?? result.understanding
  const tags = library?.tags ?? []
  const seconds = songs.reduce((sum, song) => sum + song.duration, 0)
  const source: ListSource = {
    kind: 'answer',
    text: kept.text,
    name: result.understanding.name,
    answerId: kept.id,
  }
  const play = (index: number): void => {
    fly(heroRef.current, ids.slice(index))
    player.playFrom(ids, index, { source })
  }
  // A chip taken away picks again at once; until the songs come (or when they
  // could not), what is shown is still the old answer, and says so.
  const notes = edited
    ? [
        again.isPending
          ? 'Picking again from what these let in…'
          : 'Changed. Different songs picks from what these let in.',
      ]
    : describeNotes(result, ids.length, seconds).slice(1)

  const head = (
    <ListHead
      wide={wide}
      light={light.color}
      art={null}
      topBar={
        <>
          {top !== undefined ? (
            <View style={styles.top}>{top}</View>
          ) : (
            <BackButton to="/search" always />
          )}
          <MoreMenu
            name={result.understanding.name}
            title={result.understanding.name}
            testID="answer-more"
            menuTestID="answer-menu"
            items={[
              ...listActions,
              {
                key: 'save',
                label: saving ? 'Saving…' : 'Save as playlist',
                icon: <ListMusic tone="textSecondary" />,
                disabled: ids.length === 0 || saving,
                apart: true,
                onPress: () => void save(),
              },
            ]}
          />
        </>
      }
      heroRef={heroRef}
      cover={<PlaylistCover songIds={ids} size={wide ? 176 : 196} />}
      titles={
        <>
          {asked === null ? (
            // Beside a reply's cards: the cards carry the question, the list its name.
            <Text style={listHeadText.name} numberOfLines={2} testID="answer-name">
              {result.understanding.name}
            </Text>
          ) : asked !== undefined ? (
            <>
              <AskedLabel label="You asked" />
              <AskedTitle asked={asked} testID="answer-name" />
              {said ? <Text style={styles.said}>{said}</Text> : null}
            </>
          ) : (
            <>
              <AskedLabel label="Picked for you" />
              <Text
                style={[
                  listHeadText.name,
                  result.understanding.name.length > 24 && styles.nameLong,
                ]}
                numberOfLines={2}
                accessibilityRole="header"
                testID="answer-name"
              >
                {result.understanding.name}
              </Text>
            </>
          )}
          <Text style={listHeadText.summary}>
            {typeof asked === 'string' ? `${result.understanding.name} · ` : ''}
            {plural(ids.length, 'song', 'songs')}
            {ids.length > 0 ? ` · ${formatLongDuration(seconds)}` : ''}
            {result.fit > result.picks.length ? ` · picked from ${result.fit} that fit` : ''}
          </Text>
          <View style={styles.chips}>
            {parts(understanding, tags).map(part => {
              const takeAway = (): void => {
                const left = part.without(understanding)
                editAnswer(kept.id, left)
                // Nothing avoided: the songs shown that still fit may stay.
                if (server.api)
                  again.mutate({
                    answerId: kept.id,
                    text: kept.text,
                    understanding: left,
                    avoid: [],
                  })
              }
              return (
                <Chip
                  key={part.key}
                  compact
                  label={part.label}
                  hue={part.hue}
                  selected={false}
                  onPress={takeAway}
                  onRemove={takeAway}
                />
              )
            })}
          </View>
          {notes.map(note => (
            <Text key={note} style={styles.note}>
              {note}
            </Text>
          ))}
          {again.error ? (
            <StatusLine>{failureText('Couldn’t pick again', again.error)}</StatusLine>
          ) : null}
        </>
      }
      actions={
        <>
          <AnswerPlay
            name={`the songs picked for “${kept.text}”`}
            answerId={kept.id}
            songIds={ids}
            // Changed and not yet picked again: what is shown is not the answer.
            disabled={edited !== null}
            heroRef={heroRef}
            onPlay={() => player.playFrom(ids, 0, { source, whole: true })}
            onShuffle={() => player.playShuffled(ids, source)}
          />
          {ledWith === 'save' ? (
            <Button
              label={
                saved !== null
                  ? `Saved “${saved}”`
                  : saving
                    ? 'Saving…'
                    : `Save as “${result.understanding.name}”`
              }
              variant="primary"
              disabled={ids.length === 0 || saving || saved !== null}
              onPress={() => void save()}
              testID="answer-save"
            />
          ) : null}
          <Button
            label="Different songs"
            disabled={!server.api}
            busy={again.isPending}
            onPress={() =>
              again.mutate({
                answerId: kept.id,
                text: kept.text,
                understanding,
                // Every song picked stays out while others fit, shown here or not.
                avoid: result.picks.map(pick => pick.songId),
              })
            }
            testID="answer-again"
          />
        </>
      }
      after={asked !== undefined ? undefined : <ChangeIt answerId={kept.id} />}
      wideOverrides={WIDE}
    />
  )

  return (
    <View style={styles.screen} testID="answer-page">
      {bar.beforeList}
      <View style={styles.listArea}>
        <OrderedSongList
          songs={songs}
          label={`Songs picked for ${kept.text}`}
          selection={selection}
          onPlay={play}
          onReorder={order => reorderAnswer(kept.id, order)}
          header={head}
          pinned={bar.pinned}
          contentContainerStyle={bar.listPadding}
        />
      </View>
    </View>
  )
}

/** Words asked run longer than a tag's name, so the words take a little more of the row. */
const WIDE = { titles: { flexBasis: 260 } } as const

/**
 * The answer's Play and Shuffle, apart from the page so a play or a pause
 * draws them again and not the list. While Up next is this answer its Play
 * is a Pause, and a Play that goes on where it was.
 */
function AnswerPlay({
  name,
  answerId,
  songIds,
  disabled,
  heroRef,
  onPlay,
  onShuffle,
}: {
  name: string
  answerId: string
  songIds: readonly number[]
  disabled: boolean
  heroRef: RefObject<View | null>
  onPlay: () => void
  onShuffle: () => void
}): ReactNode {
  const player = usePlayer()
  const ours =
    player.current !== null &&
    player.source?.kind === 'answer' &&
    player.source.answerId === answerId
  return (
    <PlayShuffle
      name={name}
      songIds={songIds}
      disabled={disabled}
      playing={ours ? player.isPlaying : undefined}
      heroRef={heroRef}
      onPlay={ours ? player.toggle : onPlay}
      onShuffle={onShuffle}
      testPrefix="answer"
    />
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  // Ask's trail takes the corner's width, the ⋯ at its end.
  top: { flex: 1, minWidth: 0, marginRight: space.sm },
  listArea: { flex: 1, minHeight: 0 },
  // Words asked run longer than a tag's name: smaller, so three lines still hold them.
  nameLong: { ...textStyle('page'), letterSpacing: tracking.page },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.tight },
  note: { color: theme.colors.textMuted, fontSize: type.small },
  said: { color: theme.colors.textPrimary, ...textStyle('body') },
}))
