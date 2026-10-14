import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { StyleSheet as NativeStyleSheet, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { hasColour, plural, type CoverTone, type Song } from '@selfmp3/shared'
import {
  darkPalette,
  failureText,
  fonts,
  neutralWash,
  radius,
  songColors,
  withAlpha,
} from '@selfmp3/client'
import { sharePicture } from '../../ports/sharePicture'
import { useArt } from '../../offline/useArt'
import { showToast } from '../../ui/toast'
import { BrandMark } from '../../ui/components/BrandMark'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { useSvgId } from '../../ui/useSvgId'
import { RoomQr } from '../room/RoomQr'

/**
 * A link as a picture (docs/features/share-links.md, "Why a picture"): what WeChat gets,
 * since it draws no card for a link pasted from this site. It is how 网易云 and
 * QQ音乐 send a song there: the cover big, the names under it, and the link's
 * QR code at the foot for the friend to press and hold.
 *
 * Drawn at `POSTER_SIZE` and saved at three times that, 1080 × 1920. Always in
 * the dark theme's inks, whatever this device shows: it is a picture, looked at
 * on someone else's phone.
 */
const POSTER_SIZE = { width: 360, height: 640 } as const
const POSTER_PIXELS = { width: POSTER_SIZE.width * 3, height: POSTER_SIZE.height * 3 }
const ART = 280
const DARK = darkPalette()

/** How long it waits for a cover that does not come, before it is saved without it. */
const WAIT_MS = 8000

interface PosterProps {
  /** The song's title, or the list's name. */
  name: string
  kind: 'song' | 'list'
  /** Your songs in the link, in its order: the covers are your library's own. */
  songs: readonly Song[]
  /** How many songs the link holds. */
  count: number
  /** Your name, as the link carries it. */
  from: string
  url: string
  /** What the picture is saved as. */
  fileName: string
}

/**
 * Share as picture: the poster drawn off-screen at its own size, so the
 * picture is sharp and nothing on screen moves, saved once its covers are in
 * (or after `WAIT_MS` without one), and handed on (ports/sharePicture).
 */
export function SharePictureButton(props: PosterProps): ReactNode {
  const poster = useRef<View>(null)
  const [making, setMaking] = useState(false)
  // One picture per press, however the covers and the wait race.
  const saved = useRef(true)

  const save = useCallback(async (): Promise<void> => {
    if (saved.current) return
    saved.current = true
    // A frame for the last cover's picture to reach the screen.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    try {
      const how = await sharePicture(poster.current, props.fileName, POSTER_PIXELS)
      if (how === 'saved') showToast('Picture saved', 'good')
    } catch (error) {
      showToast(failureText('Couldn’t make the picture', error), 'error')
    } finally {
      setMaking(false)
    }
  }, [props.fileName])
  const ready = useCallback(() => void save(), [save])

  useEffect(() => {
    if (!making) return undefined
    const timer = setTimeout(ready, WAIT_MS)
    return () => clearTimeout(timer)
  }, [making, ready])

  return (
    <>
      <Button
        label={making ? 'Making the picture…' : 'Share as picture'}
        busy={making}
        onPress={() => {
          saved.current = false
          setMaking(true)
        }}
        testID="share-sheet-picture"
      />
      {making ? (
        <View
          style={styles.offScreen}
          pointerEvents="none"
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <SharePoster {...props} posterRef={poster} onReady={ready} />
        </View>
      ) : null}
    </>
  )
}

/**
 * The covers it shows: a song's own; a list's first four with pictures, as a
 * playlist's mosaic is (`PlaylistCover`), or the first alone when fewer have one.
 */
function posterCovers(kind: 'song' | 'list', songs: readonly Song[]): readonly Song[] {
  if (kind === 'song') return songs.slice(0, 1)
  const withArt = songs.filter(song => song.hasArt)
  if (withArt.length >= 4) return withArt.slice(0, 4)
  const first = withArt[0] ?? songs[0]
  return first ? [first] : []
}

/** The colour washing down from the top: the cover's, as a playing song's is (`songColors`). */
function washOf(tone: CoverTone | null): string | null {
  if (!tone) return null
  return hasColour(tone) ? songColors(tone, 'dark').color : neutralWash(tone, 'dark')
}

