import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useNavigation, useRouter } from 'expo-router'
import { TAG_NAME_MAX, type Song, type Tag } from '@selfmp3/shared'
import {
  isDownloaded,
  oklchToHexAlpha,
  radius,
  tempoMark,
  useCreateTag,
  useLibrary,
  useSetSongTags,
} from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { prefs } from '../../ports/prefs'
import { useEscape } from '../../shell/useEscape'
import { useHotkeys } from '../../shell/useHotkeys'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { EnergyWave } from '../../ui/components/EnergyWave'
import { Check, ChevronRight, Inbox, Play, Plus, X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SongList } from '../../ui/components/SongList'
import { SongRow, useSongRowHeight } from '../../ui/components/SongRow'
import { BackToYou } from '../../ui/components/BackToYou'
import { Toggle } from '../../ui/components/Toggle'
import { cameFrom } from '../playlistDetail/playlistDetail.model'
import { usePullToRefresh } from '../library/usePullToRefresh'
import {
  existingTag,
  inboxSubtitle,
  nextLabel,
  orderedTags,
  PLAY_ALONG_KEY,
  sessionSummary,
  tagForKey,
  tagOrder,
  toggled,
  untaggedSongs,
} from './inbox.model'

/**
 * Untagged songs, and a quick way through them.
 *
 * The list says how many there are; "Start tagging" goes through them one at a
 * time: the song plays, its tags are tapped (or picked with the number keys),
 * and it moves on.
 *
 * Nothing here asks a server. Which songs have no tag is a pass over the
 * library, and putting a tag on one is an edit every library takes — a cloud
 * library records it and uploads it like any other. It was hidden from a cloud
 * library along with the pages that genuinely do need the server, which was
 * simply wrong.
 */
export function InboxScreen(): ReactNode {
  const accent = useAccent()
  const router = useRouter()
  const navigation = useNavigation()
  const player = usePlayer()
  const artFor = useArt()
  const { wide } = useLayout()
  const { data: library, isLoading } = useLibrary()
  const pull = usePullToRefresh()
  const { state: downloads } = useDownloads()
  /** The songs being gone through, fixed when tagging starts. */
  const [session, setSession] = useState<readonly number[] | null>(null)

  const untagged = useMemo(() => untaggedSongs(library?.songs ?? []), [library])
  const ids = useMemo(() => untagged.map(song => song.id), [untagged])

  // One press handler for every row, reading the list at the moment of the
  // press: a closure per row over the player redrew every row whenever the
  // player changed. The rows ask the player themselves whether they are playing.
  const { playFrom } = player
  const latest = useRef({ ids, playFrom })
  useEffect(() => {
    latest.current = { ids, playFrom }
  })
  const onRowPress = useCallback((_event: GestureResponderEvent, song: Song) => {
    const now = latest.current
    const index = now.ids.indexOf(song.id)
    if (index >= 0) now.playFrom(now.ids, index)
  }, [])
  const rowHeight = useSongRowHeight()

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => (
      <SongRow
        testID={`song-row-${index}`}
        song={item}
        artUri={artFor(item)}
        downloaded={isDownloaded(downloads.index, item.id)}
        onPress={onRowPress}
        index={index}
      />
    ),
    [artFor, downloads.index, onRowPress],
  )

  if (session) return <Triage ids={session} onExit={() => setSession(null)} />

  const subtitle = inboxSubtitle(isLoading && !library, untagged)

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={[styles.page, wide ? styles.pageWide : styles.pageNarrow]} testID="inbox-screen">
        <BackToYou />
        <View style={[styles.head, !wide && styles.headNarrow]}>
          <View style={styles.titles}>
            <Text
              style={[styles.heading, !wide && styles.headingNarrow]}
              accessibilityRole="header"
            >
              Untagged
            </Text>
            {subtitle ? <Text style={styles.sub}>{subtitle}</Text> : null}
          </View>
          {untagged.length > 0 ? (
            <Button
              label="Start tagging"
              variant="primary"
              icon={<Play size={15} color={accent.onAccent} />}
              onPress={() => setSession(ids)}
            />
          ) : null}
        </View>

        {untagged.length > 0 ? (
          <Text style={[styles.hint, styles.lead]}>
            {wide
              ? 'One song at a time: it plays while you pick tags with the number keys, then → for the next.'
              : 'One song at a time: it plays while you tap its tags, then Next.'}
          </Text>
        ) : null}

        {untagged.length === 0 && library ? (
          <View style={styles.empty}>
            <Text style={styles.emoji}>🏷️</Text>
            <Text style={styles.emptyTitle}>All tagged</Text>
            <Text style={styles.hint}>Every song in your library carries at least one tag.</Text>
            <View style={[styles.emptyActions, !wide && styles.stretch]}>
              <Button
                label="Back to the library"
                grow={!wide}
                // Back when the library is what is behind; otherwise the
                // library in this page's place, rather than one more page on top.
                onPress={() =>
                  cameFrom(navigation.getState(), 'index') ? router.back() : router.replace('/')
                }
              />
            </View>
          </View>
        ) : (
          <SongList
            songs={untagged}
            label="Untagged songs"
            renderSong={renderSong}
            rowHeight={rowHeight}
            onRefresh={pull.onRefresh}
            refreshing={pull.refreshing}
            contentContainerStyle={styles.list}
          />
        )}
      </View>
    </SafeAreaView>
  )
}

