import { useId } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet as NativeStyleSheet, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { fonts, withAlpha } from '@selfmp3/client'
import { Cover } from '../../../ui/components/Cover'
import { lookInk, wallLook } from '../looks.model'
import type { LookProps } from './parts'

/** `P35`'s poster: three covers across, four down. */
export const WALL_SIZE = { width: 480, height: 720 } as const

const TILE_W = WALL_SIZE.width / 3
const TILE_H = WALL_SIZE.height / 4

/**
 * Wall (`P35`): the period's covers edge to edge, darkening to the ground at
 * the foot, and the minutes set over them. The only colour on it is the
 * covers' own.
 */
export function WallLook({ input, hue, art }: LookProps): ReactNode {
  const look = wallLook(input)
  const ink = lookInk('wall', hue)
  // An SVG gradient's id is global to a web page; one per wall.
  const fade = `wallfade${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <View style={[styles.poster, { backgroundColor: ink.ground }]}>
      <View style={styles.tiles}>
        {look.tiles.map((tile, i) => (
          <View key={i} style={styles.tile}>
            {/* Square covers in taller cells: the cover is drawn to the cell's height and cropped. */}
            <Cover uri={art(tile.songId)} title={tile.title} size={TILE_H} radius={0} />
          </View>
        ))}
      </View>
      <Svg
        style={NativeStyleSheet.absoluteFill}
        width="100%"
        height="100%"
        preserveAspectRatio="none"
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id={fade} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={ink.ground} stopOpacity={0.15} />
            <Stop offset="0.45" stopColor={ink.ground} stopOpacity={0.55} />
            <Stop offset="1" stopColor={ink.ground} stopOpacity={0.95} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${fade})`} />
      </Svg>

      <View style={styles.words}>
        <Text style={[styles.title, { color: ink.ink }]}>{look.title}</Text>
        <Text style={[styles.figure, { color: ink.ink }]} numberOfLines={1}>
          {look.figure}
        </Text>
        <Text style={[styles.line, { color: withAlpha(ink.ink, 0.85) }]}>{look.line}</Text>
        <View style={styles.figures}>
          {look.figures.map(item => (
            <Text
              key={item.label}
              style={[styles.fact, { color: withAlpha(ink.ink, 0.85) }]}
              numberOfLines={1}
            >
              <Text style={[styles.factValue, { color: ink.ink }]}>{item.value}</Text> {item.label}
            </Text>
          ))}
        </View>
        <Text style={[styles.foot, { color: ink.second }]}>{look.foot}</Text>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  poster: { width: WALL_SIZE.width, height: WALL_SIZE.height, overflow: 'hidden' },
  tiles: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  tile: {
    width: TILE_W,
    height: TILE_H,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { position: 'absolute', left: 32, right: 32, bottom: 34, gap: 10 },
  title: { fontFamily: fonts.serifItalic, fontSize: 40, lineHeight: 42 },
  figure: { fontFamily: fonts.serif, fontSize: 150, lineHeight: 140, letterSpacing: -6 },
  line: { fontSize: 17, lineHeight: 22 },
  figures: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 18, rowGap: 4, paddingTop: 6 },
  fact: { fontSize: 13, maxWidth: 220 },
  factValue: { fontWeight: '700' },
  foot: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    paddingTop: 8,
  },
})