function SharePoster({
  posterRef,
  name,
  kind,
  songs,
  count,
  from,
  url,
  onReady,
}: PosterProps & {
  posterRef: RefObject<View | null>
  /** Every cover is drawn: it can be saved. */
  onReady: () => void
}): ReactNode {
  const artFor = useArt()
  const covers = useMemo(() => posterCovers(kind, songs), [kind, songs])
  const lead = covers[0] ?? null
  const wash = washOf(lead?.coverTone ?? null)
  const light = useSvgId('posterlight')

  // Ready once each cover has said it is drawn, as a picture or as its letter.
  const drawn = useRef(new Set<number>())
  const tiles = Math.max(1, covers.length)
  const told = useCallback(
    (id: number) => {
      drawn.current.add(id)
      if (drawn.current.size >= tiles) onReady()
    },
    [tiles, onReady],
  )

  const line = kind === 'song' ? (lead?.artist ?? '') : plural(count, 'song', 'songs')
  return (
    <View ref={posterRef} collapsable={false} style={styles.poster}>
      {wash ? (
        <Svg
          style={NativeStyleSheet.absoluteFill}
          width="100%"
          height="100%"
          preserveAspectRatio="none"
        >
          <Defs>
            <LinearGradient id={light} x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={wash} stopOpacity={0.75} />
              <Stop offset="0.5" stopColor={wash} stopOpacity={0.22} />
              <Stop offset="1" stopColor={wash} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Rect width="100%" height="100%" fill={`url(#${light})`} />
        </Svg>
      ) : null}

      <View style={styles.art}>
        {covers.length === 4 ? (
          <View style={styles.mosaic}>
            {covers.map(song => (
              <PosterCover
                key={song.id}
                id={song.id}
                uri={artFor(song)}
                title={song.album || song.title}
                size={ART / 2}
                corner={0}
                onDrawn={told}
              />
            ))}
          </View>
        ) : (
          <PosterCover
            id={lead?.id ?? 0}
            uri={lead ? artFor(lead) : null}
            title={lead ? lead.album || lead.title : name}
            size={ART}
            corner={radius.card}
            onDrawn={told}
          />
        )}
      </View>

      <Text style={styles.title} numberOfLines={2}>
        {name}
      </Text>
      {line ? (
        <Text style={styles.line} numberOfLines={1}>
          {line}
        </Text>
      ) : null}

      <View style={styles.foot}>
        <View style={styles.words}>
          <View style={styles.brand}>
            <BrandMark size={26} color={DARK.textPrimary} />
            <Text style={styles.brandName}>self.mp3</Text>
          </View>
          <Text style={styles.scan} numberOfLines={2}>
            {from} shared this · scan to listen
          </Text>
        </View>
        <RoomQr text={url} size={88} />
      </View>
    </View>
  )
}

/** One cover, telling the poster once it is drawn. */
function PosterCover({
  id,
  uri,
  title,
  size,
  corner,
  onDrawn,
}: {
  id: number
  uri: string | null | undefined
  title: string
  size: number
  corner: number
  onDrawn: (id: number) => void
}): ReactNode {
  const drawn = useCallback(() => onDrawn(id), [id, onDrawn])
  return <Cover uri={uri} title={title} size={size} radius={corner} onDrawn={drawn} />
}

const styles = StyleSheet.create({
  // Its own size, left of the screen: drawn and laid out, never seen.
  offScreen: { position: 'absolute', left: -10000, top: 0 },
  poster: {
    width: POSTER_SIZE.width,
    height: POSTER_SIZE.height,
    overflow: 'hidden',
    alignItems: 'center',
    paddingTop: 64,
    paddingHorizontal: 32,
    backgroundColor: DARK.surface0,
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: radius.card,
    backgroundColor: DARK.surface2,
    boxShadow: `0 18px 40px ${withAlpha('#000000', 0.55)}`,
  },
  mosaic: {
    width: ART,
    height: ART,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  title: {
    marginTop: 36,
    alignSelf: 'stretch',
    color: DARK.textPrimary,
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    textAlign: 'center',
  },
  line: {
    marginTop: 8,
    alignSelf: 'stretch',
    color: DARK.textSecondary,
    fontSize: 17,
    lineHeight: 23,
    textAlign: 'center',
  },
  foot: {
    position: 'absolute',
    left: 28,
    right: 28,
    bottom: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  words: { flex: 1, minWidth: 0, gap: 6 },
  // The mark's own grid leaves room round the notes: no more gap is needed.
  brand: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  brandName: { color: DARK.textPrimary, fontFamily: fonts.display, fontSize: 18 },
  scan: { color: DARK.textSecondary, fontSize: 13, lineHeight: 18 },
})
