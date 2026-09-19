import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Image, Text, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import type { Song } from '@selfmp3/shared'
import { fonts, isDownloaded, radius, tagColors, type, useLibrary } from '@selfmp3/client'
import { useDownloads } from '../../offline/DownloadsProvider'
import { useArt } from '../../offline/useArt'
import { usePlayer } from '../../player/PlayerProvider'
import { glassBlur } from '../../ports/glassBlur'
import { useLayout } from '../../shell/useLayout'
import { Button, PlayButton } from '../../ui/components/Button'
import { Chip } from '../../ui/components/Chip'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronLeft, More, Play, Shuffle, User } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SongList } from '../../ui/components/SongList'
import { SongMenu } from '../../ui/components/SongMenu'
import { SongRow } from '../../ui/components/SongRow'
import { useSongColor } from '../../ui/useSongColor'
import { label as labelText } from '../../ui/surfaces'
import { useSaveTagsAsPlaylist } from '../library/saveTags'
import { PlaylistCover } from '../playlists/PlaylistCover'
import { AddSheet } from './AddSheet'
import {
  albumsOf,
  artistSummary,
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
 * It opens on the one place its address names, lit by that place's covers,
 * with Play, Shuffle and Add. Add puts more tags and artists beside it and
 * every one **adds** its songs; the chips under the name say what is on.
 * Rows carry no tag chips here: inside a place, the place is the tag.
 *
 * An artist's page is the same page with a figure where a tag has its dot,
 * its name in the serif, and its songs by album.
 */
export function PlacePage({
  place,
  menu,
}: {
  place: Place
  /** The ⋯ in the corner: what this kind of place offers. */
  menu?: (anchor: View | null) => void
}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide } = useLayout()
  const player = usePlayer()
  const artFor = useArt()
  const { data: library } = useLibrary()
  const [chosen, setChosen] = useState<readonly Place[]>([place])
  const [adding, setAdding] = useState(false)
  const moreRef = useRef<View>(null)
  const saved = useSaveTagsAsPlaylist()

  const only = chosen.length === 1 ? chosen[0] : undefined
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

  const title = chosen.map(placeName).join(' + ') || placeName(place)
  const summary = artistAlone ? artistSummary(songs) : placeSummary(songs)
  const allTags = chosen.every(entry => entry.kind === 'tag')
  const back = (): void => {
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  const head = (
    <View style={[styles.head, wide && styles.headWide]}>
      <Light color={light.color} art={artistAlone ? leadArt : null} />
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

      <View style={[styles.hero, wide && styles.heroWide]}>
        {artistAlone ? null : (
          <View style={styles.mosaic}>
            <PlaylistCover songIds={ids} size={wide ? 176 : 196} />
          </View>
        )}
        <View style={styles.titles}>
          <View style={styles.kind}>
            {place.kind === 'tag' ? (
              <View style={[styles.kindDot, { backgroundColor: tagColors(place.tag.hue).dot }]} />
            ) : (
              <User size={12} tone="textSecondary" />
            )}
            <Text style={styles.kindText}>{place.kind === 'tag' ? 'Tag' : 'Artist'}</Text>
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
          {artistAlone ? null : (
            <Chips
              chosen={chosen}
              onRemove={entry => setChosen(current => togglePlace(current, entry))}
              onAdd={() => setAdding(true)}
            />
          )}
        </View>
        <View style={[styles.actions, wide && styles.actionsWide]}>
          <PlayButton
            testID="place-play"
            label={`Play ${title}`}
            icon={<Play size={24} color={theme.colors.onPrimary} />}
            disabled={ids.length === 0}
            onPress={() => player.playFrom(ids, 0)}
          />
          <Button
            testID="place-shuffle"
            label="Shuffle"
            icon={<Shuffle size={16} tone="textPrimary" />}
            disabled={ids.length === 0}
            onPress={() => player.playShuffled(ids)}
          />
          {artistAlone ? (
            <Chip
              testID="place-add"
              label="Add"
              icon={<Text style={styles.plus}>+</Text>}
              selected={false}
              dashed
              onPress={() => setAdding(true)}
            />
          ) : null}
          {wide && allTags ? (
            <Button
              testID="place-save"
              label={saved.savedName === title ? 'Saved' : 'Save as playlist'}
              busy={saved.saving}
              disabled={saved.savedName === title}
              onPress={() =>
                saved.save({
                  name: title,
                  tagIds: chosen.flatMap(entry => (entry.kind === 'tag' ? [entry.tag.id] : [])),
                  sort: 'addedAt',
                  descending: true,
                })
              }
            />
          ) : null}
        </View>
      </View>
    </View>
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <PlaceSongs songs={songs} byAlbum={artistAlone} head={head} label={`${title} songs`} />
      <AddSheet
        open={adding}
        chosen={chosen}
        onClose={() => setAdding(false)}
        onShow={places => {
          setAdding(false)
          if (places.length > 0) setChosen(places)
        }}
      />
    </SafeAreaView>
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
 * The page lit by its covers: the lead cover's colour washing down from the
 * top, and on an artist's page the cover itself behind the name, fading into
 * the ground.
 */
function Light({ color, art }: { color: string; art: string | null }): ReactNode {
  const { theme } = useUnistyles()
  const id = `placelight${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <View pointerEvents="none" style={styles.light}>
      {art ? <Image source={{ uri: art }} style={styles.lightArt} resizeMode="cover" /> : null}
      <Svg width="100%" height="100%" preserveAspectRatio="none" style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity={art ? 0.25 : 0.45} />
            <Stop offset="0.45" stopColor={theme.colors.surface0} stopOpacity={art ? 0.75 : 0.4} />
            <Stop offset="1" stopColor={theme.colors.surface0} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  )
}

/**
 * The songs, in a list that only draws what is on screen. On an artist's
 * page each album starts with its own small heading.
 */
function PlaceSongs({
  songs,
  byAlbum,
  head,
  label,
}: {
  songs: readonly Song[]
  byAlbum: boolean
  head: ReactElement
  label: string
}): ReactNode {
  const player = usePlayer()
  const artFor = useArt()
  const { state: downloads } = useDownloads()
  const [menuSong, setMenuSong] = useState<Song | null>(null)
  const anchor = useRef<View | null>(null)
  const ids = useMemo(() => songs.map(song => song.id), [songs])
  const latest = useRef({ ids, playFrom: player.playFrom })
  useEffect(() => {
    latest.current = { ids, playFrom: player.playFrom }
  }, [ids, player.playFrom])

  const onPress = useCallback((_event: GestureResponderEvent, song: Song) => {
    const { ids: now, playFrom } = latest.current
    const index = now.indexOf(song.id)
    if (index >= 0) playFrom(now, index)
  }, [])
  const onMore = useCallback((node: View | null, song: Song) => {
    anchor.current = node
    setMenuSong(current => (current?.id === song.id ? null : song))
  }, [])

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
    [artFor, downloads.index, onPress, onMore, menuSong, byAlbum, songs],
  )

  return (
    <>
      <SongList songs={songs} label={label} renderSong={renderSong} header={head} />
      <SongMenu song={menuSong} anchorRef={anchor} onClose={() => setMenuSong(null)} />
    </>
  )
}

function AlbumHeading({ song, artUri }: { song: Song; artUri: string | null }): ReactNode {
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
  // The light stays inside the head, so it never runs on under the rows.
  head: { paddingHorizontal: 20, paddingBottom: 16, gap: 18, overflow: 'hidden' },
  headWide: { paddingHorizontal: 40, paddingTop: 16 },
  light: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  lightArt: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.35 },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 8,
    ...glassBlur,
  },
  hero: { gap: 16 },
  heroWide: { flexDirection: 'row', alignItems: 'flex-end', gap: 28 },
  mosaic: {
    alignSelf: 'flex-start',
    boxShadow: '0 14px 34px rgba(0, 0, 0, 0.35)',
    borderRadius: radius.card,
  },
  titles: { gap: 6, flexShrink: 1, minWidth: 0 },
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
  nameSerif: { fontFamily: fonts.serif, fontSize: 52, lineHeight: 56, letterSpacing: -0.5 },
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
