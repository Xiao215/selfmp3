import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import type { LayoutChangeEvent } from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { StyleSheet, ScopedTheme } from 'react-native-unistyles'
import { plural, type MapPlace } from '@selfmp3/shared'
import {
  clientApi,
  iconSize,
  isLoop,
  loopName,
  nearestSongs,
  pathName,
  queryKeys,
  songsAlongPath,
  songsInside,
  space,
  tagRegions,
  uniqueName,
  useCreatePlaylist,
  useLibrary,
  useSoundMap,
} from '@selfmp3/client'
import { usePlayerCommands, usePlayingSongId } from '../../player/PlayerProvider'
import { useFloatingChrome } from '../../shell/bottomInset'
import { setPageFoot } from '../../shell/pageFoot'
import { useLayoutValue } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { Chip } from '../../ui/components/Chip'
import { EmptyState } from '../../ui/components/EmptyState'
import { IconButton } from '../../ui/components/IconButton'
import { DrawLine, Expand, Locate, Minus, Plus, SoundMap } from '../../ui/components/Icons'
import { PageHeader } from '../../ui/components/PageHeader'
import { PageLoading } from '../../ui/components/PageLoading'
import { pageFrame } from '../../ui/surfaces'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { showFailure, showToast, showUndoToast } from '../../ui/toast'
import { newPlaylist } from '../playlists/playlists.model'
import { FieldControl } from './fieldControl'
import { useShiftHeld } from './fieldInput'
import { MapHint, useMapHint } from './MapHint'
import { MapTray } from './MapTray'
import { SoundField } from './SoundField'
import { chainAlong, lensTags, skyPoints, skyRegions, type MapTake } from './sky.model'

/** A drawn stroke's points closer than this (0–1) are one point. */
const PATH_STEP = 0.004
/** A stroke that ends within this many reaches of where it began has gone round: a loop. */
const LOOP_CLOSE = 2.5

/**
 * `/sound-map` (docs/features/sound-map.md): the library as a night sky,
 * songs heard as alike together, each a star in its cover's colour and
 * brighter the more it is played, with the tags as nebulae where they gather.
 *
 * The map fills the page: on a phone no tab bar, only the mini player; on a
 * computer the sidebar and the player bar stay. Over it, the way back and the
 * name, the tags as chips that light their own songs and fly to them, and in
 * the corner the pen and the way to the song playing.
 *
 * A tap plays the songs nearest it. Holding, then dragging, draws: a line
 * takes the songs along it as a drift from one place to the other, a loop
 * the songs inside. Each stroke goes into the tray at the foot, to play, add
 * to Up next or save as a playlist.
 *
 * `?song=` opens it on a song (Show on the map); `?draw=1` with the pen ready
 * (New playlist's Draw it on the map).
 */
