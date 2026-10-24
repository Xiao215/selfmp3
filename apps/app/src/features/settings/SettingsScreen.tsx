import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams } from 'expo-router'
import Constants from 'expo-constants'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { radius, space, type, useHealth } from '@selfmp3/client'
import { setRomanizationOn, useRomanizationOn } from '../nowPlaying/romanizationPref'
import { loginItem } from '../../ports/loginItem'
import { macApp } from '../../ports/macApp'
import { installedApp } from '../../ports/install'
import { bucketCapped } from '../library/library.model'
import { useBucketHold } from '../profile/useBucketHold'
import { deviceKind } from '../../ports/device'
import { useLayout } from '../../shell/useLayout'
import { useContentWidthValue } from '../../shell/contentWidth'
import { PageHeader } from '../../ui/components/PageHeader'
import { Chip } from '../../ui/components/Chip'
import { Toggle } from '../../ui/components/Toggle'
import { engineCapabilities } from '../../ports/engine'
import { CROSSFADE_MAX, setCrossfadeSeconds, useCrossfadeSeconds } from '../../player/crossfadePref'
import { label, PAGE_TOP_PHONE, PAGE_TOP_WIDE, pageFrame } from '../../ui/surfaces'
import { SectionHead } from '../../ui/components/SectionHead'
import { createValueStore, type ValueStore } from '../../state/valueStore.model'
import { useValueStore } from '../../state/useValueStore'
import { useMenuCommands } from '../../ports/menuKeys'
import { Button } from '../../ui/components/Button'
import { showToast } from '../../ui/toast'
import { forgetGuides } from '../guide/guideMemory'
import { Panel, partStyles, Row, SliderSetting, StackedRows } from './SettingsParts'
import { AppearancePanel } from './AppearancePanel'
import { Confirmations } from './Confirmations'
import { ConnectionPanel } from './ConnectionPanel'
import { DesktopPanel } from './DesktopPanel'
import { DevicesPanel } from './DevicesPanel'
import { GetAppPanel } from './GetAppPanel'
import { ImportingPanel } from './ImportingPanel'
import { LibraryPanel } from './LibraryPanel'
import { OfflinePanel } from './OfflinePanel'
import { ShortcutsPanel } from './ShortcutsPanel'
import { SmartModelPanel, SmartPanel } from './SmartPanel'
import {
  activeSection,
  crossfadeLabel,
  devicePlace,
  healthLine,
  indexIdFor,
  landingOffset,
  onThisDevice,
  sectionsFor,
  settingsIndex,
  type Confirming,
  type Section,
  type SectionId,
} from './settings.model'
import { ScrollView } from '../../ui/components/Scroll'
import { Press } from '../../ui/components/Press'
import { COLUMN_WIDTH } from '../../shell/widths'
import { UsageRow } from '../usage/UsageRow'

/** The index column itself, and the gutter on either side of it. */
const INDEX_WIDTH = 172
const INDEX_GUTTER = space.gutterWide

/** The page's top padding beside the index column, and on a phone. */
const COLUMN_TOP = PAGE_TOP_WIDE
const NARROW_TOP = PAGE_TOP_PHONE
/** The panels' width cap (`panels`). */
const PANELS_MAX = 780
/**
 * The panels' width a row needs to keep its words beside its control: Accent
 * colour's swatches and hue strip leave its name a squeezed column below this.
 */
const ROWS_BESIDE = 620

/** How wide the panels are in a page column of `page`: beside the index, or under the chips. */
function panelsWidth(page: number): number {
  const beside = page >= COLUMN_WIDTH.settingsIndex
  const taken = beside ? INDEX_GUTTER * 3 + INDEX_WIDTH : space.gutterWide * 2
  return Math.min(PANELS_MAX, page - taken)
}
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
 * then playback, smart features and lyrics. What is about running the server
 * or the Mac app — the library folder, importing, the model — is under one
 * Advanced at the end (O1). What the server acts on is asked of the server,
 * reached directly from a cloud library (`useServerApi`). Each group is a label over a card, its
 * rows told apart by space, and each row says at most one short line. The
 * page carries its own index — a column beside the panels on a wide screen, a
 * sticky row of chips above them on a narrow one. A link from elsewhere names
 * its section (`/settings?section=account`) and lands there.
 */
