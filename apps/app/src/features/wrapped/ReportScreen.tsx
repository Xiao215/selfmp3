import { useCallback, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { WrappedRange } from '@selfmp3/shared'
import { lightPalette, useLibrary, withAlpha, type ServerConnection } from '@selfmp3/client'
import { ServerAway } from '../../connection/ServerAway'
import { useConnection } from '../../connection/ConnectionProvider'
import { useServerDirect } from '../../connection/useServerDirect'
import { useArt } from '../../offline/useArt'
import { canShareCard, shareWrappedCard } from '../../ports/shareCard'
import type { CardPalette } from '../../ports/shareCard.types'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { useBackTo } from '../../ui/components/BackRow'
import { Button } from '../../ui/components/Button'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronLeft, Download, Play } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Segmented } from '../../ui/components/Segmented'
import { Select } from '../../ui/components/Select'
import { card, floating, sectionTitle } from '../../ui/surfaces'
import { useStatsFor, useStatsSongs, useWrappedFor } from '../stats/statsSource'
import { LOOK_VIEWS } from './looks'
import { Scaled } from './looks/Scaled'
import {
  lookInk,
  LOOK_LABELS,
  looksFor,
  lookToDraw,
  statsRangeOf,
  type LookId,
  type LookInput,
} from './looks.model'
import {
  emptyHint,
  emptyTitle,
  longerRanges,
  rangeShort,
  tryLabel,
  WRAPPED_RANGES,
} from './wrapped.model'

/** How wide a portrait look is drawn on a computer: its board's own width, near enough. */
const PORTRAIT_ON_COMPUTER = 480
const FRONT_PAGE_MAX = 1120

/**
 * The colours the saved image is drawn in. The card is the share port's own
 * drawing, not the look (see `share` below), so it borrows the chosen look's
 * inks: saving the Words page gives a blue card, the receipt a white one.
 */
function cardPaletteFor(look: LookId, hue: number): CardPalette {
  const ink = lookInk(look, hue)
  return {
    background: ink.ground,
    surface: ink.tone,
    border: ink.tone,
    accent: ink.accent,
    accentDim: ink.tone,
    bar: ink.accent,
    text: ink.ink,
    secondary: ink.second,
    muted: ink.quiet,
  }
}

/**
 * The month as a page (docs/ui-mock `P33`–`P37`, `C16`): the period as one
 * picture, in a look chosen underneath it on a phone and above it on a
 * computer. A computer opens on the newspaper front page, a phone on Paper
 * (looks.model.ts), and either keeps the window chosen — a week, a month, all
 * time — as the looks change.
 *
 * Stats are the server's and nobody else's (statsSource.ts), so a cloud
 * library asks its server directly; when that server cannot be reached the
 * page keeps its controls and says why in place of the picture.
 */
export function ReportScreen(): ReactNode {
  const { fromCloud } = useConnection()
  const { wide } = useLayout()
  const [range, setRange] = useState<WrappedRange>('month')
  // Null until a look is picked, so the default follows the width it is drawn at.
  const [chosen, setChosen] = useState<LookId | null>(null)
  const frame: FrameState = {
    range,
    onRange: setRange,
    look: lookToDraw(chosen, wide),
    onLook: setChosen,
  }
  return fromCloud ? <CloudReport {...frame} /> : <Report via={undefined} {...frame} />
}

interface FrameState {
  range: WrappedRange
  onRange: (range: WrappedRange) => void
  look: LookId
  onLook: (look: LookId) => void
}

function CloudReport(frame: FrameState): ReactNode {
  const reach = useServerDirect()
  if (reach.state === 'reachable') return <Report via={reach.connection} {...frame} />
  return (
    <ReportFrame {...frame} topArt={null} share={null}>
      <ServerAway reach={reach} need="stats" testID="report-server" />
    </ReportFrame>
  )
}

