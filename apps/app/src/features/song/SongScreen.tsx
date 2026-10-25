import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import type { Song } from '@selfmp3/shared'
import { radius, space, type, useLibrary, useSimilar, withAlpha, iconSize } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBottomInset } from '../../shell/bottomInset'
import { useLayout } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { CoverLight } from '../../ui/components/CoverLight'
import { Mic, Next } from '../../ui/components/Icons'
import { MoreButton } from '../../ui/components/MoreMenu'
import { LikeButton } from '../../ui/components/LikeButton'
import { PlayPauseButton } from '../../ui/components/PlayPauseButton'
import { BackButton } from '../../ui/components/BackButton'
import { MissingPage } from '../../ui/components/MissingPage'
import { SongMenu } from '../../ui/components/SongMenu'
import { SONG_ACTION_LABELS } from '../../ui/songActions.model'
import { TagPicker } from '../../ui/components/TagPicker'
import { artShadow, card, label, pageFrame, serif, bodyText, heroTitle } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { useSongColor } from '../../ui/useSongColor'
import { ArtistLinks } from '../nowPlaying/ArtistLinks'
import { SimilarShelf } from './SimilarShelf'
import { useHistoryFor, useStatsSongs } from '../stats/statsSource'
import { useOpenTag } from '../tag/useOpenTag'
import { SongAbout } from './SongAbout'
import { SoundStrip } from './SongFacts'
import {
  bylineRest,
  playStrip,
  songPlays,
  songStory,
  unplayedLine,
  type PlayStrip,
} from './song.model'
import { goBack } from '../../ui/useBackTo'
import { useVia } from '../../connection/via'
import { ScrollView } from '../../ui/components/Scroll'

/**
 * A song's own page, `/song/<id>` (docs/ui-mock `P15`).
 *
 * Lit by its cover, with the song's cover, name, artists and tags at the top;
 * Play, Lyrics and Play next under them, and beside them "Not played yet ·
 * added a month ago" until it has been; then, once it has plays, what you and
 * the song have done together; its Sound as three tiles; and songs that sound
 * like it. The song's facts follow at the end as one quiet line, with Fix
 * song info… beside it (F1, 2026-10-25).
 *
 * On a computer it is the same page at the window's width, inside the shell:
 * there is no board for it, and the page reads as well wide (docs/UI-MIGRATION.md,
 * Risks).
 */
export function SongScreen(): ReactNode {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const { data: library } = useLibrary()
  const song = library?.songs.find(item => String(item.id) === id)
  /*
   * Removed from its own page — the ⋯ menu's Remove — the song leaves the
   * library under the page that shows it. That is not an address naming a
   * song nobody has, so it is not "No such song": the page goes back to
   * where it was opened from, and the toast says what went (Xiao, 2026-10-04).
   */
  const [shown, setShown] = useState<string | null>(null)
  if (song && shown !== id) setShown(id)
  const removedHere = !song && library !== undefined && shown === id
  useEffect(() => {
    if (removedHere) goBack(router, '/library')
  }, [removedHere, router])
  if (!library || removedHere) return null
  if (!song) return <SongMissing />
  return <SongPage key={song.id} song={song} />
}

