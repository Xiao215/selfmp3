import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { Song } from '@selfmp3/shared'
import {
  fonts,
  radius,
  space,
  type,
  useLibrary,
  useSimilar,
  useToggleLoved,
  withAlpha,
} from '@selfmp3/client'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'
import { useArt } from '../../offline/useArt'
import { usePlayer, usePlayerStalled } from '../../player/PlayerProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBottomInset } from '../../shell/bottomInset'
import { useLayout } from '../../shell/useLayout'
import { Button, PlayButton } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { CoverLight } from '../../ui/components/CoverLight'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronLeft, Heart, Mic, More, Queue, Sparkles } from '../../ui/components/Icons'
import { PlayPauseIcon } from '../../ui/components/PlayPauseIcon'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SongMenu } from '../../ui/components/SongMenu'
import { TagPicker } from '../../ui/components/TagPicker'
import { artShadow, card, label as labelText, pageTitle, serif } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { useSongColor } from '../../ui/useSongColor'
import { FixMetadata } from '../metadata/FixMetadata'
import { ArtistLinks } from '../nowPlaying/ArtistLinks'
import { SimilarShelf } from '../nowPlaying/SimilarShelf'
import { useHistoryFor, useStatsSongs } from '../stats/statsSource'
import { tagLink } from '../tag/placeLinks'
import { SongFacts } from './SongFacts'
import {
  bylineRest,
  playStrip,
  songPlays,
  songStory,
  soundWords,
  type PlayStrip,
} from './song.model'

/**
 * A song's own page, `/song/<id>` (docs/ui-mock `P15`).
 *
 * Lit by its cover, with the song's cover, name, artists and tags at the top;
 * Play, Lyrics and Play next under them (Play next moved here from the song
 * menu); then what you and the song have done together, and songs that sound
 * like it. Everything the old Song details dialog said follows at the end, in
 * the same quiet groups, with Fix metadata beside the facts it fixes.
 *
 * On a computer it is the same page at the window's width, inside the shell:
 * there is no board for it, and the page reads as well wide (docs/UI-MIGRATION.md,
 * Risks).
 */
export function SongScreen(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: library } = useLibrary()
  if (!library) return null
  const song = library.songs.find(item => String(item.id) === id)
  if (!song) return <SongMissing />
  return <SongPage key={song.id} song={song} />
}

