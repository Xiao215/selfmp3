import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams } from 'expo-router'
import Constants from 'expo-constants'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useQuery } from '@tanstack/react-query'
import { type Settings } from '@selfmp3/shared'
import { clientApi, queryKeys, radius, useSettings, useUpdateSettings } from '@selfmp3/client'
import { setRomanizationOn, useRomanizationOn } from '../nowPlaying/romanizationPref'
import { loginItem } from '../../ports/loginItem'
import { macApp } from '../../ports/macApp'
import { installedApp } from '../../ports/install'
import { useConnection } from '../../connection/ConnectionProvider'
import { deviceKind } from '../../ports/device'
import { useLayout } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { Toggle } from '../../ui/components/Toggle'
import { label, pageTitle } from '../../ui/surfaces'
import { usePlayer } from '../../player/PlayerProvider'
import { menuCommands } from '../../ports/menuKeys'
import { finePointer } from '../../ports/pointer'
import { Panel, partStyles, Row, SliderSetting, StackedRows } from './SettingsParts'
import { AppearancePanel } from './AppearancePanel'
import { CloudPanel } from './CloudPanel'
import { Confirmations } from './Confirmations'
import { ConnectionPanel } from './ConnectionPanel'
import { DesktopPanel } from './DesktopPanel'
import { DevicesPanel } from './DevicesPanel'
import { GetAppPanel } from './GetAppPanel'
import { ImportingPanel } from './ImportingPanel'
import { LibraryPanel } from './LibraryPanel'
import { OfflinePanel } from './OfflinePanel'
import { ShortcutsPanel } from './ShortcutsPanel'
import {
  activeSection,
  crossfadeLabel,
  devicePlace,
  healthLine,
  landingOffset,
  onThisDevice,
  sectionsFor,
  type Confirming,
  type SectionId,
} from './settings.model'

/** At this width the index is a column beside the panels; below it, a row of chips. */
const INDEX_COLUMN = 1080

/** The index column itself, and the gutter on either side of it. */
const INDEX_WIDTH = 172
const INDEX_GUTTER = 32

/** The page's top padding beside the index column, and on a narrow screen. */
const COLUMN_TOP = 28
const NARROW_TOP = 18
/** The gap under the sticky chips, which a section chosen from them lands below. */
const CHIPS_GAP = 14

/**
 * How long the index holds a chosen section — no scroll-spy, and landed again
 * if the page grows — once the page has stopped growing. Longer for a link from
 * elsewhere, which arrives while the panels above are still filling in.
 */
const CHOSEN_HOLD_MS = 900
const LINKED_HOLD_MS = 2500

/**
 * Settings (`P38`, `C17`).
 *
 * Grouped as the boards group it: the account and the look first, then what
 * this device keeps — "On this phone", "On this computer" — and its devices,
 * then what the server keeps for every device: playback, the library,
 * importing, the cloud. Downloads, the accent and the theme belong to this
 * device; the rest live on the server so it and every phone agree. Each group
 * is a label over a card, its rows told apart by space. The page carries its own index — a
 * column beside the panels on a wide screen, a sticky row of chips above them
 * on a narrow one — and every setting has the same anatomy. A link from
 * elsewhere names its section (`/settings?section=account`) and lands there.
 */