export function SoundMapScreen(): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  const params = useLocalSearchParams<{ song?: string; draw?: string }>()
  const { data: library } = useLibrary()
  const { data: map, isLoading } = useSoundMap()
  const player = usePlayerCommands()
  const playing = usePlayingSongId()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { mutateAsync: createPlaylist } = useCreatePlaylist()
  const chrome = useFloatingChrome()
  const [control] = useState(() => new FieldControl())
  useEffect(() => () => setPageFoot(0), [])

  const songs = useMemo(
    () => new Map((library?.songs ?? []).map(song => [song.id, song])),
    [library],
  )
  const tags = useMemo(() => library?.tags ?? [], [library])
  const places = useMemo(
    () => (map?.places ?? []).filter(place => songs.has(place.id)),
    [map, songs],
  )
  const points = useMemo(() => skyPoints(places, songs), [places, songs])
  const allRegions = useMemo(() => tagRegions(places, songs, tags), [places, songs, tags])
  const [lens, setLens] = useState<number | null>(null)
  const regions = useMemo(() => skyRegions(allRegions, lens), [allRegions, lens])
  const chips = useMemo(() => lensTags(tags, points), [tags, points])
  useEffect(() => {
    if (places.length === 0) return
    let x0 = 1
    let y0 = 1
    let x1 = 0
    let y1 = 0
    for (const place of places) {
      x0 = Math.min(x0, place.x)
      y0 = Math.min(y0, place.y)
      x1 = Math.max(x1, place.x)
      y1 = Math.max(y1, place.y)
    }
    control.setBounds({ x0, y0, x1, y1 })
  }, [control, places])

  // Opened on a song: Show on the map.
  const opened = useRef(false)
  useEffect(() => {
    if (opened.current || !params.song || places.length === 0) return
    opened.current = true
    const place = places.find(each => each.id === Number(params.song))
    if (place) control.flyToSong(place, true)
    else showToast('That song isn’t on the map yet: it’s placed once it has been heard')
  }, [control, params.song, places])

  const shift = useShiftHeld()
  const [pen, setPen] = useState(params.draw === '1')
  const armed = pen || shift

  const hint = useMapHint(points.length > 0)

  // What the tray holds: every stroke since it was cleared, and the songs left out of it.
  const [takes, setTakes] = useState<readonly MapTake[]>([])
  const [left, setLeft] = useState<ReadonlySet<number>>(new Set())
  const [trayOpen, setTrayOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const trayIds = useMemo(() => {
    const seen = new Set<number>()
    const out: number[] = []
    for (const take of takes) {
      for (const id of take.ids) {
        if (seen.has(id) || left.has(id)) continue
        seen.add(id)
        out.push(id)
      }
    }
    return out
  }, [takes, left])
  const traySongs = useMemo(() => trayIds.flatMap(id => songs.get(id) ?? []), [trayIds, songs])
  const trayName = useMemo(
    () => [...new Set(takes.map(take => take.name).filter(Boolean))].join(' · '),
    [takes],
  )
  const clearTray = (): void => {
    setTakes([])
    setLeft(new Set())
    setTrayOpen(false)
  }

  // The stroke being drawn.
  const [stroke, setStroke] = useState<readonly MapPlace[]>([])
  const strokeRef = useRef<MapPlace[]>([])
  const reach = useRef(0.03)

  const onPress = useCallback(
    (spot: MapPlace) => {
      const ids = nearestSongs(places, spot)
      const first = songs.get(ids[0] ?? -1)
      if (!first) return
      player.playFrom(ids, 0, {
        source: { kind: 'songs', origin: 'map', name: `Near ${first.title}` },
      })
    },
    [places, songs, player],
  )
  const onPathStart = useCallback((spot: MapPlace) => {
    strokeRef.current = [spot]
    setStroke([spot])
  }, [])
  const onPathMove = useCallback((spot: MapPlace, within: number) => {
    reach.current = within
    const last = strokeRef.current[strokeRef.current.length - 1]
    if (last && Math.hypot(spot.x - last.x, spot.y - last.y) < PATH_STEP) return
    strokeRef.current = [...strokeRef.current, spot]
    setStroke(strokeRef.current)
  }, [])
  const { done: hintDone } = hint
  const onPathEnd = useCallback(() => {
    const drawn = strokeRef.current
    strokeRef.current = []
    setStroke([])
    if (drawn.length < 2) return
    setPen(false)
    hintDone()
    const loop = isLoop(drawn, reach.current * LOOP_CLOSE)
    const ids = loop
      ? songsInside(places, drawn, songs)
      : songsAlongPath(places, drawn, reach.current, songs)
    // Nothing taken: the stroke simply goes, as it came, with no word about it.
    if (ids.length === 0) return
    const take: MapTake = {
      kind: loop ? 'loop' : 'line',
      name: loop ? loopName(places, ids, songs, tags) : pathName(places, drawn, songs, tags),
      ids,
      chain: loop ? ids : chainAlong(places, drawn, ids),
      path: drawn,
    }
    setTakes(before => [...before, take])
  }, [places, songs, tags, hintDone])

  const playTray = (): void => {
    if (trayIds.length === 0) return
    player.playFrom(trayIds, 0, { source: { kind: 'songs', origin: 'map', name: trayName } })
  }
  const upNextTray = (): void => {
    if (trayIds.length === 0) return
    player.addToQueue(trayIds)
    showToast(`Added ${plural(trayIds.length, 'song', 'songs')} to Up next`, 'good')
  }
  const saveTray = (): void => {
    if (trayIds.length === 0 || saving) return
    const name = uniqueName(
      trayName || 'From the sound map',
      (library?.playlists ?? []).map(list => list.name),
    )
    const input = newPlaylist('manual', name)
    if (!input) return
    setSaving(true)
    void (async () => {
      try {
        const created = await createPlaylist({ input, songIds: trayIds, refresh: 'wait' })
        clearTray()
        showUndoToast(
          { over: 'Saved as a playlist', say: created.name },
          async () => {
            await clientApi().deletePlaylist(created.id)
            await queryClient.invalidateQueries({ queryKey: queryKeys.library })
          },
          {
            tone: 'good',
            failed: 'Couldn’t undo that',
            also: [
              {
                label: 'Open',
                onPress: () =>
                  router.navigate({
                    pathname: '/playlists/[id]',
                    params: { id: String(created.id) },
                  }),
              },
            ],
          },
        )
      } catch (caught) {
        showFailure(`Couldn’t save “${name}”`, caught)
      } finally {
        setSaving(false)
      }
    })()
  }

  const locate = (): void => {
    const place = playing === null ? undefined : places.find(each => each.id === playing)
    if (place) control.flyToSong(place)
    else
      showToast(playing === null ? 'Nothing is playing' : 'The song playing isn’t on the map yet')
  }
  const pickLens = (tagId: number): void => {
    if (lens === tagId) {
      setLens(null)
      control.fit()
      return
    }
    setLens(tagId)
    control.flyToPlaces(points.filter(point => point.tagIds.includes(tagId)))
  }

  // What the page lays over the field, which fitting and flying keep clear of:
  // its head, and the tray as it is folded (opened, it lies over the map for a while).
  const [head, setHead] = useState(0)
  const [tray, setTray] = useState(0)
  const [folded, setFolded] = useState(0)
  const [tools, setTools] = useState(0)
  const bottom = (wide ? 0 : chrome) + space.md
  const trayRoom = takes.length > 0 ? folded : 0
  useEffect(() => {
    control.setInsets({ top: head, bottom: bottom + trayRoom })
  }, [control, head, bottom, trayRoom])
  const onTray = (event: LayoutChangeEvent): void => {
    const height = event.nativeEvent.layout.height
    setTray(height)
    if (!trayOpen) setFolded(height)
  }
  // On a phone the buttons stand over the folded tray, and stay there when it
  // opens over them; on a computer they are beside it, at the foot.
  const toolsBottom = wide || trayRoom === 0 ? 0 : trayRoom + space.sm
  // The toasts rise above the tray and the buttons rather than cover Play or the pen.
  useEffect(() => {
    setPageFoot(Math.max(tray, toolsBottom + tools) + space.md)
  }, [tray, toolsBottom, tools])

  const [field, setField] = useState<{ width: number; height: number } | null>(null)
  const shown = places.length > 0

  return (
    <ScopedTheme name="dark">
      <View style={styles.screen} testID="sound-map-screen">
        {isLoading && !map ? (
          <PageLoading />
        ) : !shown ? (
          <SafeAreaView style={styles.empty} edges={['top']}>
            <View style={styles.emptyHead}>
              <BackButton to="/" testID="sound-map-back" />
            </View>
            <EmptyState
              icon={<SoundMap tone="textSecondary" />}
              title="Nothing on the map yet"
              line="Each song is placed once it has been heard."
              testID="sound-map-empty"
            />
          </SafeAreaView>
        ) : (
          <>
            <View
              style={StyleSheet.absoluteFill}
              onLayout={event =>
                setField({
                  width: event.nativeEvent.layout.width,
                  height: event.nativeEvent.layout.height,
                })
              }
            >
              <SoundField
                control={control}
                armed={armed}
                points={points}
                songs={songs}
                regions={regions}
                lens={lens}
                takes={takes}
                stroke={stroke}
                onPress={onPress}
                onPathStart={onPathStart}
                onPathMove={onPathMove}
                onPathEnd={onPathEnd}
              />
            </View>

            <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
              <View
                style={[styles.head, pageFrame(wide)]}
                pointerEvents="box-none"
                onLayout={event =>
                  setHead(event.nativeEvent.layout.y + event.nativeEvent.layout.height)
                }
              >
                <PageHeader title="Sound map" back={{ to: '/', testID: 'sound-map-back' }} />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={[
                    styles.chips,
                    wide ? styles.chipsWide : styles.chipsPhone,
                  ]}
                  style={wide ? styles.chipRowWide : styles.chipRowPhone}
                  testID="sound-map-lens"
                >
                  {chips.map(tag => (
                    <Chip
                      key={tag.id}
                      label={tag.name}
                      hue={tag.hue}
                      count={lens === tag.id ? tag.count : undefined}
                      selected={lens === tag.id}
                      compact
                      onPress={() => pickLens(tag.id)}
                      accessibilityLabel={
                        lens === tag.id ? `Show every tag again` : `Light the ${tag.name} songs`
                      }
                      testID={`sound-map-lens-${tag.id}`}
                    />
                  ))}
                </ScrollView>
              </View>
            </SafeAreaView>

            <View
              style={[styles.tools, wide && styles.toolsWide, { bottom: bottom + toolsBottom }]}
              pointerEvents="box-none"
              onLayout={event => setTools(event.nativeEvent.layout.height)}
            >
              {wide ? (
                <>
                  <IconButton
                    label="Zoom in"
                    filled
                    onPress={() => control.zoomBy(1.6)}
                    testID="sound-map-zoom-in"
                  >
                    <Plus size={iconSize.item} tone="textPrimary" />
                  </IconButton>
                  <IconButton
                    label="Zoom out"
                    filled
                    onPress={() => control.zoomBy(1 / 1.6)}
                    testID="sound-map-zoom-out"
                  >
                    <Minus size={iconSize.item} tone="textPrimary" />
                  </IconButton>
                  <IconButton
                    label="Show all"
                    filled
                    onPress={() => control.fit()}
                    testID="sound-map-fit"
                  >
                    <Expand size={iconSize.item} tone="textPrimary" />
                  </IconButton>
                </>
              ) : null}
              <IconButton
                label="Find the song playing"
                filled
                onPress={locate}
                testID="sound-map-locate"
              >
                <Locate size={iconSize.item} tone="textPrimary" />
              </IconButton>
              <IconButton
                label={pen ? 'Stop drawing' : 'Draw a line or a loop'}
                caption={wide ? 'Draw (or hold Shift)' : undefined}
                filled={pen ? 'accent' : true}
                active={pen}
                onPress={() => setPen(on => !on)}
                testID="sound-map-pen"
              >
                <DrawLine size={iconSize.item} tone={pen ? 'onAccent' : 'textPrimary'} />
              </IconButton>
            </View>

            {takes.length > 0 ? (
              <View
                style={[styles.tray, wide && styles.trayWide, { bottom }]}
                pointerEvents="box-none"
                onLayout={onTray}
              >
                <MapTray
                  name={trayName}
                  songs={traySongs}
                  open={trayOpen}
                  saving={saving}
                  onOpen={setTrayOpen}
                  onRemove={id => setLeft(before => new Set(before).add(id))}
                  onClear={clearTray}
                  onPlay={playTray}
                  onSave={saveTray}
                  onUpNext={upNextTray}
                />
              </View>
            ) : null}

            {hint.shown && field ? <MapHint field={field} onDone={hint.done} /> : null}
          </>
        )}
      </View>
    </ScopedTheme>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: '#04050b' },
  empty: { flex: 1, backgroundColor: theme.colors.surface0 },
  emptyHead: { padding: space.md },
  top: { position: 'absolute', left: 0, right: 0, top: 0 },
  head: { gap: space.md },
  chipRowPhone: { flexGrow: 0, marginHorizontal: -space.gutter },
  chipRowWide: { flexGrow: 0, marginHorizontal: -space.gutterWide },
  chips: { gap: space.xs },
  chipsPhone: { paddingHorizontal: space.gutter },
  chipsWide: { paddingHorizontal: space.gutterWide },
  tools: { position: 'absolute', right: space.md, gap: space.sm, zIndex: 1 },
  toolsWide: { right: space.gutterWide },
  // Over the buttons once opened, as a sheet is.
  tray: { position: 'absolute', left: space.sm, right: space.sm, zIndex: 2 },
  trayWide: { left: 0, right: 0, alignSelf: 'center', marginHorizontal: 'auto', maxWidth: 560 },
}))
