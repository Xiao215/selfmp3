import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatLongDuration, plural, type Understanding } from '@selfmp3/shared'
import { clientApi, failureText, fonts, queryKeys, radius, useLibrary } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useSelection } from '../../selection/useSelection'
import { useLayout } from '../../shell/useLayout'
import { Button, PlayButton } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { CoverLight } from '../../ui/components/CoverLight'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronLeft, More, Play, Shuffle, Sparkle } from '../../ui/components/Icons'
import { OrderedSongList } from '../../ui/components/OrderedSongList'
import { Popover } from '../../ui/components/Popover'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SELECTION_BAR_SPACE, SelectionBar } from '../../ui/components/SelectionBar'
import { SheetItem } from '../../ui/components/Sheet'
import { showToast } from '../../ui/toast'
import { artShadow, label as labelText, serif } from '../../ui/surfaces'
import { useSongColor } from '../../ui/useSongColor'
import type { ListSource } from '../lists/lists.model'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { newPlaylist } from '../playlists/playlists.model'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { reorderAnswer, replaceAnswer, useKeptAnswer } from './answers.store'
import { describeNotes, parts, picksHere } from './smart.model'
import { useSmartServer } from './useSmartServer'

/**
 * An answer to Ask as a page of its own, `/answer?id=…` (docs/features/lists.md,
 * C1). A list of songs like any other: the head a tag's or a playlist's page
 * has, lit by its covers, and the same rows a playlist draws
 * (`OrderedSongList`) — select them, hold one to move it, its ⋯ for the song.
 * Nothing here is a row of its own.
 *
 * The head is Play, Shuffle and Different songs; the ⋯ holds Add to Up next
 * and Save as playlist, for an answer you already trust. Otherwise nothing
 * asks you to keep it before you have heard it: played, it is Up next by the
 * name of your question, and Save is there. The order you put it in is the
 * order it plays and saves in, for as long as the app is open.
 *
 * What it understood is shown as chips; taking one away and pressing
 * Different songs picks again from what is left.
 */
