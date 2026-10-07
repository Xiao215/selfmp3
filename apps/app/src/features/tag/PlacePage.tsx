import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Animated, Text, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useNavigation, useRouter } from 'expo-router'
import type { NativeStackNavigationProp } from 'expo-router'
import type { Song } from '@selfmp3/shared'
import { fonts, isDownloaded, radius, tagColors, type, useLibrary } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLayout } from '../../shell/useLayout'
import { Button, PlayButton } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { CoverLight } from '../../ui/components/CoverLight'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronLeft, More, Play, Plus, Shuffle, User } from '../../ui/components/Icons'
import { SELECTION_BAR_SPACE, SelectionBar } from '../../ui/components/SelectionBar'
import { SongList } from '../../ui/components/SongList'
import { sortLabel } from '../../ui/components/listScrollbar.model'
import { SongMenu } from '../../ui/components/SongMenu'
import { SongRow } from '../../ui/components/SongRow'
import { useSongColor } from '../../ui/useSongColor'
import { modifiersOf, useSelection } from '../../selection/useSelection'
import { spring } from '../../ui/motion'
import { takePlaceHandoff } from '../../ui/coverHandoff'
import { artShadow, label as labelText } from '../../ui/surfaces'
import {
  combinedLink,
  combinedName,
  placesSource,
  recentKind,
  type ListSource,
} from '../lists/lists.model'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { useFlyToUpNext } from '../queue/useFlyToUpNext'
import { AddSheet } from './AddSheet'
import { useArtistPicture } from './useArtistPicture'
import {
  albumsOf,
  artistSummary,
  currentPlaces,
  placeKey,
  placeName,
  placeSongs,
  placeSummary,
  togglePlace,
  type Place,
} from './tag.model'

/**
 * A place's page (docs/ui-mock `P08`, `P10`, `C06`): a tag, an artist, or
 * several of them together.
 *
 * A tag's page is always that one tag (docs/features/lists.md, B1): lit by
 * its covers, with Play, Shuffle and Combine with…. Combining never changes
 * the page under you: the tags and artists picked open as a page of their own
 * on top of it (`/combined`), where chips say what is on and every one
 * **adds** its songs, and Back comes back to the tag. Rows carry no tag chips
 * here: inside a place, the place is the tag.
 *
 * A place has no order of its own — its songs read newest first, as Library
 * opens — so holding a row selects it, as it does in the library, and the
 * selection bar acts on what is ticked. Nothing here is saved: what is played
 * from it is Up next, and Up next's Save keeps it (docs/features/lists.md).
 *
 * An artist's page is the same page with a figure where a tag has its dot,
 * its name in the serif, and its songs by album.
 */
