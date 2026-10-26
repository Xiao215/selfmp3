import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { naturalOrder, plural, type Song } from '@selfmp3/shared'
import { radius, space, type, useLibrary, useSimilar, withAlpha, iconSize } from '@selfmp3/client'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBottomInset } from '../../shell/bottomInset'
import { useLayoutFlags } from '../../shell/useLayout'
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
import { artShadow, card, label, pageFrame, heroTitle } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { useSongColor } from '../../ui/useSongColor'
import { ArtistLinks } from '../nowPlaying/ArtistLinks'
import { SimilarShelf } from './SimilarShelf'
import { useSongHistoryFor } from '../stats/statsSource'
import { useOpenTag } from '../tag/useOpenTag'
import { SongAbout } from './SongAbout'
import { SoundStrip } from './SongFacts'
import { bylineRest, songStory, unplayedLine, type WeekStrip } from './song.model'
import { goBack } from '../../ui/useBackTo'
import { useVia } from '../../connection/via'
import { ScrollView } from '../../ui/components/Scroll'
import { useStackedTitle } from '../../ui/useStackedTitle'

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
  const { wide } = useLayoutFlags()
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

  const tags = useMemo(
    () =>
      (library?.tags ?? [])
        .filter(tag => song.tagIds.includes(tag.id))
        .sort((a, b) => naturalOrder(a.name, b.name)),
    [library?.tags, song.tagIds],
  )
  const isCurrent = player.current?.id === song.id
  const rest = bylineRest(song)
  const unplayed = useMemo(() => unplayedLine(song, new Date()), [song])
  // The cover goes above a title that would take more than two lines beside it (AM1).
  const coverSize = wide ? 200 : 132
  const titleStyle = [styles.title, wide && styles.titleWide]
  const head = useStackedTitle({
    title: song.title,
    step: wide ? 'display' : 'page',
    style: titleStyle,
    cover: coverSize,
    gap: wide ? HERO_GAP_WIDE : space.lg,
  })

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

        <View
          onLayout={head.onHeadLayout}
          style={[styles.hero, wide && styles.heroWide, head.stacked && styles.heroStacked]}
        >
          {head.measure}
          <View style={styles.cover}>
            <Cover
              uri={art}
              title={song.album || song.title}
              size={coverSize}
              radius={radius.card}
            />
          </View>
          <View style={[styles.titles, head.stacked && styles.titlesStacked]}>
            <Text
              style={titleStyle}
              // Above its cover the title has the width, and is never cut.
              numberOfLines={head.stacked ? undefined : 3}
              accessibilityRole="header"
            >
              {song.title}
            </Text>
            {/* Two lines at most: an album named at length ran on for forty. */}
            <Text style={styles.byline} numberOfLines={2}>
              <ArtistLinks artist={song.artist} />
              {rest ? ` · ${rest}` : ''}
            </Text>
          </View>
        </View>

        {/*
          Under the hero, the page's width to wrap in, and a few of them: a song
          with fifty tags had pushed the cover to the foot of a column a
          thousand points tall. The rest are a count that opens the tag window,
          where all of them are.
        */}
        <View style={styles.tags}>
          {tags.slice(0, SHOWN_TAGS).map(tag => (
            <View key={tag.id} style={styles.tagSlot}>
              <Chip
                label={tag.name}
                hue={tag.hue}
                selected={false}
                compact
                onPress={() => openTag(tag)}
              />
            </View>
          ))}
          {tags.length > SHOWN_TAGS ? (
            <Chip
              testID="song-more-tags"
              label={`+${tags.length - SHOWN_TAGS}`}
              accessibilityLabel={`All ${plural(tags.length, 'tag', 'tags')}`}
              selected={false}
              compact
              onPress={() => setTagging(true)}
            />
          ) : null}
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
 * "You and this song": when it came and from where, its first play, its best
 * week and its last, and a strip of its weeks since.
 *
 * Every play of it is the server's, which a cloud library reaches only while
 * its server can be reached (`useVia`, as Stats and Home do). Without one the
 * card says what this device's copy of the song knows — when it came, how
 * often and when it was last played — and nothing more.
 */
function YouAndThisSong({ song }: { song: Song }): ReactNode {
  const via = useVia()
  const { data: history } = useSongHistoryFor(via, song.id)
  const story = useMemo(() => songStory(song, history ?? null, new Date()), [history, song])

  return (
    <View style={styles.card} testID="song-you">
      <Text style={styles.cardLabel}>You and this song</Text>
      <View style={styles.rows}>
        {story.rows.map(row => (
          <View key={row.key} style={styles.row} testID={`song-you-${row.key}`}>
            <Text style={styles.rowLabel}>{row.label}</Text>
            <View style={styles.rowText}>
              <Text style={styles.rowValue} numberOfLines={1}>
                {row.value}
              </Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {row.sub}
              </Text>
            </View>
          </View>
        ))}
      </View>
      {story.strip ? <Strip strip={story.strip} /> : null}
    </View>
  )
}

/** Plays a week, oldest on the left; the busiest week in the accent. */
function Strip({ strip }: { strip: WeekStrip }): ReactNode {
  return (
    <View style={styles.stripWrap}>
      <View style={styles.strip} accessibilityLabel="Plays each week" testID="song-you-strip">
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
      <Text style={styles.rowSub}>{strip.caption}</Text>
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

/** Between the cover and the title on a computer. */
const HERO_GAP_WIDE = 28
/** The quiet names down the listening card's left: "Best week" fits on one line. */
const ROW_LABEL_WIDTH = 76
/** How many of a song's tags its page lays out; the rest are a count that opens them all. */
const SHOWN_TAGS = 12

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
  heroWide: { gap: HERO_GAP_WIDE },
  heroStacked: { flexDirection: 'column', alignItems: 'flex-start' },
  cover: {
    borderRadius: radius.card,
    ...artShadow(theme.colors),
  },
  titles: { flex: 1, minWidth: 0, gap: space.tight },
  titlesStacked: { flex: 0, alignSelf: 'stretch' },
  title: heroTitle(theme.colors, 'page'),
  titleWide: heroTitle(theme.colors),
  byline: { color: theme.colors.textSecondary, fontSize: type.body },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: space.tight, alignItems: 'center' },
  // A chip never wider than the page: a long name ends in "…".
  tagSlot: { maxWidth: '100%' },
  plus: { color: theme.colors.textSecondary, fontSize: type.sub },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.snug, flexWrap: 'wrap' },
  card: { ...card(theme.colors), padding: space.lg, gap: space.md },
  cardLabel: label(theme.colors),
  rows: { gap: space.md },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.md },
  rowLabel: { width: ROW_LABEL_WIDTH, color: theme.colors.textMuted, fontSize: type.sub },
  rowText: { flex: 1, minWidth: 0, gap: 2 },
  rowValue: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  rowSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  stripWrap: { gap: space.sm },
  strip: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 36 },
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