function SongPage({ song }: { song: Song }): ReactNode {
  const router = useRouter()
  const openTag = useOpenTag()
  const { wide } = useLayout()
  const bottom = useBottomInset()
  const { top } = useSafeAreaInsets()
  const player = usePlayer()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const art = artFor(song)
  const light = useSongColor(song, art)
  const similar = useSimilar(song.id, 10)
  const similarSongs = similar.isPlaceholderData ? [] : (similar.data?.songs ?? [])
  const [menuOpen, setMenuOpen] = useState(false)
  const [tagging, setTagging] = useState(false)
  const moreRef = useRef<View>(null)
  const addTagRef = useRef<View>(null)

  const tags = (library?.tags ?? []).filter(tag => song.tagIds.includes(tag.id))
  const isCurrent = player.current?.id === song.id
  const rest = bylineRest(song)
  const unplayed = useMemo(() => unplayedLine(song, new Date()), [song])

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
          { paddingTop: top + pageFrame(wide).paddingTop, paddingBottom: bottom + space.xl },
        ]}
      >
        <View style={styles.light}>
          <CoverLight color={light.color} art={art} blur={40} />
        </View>

        <View style={styles.topBar}>
          <BackButton to="/" always />
          <View style={styles.topRight}>
            <LikeButton song={song} filled />
            <MoreButton
              name={song.title}
              anchorRef={moreRef}
              onPress={() => setMenuOpen(open => !open)}
              active={menuOpen}
              testID="song-more"
            />
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
                  onPress={() => openTag(tag)}
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
          <PlayPauseButton
            testID="song-play"
            songId={song.id}
            playLabel={`Play ${song.title}`}
            glyph={iconSize.hero}
            // The song already loaded pauses and resumes; any other starts from the top.
            onPress={() => (isCurrent ? player.toggle() : player.playFrom([song.id], 0))}
          />
          <Button
            testID="song-lyrics"
            label="Lyrics"
            icon={<Mic tone="textPrimary" />}
            onPress={() => {
              // The words follow the song that is playing, so it has to be this one.
              if (!isCurrent) player.playFrom([song.id], 0)
              router.navigate('/now-playing')
            }}
          />
          {/* Not for the song playing: it is where "next" is counted from, and a
              greyed button there would only ask why. */}
          {isCurrent ? null : (
            <Button
              testID="song-play-next"
              label={SONG_ACTION_LABELS.playNext}
              icon={<Next tone="textPrimary" />}
              onPress={() => {
                player.playNext([song.id])
                showToast({ over: 'Plays next', say: song.title }, 'good', {
                  songs: [song],
                  group: 'plays-next',
                })
              }}
            />
          )}
          {unplayed ? (
            <Text style={[styles.unplayed, wide && styles.unplayedWide]} testID="song-unplayed">
              {unplayed}
            </Text>
          ) : null}
        </View>

        {/* The listening card only once there are plays to draw. */}
        {unplayed ? null : <YouAndThisSong song={song} />}

        <SoundStrip song={song} />

        {similarSongs.length > 0 ? (
          <SimilarShelf songs={similarSongs} heading="Sounds like" />
        ) : null}

        <SongAbout song={song} plays={false} sound={false} style={styles.facts} />
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
    </View>
  )
}

/**
 * "You and this song": the plays and when it came, in a sentence, and a strip
 * of when those plays were.
 *
 * The count and the dates are the song record's and always there. When each
 * play happened is the server's history, which a cloud library reaches only
 * while its server can be reached (`useVia`, as Stats and Home do);
 * without it the sentence says what the record knows and the strip is left out.
 * Out of reach, it asks its own client, as Home does, which has no history to
 * give.
 */
function YouAndThisSong({ song }: { song: Song }): ReactNode {
  const via = useVia()
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
    <MissingPage
      testID="song-missing"
      title="No such song"
      line="It may have been removed from your library."
      back="/library"
      action={{ label: 'Library', onPress: () => router.replace('/library') }}
    />
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingHorizontal: space.gutter, gap: 18 },
  contentWide: { paddingHorizontal: space.gutterWide },
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
    paddingTop: space.sm,
  },
  topRight: { flexDirection: 'row', gap: space.sm },
  hero: { flexDirection: 'row', alignItems: 'flex-end', gap: space.lg },
  heroWide: { gap: 28 },
  cover: {
    borderRadius: radius.card,
    ...artShadow(theme.colors),
  },
  titles: { flex: 1, minWidth: 0, gap: space.tight },
  title: heroTitle(theme.colors, 'page'),
  titleWide: heroTitle(theme.colors),
  byline: { color: theme.colors.textSecondary, fontSize: type.body },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.tight, alignItems: 'center' },
  plus: { color: theme.colors.textSecondary, fontSize: type.sub },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.snug, flexWrap: 'wrap' },
  card: { ...card(theme.colors), padding: space.lg, gap: space.md },
  cardLabel: label(theme.colors),
  story: bodyText(theme.colors),
  count: serif(theme.colors, 'large'),
  bright: { color: theme.colors.textPrimary },
  strip: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 28 },
  bar: {
    flex: 1,
    minHeight: 2,
    borderRadius: 2,
    backgroundColor: withAlpha(theme.colors.textPrimary, 0.12),
  },
  barPeak: { backgroundColor: theme.colors.accent },
  // Beside the buttons on a computer, at the row's far end; under them on a phone.
  unplayed: { color: theme.colors.textMuted, fontSize: type.sub, flexBasis: '100%' },
  unplayedWide: { flexBasis: 'auto', marginLeft: 'auto' },
  facts: { paddingTop: space.sm },
}))
