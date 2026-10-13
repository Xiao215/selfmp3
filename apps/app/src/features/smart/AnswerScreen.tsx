import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { formatLongDuration, plural, type Understanding } from '@selfmp3/shared'
import {
  ApiError,
  failureText,
  type,
  useCreatePlaylist,
  useLibrary,
  textStyle,
  tracking,
  iconSize,
} from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayerCommands } from '../../player/PlayerProvider'
import { useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { ListHead, listHeadText } from '../../ui/components/ListHead'
import { ListMusic, Sparkle } from '../../ui/components/Icons'
import { MoreMenu } from '../../ui/components/MoreMenu'
import { PlayShuffle } from '../../ui/components/PlayShuffle'
import { BackButton } from '../../ui/components/BackButton'
import { MissingPage } from '../../ui/components/MissingPage'
import { OrderedSongList } from '../../ui/components/OrderedSongList'
import { useListActions } from '../../ui/components/useListActions'
import { useListSelectionBar } from '../../ui/components/useListSelectionBar'
import { showToast } from '../../ui/toast'
import { useSongsById } from '../../ui/songsById'
import { useSongColor } from '../../ui/useSongColor'
import type { ListSource } from '../lists/lists.model'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { newPlaylist } from '../playlists/playlists.model'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { changeAnswer, reorderAnswer, useKeptAnswer } from './answers.store'
import { ChangeIt } from './ChangeIt'
import { answerSongs, describeNotes, parts } from './smart.model'
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
 * What it understood is shown as chips; taking one away and pressing
 * Different songs picks again from what is left.
 */
export function AnswerScreen(): ReactNode {
  const router = useRouter()
  const { wide } = useLayout()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const kept = useKeptAnswer(id)
  const server = useSmartServer()
  const player = usePlayerCommands()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const { data: library } = useLibrary()
  const byId = useSongsById()
  const artFor = useArt()
  const [edited, setEdited] = useState<Understanding | null>(null)
  const [saving, setSaving] = useState(false)
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
  const listActions = useListActions(ids, { heroRef, selection })
  // Always mounted, told when to show (as on a tag's page).
  const bar = useListSelectionBar({ songs, selection, scope: 'in this answer', wide })
  const lead = useMemo(() => songs.find(song => song.hasArt) ?? songs[0] ?? null, [songs])
  const light = useSongColor(lead, lead ? artFor(lead) : null)

  const again = useMutation({
    mutationFn: (understanding: Understanding) => {
      if (!server.api || !kept) throw new ApiError(0, 'no server to ask', 'offline')
      // The songs shown, as the server knows them, stay out while others fit.
      const shown = ids.flatMap(each => {
        const serverId = server.onServer(each)
        return serverId === undefined ? [] : [serverId]
      })
      return server.api.describePlaylist({ text: kept.text, understanding, avoid: shown })
    },
    onSuccess: answer => {
      if (kept) changeAnswer(kept.id, 'Different songs', answer)
      setEdited(null)
    },
  })

  if (!kept || !result) {
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
  const notes = edited
    ? ['Changed. Different songs picks from what these let in.']
    : describeNotes(result, ids.length).slice(1)

  const save = async (): Promise<void> => {
    const input = newPlaylist('manual', result.understanding.name)
    if (!input || ids.length === 0 || saving) return
    setSaving(true)
    try {
      const created = await createPlaylist({ input, songIds: ids })
      showToast(`Saved “${created.name}”`, 'good', {
        actions: [
          {
            label: 'Open',
            onPress: () =>
              router.navigate({ pathname: '/playlists/[id]', params: { id: String(created.id) } }),
          },
        ],
      })
    } catch (caught) {
      showToast(failureText(`Couldn’t save “${input.name}”`, caught), 'error')
    } finally {
      setSaving(false)
    }
  }

  const head = (
    <ListHead
      wide={wide}
      light={light.color}
      art={null}
      topBar={
        <>
          <BackButton to="/search" always />
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
                icon: <ListMusic size={iconSize.item} tone="textSecondary" />,
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
          <View style={listHeadText.kind}>
            <Sparkle size={iconSize.tiny} />
            <Text style={listHeadText.kindText}>Picked for you</Text>
          </View>
          <Text
            style={[listHeadText.name, result.understanding.name.length > 24 && styles.nameLong]}
            numberOfLines={2}
            accessibilityRole="header"
            testID="answer-name"
          >
            {result.understanding.name}
          </Text>
          <Text style={listHeadText.summary}>
            {plural(ids.length, 'song', 'songs')}
            {ids.length > 0 ? ` · ${formatLongDuration(seconds)}` : ''}
            {result.fit > ids.length ? ` · picked from ${result.fit} that fit` : ''}
          </Text>
          <View style={styles.chips}>
            {parts(understanding, tags).map(part => {
              const takeAway = (): void => setEdited(part.without(understanding))
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
          <PlayShuffle
            name={`the songs picked for “${kept.text}”`}
            songIds={ids}
            // Changed and not yet picked again: what is shown is not the answer.
            disabled={edited !== null}
            heroRef={heroRef}
            onPlay={() => player.playFrom(ids, 0, { source })}
            onShuffle={() => player.playShuffled(ids, source)}
            testPrefix="answer"
          />
          <Button
            label="Different songs"
            disabled={!server.api}
            busy={again.isPending}
            onPress={() => again.mutate(understanding)}
            testID="answer-again"
          />
        </>
      }
      // The page is the version showing: no trail of the ones before it.
      after={<ChangeIt answerId={kept.id} trail={false} large />}
      wideOverrides={WIDE}
    />
  )

  return (
    <View style={styles.screen} testID="answer-page">
      {bar.beforeList}
      <View style={[styles.listArea, edited && styles.stale]}>
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

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  listArea: { flex: 1, minHeight: 0 },
  stale: { opacity: 0.55 },
  // Words asked run longer than a tag's name: smaller, so three lines still hold them.
  nameLong: { ...textStyle('page'), letterSpacing: tracking.page },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  note: { color: theme.colors.textMuted, fontSize: type.small },
}))