/**
 * One song at a time. The list is fixed when tagging starts, so a song tagged
 * does not vanish from under you and Back returns to it; tags keep their order
 * for the whole session, so each keeps its number.
 */
function Triage({ ids, onExit }: { ids: readonly number[]; onExit: () => void }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const player = usePlayer()
  const artFor = useArt()
  const { wide } = useLayout()
  const { data: library } = useLibrary()
  const setSongTags = useSetSongTags()
  const createTag = useCreateTag()
  const newTagRef = useRef<TextInput>(null)

  const [index, setIndex] = useState(0)
  const [finished, setFinished] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [playAlong, setPlayAlongState] = useState(() => prefs.get(PLAY_ALONG_KEY) !== 'false')
  /** What this session set on each song, so a chip flips before the refetch lands. */
  const [applied, setApplied] = useState<ReadonlyMap<number, ReadonlySet<number>>>(() => new Map())

  const tags = useMemo<readonly Tag[]>(() => library?.tags ?? [], [library])
  const [order, setOrder] = useState<readonly number[]>(() => tagOrder(tags))
  const shownTags = useMemo(() => orderedTags(order, tags), [order, tags])
  const queue = useMemo(() => {
    const byId = new Map((library?.songs ?? []).map(song => [song.id, song]))
    // A song deleted mid-session just drops out.
    return ids.flatMap(id => {
      const song = byId.get(id)
      return song ? [song] : []
    })
  }, [ids, library])

  const safeIndex = Math.min(index, Math.max(0, queue.length - 1))
  const song = queue[safeIndex]
  const current = song ? (applied.get(song.id) ?? new Set(song.tagIds)) : new Set<number>()

  const setPlayAlong = (on: boolean): void => {
    setPlayAlongState(on)
    prefs.set(PLAY_ALONG_KEY, String(on))
  }

  const apply = (target: Song, next: ReadonlySet<number>): void => {
    setApplied(map => new Map(map).set(target.id, next))
    setSongTags.mutate({ songId: target.id, tagIds: [...next] })
  }
  const toggle = (tagId: number): void => {
    if (song) apply(song, toggled(current, tagId))
  }
  const next = (): void => {
    if (safeIndex >= queue.length - 1) setFinished(true)
    else setIndex(safeIndex + 1)
  }
  const back = (): void => {
    setFinished(false)
    setIndex(Math.max(0, safeIndex - 1))
  }

  const create = async (): Promise<void> => {
    const name = newTag.trim()
    if (!name || !song) return
    setNewTag('')
    const existing = existingTag(tags, name)
    if (existing) {
      if (!current.has(existing.id)) toggle(existing.id)
      return
    }
    const tag = await createTag.mutateAsync(name)
    setOrder(list => [...list, tag.id])
    apply(song, new Set([...current, tag.id]))
  }

  // Play along: the card and the player move together. A song is asked for
  // once per card, so a player that has not switched yet is not asked again.
  const requested = useRef<number | null>(null)
  const queueIds = useMemo(() => queue.map(item => item.id), [queue])
  const songId = song?.id
  useEffect(() => {
    if (!playAlong || finished || songId === undefined) return
    if (player.current?.id === songId || requested.current === songId) return
    requested.current = songId
    const position = queueIds.indexOf(songId)
    if (position >= 0) player.playFrom(queueIds, position)
  }, [songId, playAlong, finished, player, queueIds])

  // …and when a song ends on its own and the next one starts, the card follows.
  const playingId = player.current?.id
  const [followed, setFollowed] = useState(playingId)
  if (playAlong && playingId !== followed) {
    setFollowed(playingId)
    const position = playingId === undefined ? -1 : queueIds.indexOf(playingId)
    if (position >= 0 && position !== safeIndex) setIndex(position)
  }

  useEscape(true, onExit)
  const keys: Record<string, () => void> = {
    ArrowRight: () => (finished ? onExit() : next()),
    Enter: () => (finished ? onExit() : next()),
    ArrowLeft: back,
    n: () => newTagRef.current?.focus(),
    '/': () => newTagRef.current?.focus(),
  }
  for (const key of ['1', '2', '3', '4', '5', '6', '7', '8', '9']) {
    keys[key] = () => {
      const tag = tagForKey(key, shownTags)
      if (tag) toggle(tag.id)
    }
  }
  useHotkeys(keys)

  if (queue.length === 0 || finished) {
    const summary = sessionSummary(queue, applied)
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <View style={styles.empty} testID="triage-done">
          <Text style={styles.emoji}>🏷️</Text>
          <Text style={styles.emptyTitle}>{summary.title}</Text>
          <Text style={styles.hint}>{summary.hint}</Text>
          <View style={styles.emptyActions}>
            {queue.length > 0 ? <Button label="Back to the last song" onPress={back} /> : null}
            <Button
              label="Done"
              variant="primary"
              icon={<Check size={15} color={accent.onAccent} />}
              onPress={onExit}
            />
          </View>
        </View>
      </SafeAreaView>
    )
  }

  if (!song) return null
  const label = nextLabel(safeIndex, queue.length, current.size)

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.triage, wide ? styles.triageWide : styles.triageNarrow]}
        keyboardShouldPersistTaps="handled"
        testID="triage-screen"
      >
        <View style={styles.triageHead}>
          <Button
            label="Done"
            icon={<X size={15} color={theme.colors.textPrimary} />}
            onPress={onExit}
          />
          <Text style={styles.count}>
            {safeIndex + 1} <Text style={styles.hint}>of {queue.length}</Text>
          </Text>
          <View style={styles.playAlong}>
            <Toggle value={playAlong} onChange={setPlayAlong} label="Play along" />
            <Text style={styles.playAlongLabel}>Play along</Text>
          </View>
        </View>

        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityLabel="Songs gone through"
          accessibilityValue={{ min: 1, max: queue.length, now: safeIndex + 1 }}
        >
          <View
            style={[
              styles.progressBar,
              {
                width: `${((safeIndex + 1) / queue.length) * 100}%`,
                backgroundColor: accent.accent,
              },
            ]}
          />
        </View>

        <View style={[styles.card, !wide && styles.cardNarrow]}>
          <Cover uri={artFor(song)} title={song.album || song.title} size={wide ? 176 : 132} />
          <View style={[styles.meta, !wide && styles.metaNarrow]}>
            <Text
              style={[styles.title, !wide && styles.titleNarrow]}
              numberOfLines={2}
              accessibilityRole="header"
            >
              {song.title}
            </Text>
            <Text style={styles.artist}>
              {song.artist || 'Unknown artist'}
              {song.album ? <Text style={styles.album}> · {song.album}</Text> : null}
            </Text>
            {song.audioFeatures ? (
              <View style={styles.features}>
                {song.audioFeatures.bpm != null ? (
                  <Text style={styles.tempo}>{tempoMark(song.audioFeatures.bpm)}</Text>
                ) : null}
                {song.audioFeatures.energy != null ? (
                  <EnergyWave energy={song.audioFeatures.energy} width={30} height={16} />
                ) : null}
              </View>
            ) : null}
            {!playAlong ? (
              <Button
                label="Play this one"
                icon={<Play size={13} color={theme.colors.textPrimary} />}
                onPress={() => player.playFrom(queueIds, safeIndex)}
              />
            ) : null}
          </View>
        </View>

        <View
          style={[styles.tags, !wide && styles.tagsNarrow]}
          role="group"
          accessibilityLabel={`Tags for ${song.title}`}
        >
          {shownTags.length === 0 ? (
            <Text style={styles.hint}>
              No tags yet — type one below to create it and put it on this song.
            </Text>
          ) : null}
          {shownTags.map((tag, position) => {
            const on = current.has(tag.id)
            return (
              <Pressable
                key={tag.id}
                onPress={() => toggle(tag.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                aria-pressed={on}
                accessibilityLabel={tag.name}
                testID={`triage-tag-${tag.id}`}
                style={[
                  styles.tag,
                  {
                    backgroundColor: oklchToHexAlpha(
                      on ? 0.55 : 0.3,
                      on ? 0.14 : 0.05,
                      tag.hue,
                      on ? 0.7 : 0.35,
                    ),
                    borderColor: oklchToHexAlpha(
                      on ? 0.72 : 0.45,
                      on ? 0.14 : 0.08,
                      tag.hue,
                      on ? 1 : 0.45,
                    ),
                  },
                ]}
              >
                {wide && position < 9 ? (
                  <View
                    style={[styles.kbd, { borderColor: oklchToHexAlpha(0.45, 0.06, tag.hue, 0.6) }]}
                  >
                    <Text
                      style={[styles.kbdText, { color: oklchToHexAlpha(0.86, 0.08, tag.hue, 1) }]}
                    >
                      {position + 1}
                    </Text>
                  </View>
                ) : null}
                {on ? <Check size={13} color={oklchToHexAlpha(0.98, 0.02, tag.hue, 1)} /> : null}
                <Text
                  style={[
                    styles.tagText,
                    on && styles.tagTextOn,
                    { color: oklchToHexAlpha(on ? 0.98 : 0.86, on ? 0.02 : 0.08, tag.hue, 1) },
                  ]}
                >
                  {tag.name}
                </Text>
              </Pressable>
            )
          })}
          <View style={styles.newTag}>
            <Plus size={14} color={theme.colors.textMuted} />
            <TextInput
              ref={newTagRef}
              style={styles.newTagInput}
              value={newTag}
              onChangeText={setNewTag}
              onSubmitEditing={() => void create()}
              placeholder={wide ? 'New tag (N)' : 'New tag'}
              placeholderTextColor={theme.colors.textMuted}
              accessibilityLabel="Create a tag and add it to this song"
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={TAG_NAME_MAX}
            />
          </View>
        </View>

        <View style={styles.foot}>
          <Button label="← Back" onPress={back} disabled={safeIndex === 0} grow={!wide} />
          {wide ? <Text style={styles.hint}>1–9 tags · → next · Esc done</Text> : null}
          <Button
            label={label}
            variant="primary"
            grow={!wide}
            icon={
              label === 'Finish' ? (
                <Check size={15} color={accent.onAccent} />
              ) : (
                <ChevronRight size={15} color={accent.onAccent} />
              )
            }
            onPress={next}
          />
        </View>

        <View style={styles.footNote}>
          <Inbox size={13} color={theme.colors.textMuted} />
          <Text style={styles.hint}>Songs you skip stay in Untagged.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flex: 1 },
  pageWide: { paddingTop: 28, paddingHorizontal: 32 },
  pageNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    marginBottom: 14,
  },
  headNarrow: { flexDirection: 'column', gap: 12 },
  titles: { flexShrink: 1 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: 22 },
  sub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 6 },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  lead: { marginBottom: 14 },
  list: { paddingBottom: 40 },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 60,
    paddingHorizontal: 16,
  },
  emoji: { fontSize: 36 },
  emptyTitle: { color: theme.colors.textPrimary, fontSize: 17, fontWeight: '600' },
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  stretch: { alignSelf: 'stretch' },
  triage: { gap: 18, paddingBottom: 40 },
  triageWide: {
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
    paddingTop: 28,
    paddingHorizontal: 32,
  },
  triageNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  triageHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  count: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  playAlong: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  playAlongLabel: { color: theme.colors.textSecondary, fontSize: 13 },
  progress: {
    height: 4,
    marginTop: -8,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  progressBar: { height: 4, borderRadius: 999 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 22,
    padding: 18,
    borderRadius: radius.lg,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  cardNarrow: { flexDirection: 'column', gap: 14 },
  meta: { flex: 1, minWidth: 0, alignItems: 'flex-start', gap: 6 },
  metaNarrow: { alignItems: 'center', flex: 0 },
  title: { color: theme.colors.textPrimary, fontSize: 26, lineHeight: 31, fontWeight: '700' },
  titleNarrow: { fontSize: 20, lineHeight: 24, textAlign: 'center' },
  artist: { color: theme.colors.textSecondary, fontSize: 14 },
  album: { color: theme.colors.textMuted },
  features: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tempo: { color: theme.colors.textSecondary, fontSize: 14, fontVariant: ['tabular-nums'] },
  tags: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  tagsNarrow: { justifyContent: 'center' },
  tag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 38,
    paddingVertical: 6,
    paddingLeft: 8,
    paddingRight: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  tagText: { fontSize: 14 },
  tagTextOn: { fontWeight: '600' },
  kbd: {
    minWidth: 20,
    paddingHorizontal: 4,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
  },
  kbdText: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  newTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 38,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
  },
  newTagInput: { width: 120, color: theme.colors.textPrimary, fontSize: 14, paddingVertical: 6 },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -8 },
}))