export function AnswerScreen(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide } = useLayout()
  const { top } = useSafeAreaInsets()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const kept = useKeptAnswer(id)
  const server = useSmartServer()
  const player = usePlayer()
  const queryClient = useQueryClient()
  const { data: library } = useLibrary()
  const artFor = useArt()
  const [edited, setEdited] = useState<Understanding | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const moreRef = useRef<View>(null)
  const heroRef = useRef<View>(null)
  const fly = useFlyToUpNext()

  const result = kept?.result
  const songs = useMemo(() => {
    if (!result) return []
    const byId = new Map((library?.songs ?? []).map(song => [song.id, song]))
    const picked = picksHere(result, server.onDevice).flatMap(pick => byId.get(pick.songId) ?? [])
    const order = kept?.order
    if (!order) return picked
    // The order you put it in, with anything it did not cover after.
    const place = new Map(order.map((songId, index) => [songId, index]))
    return [...picked].sort(
      (a, b) => (place.get(a.id) ?? order.length) - (place.get(b.id) ?? order.length),
    )
  }, [result, kept?.order, library, server.onDevice])
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const selection = useSelection(ids)
  const selectedSongs = useMemo(
    () => songs.filter(song => selection.has(song.id)),
    [songs, selection],
  )
  const lead = useMemo(() => songs.find(song => song.hasArt) ?? songs[0] ?? null, [songs])
  const light = useSongColor(lead, lead ? artFor(lead) : null)

  const again = useMutation({
    mutationFn: (understanding: Understanding) => {
      if (!server.api || !kept) throw new Error('your server isn’t reachable')
      // The songs shown, as the server knows them, stay out while others fit.
      const shown = ids.flatMap(each => {
        const serverId = server.onServer(each)
        return serverId === undefined ? [] : [serverId]
      })
      return server.api.describePlaylist({ text: kept.text, understanding, avoid: shown })
    },
    onSuccess: answer => {
      if (kept) replaceAnswer(kept.id, answer)
      setEdited(null)
    },
  })

  const back = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/search')
  }

  if (!kept || !result) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.gone} testID="answer-gone">
          <Text style={styles.goneTitle} accessibilityRole="header">
            This answer is gone
          </Text>
          <Text style={styles.goneText}>
            Answers are kept while the app is open. Ask again and it will pick again.
          </Text>
          <Button label="Search" onPress={() => router.replace('/search')} />
        </View>
      </SafeAreaView>
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
    setMenuOpen(false)
    const input = newPlaylist('manual', result.understanding.name)
    if (!input || ids.length === 0 || saving) return
    setSaving(true)
    try {
      const created = await clientApi().createPlaylist(input)
      await clientApi().addToPlaylist(created.id, { songIds: ids })
      void queryClient.invalidateQueries({ queryKey: queryKeys.library })
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
    <View style={[styles.head, wide && styles.headWide, { paddingTop: top + 8 }]}>
      <CoverLight color={light.color} art={null} />
      <View style={styles.topBar}>
        <IconButton label="Back" onPress={back} filled>
          <ChevronLeft size={20} tone="textPrimary" />
        </IconButton>
        <View ref={moreRef} collapsable={false}>
          <IconButton
            label="More for this answer"
            onPress={() => setMenuOpen(true)}
            filled
            testID="answer-more"
          >
            <More size={18} tone="textPrimary" />
          </IconButton>
        </View>
      </View>

      <View ref={heroRef} collapsable={false} style={[styles.hero, wide && styles.heroWide]}>
        <View style={styles.mosaic}>
          <PlaylistCover songIds={ids} size={wide ? 176 : 196} />
        </View>
        <View style={[styles.titles, wide && styles.titlesWide]}>
          <View style={styles.kind}>
            <Sparkle size={11} />
            <Text style={styles.kindText}>You asked</Text>
          </View>
          <Text
            style={[styles.name, kept.text.length > 24 && styles.nameLong]}
            numberOfLines={3}
            accessibilityRole="header"
            testID="answer-question"
          >
            {kept.text}
          </Text>
          <Text style={styles.summary}>
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
            <Text style={styles.error}>{failureText('Couldn’t pick again', again.error)}</Text>
          ) : null}
        </View>
        <View style={[styles.actions, wide && styles.actionsWide]}>
          <PlayButton
            label={`Play the songs picked for “${kept.text}”`}
            icon={<Play size={24} color={theme.colors.onPrimary} />}
            disabled={ids.length === 0 || edited !== null}
            onPress={() => play(0)}
            testID="answer-play"
          />
          <Button
            accessibilityLabel="Shuffle"
            icon={<Shuffle size={16} tone="textPrimary" />}
            disabled={ids.length === 0 || edited !== null}
            onPress={() => {
              fly(heroRef.current, ids)
              player.playShuffled(ids, source)
            }}
          />
          <Button
            label="Different songs"
            disabled={!server.api}
            busy={again.isPending}
            onPress={() => again.mutate(understanding)}
            testID="answer-again"
          />
        </View>
      </View>
    </View>
  )

  // Always mounted, told when to show (as on a tag's page): in the list at the
  // head's foot on a computer, floating at the foot on a phone.
  const bar = (
    <SelectionBar
      shown={selection.active}
      songs={selectedSongs}
      total={songs.length}
      scope="in this answer"
      allSelected={selection.allSelected}
      onSelectAll={selection.selectAll}
      onDeselectAll={selection.clear}
      onDone={selection.clear}
      inline={wide}
    />
  )

  return (
    <View style={styles.screen} testID="answer-page">
      {wide ? null : bar}
      <View style={[styles.listArea, edited && styles.stale]}>
        <OrderedSongList
          songs={songs}
          label={`Songs picked for ${kept.text}`}
          selection={selection}
          onPlay={play}
          onReorder={order => reorderAnswer(kept.id, order)}
          header={head}
          pinned={wide ? bar : null}
          contentContainerStyle={
            selection.active && !wide ? { paddingBottom: SELECTION_BAR_SPACE } : undefined
          }
        />
      </View>

      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={moreRef}
        width={220}
        testID="answer-menu"
      >
        <SheetItem
          label="Add to Up next"
          disabled={ids.length === 0}
          onPress={() => {
            setMenuOpen(false)
            fly(heroRef.current, ids)
            player.playNext(ids)
          }}
        />
        <SheetItem
          label={saving ? 'Saving…' : 'Save as playlist'}
          disabled={ids.length === 0 || saving}
          onPress={() => void save()}
        />
      </Popover>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  listArea: { flex: 1, minHeight: 0 },
  stale: { opacity: 0.55 },
  // The tag page's head (`PlacePage`), so an answer reads as the same kind of page.
  head: { paddingHorizontal: 20, paddingBottom: 16, gap: 18, overflow: 'hidden' },
  headWide: { paddingHorizontal: 40, paddingTop: 16 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  hero: { gap: 16 },
  heroWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 28 },
  mosaic: {
    alignSelf: 'flex-start',
    ...artShadow(theme.colors),
    borderRadius: radius.card,
  },
  titles: { gap: 6, flexShrink: 1, minWidth: 0 },
  titlesWide: { flexGrow: 1, flexBasis: 260 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindText: labelText(theme.colors),
  name: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.8,
  },
  // Words asked run longer than a tag's name: smaller, so three lines still hold them.
  nameLong: { fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  summary: { color: theme.colors.textSecondary, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  note: { color: theme.colors.textMuted, fontSize: 12.5 },
  error: { color: theme.colors.danger, fontSize: 12.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsWide: { marginLeft: 'auto', paddingBottom: 6 },
  gone: { padding: 24, gap: 12, alignItems: 'flex-start' },
  goneTitle: { ...serif(theme.colors, 30) },
  goneText: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22 },
}))