export function SettingsScreen(): ReactNode {
  const pinyinOn = useRomanizationOn('zh')
  const romajiOn = useRomanizationOn('ja')
  const { wide } = useLayout()
  const health = useHealth()
  // The bucket refusing for the day, which the health cannot see: in the cloud
  // it is the doorman's, and the doorman answers while the bucket will not.
  const capped = useBucketHold() !== null || bucketCapped(health.error)

  // Keys to list where they can be pressed: the installed app's menu, or an
  // iPad's while a keyboard is attached, which comes and goes. A tab on a Mac
  // is the one place the desktop app is offered from.
  const shortcuts = useMenuCommands()
  const place = devicePlace(deviceKind())
  const sections = sectionsFor({
    crossfade: engineCapabilities.crossfade,
    installed: installedApp,
    keyboard: shortcuts !== null,
    shell: loginItem.available,
    place,
    offered: macApp.offered,
  })
  const indexed = settingsIndex(sections)
  const shown = (id: SectionId): boolean => sections.some(section => section.id === id)
  // The index is a column beside the panels where the page has room; a row of chips below.
  const column = useContentWidthValue(page => page !== null && page >= COLUMN_WIDTH.settingsIndex)
  // A row's words beside its control where the panels have the room for both;
  // stacked on a phone, and in a computer's column the sidebar and Up next
  // have narrowed, where they were crushed to a letter a line.
  const rowsBeside = useContentWidthValue(page => page !== null && panelsWidth(page) >= ROWS_BESIDE)
  // Under the chips on a computer, the page keeps a computer's frame.
  const narrowTop = wide ? PAGE_TOP_WIDE : NARROW_TOP
  const scrollRef = useRef<ScrollView>(null)
  // Each shown panel's view, kept by `anchorAt`, and where it was last measured
  // in the scroll content.
  const [anchors] = useState(() => new Map<SectionId, View>())
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
  /*
   * The section being read, kept out of this component's state: the scroll-spy
   * moves it on every section crossed, and as state it redrew every panel on
   * the page — the offline tally, the library's counts, the devices — each
   * time. Only the index reads it (`SectionIndex`).
   */
  const [active] = useState(() =>
    createValueStore<SectionId>(linkedSection ? indexIdFor(linkedSection, sections) : 'account'),
  )
  const chipsRef = useRef<ScrollView>(null)
  const chipsWidth = useRef(0)
  const [confirming, setConfirming] = useState<Confirming>(null)

  // One callback per section for the page's life, so a redraw does not detach
  // and reattach every panel's view.
  const [anchorAt] = useState(() => {
    const callbacks = new Map<SectionId, (node: View | null) => void>()
    return (id: SectionId): ((node: View | null) => void) => {
      let callback = callbacks.get(id)
      if (!callback) {
        callback = node => {
          if (node) anchors.set(id, node)
          else anchors.delete(id)
        }
        callbacks.set(id, callback)
      }
      return callback
    }
  })

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
      Promise.all([...anchors].map(async ([id, node]) => ({ id, place: await at(node) }))),
    ])
    if (!origin) return
    chipBarHeight.current = bar?.height ?? 0
    const pageTop = column ? COLUMN_TOP : narrowTop
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
    const list = indexed.map(section => ({
      id: section.id,
      top: tops.current.get(section.id) ?? Number.POSITIVE_INFINITY,
    }))
    const next = activeSection(
      list,
      event.nativeEvent.contentOffset.y,
      metrics.current.view,
      metrics.current.content,
    )
    if (next !== null) active.set(next)
  }

  const go = (id: SectionId, ms = CHOSEN_HOLD_MS, animated = true): void => {
    active.set(id)
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

  const index = (
    <SectionIndex
      sections={indexed}
      active={active}
      column={column}
      chipsRef={chipsRef}
      chipsWidth={chipsWidth}
      onGo={go}
    />
  )

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
        contentContainerStyle={[styles.content, column ? styles.contentColumn : pageFrame(wide)]}
      >
        <View ref={headRef} style={styles.head}>
          <PageHeader
            title="Settings"
            back={{ to: '/profile', testID: 'settings-back' }}
            subtitle={
              <Text style={capped ? styles.subCapped : undefined}>
                {capped ? '● ' : null}
                {healthLine(health.data, {
                  loading: health.isPending,
                  error: health.isError ? health.error : null,
                  capped,
                  compact: !wide,
                })}
              </Text>
            }
            subtitleTestID="settings-health"
          />
        </View>

        {column ? null : (
          <ChipBar
            wide={wide}
            barRef={chipBarRef}
            chipsRef={chipsRef}
            onWidth={barWidth => {
              chipsWidth.current = barWidth
            }}
          >
            {index}
          </ChipBar>
        )}

        <StackedRows value={!rowsBeside}>
          <View style={styles.panels}>
            <ConnectionPanel anchor={anchorAt('account')} onConfirm={setConfirming} />

            <AppearancePanel anchor={anchorAt('appearance')} />

            {/* A browser streams and keeps nothing: only an installed app has songs on it. */}
            {installedApp ? (
              <OfflinePanel
                title={onThisDevice(place)}
                anchor={anchorAt('offline')}
                onConfirm={setConfirming}
              />
            ) : null}

            <DevicesPanel anchor={anchorAt('devices')} />

            {shown('playback') ? (
              <Panel title="Playback" hint="on this device" anchor={anchorAt('playback')}>
                <CrossfadeRow />
              </Panel>
            ) : null}

            <SmartPanel anchor={anchorAt('smart')} />

            <Panel title="Lyrics" hint="on this device" anchor={anchorAt('lyrics')}>
              <Row label="Show pinyin" hint="A romanized line under Chinese lyrics.">
                <Toggle
                  value={pinyinOn}
                  onChange={on => setRomanizationOn('zh', on)}
                  label="Show pinyin"
                />
              </Row>
              <Row label="Show romaji" hint="A romanized line under Japanese lyrics." last>
                <Toggle
                  value={romajiOn}
                  onChange={on => setRomanizationOn('ja', on)}
                  label="Show romaji"
                />
              </Row>
            </Panel>

            {shortcuts ? <ShortcutsPanel items={shortcuts} anchor={anchorAt('shortcuts')} /> : null}

            <Panel title="About" anchor={anchorAt('about')}>
              <Row label="Version">
                <Text style={partStyles.valueText}>
                  {String(Constants.expoConfig?.version ?? '1.0.0')}
                </Text>
              </Row>
              {/* Each guide shows once on a device; this brings them all back, once each. */}
              <Row label="Tips">
                <Button
                  label="Show tips again"
                  onPress={() => {
                    forgetGuides()
                    showToast('Tips will show again.', 'good')
                  }}
                  testID="settings-show-tips"
                />
              </Row>
              <UsageRow />
            </Panel>

            {indexed.some(section => section.id === 'advanced') ? (
              <View ref={anchorAt('advanced')} style={styles.advanced}>
                <SectionHead title="Advanced" />
                <LibraryPanel anchor={anchorAt('library')} onConfirm={setConfirming} />
                <ImportingPanel anchor={anchorAt('importing')} />
                <SmartModelPanel anchor={anchorAt('model')} />
                {shown('desktop') ? <DesktopPanel anchor={anchorAt('desktop')} /> : null}
                {shown('getApp') ? <GetAppPanel anchor={anchorAt('getApp')} /> : null}
              </View>
            ) : null}
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
 * The page's index: a column beside the panels, or the sticky row of chips.
 * It alone reads which section is being read, so the scroll-spy moving on
 * redraws these links and nothing else.
 */
function SectionIndex({
  sections,
  active,
  column,
  chipsRef,
  chipsWidth,
  onGo,
}: {
  sections: readonly Section[]
  active: ValueStore<SectionId>
  column: boolean
  chipsRef: RefObject<ScrollView | null>
  chipsWidth: RefObject<number>
  onGo: (id: SectionId) => void
}): ReactNode {
  const on = useValueStore(active)
  const chipAt = useRef(new Map<SectionId, { x: number; width: number }>())

  // At narrow widths the chip for the section being read is often scrolled out
  // of its row. Bring it back — sideways only.
  useEffect(() => {
    const chip = chipAt.current.get(on)
    if (!chip || chipsWidth.current === 0) return
    chipsRef.current?.scrollTo({
      x: Math.max(0, chip.x - (chipsWidth.current - chip.width) / 2),
      animated: true,
    })
  }, [on, chipsRef, chipsWidth])

  return sections.map(section => {
    const current = on === section.id
    if (!column) {
      // A phone's index is a row of chips, the lit one the section on screen.
      return (
        <Chip
          key={section.id}
          label={section.label}
          selected={current}
          role="link"
          onPress={() => onGo(section.id)}
          onLayout={event => {
            const { x, width: chipWidth } = event.nativeEvent.layout
            chipAt.current.set(section.id, { x, width: chipWidth })
          }}
        />
      )
    }
    return (
      <Press
        key={section.id}
        onPress={() => onGo(section.id)}
        accessibilityRole="link"
        accessibilityState={{ selected: current }}
        aria-current={current ? 'page' : undefined}
        style={[styles.indexItem, current && styles.indexItemOn]}
      >
        <Text style={[styles.indexText, current && styles.indexTextOn]}>{section.label}</Text>
      </Press>
    )
  })
}

/**
 * Crossfade, this device's own (`crossfadePref.ts`). Drawn only where this
 * device's engine can fade one song into the next — a browser and the
 * installed app can. A phone's engine plays gapless and cannot fade, and a
 * slider that does nothing there is worse than none: Playback, which holds
 * nothing else, is not drawn there (`sectionsFor`).
 */
function CrossfadeRow(): ReactNode {
  const seconds = useCrossfadeSeconds()
  return (
    <Row label="Crossfade" hint="Overlaps songs. Zero turns it off." last>
      <SliderSetting
        value={seconds}
        min={0}
        max={CROSSFADE_MAX}
        step={1}
        label="Crossfade"
        format={crossfadeLabel}
        onCommit={setCrossfadeSeconds}
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
  wide,
  barRef,
  chipsRef,
  onWidth,
  children,
}: {
  wide: boolean
  barRef: RefObject<View | null>
  chipsRef: RefObject<ScrollView | null>
  onWidth: (width: number) => void
  children: ReactNode
}): ReactNode {
  const { theme } = useUnistyles()
  return (
    <View
      ref={barRef}
      style={[
        styles.chipBar,
        wide && styles.chipBarWide,
        { backgroundColor: theme.colors.surface0 },
      ]}
    >
      <ScrollView
        ref={chipsRef}
        onLayout={event => onWidth(event.nativeEvent.layout.width)}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.chips, wide && styles.chipsWide]}
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
  head: { marginBottom: 20 },
  subCapped: { color: theme.colors.danger },
  panels: { gap: 20, maxWidth: PANELS_MAX },
  advanced: { gap: 20, paddingTop: space.md },
  indexColumn: {
    position: 'absolute',
    top: COLUMN_TOP,
    left: INDEX_GUTTER,
    width: INDEX_WIDTH,
    gap: 1,
  },
  indexTitle: {
    ...label(theme.colors),
    paddingTop: space.xs,
    paddingHorizontal: space.snug,
    paddingBottom: space.tight,
  },
  indexItem: {
    paddingVertical: space.tight,
    paddingHorizontal: space.snug,
    borderRadius: radius.pill,
  },
  // The section you are on is "on" as a chosen chip is: white, with dark ink
  // (proposal P1). A grey fill a step lighter read as hovered, not chosen.
  indexItemOn: { backgroundColor: theme.colors.textPrimary },
  indexText: { color: theme.colors.textMuted, fontSize: type.sub },
  indexTextOn: { color: theme.colors.onPrimary, fontWeight: '600' },
  // Out to the page's edges, then the gutter again inside: the chips scroll
  // under the page's margin rather than stopping at it.
  chipBar: {
    marginHorizontal: -space.gutter,
    paddingVertical: space.snug,
    marginBottom: CHIPS_GAP,
    backgroundColor: theme.colors.surface0,
  },
  chipBarWide: { marginHorizontal: -space.gutterWide },
  chips: { gap: space.tight, paddingHorizontal: space.gutter },
  chipsWide: { paddingHorizontal: space.gutterWide },
}))