export function SettingsScreen(): ReactNode {
  const { fromCloud } = useConnection()
  const romanizationOn = useRomanizationOn()
  const { width, wide } = useLayout()
  const settings = useSettings()
  const updateSettings = useUpdateSettings()
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => clientApi().health(),
    retry: false,
    staleTime: 60_000,
  })

  // A mouse or trackpad stands in for a keyboard, and only the installed app —
  // the one with a login item — has a menu of keys to list. A tab on a Mac is
  // the one place the desktop app is offered from.
  const place = devicePlace(deviceKind())
  const sections = sectionsFor(
    fromCloud,
    installedApp,
    finePointer,
    loginItem.available,
    place,
    macApp.offered,
  )
  const shortcuts = sections.some(section => section.id === 'shortcuts') ? menuCommands : null
  const column = width >= INDEX_COLUMN
  const scrollRef = useRef<ScrollView>(null)
  // Each shown panel's view, and where it was last measured in the scroll content.
  const anchors = useRef(new Map<SectionId, View>())
  const tops = useRef(new Map<SectionId, number>())
  const headRef = useRef<View>(null)
  const chipBarRef = useRef<View>(null)
  const chipBarHeight = useRef(0)
  const metrics = useRef({ view: 0, content: 0 })
  const held = useRef<{ id: SectionId; ms: number; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  )
  const { section: linked } = useLocalSearchParams<{ section?: string }>()
  const linkedSection = sections.find(section => section.id === linked)?.id
  const [active, setActive] = useState<SectionId>(() => linkedSection ?? 'account')
  const chipsRef = useRef<ScrollView>(null)
  const chipAt = useRef(new Map<SectionId, { x: number; width: number }>())
  const chipsWidth = useRef(0)

  // At narrow widths the chip for the section being read is often scrolled out
  // of its row. Bring it back — sideways only.
  useEffect(() => {
    const chip = chipAt.current.get(active)
    if (!chip || chipsWidth.current === 0) return
    chipsRef.current?.scrollTo({
      x: Math.max(0, chip.x - (chipsWidth.current - chip.width) / 2),
      animated: true,
    })
  }, [active])
  const [confirming, setConfirming] = useState<Confirming>(null)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
    updateSettings.mutate({ [key]: value } as Partial<Settings>)
  }
  const anchorAt = (id: SectionId, node: View | null): void => {
    if (node) anchors.current.set(id, node)
    else anchors.current.delete(id)
  }

  /**
   * Where every shown panel is now, in the scroll content, and how tall the
   * sticky chips are.
   *
   * Asked for rather than kept from `onLayout`: in a browser a view reports its
   * layout only when its own size changes, so a panel pushed down by Playback or
   * Library filling in never says it moved, and the index would stop a panel or
   * two short. Measured against the head, which starts the content and stays put.
   *
   * In the window's coordinates rather than `measureLayout`'s, because the head
   * is the panels' sibling and not their ancestor. A browser does not mind —
   * react-native-web subtracts two rectangles — but iOS measures by walking up
   * from the node to the view it was given, finds the head is not on that path,
   * and calls the failure callback. That read as an index that simply did not
   * scroll on a phone while working on a desktop. Everything measured here is
   * inside the same scroll content, so a scroll moves the head and the panels
   * by the same amount and the difference between them is the offset wanted.
   */
  const measure = async (): Promise<void> => {
    const head = headRef.current
    if (!head) return
    const at = (node: View): Promise<{ y: number; height: number } | null> =>
      new Promise(resolve => {
        node.measureInWindow((_x, y, _width, height) =>
          resolve(Number.isFinite(y) ? { y, height } : null),
        )
      })
    const chips = chipBarRef.current
    const [origin, bar, placed] = await Promise.all([
      at(head),
      chips ? at(chips) : null,
      Promise.all([...anchors.current].map(async ([id, node]) => ({ id, place: await at(node) }))),
    ])
    if (!origin) return
    chipBarHeight.current = bar?.height ?? 0
    const pageTop = column ? COLUMN_TOP : NARROW_TOP
    tops.current = new Map(
      placed.flatMap(({ id, place }) =>
        place ? [[id, pageTop + (place.y - origin.y)] as const] : [],
      ),
    )
  }

  /** Scrolls so `id`'s heading sits under whatever covers the top of the scroll area. */
  const land = (id: SectionId, animated: boolean): void => {
    void measure().then(() => {
      const top = tops.current.get(id)
      if (top === undefined) return
      const clearance = column ? COLUMN_TOP : chipBarHeight.current + CHIPS_GAP
      scrollRef.current?.scrollTo({ y: landingOffset(top, clearance), animated })
    })
  }

  const hold = (id: SectionId, ms: number): void => {
    if (held.current) clearTimeout(held.current.timer)
    const timer = setTimeout(() => {
      held.current = null
    }, ms)
    held.current = { id, ms, timer }
  }

  /** The reader took the page back: stop holding the section they chose. */
  const letGo = (): void => {
    if (!held.current) return
    clearTimeout(held.current.timer)
    held.current = null
  }

  const onContentSizeChange = (_width: number, height: number): void => {
    metrics.current.content = height
    // A panel above filled in and pushed everything down. Holding a section,
    // land on it again where it is now; otherwise just keep the scroll-spy true.
    const on = held.current
    if (on) {
      hold(on.id, on.ms)
      land(on.id, false)
    } else {
      void measure()
    }
  }

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    // Chosen from the index: held until the jump has landed.
    if (held.current !== null) return
    const list = sections.map(section => ({
      id: section.id,
      top: tops.current.get(section.id) ?? Number.POSITIVE_INFINITY,
    }))
    const next = activeSection(
      list,
      event.nativeEvent.contentOffset.y,
      metrics.current.view,
      metrics.current.content,
    )
    if (next !== null && next !== active) setActive(next)
  }

  const go = (id: SectionId, ms = CHOSEN_HOLD_MS, animated = true): void => {
    setActive(id)
    hold(id, ms)
    land(id, animated)
  }

  // A link from elsewhere, such as a can't-reach screen's "Connection settings":
  // straight there, and held while the panels above it fill in. The index
  // already starts on it.
  useEffect(() => {
    if (!linkedSection) return
    hold(linkedSection, LINKED_HOLD_MS)
    land(linkedSection, false)
    // Once per link: `hold` and `land` are new on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedSection])

  const index = sections.map(section => {
    const on = active === section.id
    return (
      <Pressable
        key={section.id}
        onPress={() => go(section.id)}
        onLayout={
          column
            ? undefined
            : event => {
                const { x, width: chipWidth } = event.nativeEvent.layout
                chipAt.current.set(section.id, { x, width: chipWidth })
              }
        }
        accessibilityRole="link"
        accessibilityState={{ selected: on }}
        style={({ pressed }) => [
          column ? styles.indexItem : styles.chip,
          on && (column ? styles.indexItemOn : styles.chipOn),
          pressed && styles.indexPressed,
        ]}
      >
        <Text style={[styles.indexText, on && styles.indexTextOn]}>{section.label}</Text>
      </Pressable>
    )
  })

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        onScroll={onScroll}
        scrollEventThrottle={32}
        onLayout={event => {
          metrics.current.view = event.nativeEvent.layout.height
        }}
        onContentSizeChange={onContentSizeChange}
        onScrollBeginDrag={letGo}
        stickyHeaderIndices={column ? undefined : [1]}
        contentContainerStyle={[
          styles.content,
          column ? styles.contentColumn : styles.contentNarrow,
        ]}
      >
        {/* On a phone the way back and the page's name share a line, the name
            at the far end of it, as Import has them (`P30`). A computer has no
            way back here — the sidebar is always there — so the name leads. */}
        <View ref={headRef} style={[styles.head, wide ? null : styles.headPhone]}>
          <BackButton to="/profile" label="Profile" testID="settings-back" />
          <View style={wide ? null : styles.titles}>
            <Text
              style={[styles.title, wide ? null : styles.titleRight]}
              accessibilityRole="header"
            >
              Settings
            </Text>
            <Text style={[styles.sub, wide ? null : styles.titleRight]}>
              {healthLine(health.data, {
                loading: health.isPending,
                error: health.isError,
                fromCloud,
              })}
            </Text>
          </View>
        </View>

        {column ? null : (
          <ChipBar
            barRef={chipBarRef}
            chipsRef={chipsRef}
            onWidth={barWidth => {
              chipsWidth.current = barWidth
            }}
          >
            {index}
          </ChipBar>
        )}

        <StackedRows value={!wide}>
          <View style={styles.panels}>
            <ConnectionPanel anchor={node => anchorAt('account', node)} onConfirm={setConfirming} />

            <AppearancePanel anchor={node => anchorAt('appearance', node)} />

            {/* A browser streams and keeps nothing: only an installed app has songs on it. */}
            {installedApp ? (
              <OfflinePanel
                title={onThisDevice(place)}
                anchor={node => anchorAt('offline', node)}
                onConfirm={setConfirming}
              />
            ) : null}

            <DevicesPanel anchor={node => anchorAt('devices', node)} />

            {settings.data ? (
              <Panel
                title="Playback"
                hint="shared across your devices"
                anchor={node => anchorAt('playback', node)}
              >
                <CrossfadeRow
                  seconds={settings.data.crossfadeSeconds}
                  onCommit={value => set('crossfadeSeconds', value)}
                />
                <Row
                  label="Look up lyrics automatically"
                  hint="Fetches synced lyrics from lrclib.net when a song is imported, and saves them next to the audio so they work offline."
                  last
                >
                  <Toggle
                    value={settings.data.autoFetchLyrics}
                    onChange={value => set('autoFetchLyrics', value)}
                    label="Look up lyrics automatically"
                  />
                </Row>
              </Panel>
            ) : null}

            {fromCloud ? null : (
              <LibraryPanel
                libraryPath={health.data?.libraryPath}
                anchor={node => anchorAt('library', node)}
                onConfirm={setConfirming}
              />
            )}

            {settings.data && !fromCloud ? (
              <ImportingPanel
                settings={settings.data}
                set={set}
                anchor={node => anchorAt('importing', node)}
              />
            ) : null}

            {fromCloud ? null : <CloudPanel anchor={node => anchorAt('cloud', node)} />}

            <Panel title="Lyrics" hint="on this device" anchor={node => anchorAt('lyrics', node)}>
              <Row
                label="Show pinyin / romaji"
                hint="A romanized line under each Chinese or Japanese lyric. It is made on the server and kept with the words, in the cloud too, so this only chooses whether to draw it."
                last
              >
                <Toggle
                  value={romanizationOn}
                  onChange={setRomanizationOn}
                  label="Show pinyin / romaji"
                />
              </Row>
            </Panel>

            {loginItem.available ? (
              <DesktopPanel anchor={node => anchorAt('desktop', node)} />
            ) : null}

            {macApp.offered ? <GetAppPanel anchor={node => anchorAt('getApp', node)} /> : null}

            {shortcuts ? (
              <ShortcutsPanel items={shortcuts} anchor={node => anchorAt('shortcuts', node)} />
            ) : null}

            <Panel title="About" anchor={node => anchorAt('about', node)}>
              <Row label="Version" last>
                <Text style={partStyles.valueText}>
                  {String(Constants.expoConfig?.version ?? '1.0.0')}
                </Text>
              </Row>
            </Panel>
          </View>
        </StackedRows>
        <ChromeSpacer />
      </ScrollView>

      {column ? (
        <View style={styles.indexColumn} accessibilityLabel="Settings sections">
          <Text style={styles.indexTitle}>ON THIS PAGE</Text>
          {index}
        </View>
      ) : null}

      <Confirmations confirming={confirming} onDone={() => setConfirming(null)} />
    </SafeAreaView>
  )
}

