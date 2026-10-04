import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { formatLongDuration, plural, type Understanding } from '@selfmp3/shared'
import { clientApi, failureText, queryKeys, radius, space, useLibrary } from '@selfmp3/client'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useBottomInset } from '../../shell/bottomInset'
import { useLayout } from '../../shell/useLayout'
import { Button, PlayButton } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronLeft, More, Play, Sparkle } from '../../ui/components/Icons'
import { Popover } from '../../ui/components/Popover'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SheetItem } from '../../ui/components/Sheet'
import { showToast } from '../../ui/toast'
import { label as labelText, serif } from '../../ui/surfaces'
import type { ListSource } from '../lists/lists.model'
import { newPlaylist } from '../playlists/playlists.model'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { replaceAnswer, useKeptAnswer } from './answers.store'
import { describeNotes, parts, picksHere } from './smart.model'
import { useSmartServer } from './useSmartServer'

/**
 * An answer to Ask as a page of its own, `/answer?id=…` (docs/features/lists.md,
 * C1): the same shape as any list — a head, Play, the songs — so there is
 * nothing new to learn about it.
 *
 * Its head is Play, Different songs and ⋯. Nothing here asks you to keep it
 * before you have heard it: played, it is Up next by the name of your
 * question, and Save is there. Leaving a song out happens in Up next, after
 * Play, the way songs always leave Up next. The ⋯ holds Shuffle, Add to Up
 * next, and Save as playlist for an answer you already trust.
 *
 * What it understood is shown as chips; taking one away and pressing
 * Different songs picks again from what is left.
 */
export function AnswerScreen(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide } = useLayout()
  const bottom = useBottomInset()
  const { id } = useLocalSearchParams<{ id?: string }>()
  const kept = useKeptAnswer(id)
  const server = useSmartServer()
  const player = usePlayer()
  const queryClient = useQueryClient()
  const { data: library } = useLibrary()
  const artFor = useArt(ROW_COVER_SIZE)
  const [edited, setEdited] = useState<Understanding | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const moreRef = useRef<View>(null)
  const headRef = useRef<View>(null)
  const fly = useFlyToUpNext()

  const result = kept?.result
  const songsById = new Map((library?.songs ?? []).map(song => [song.id, song]))
  const picks = result
    ? picksHere(result, server.onDevice).filter(pick => songsById.has(pick.songId))
    : []
  const ids = picks.map(pick => pick.songId)

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
  const seconds = ids.reduce((sum, each) => sum + (songsById.get(each)?.duration ?? 0), 0)
  const source: ListSource = {
    kind: 'answer',
    text: kept.text,
    name: result.understanding.name,
    answerId: kept.id,
  }
  const play = (index: number): void => {
    fly(headRef.current, ids.slice(index))
    player.playFrom(ids, index, { source })
  }

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

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.page,
          wide && styles.pageWide,
          { paddingBottom: bottom + 24 },
        ]}
        testID="answer-page"
      >
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

        <View style={styles.head} ref={headRef} collapsable={false}>
          <View style={styles.eyebrow}>
            <Sparkle size={12} />
            <Text style={styles.eyebrowText}>You asked</Text>
          </View>
          <Text style={styles.question} accessibilityRole="header" testID="answer-question">
            {kept.text}
          </Text>
          <Text style={styles.meta}>
            {plural(ids.length, 'song', 'songs')}
            {ids.length > 0 ? ` · ${formatLongDuration(seconds)}` : ''} · from your library
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
          {(edited
            ? ['Changed. Different songs picks from what these let in.']
            : describeNotes(result, ids.length)
          ).map(note => (
            <Text key={note} style={styles.note}>
              {note}
            </Text>
          ))}
          <View style={styles.actions}>
            <PlayButton
              label={`Play the songs picked for “${kept.text}”`}
              icon={<Play size={24} color={theme.colors.onPrimary} />}
              disabled={ids.length === 0 || edited !== null}
              onPress={() => play(0)}
              testID="answer-play"
            />
            <Button
              label="Different songs"
              disabled={!server.api}
              busy={again.isPending}
              onPress={() => again.mutate(understanding)}
              testID="answer-again"
            />
          </View>
          {again.error ? (
            <Text style={styles.error}>{failureText('Couldn’t pick again', again.error)}</Text>
          ) : null}
        </View>

        <View style={edited ? styles.stale : undefined}>
          {picks.map((pick, index) => {
            const song = songsById.get(pick.songId)!
            return (
              <Pressable
                key={song.id}
                onPress={() => play(index)}
                disabled={edited !== null}
                accessibilityRole="button"
                accessibilityLabel={`Play ${song.title}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Cover uri={artFor(song)} title={song.album || song.title} size={44} />
                <View style={styles.text}>
                  <Text style={styles.title} numberOfLines={1}>
                    {song.title}
                    <Text style={styles.artist}> · {song.artist || 'Unknown artist'}</Text>
                  </Text>
                  {pick.why ? (
                    <Text style={styles.why} numberOfLines={1}>
                      {pick.why}
                    </Text>
                  ) : null}
                </View>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>

      <Popover
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchorRef={moreRef}
        width={220}
        testID="answer-menu"
      >
        <SheetItem
          label="Shuffle"
          disabled={ids.length === 0}
          onPress={() => {
            setMenuOpen(false)
            fly(headRef.current, ids)
            player.playShuffled(ids, source)
          }}
        />
        <SheetItem
          label="Add to Up next"
          disabled={ids.length === 0}
          onPress={() => {
            setMenuOpen(false)
            fly(headRef.current, ids)
            player.playNext(ids)
          }}
        />
        <SheetItem
          label={saving ? 'Saving…' : 'Save as playlist'}
          disabled={ids.length === 0 || saving}
          onPress={() => void save()}
        />
      </Popover>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { paddingHorizontal: space.lg, gap: space.lg },
  pageWide: { maxWidth: 820, width: '100%', alignSelf: 'center', paddingHorizontal: space.xl },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: space.sm,
  },
  head: { gap: space.sm },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eyebrowText: labelText(theme.colors),
  question: { ...serif(theme.colors, 34), lineHeight: 40 },
  meta: { color: theme.colors.textSecondary, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  note: { color: theme.colors.textMuted, fontSize: 12.5 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingTop: space.sm },
  error: { color: theme.colors.danger, fontSize: 12.5 },
  stale: { opacity: 0.45 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 6,
    paddingHorizontal: space.xs,
    borderRadius: radius.cover,
  },
  pressed: { opacity: 0.6 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.colors.textPrimary, fontSize: 14.5, fontWeight: '500' },
  artist: { color: theme.colors.textMuted, fontWeight: '400' },
  why: { color: theme.colors.textMuted, fontSize: 12.5 },
  gone: { padding: 24, gap: 12, alignItems: 'flex-start' },
  goneTitle: { ...serif(theme.colors, 30) },
  goneText: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22 },
}))