function SongPage({ song }: { song: Song }): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide } = useLayout()
  const bottom = useBottomInset()
  const { top } = useSafeAreaInsets()
  const player = usePlayer()
  const stalled = usePlayerStalled()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const art = artFor(song)
  const light = useSongColor(song, art)
  const similar = useSimilar(song.id, 10)
  const similarSongs = similar.isPlaceholderData ? [] : (similar.data?.songs ?? [])
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagging, setTagging] = useState(false)
  const [fixing, setFixing] = useState(false)
  const moreRef = useRef<View>(null)
  const addTagRef = useRef<View>(null)
  const toggleLoved = useToggleLoved()

  const tags = (library?.tags ?? []).filter(tag => song.tagIds.includes(tag.id))
  const isCurrent = player.current?.id === song.id
  const rest = bylineRest(song)
  const back = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        testID="song-screen"
        contentContainerStyle={[
          styles.content,
          wide && styles.contentWide,
          // The inset is the content's, not the screen's: a safe area around
          // the whole page would push the light down with everything else and
          // leave a black band above it, where a place's page runs its light
          // right up under the status bar (Xiao, 2026-09-27).
          { paddingTop: top + space.sm, paddingBottom: bottom + space.xl },
        ]}
      >
        <View style={styles.light}>
          <CoverLight color={light.color} art={art} blur={40} />
        </View>

        <View style={styles.topBar}>
          <IconButton label="Back" onPress={back} filled>
            <ChevronLeft size={20} tone="textPrimary" />
          </IconButton>
          <View style={styles.topRight}>
            <IconButton
              label={song.loved ? 'Unlike' : 'Like'}
              active={song.loved}
              filled
              onPress={() => toggleLoved.mutate({ id: song.id, loved: !song.loved })}
            >
              <Heart
                size={18}
                filled={song.loved}
                color={song.loved ? theme.colors.danger : theme.colors.textPrimary}
              />
            </IconButton>
            <View ref={moreRef} collapsable={false}>
              <IconButton
                label={`More for ${song.title}`}
                onPress={() => setMenuOpen(true)}
                filled
                testID="song-more"
              >
                <More size={18} tone="textPrimary" />
              </IconButton>
            </View>
          </View>
        </View>

        <View style={[styles.hero, wide && styles.heroWide]}>
          <View style={styles.cover}>
            <Cover
              uri={art}
              title={song.album || song.title}
              size={wide ? 200 : 132}
              radius={radius.card}
            />
          </View>
          <View style={styles.titles}>
            <Text
              style={[styles.title, wide && styles.titleWide]}
              numberOfLines={3}
              accessibilityRole="header"
            >
              {song.title}
            </Text>
            <Text style={styles.byline}>
              <ArtistLinks artist={song.artist} />
              {rest ? ` · ${rest}` : ''}
            </Text>
            <View style={styles.tags}>
              {tags.map(tag => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  hue={tag.hue}
                  selected={false}
                  compact
                  onPress={() => router.navigate(tagLink(tag.name))}
                />
              ))}
              <View ref={addTagRef} collapsable={false}>
                <Chip
                  testID="song-add-tag"
                  label="Tag"
                  icon={<Text style={styles.plus}>+</Text>}
                  selected={false}
                  dashed
                  compact
                  onPress={() => setTagging(true)}
                />
              </View>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          <PlayButton
            testID="song-play"
            label={isCurrent && player.isPlaying ? 'Pause' : `Play ${song.title}`}
            icon={
              <PlayPauseIcon
                playing={isCurrent && player.isPlaying}
                busy={isCurrent && stalled}
                size={24}
                color={theme.colors.onPrimary}
              />
            }
            // The song already loaded pauses and resumes; any other starts from the top.
            onPress={() => (isCurrent ? player.toggle() : player.playFrom([song.id], 0))}
          />
          <Button
            testID="song-lyrics"
            label="Lyrics"
            icon={<Mic size={16} tone="textPrimary" />}
            onPress={() => {
              // The words follow the song that is playing, so it has to be this one.
              if (!isCurrent) player.playFrom([song.id], 0)
              router.navigate('/now-playing')
            }}
          />
          <Button
            testID="song-play-next"
            label="Play next"
            icon={<Queue size={16} tone="textPrimary" />}
            // The song playing is already where "next" is counted from.
            disabled={isCurrent}
            onPress={() => {
              player.playNext([song.id])
              showToast('Plays next', 'good')
            }}
          />
        </View>

        <YouAndThisSong song={song} />

        {similarSongs.length > 0 ? (
          <SimilarShelf
            songs={similarSongs}
            heading="Sounds like"
            aside={soundWords(song.audioFeatures) ?? ''}
          />
        ) : null}

        <View style={styles.facts}>
          <SongFacts song={song} plays={false} />
          <View style={styles.fix}>
            <Button
              label="Fix metadata…"
              icon={<Sparkles size={15} tone="textSecondary" />}
              onPress={() => setFixing(true)}
            />
          </View>
        </View>
      </ScrollView>

      <SongMenu
        song={menuOpen ? song : null}
        anchorRef={moreRef}
        onClose={() => setMenuOpen(false)}
      />
      <TagPicker
        song={tagging ? song : null}
        anchorRef={addTagRef}
        onClose={() => setTagging(false)}
      />
      {fixing ? <FixMetadata song={song} onClose={() => setFixing(false)} /> : null}
    </View>
  )
}

/**
 * "You and this song": the plays and when it came, in a sentence, and a strip
 * of when those plays were.
 *
 * The count and the dates are the song record's and always there. When each
 * play happened is the server's history, which a cloud library reaches only
 * while its server can be reached (`useServerDirect`, as Stats and Home do);
 * without it the sentence says what the record knows and the strip is left out.
 * Out of reach, it asks its own client, as Home does, which has no history to
 * give.
 */