/**
 * Crossfade, where this device's engine can fade one song into the next — a
 * browser and the installed app can. A phone's engine plays gapless and cannot
 * fade, and a slider that does nothing there is worse than none: the row stays
 * away until it can.
 */
function CrossfadeRow({
  seconds,
  onCommit,
}: {
  seconds: number
  onCommit: (value: number) => void
}): ReactNode {
  // Its own component: the player changes on every play and pause, and the
  // whole of Settings has no reason to redraw for that.
  const { canCrossfade } = usePlayer()
  if (!canCrossfade) return null
  return (
    <Row
      label="Crossfade"
      hint="Overlap the end of one track with the start of the next. Zero turns it off."
    >
      <SliderSetting
        value={seconds}
        min={0}
        max={12}
        step={1}
        label="Crossfade"
        format={crossfadeLabel}
        onCommit={onCommit}
      />
    </Row>
  )
}

/**
 * The sticky row of section chips.
 *
 * Its ground has to be read from the theme and written inline: a sticky header
 * is re-parented into ScrollView's own animated wrapper, which Unistyles' live
 * update does not reach, so from the sheet alone the strip would keep the last
 * theme's colour. That makes it the one part of this page that has to be
 * re-rendered when the theme moves — so it is its own component, and dragging
 * the accent picker in Appearance re-renders this strip rather than the page
 * of panels it is pinned to.
 */