function Report({ via, ...frame }: FrameState & { via: ServerConnection | undefined }): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const backTo = useBackTo()
  const { wide } = useLayout()
  const { data: wrapped, isLoading } = useWrappedFor(via, frame.range)
  // The day by day the calendar, the receipt's bars and the front page's grid need.
  const { data: stats } = useStatsFor(via, statsRangeOf(frame.range))
  // The report names songs the way whichever library answered numbers them;
  // this is the same song as this device knows it (statsSource.ts).
  const songFor = useStatsSongs(via)
  const artFor = useArt()
  const { data: library } = useLibrary()
  const [sharing, setSharing] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const art = useCallback(
    (songId: number): string | null => {
      const song = songFor(songId)
      return song ? artFor(song) : null
    },
    [artFor, songFor],
  )
  const hues = useMemo(
    () => new Map((library?.tags ?? []).map(tag => [tag.name, tag.hue])),
    [library?.tags],
  )
  const tagHue = useCallback((name: string) => hues.get(name), [hues])

  const top = wrapped?.topSongs[0]
  const topArt = top ? art(top.songId) : null

  /*
   * The saved image is the share port's own card, drawn on a canvas, not the
   * look on screen: the port draws, it cannot photograph a view, and a phone
   * has no port yet at all. It borrows the chosen look's inks (cardPaletteFor)
   * so a blue Words page saves as a blue card.
   */
  const share = async (): Promise<void> => {
    if (!wrapped) return
    setSharing(true)
    setShareError(null)
    try {
      await shareWrappedCard(wrapped, cardPaletteFor(frame.look, accent.hue), topArt)
    } catch (error) {
      setShareError(error instanceof Error ? error.message : 'could not make the image')
    } finally {
      setSharing(false)
    }
  }

  // Only where an image can be made and handed on: a browser and the Mac app.
  const canShare = canShareCard && !!wrapped && wrapped.totals.plays > 0
  const shareLabel = sharing ? 'Making the image…' : 'Save as image'
  const shareControl = !canShareCard ? null : wide ? (
    <Button
      label={shareLabel}
      icon={<Download size={15} color={theme.colors.textPrimary} />}
      busy={sharing}
      disabled={!canShare}
      onPress={() => void share()}
      testID="report-share"
    />
  ) : (
    <IconButton
      label={shareLabel}
      filled
      disabled={!canShare || sharing}
      onPress={() => void share()}
      testID="report-share"
    >
      {sharing ? (
        <ActivityIndicator size="small" color={theme.colors.textMuted} />
      ) : (
        <Download size={18} color={theme.colors.textPrimary} />
      )}
    </IconButton>
  )

  const shell = (children: ReactNode): ReactNode => (
    <ReportFrame {...frame} topArt={topArt} share={shareControl}>
      {children}
    </ReportFrame>
  )

  if (isLoading && !wrapped) return shell(<Text style={styles.hint}>Working it out…</Text>)

  if (!wrapped) {
    return shell(
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>The report needs your library</Text>
        <Text style={[styles.hint, styles.center]}>
          It’ll be here when your server is reachable again.
        </Text>
      </View>,
    )
  }

  if (wrapped.totals.plays === 0) {
    return shell(
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>{emptyTitle(frame.range)}</Text>
        <Text style={[styles.hint, styles.center]}>{emptyHint(frame.range)}</Text>
        <View style={styles.emptyActions}>
          {longerRanges(frame.range).map(option => (
            <Button key={option} label={tryLabel(option)} onPress={() => frame.onRange(option)} />
          ))}
          <Button
            label="Go to the library"
            icon={<Play size={15} color={theme.colors.textPrimary} />}
            onPress={() => backTo('/library')}
          />
        </View>
      </View>,
    )
  }

  return shell(
    <>
      {shareError ? (
        <View style={styles.notice} accessibilityRole="alert">
          <Text style={styles.noticeText}>{shareError}</Text>
        </View>
      ) : null}
      <LookStage
        look={frame.look}
        input={{ wrapped, daily: stats?.daily ?? [] }}
        hue={accent.hue}
        art={art}
        tagHue={tagHue}
      />
    </>,
  )
}