function YouAndThisSong({ song }: { song: Song }): ReactNode {
  const { fromCloud } = useConnection()
  const reach = useServerDirect({ enabled: fromCloud })
  const via = fromCloud && reach.state === 'reachable' ? reach.connection : undefined
  const { data: history } = useHistoryFor(via)
  const songFor = useStatsSongs(via)
  const { story, strip } = useMemo(() => {
    const now = new Date()
    const known = history ? songPlays(history.events, id => songFor(id)?.id === song.id) : null
    return {
      story: songStory(song, known?.playedAt ?? [], now),
      strip: known
        ? playStrip({
            playedAt: known.playedAt,
            addedAt: song.addedAt,
            coveredFrom: known.coveredFrom,
            now,
          })
        : null,
    }
  }, [history, songFor, song])

  return (
    <View style={styles.card} testID="song-you">
      <Text style={styles.cardLabel}>You and this song</Text>
      <Text style={styles.story}>
        {story.count !== null ? <Text style={styles.count}>{story.count}</Text> : null}
        {story.lead}
        <Text style={styles.bright}>{story.when}</Text>
        {story.tail}
      </Text>
      {strip ? <Strip strip={strip} /> : null}
    </View>
  )
}

/** Plays over time, oldest on the left; the busiest stretch in the accent. */
function Strip({ strip }: { strip: PlayStrip }): ReactNode {
  return (
    <View style={styles.strip} accessibilityLabel="Plays over time">
      {strip.bars.map((bar, index) => (
        <View
          // The bars are positions in time, and never move.
          key={index}
          style={[
            styles.bar,
            { height: `${Math.round(bar * 100)}%` },
            index === strip.peak && styles.barPeak,
          ]}
        />
      ))}
    </View>
  )
}

/** An address naming a song the library does not hold: removed since the link was made. */
function SongMissing(): ReactNode {
  const router = useRouter()
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.missing} testID="song-missing">
        <Text style={styles.missingTitle} accessibilityRole="header">
          No such song
        </Text>
        <Text style={styles.missingText}>It may have been removed from your library.</Text>
        <Button label="Library" onPress={() => router.replace('/library')} />
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingHorizontal: 20, gap: 18 },
  contentWide: { paddingHorizontal: 40 },
  // The light reaches down behind the head and fades into the ground before the card.
  light: { position: 'absolute', top: 0, left: 0, right: 0, height: 560 },
  // No glass here. The bar scrolls with the head rather than floating over
  // the page, and it carries no fill, so `backdrop-filter` only blurred the
  // head's own light inside the bar's rectangle — a band across the top with
  // a hard edge where the filter stopped (Xiao, 2026-09-21).
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
  },
  topRight: { flexDirection: 'row', gap: space.sm },
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: 16 },
  heroWide: { gap: 28 },
  cover: {
    borderRadius: radius.card,
    ...artShadow(theme.colors),
  },
  titles: { flex: 1, minWidth: 0, gap: 6 },
  title: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.4,
  },
  titleWide: { fontSize: 40, lineHeight: 46, letterSpacing: -0.8 },
  byline: { color: theme.colors.textSecondary, fontSize: type.body },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  plus: { color: theme.colors.textSecondary, fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  card: { ...card(theme.colors), padding: space.lg, gap: space.md },
  cardLabel: labelText(theme.colors),
  story: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 23 },
  count: serif(theme.colors, 24),
  bright: { color: theme.colors.textPrimary },
  strip: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 28 },
  bar: {
    flex: 1,
    minHeight: 2,
    borderRadius: 2,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.12),
  },
  barPeak: { backgroundColor: theme.colors.accent },
  facts: { maxWidth: 600, paddingTop: space.sm },
  fix: { alignItems: 'flex-start' },
  missing: { padding: 24, gap: 12, alignItems: 'flex-start' },
  missingTitle: pageTitle(theme.colors),
  missingText: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22 },
}))