function ChipBar({
  barRef,
  chipsRef,
  onWidth,
  children,
}: {
  barRef: RefObject<View | null>
  chipsRef: RefObject<ScrollView | null>
  onWidth: (width: number) => void
  children: ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View ref={barRef} style={[styles.chipBar, { backgroundColor: theme.colors.surface0 }]}>
      <ScrollView
        ref={chipsRef}
        onLayout={event => onWidth(event.nativeEvent.layout.width)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        {children}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentColumn: {
    paddingTop: COLUMN_TOP,
    // Clear of the index: its gutter, the column, and the same gutter again.
    paddingLeft: INDEX_GUTTER + INDEX_WIDTH + INDEX_GUTTER,
    paddingRight: INDEX_GUTTER,
  },
  // `S2`'s phone gutter.
  contentNarrow: { paddingTop: NARROW_TOP, paddingHorizontal: 20 },
  head: { marginBottom: 20 },
  headPhone: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  titles: { flex: 1, minWidth: 0, alignItems: 'flex-end' },
  titleRight: { textAlign: 'right' },
  title: pageTitle(theme.colors),
  sub: { color: theme.colors.textMuted, fontSize: 13, marginTop: 4 },
  panels: { gap: 20, maxWidth: 780 },
  indexColumn: {
    position: 'absolute',
    top: COLUMN_TOP,
    left: INDEX_GUTTER,
    width: INDEX_WIDTH,
    gap: 1,
  },
  indexTitle: {
    ...label(theme.colors),
    paddingTop: 4,
    paddingHorizontal: 10,
    paddingBottom: 6,
  },
  indexItem: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
  },
  // The section you are on is the selected tone, as a chosen segment is (`S2`):
  // a lighter fill, not an accent edge.
  indexItemOn: { backgroundColor: theme.colors.surfaceSelected },
  chipOn: { backgroundColor: theme.colors.surfaceSelected },
  indexPressed: { backgroundColor: theme.colors.surface3 },
  indexText: { color: theme.colors.textMuted, fontSize: 13 },
  indexTextOn: { color: theme.colors.textPrimary, fontWeight: '600' },
  chipBar: {
    marginHorizontal: -20,
    paddingVertical: 10,
    marginBottom: CHIPS_GAP,
    backgroundColor: theme.colors.surface0,
  },
  chips: { gap: 6, paddingHorizontal: 20 },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
}))