export function PlacePage({
  places,
  menu,
  onChange,
}: {
  /** One tag or artist; or, on `/combined`, the several put together. */
  places: readonly Place[]
  /** The ⋯ in the corner: what this kind of place offers. */
  menu?: (anchor: View | null) => void
  /**
   * Given on a combination's own page: its chips can be taken off and added
   * to there. Without it the page is one place, and combining opens a new one.
   */
  onChange?: (places: readonly Place[]) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide } = useLayout()
  // The head's light runs up behind the status bar rather than stopping at
  // it, so the page is lit to its own top edge; only what is read sits under.
  const { top } = useSafeAreaInsets()
  const player = usePlayer()
  const artFor = useArt()
  const { data: library } = useLibrary()
  // What was picked, read against the library now: a tag renamed or
  // recoloured from the ⋯ or the sidebar shows its new name at once.
  const chosen = useMemo(
    () => (library ? currentPlaces(places, library.tags) : places),
    [places, library],
  )
  const place = chosen[0] ?? places[0]!
  const combining = onChange !== undefined
  const [adding, setAdding] = useState(false)
  const moreRef = useRef<View>(null)
  const fly = useFlyToUpNext()

  const only = !combining && chosen.length === 1 ? chosen[0] : undefined
  const artistAlone = only?.kind === 'artist'
  const songs = useMemo(() => {
    const found = placeSongs(chosen, library?.songs ?? [])
    // An artist alone reads by album; a mix reads newest first, as Library does.
    return artistAlone ? albumsOf(found).flatMap(group => group.songs) : found
  }, [chosen, library, artistAlone])
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const lead = useMemo(() => songs.find(song => song.hasArt) ?? songs[0] ?? null, [songs])
  const leadArt = lead ? artFor(lead) : null
  const light = useSongColor(lead, leadArt)
  // An artist alone is lit by their own picture where the server has one,
  // and by a song's cover — as every place is — until then.
  const backdrop =
    useArtistPicture(only?.kind === 'artist' ? only.artist.name : null)?.banner ?? null

  const title = combinedName(chosen.map(placeName)) || placeName(place)
  const summary = artistAlone ? artistSummary(songs) : placeSummary(songs)
  // What Up next is called when this plays.
  const source = useMemo(() => placesSource(chosen), [chosen])
  const kindLabel = combining
    ? source?.kind === 'combined'
      ? recentKind(source)
      : 'Together'
    : place.kind === 'tag'
      ? 'Tag'
      : 'Artist'
  /** Combining from one place: the pick opens as a page of its own, over this one. */
  const combine = (picked: readonly Place[]): void => {
    setAdding(false)
    if (combining) {
      if (picked.length > 0) onChange(picked)
      return
    }
    const together = placesSource(picked)
    if (picked.length < 2 || together?.kind !== 'combined') return
    const link = combinedLink(together)
    router.push({ pathname: '/combined', params: { ...link.params } })
  }
  // The board has the tapped tile stretching into this head (docs/ui-mock
  // `M2`, 2). Without shared elements the head grows into place from where
  // the tile was: the tile hands its frame over as it is tapped
  // (`ui/coverHandoff.ts`), the hero measures its own once laid out, and the
  // one spring carries it from the one to the other — a translation between
  // the two centres and a scale by their widths — while the stack crossfades
  // the page in around it. Opened any other way (Back, an address, a row's
  // name), there is no frame and the head is simply there.
  const [handed] = useState(() => takePlaceHandoff())
  const [entrance] = useState(() => new Animated.Value(handed ? 0 : 1))
  const [start] = useState(() => ({
    dx: new Animated.Value(0),
    dy: new Animated.Value(0),
    grow: new Animated.Value(0),
  }))
  // Going back to the tile, once Back has been pressed (Xiao chose D, 2026-10-04).
  const [home] = useState(() => new Animated.Value(0))
  const [grow] = useState(() => {
    // How far from its place the hero is, 0 to 1: still growing out of the
    // tile, or on its way back into it.
    const left = Animated.add(
      entrance.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      home,
    ).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' })
    return {
      opacity: entrance,
      transform: [
        { translateX: Animated.multiply(left, start.dx) },
        { translateY: Animated.multiply(left, start.dy) },
        { scale: Animated.add(1, Animated.multiply(left, start.grow)) },
      ],
    }
  })
  const heroRef = useRef<View>(null)
  const heroPlaced = useRef(false)
  /** The hero's way between the tile and where it is laid out now. */
  const aimAtTile = (
    tile: NonNullable<typeof handed>,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void => {
    start.dx.setValue(tile.x + tile.width / 2 - (x + width / 2))
    start.dy.setValue(tile.y + tile.height / 2 - (y + height / 2))
    start.grow.setValue(tile.width / width - 1)
  }
  /*
   * The grow waits for the navigator's crossfade to start as well as for the
   * hero to be measured. Sent at layout, it had all but landed before the
   * native side began the fade, so the page arrived with the head already in
   * place and the tile seemed not to grow at all.
   */
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>()
  const growReady = useRef({ measured: false, fading: false })
  const growWhenReady = (): void => {
    const ready = growReady.current
    if (ready.measured && ready.fading) spring(entrance, 1)
  }
  useEffect(() => {
    if (!handed) return undefined
    const letGo = (): void => {
      growReady.current.fading = true
      growWhenReady()
    }
    const off = navigation.addListener('transitionStart', event => {
      if (!event.data.closing) letGo()
    })
    // A stack with no moves — a browser's — says nothing; nor does one asked
    // for less motion, where the spring lands at once anyway.
    const late = setTimeout(letGo, 400)
    return () => {
      off()
      clearTimeout(late)
    }
    // Once, for the page's arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const placeHero = (): void => {
    if (!handed || heroPlaced.current) return
    heroPlaced.current = true
    const node = heroRef.current
    if (!node) {
      growReady.current.measured = true
      growWhenReady()
      return
    }
    node.measureInWindow((x, y, width, height) => {
      if (width > 0) aimAtTile(handed, x, y, width, height)
      growReady.current.measured = true
      growWhenReady()
    })
  }

  /*
   * Back, on a phone, from a place that grew out of its Home tile: the
   * opening in reverse (Xiao chose D, 2026-10-04). The hero is aimed at the
   * tile from where it sits now — the page may have scrolled — and sets off
   * with the press: the navigator tells a page that is going nothing about
   * when its fade starts. The swipe back is left to the navigator: a hand
   * dragging the page can still change its mind.
   */
  const back = (): void => {
    if (!router.canGoBack()) {
      router.replace('/')
      return
    }
    const node = heroRef.current
    if (!handed || wide || !node) {
      router.back()
      return
    }
    node.measureInWindow((x, y, width, height) => {
      // Scrolled out of sight, it has nothing to carry back.
      if (width > 0 && y + height > 0) {
        aimAtTile(handed, x, y, width, height)
        spring(home, 1)
      }
      router.back()
    })
  }

  const head = (
    <View style={[styles.head, wide && styles.headWide, { paddingTop: top + 8 }]}>
      <CoverLight color={light.color} art={artistAlone ? (backdrop ?? leadArt) : null} />
      <View style={styles.topBar}>
        <IconButton label="Back" onPress={back} filled>
          <ChevronLeft size={20} tone="textPrimary" />
        </IconButton>
        {menu ? (
          <View ref={moreRef} collapsable={false}>
            <IconButton
              label={`More for ${placeName(place)}`}
              onPress={() => menu(moreRef.current)}
              filled
              testID="place-more"
            >
              <More size={18} tone="textPrimary" />
            </IconButton>
          </View>
        ) : null}
      </View>

      <Animated.View
        ref={heroRef}
        collapsable={false}
        onLayout={placeHero}
        style={[styles.hero, wide && styles.heroWide, grow]}
      >
        {artistAlone ? null : (
          <View style={styles.mosaic}>
            <PlaylistCover songIds={ids} size={wide ? 176 : 196} />
          </View>
        )}
        <View style={[styles.titles, wide && styles.titlesWide]}>
          <View style={styles.kind}>
            {place.kind === 'tag' ? (
              <View style={[styles.kindDot, { backgroundColor: tagColors(place.tag.hue).dot }]} />
            ) : (
              <User size={12} tone="textSecondary" />
            )}
            <Text style={styles.kindText}>{kindLabel}</Text>
          </View>
          <Text
            style={[styles.name, artistAlone && styles.nameSerif]}
            numberOfLines={2}
            accessibilityRole="header"
            testID="place-name"
          >
            {title}
          </Text>
          <Text style={styles.summary}>{summary}</Text>
          {combining ? (
            <Chips
              chosen={chosen}
              onRemove={entry => onChange(togglePlace(chosen, entry))}
              onAdd={() => setAdding(true)}
            />
          ) : null}
        </View>
        <View style={[styles.actions, wide && styles.actionsWide]}>
          <PlayButton
            testID="place-play"
            label={`Play ${title}`}
            icon={<Play size={24} color={theme.colors.onPrimary} />}
            disabled={ids.length === 0}
            onPress={() => {
              fly(heroRef.current, ids)
              player.playFrom(ids, 0, { source })
            }}
          />
          <Button
            testID="place-shuffle"
            accessibilityLabel={`Shuffle ${title}`}
            icon={<Shuffle size={16} tone="textPrimary" />}
            disabled={ids.length === 0}
            onPress={() => {
              fly(heroRef.current, ids)
              player.playShuffled(ids, source)
            }}
          />
          {combining ? null : (
            <Button
              testID="place-combine"
              label="Combine with…"
              accessibilityLabel={`Combine ${title} with another tag or artist`}
              icon={<Plus size={15} tone="textPrimary" />}
              onPress={() => setAdding(true)}
            />
          )}
        </View>
      </Animated.View>
    </View>
  )

  return (
    <View style={styles.screen}>
      <PlaceSongs
        songs={songs}
        source={source}
        byAlbum={artistAlone}
        head={head}
        label={`${title} songs`}
        scope={
          artistAlone ? 'by this artist' : only?.kind === 'tag' ? 'in this tag' : 'on this page'
        }
      />
      <AddSheet open={adding} chosen={chosen} onClose={() => setAdding(false)} onShow={combine} />
    </View>
  )
}

/** What is on, as chips: the first stays, the rest can be taken off; then Add. */
function Chips({
  chosen,
  onRemove,
  onAdd,
}: {
  chosen: readonly Place[]
  onRemove: (place: Place) => void
  onAdd: () => void
}): ReactNode {
  return (
    <View style={styles.chips}>
      {chosen.map((entry, index) => (
        <Chip
          key={placeKey(entry)}
          label={placeName(entry)}
          hue={entry.kind === 'tag' ? entry.tag.hue : undefined}
          icon={entry.kind === 'artist' ? <User size={12} tone="onPrimary" /> : undefined}
          selected
          compact
          onPress={() => undefined}
          onRemove={index > 0 || chosen.length > 1 ? () => onRemove(entry) : undefined}
        />
      ))}
      <Chip
        testID="place-add"
        label="Add a tag or artist"
        icon={<Text style={styles.plus}>+</Text>}
        selected={false}
        dashed
        compact
        onPress={onAdd}
      />
    </View>
  )
}

/**
 * The songs, in a list that only draws what is on screen. On an artist's
 * page each album starts with its own small heading.
 *
 * Selecting is the library's: hold a row (or Cmd/Shift-click it, or tick its
 * box on a computer) and the selection bar comes up — a lane above the list
 * on a computer, floating at the foot on a phone.
 */
function PlaceSongs({
  songs,
  source,
  byAlbum,
  head,
  label,
  scope,
}: {
  songs: readonly Song[]
  /** What Up next is called when a row plays the list, as the head's Play names it. */
  source: ListSource | null
  byAlbum: boolean
  head: ReactElement
  label: string
  /** What "all" means on this page, for the selection bar. */
  scope: string
}): ReactNode {
  const player = usePlayer()
  const artFor = useArt()
  const { wide } = useLayout()
  const { state: downloads } = useDownloads()
  const [menuSong, setMenuSong] = useState<Song | null>(null)
  const anchor = useRef<View | null>(null)
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const selection = useSelection(ids)
  // Newest first, or an artist's albums one after another: the scrollbar's bubble says which.
  const scrollLabel = useMemo(() => sortLabel(byAlbum ? 'album' : 'addedAt'), [byAlbum])
  const selectedSongs = useMemo(
    () => songs.filter(song => selection.has(song.id)),
    [songs, selection],
  )
  const latest = useRef({ ids, playFrom: player.playFrom, selection, source })
  useEffect(() => {
    latest.current = { ids, playFrom: player.playFrom, selection, source }
  }, [ids, player.playFrom, selection, source])

  const onPress = useCallback((event: GestureResponderEvent, song: Song) => {
    const { ids: now, playFrom, selection: selecting, source: named } = latest.current
    // Shift and Cmd, and a tap in selection mode, select; a plain tap plays.
    if (selecting.click(song.id, modifiersOf(event))) return
    const index = now.indexOf(song.id)
    if (index >= 0) playFrom(now, index, { source: named })
  }, [])
  const onMore = useCallback((node: View | null, song: Song) => {
    anchor.current = node
    setMenuSong(current => (current?.id === song.id ? null : song))
  }, [])
  // Holding a row selects it; the ⋯ opens the menu.
  const onLongPress = useCallback((song: Song) => latest.current.selection.enter(song.id), [])
  const onToggleSelect = useCallback((song: Song) => latest.current.selection.toggle(song.id), [])

  const renderSong = useCallback(
    ({ item, index }: { item: Song; index: number }) => {
      const row = (
        <SongRow
          testID={`place-song-${index}`}
          song={item}
          artUri={artFor(item)}
          downloaded={isDownloaded(downloads.index, item.id)}
          onPress={onPress}
          onMore={onMore}
          menuOpen={menuSong?.id === item.id}
          onLongPress={onLongPress}
          selecting={selection.active}
          selected={selection.has(item.id)}
          onToggleSelect={onToggleSelect}
          index={index}
        />
      )
      const previous = index > 0 ? songs[index - 1] : undefined
      if (!byAlbum || (previous && previous.album.trim() === item.album.trim())) return row
      return (
        <View>
          <AlbumHeading song={item} artUri={artFor(item)} />
          {row}
        </View>
      )
    },
    [
      artFor,
      downloads.index,
      onPress,
      onMore,
      onLongPress,
      onToggleSelect,
      selection,
      menuSong,
      byAlbum,
      songs,
    ],
  )

  // Always mounted, told when to show, so it rises and sinks rather than
  // appearing. On a computer it is in the list, at the head's foot, and stays
  // at the top once the head has scrolled away; a phone's floats at the foot.
  const bar = (
    <SelectionBar
      shown={selection.active}
      songs={selectedSongs}
      total={songs.length}
      scope={scope}
      allSelected={selection.allSelected}
      onSelectAll={selection.selectAll}
      onDeselectAll={selection.clear}
      onDone={selection.clear}
      inline={wide}
    />
  )

  return (
    <View style={styles.listArea}>
      {wide ? null : bar}
      <SongList
        songs={songs}
        label={label}
        renderSong={renderSong}
        header={head}
        pinned={wide ? bar : null}
        scrollLabel={scrollLabel}
        // On a phone the bar floats over the foot of the list; the last song
        // can scroll out from under it.
        contentContainerStyle={
          selection.active && !wide ? { paddingBottom: SELECTION_BAR_SPACE } : undefined
        }
      />
      <SongMenu song={menuSong} anchorRef={anchor} onClose={() => setMenuSong(null)} />
    </View>
  )
}

function AlbumHeading({
  song,
  artUri,
}: {
  song: Song
  artUri: string | null | undefined
}): ReactNode {
  const album = song.album.trim()
  return (
    <View style={styles.album}>
      <Cover uri={artUri} title={album || song.title} size={28} />
      <Text style={styles.albumName} numberOfLines={1}>
        {album || 'Other songs'}
      </Text>
      {song.year ? <Text style={styles.albumYear}>{song.year}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  listArea: { flex: 1, minHeight: 0 },
  // The light stays inside the head, so it never runs on under the rows.
  head: { paddingHorizontal: 20, paddingBottom: 16, gap: 18, overflow: 'hidden' },
  headWide: { paddingHorizontal: 40, paddingTop: 16 },
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
  hero: { gap: 16 },
  // The buttons go under the name when the page cannot hold all three abreast
  // (an iPad in portrait), rather than squeezing the name to nothing.
  heroWide: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 28 },
  mosaic: {
    alignSelf: 'flex-start',
    ...artShadow(theme.colors),
    borderRadius: radius.card,
  },
  titles: { gap: 6, flexShrink: 1, minWidth: 0 },
  titlesWide: { flexGrow: 1, flexBasis: 220 },
  kind: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kindDot: { width: 7, height: 7, borderRadius: 3.5 },
  kindText: labelText(theme.colors),
  name: {
    color: theme.colors.textPrimary,
    fontFamily: fonts.display,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -0.8,
  },
  nameSerif: { fontFamily: fonts.serif, fontSize: 52, lineHeight: 60, letterSpacing: -0.5 },
  summary: { color: theme.colors.textSecondary, fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  plus: { color: theme.colors.textSecondary, fontSize: 14 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  actionsWide: { marginLeft: 'auto', paddingBottom: 6 },
  album: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 6,
  },
  albumName: {
    color: theme.colors.textPrimary,
    fontSize: type.body,
    fontWeight: '600',
    flexShrink: 1,
  },
  albumYear: { color: theme.colors.textMuted, fontSize: 13 },
}))