/**
 * The page around the picture. A phone draws `P33`: back, the window and the
 * share in a row over the number one's blurred cover, the looks underneath.
 * A computer draws `C16`: the looks along the top, the window, Save as image
 * and the way back to Stats beside them.
 */
function ReportFrame({
  range,
  onRange,
  look,
  onLook,
  topArt,
  share,
  children,
}: FrameState & {
  topArt: string | null
  share: ReactNode
  children: ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  const { wide } = useLayout()
  const accent = useAccent()
  const router = useRouter()
  const backTo = useBackTo()
  const picker = (
    <LookPicker
      looks={looksFor(wide)}
      value={look}
      onChange={onLook}
      hue={accent.hue}
      topArt={topArt}
    />
  )

  if (wide) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <ScrollView contentContainerStyle={styles.contentWide} testID="report-screen">
          <View style={styles.bar}>
            {picker}
            <View style={styles.barEnd}>
              <Segmented
                value={range}
                onChange={onRange}
                label="Time range"
                options={WRAPPED_RANGES.map(option => ({
                  value: option,
                  label: rangeShort(option),
                }))}
              />
              {share}
              <Button
                variant="text"
                label="Back to Stats"
                onPress={() => backTo('/stats')}
                testID="report-back"
              />
            </View>
          </View>
          {children}
        </ScrollView>
      </SafeAreaView>
    )
  }

  return (
    <View style={styles.screen}>
      {/* The number one's cover, blurred into light behind the page (`P33`). */}
      {topArt ? (
        <View style={styles.backdrop} pointerEvents="none">
          <Image
            source={{ uri: topArt }}
            style={styles.backdropArt}
            blurRadius={50}
            resizeMode="cover"
          />
          <View
            style={[styles.backdrop, { backgroundColor: withAlpha(theme.colors.surface0, 0.5) }]}
          />
        </View>
      ) : null}
      <SafeAreaView style={styles.fill} edges={['top']}>
        <ScrollView contentContainerStyle={styles.contentNarrow} testID="report-screen">
          <View style={styles.header}>
            <IconButton
              label="Back"
              filled
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/stats'))}
              testID="report-back"
            >
              <ChevronLeft size={22} color={theme.colors.textPrimary} />
            </IconButton>
            <View style={styles.headerEnd}>
              <Select
                value={range}
                onChange={onRange}
                label="Time range"
                size="small"
                options={WRAPPED_RANGES.map(option => ({
                  value: option,
                  label: rangeShort(option),
                }))}
              />
              {share}
            </View>
          </View>
          {children}
          {picker}
          <ChromeSpacer />
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}

/**
 * The chosen look, as large as the page allows: the whole width on a phone, a
 * portrait look at about its board's size on a computer, the front page as wide
 * as the page up to a broadsheet's width.
 */
function LookStage({
  look,
  input,
  hue,
  art,
  tagHue,
}: {
  look: LookId
  input: LookInput
  hue: number
  art: (songId: number) => string | null
  tagHue: (tag: string) => number | undefined
}): ReactNode {
  const { wide } = useLayout()
  const [room, setRoom] = useState(0)
  const view = LOOK_VIEWS[look]
  const cap = look === 'front' ? FRONT_PAGE_MAX : wide ? PORTRAIT_ON_COMPUTER : room
  const display = Math.min(room, cap)
  const scale = display / view.size.width
  const corner = { borderRadius: view.corner * scale }
  const { Look } = view
  return (
    <View style={styles.stage} onLayout={event => setRoom(event.nativeEvent.layout.width)}>
      {display > 0 ? (
        <View
          style={[styles.object, corner]}
          testID={`report-page-${look}`}
          accessibilityLabel={`${LOOK_LABELS[look]}: ${input.wrapped.personality.line || 'your listening'}`}
        >
          <View style={[styles.clip, corner]}>
            <Scaled width={view.size.width} height={view.size.height} display={display}>
              <Look input={input} hue={hue} art={art} tagHue={tagHue} />
            </Scaled>
          </View>
        </View>
      ) : null}
    </View>
  )
}

/**
 * The looks, each a small swatch of its own paper with its name under it: tall
 * on a phone (`P33`), wide on a computer (`C16`). The chosen one is ringed.
 */
function LookPicker({
  looks,
  value,
  onChange,
  hue,
  topArt,
}: {
  looks: readonly LookId[]
  value: LookId
  onChange: (look: LookId) => void
  hue: number
  topArt: string | null
}): ReactNode {
  const { wide } = useLayout()
  return (
    <View style={[styles.picker, !wide && styles.pickerNarrow]} role="group" aria-label="Look">
      {looks.map(id => {
        const active = id === value
        return (
          <Pressable
            key={id}
            onPress={() => onChange(id)}
            accessibilityRole="button"
            accessibilityLabel={LOOK_LABELS[id]}
            accessibilityState={{ selected: active }}
            aria-pressed={active}
            testID={`report-look-${id}`}
            style={({ pressed }) => [styles.pick, pressed && styles.pressed]}
          >
            <View
              style={[
                styles.swatch,
                wide ? styles.swatchWide : styles.swatchNarrow,
                { backgroundColor: swatchOf(id, hue) },
                active && styles.swatchActive,
              ]}
            >
              {/* The wall is its covers: its swatch is the number one's. */}
              {id === 'wall' && topArt ? (
                <Image source={{ uri: topArt }} style={styles.swatchArt} resizeMode="cover" />
              ) : null}
            </View>
            <Text style={[styles.pickLabel, active && styles.pickLabelActive]}>
              {LOOK_LABELS[id]}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * A look's swatch is its paper, except two: the calendar's, which `P33` draws a
 * shade darker than Paper's so the two are told apart, and the wall's, which is
 * its number one's cover and, until there is one, a tone off the dark ground
 * that would otherwise vanish into the page.
 */
function swatchOf(look: LookId, hue: number): string {
  if (look === 'calendar') return lightPalette(hue).surface3
  if (look === 'wall') return lookInk(look, hue).tone
  return lookInk(look, hue).ground
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  fill: { flex: 1 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, overflow: 'hidden' },
  backdropArt: {
    position: 'absolute',
    top: -60,
    left: -60,
    right: -60,
    bottom: -60,
    opacity: 0.8,
  },
  contentWide: { paddingTop: 28, paddingHorizontal: 40, paddingBottom: 48, gap: 20 },
  contentNarrow: { paddingTop: 8, paddingHorizontal: 20, paddingBottom: 28, gap: 16 },
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 16,
  },
  barEnd: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  headerEnd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stage: { width: '100%', alignItems: 'center' },
  // The picture floats over the page: the one shadow here.
  object: floating(theme.colors),
  clip: { overflow: 'hidden' },
  picker: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 14 },
  pickerNarrow: { justifyContent: 'center', paddingTop: 4 },
  pick: { alignItems: 'center', gap: 5 },
  pressed: { opacity: 0.7 },
  swatch: { overflow: 'hidden' },
  swatchNarrow: { width: 44, height: 58, borderRadius: 9 },
  swatchWide: { width: 64, height: 44, borderRadius: 8 },
  // A ring, not an edge: the ground, then the ink, around the chosen swatch.
  swatchActive: {
    boxShadow: `0 0 0 2px ${theme.colors.surface0}, 0 0 0 3.5px ${theme.colors.textPrimary}`,
  },
  swatchArt: { width: '100%', height: '100%' },
  pickLabel: { fontSize: 11, fontWeight: '600', color: theme.colors.textSecondary },
  pickLabelActive: { color: theme.colors.textPrimary },
  hint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  center: { textAlign: 'center', maxWidth: 420 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 8 },
  emptyTitle: sectionTitle(theme.colors),
  emptyActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    marginTop: 8,
  },
  // A card, with the danger in its ink rather than an edge.
  notice: { ...card(theme.colors), paddingVertical: 10, paddingHorizontal: 14 },
  noticeText: { color: theme.colors.danger, fontSize: 13 },
}))
