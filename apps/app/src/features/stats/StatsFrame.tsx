import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { StyleProp, ViewStyle } from 'react-native'
import { Animated, Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { HIT_TARGET, radius } from '@selfmp3/client'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayout } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { ChevronRight } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Segmented } from '../../ui/components/Segmented'
import { Select } from '../../ui/components/Select'
import { ease, timing } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { pageTitle } from '../../ui/surfaces'
import { periodLabel, STATS_PERIODS, type StatsPeriod } from './stats.model'

/** How far a set of numbers comes in from. */
const SWAP_TRAVEL = 26

/**
 * The page's numbers, when the window changes: the new set slides in from the
 * side the change came from — a longer window from the right, a shorter one
 * from the left — and fades up as it arrives (Xiao, 2026-09-21). A plain fade
 * said that something had changed; the direction says which way.
 *
 * `order` is the window's place in the row of them, which is what gives the
 * direction. Where it came from is held in state rather than a ref, because
 * the interpolation is built during render; the numbers themselves arrive
 * part-way through the move, which is what makes it read as the page catching
 * up rather than as a flash.
 */
function Arriving({
  order,
  style,
  children,
}: {
  order: number
  /** The page's own gap: this view stands between the content and its blocks. */
  style: StyleProp<ViewStyle>
  children: ReactNode
}): ReactNode {
  const [value] = useState(() => new Animated.Value(1))
  // Which window is showing and which side the last change came from, settled
  // during render as `SlidingHighlight` settles its pair: the interpolation
  // below is built here, so the direction has to be known by now.
  const [swap, setSwap] = useState({ order, from: 0 })
  if (swap.order !== order) {
    setSwap({ order, from: order > swap.order ? SWAP_TRAVEL : -SWAP_TRAVEL })
  }
  const from = swap.from
  useEffect(() => {
    // Nothing to play on the first showing; `from` is only zero there.
    if (swap.from === 0) return
    value.setValue(0)
    timing(value, 1, MOVE_MS.arrive, undefined, { easing: ease.out })
  }, [swap, value])
  return (
    <Animated.View
      style={[
        style,
        {
          opacity: value,
          transform: [
            { translateX: value.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  )
}

/** Where "View Report" goes: the month as a page, a page of its own. */
const REPORT_HREF = '/stats/report'

/**
 * The page Stats is drawn in: the title, the window, and the way to the month
 * as a page (`P32`, `C15`).
 *
 * Drawn the same whether or not there are numbers to put in it, so a cloud
 * library whose server is away still gets the page, with the reason in its
 * body (StatsViaServer.tsx).
 *
 * A computer has room for every window as a segment and the Report as a pill
 * beside them. A phone has the window as one control that opens the list, and
 * the Report as the last line of the page.
 */
export function StatsFrame({
  period,
  onPeriod,
  testID,
  children,
}: {
  period: StatsPeriod
  onPeriod: (period: StatsPeriod) => void
  testID: string
  children: ReactNode
}): ReactNode {
  const { wide } = useLayout()
  const options = STATS_PERIODS.map(option => ({ value: option, label: periodLabel(option) }))

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        testID={testID}
      >
        {/* On a phone the way back, the window and the page's name share a
            line, the name at the far end of it, as Import has it (`P32`). A
            computer has no way back here, so the name leads and the windows
            and the Report follow it. */}
        <View style={[styles.head, wide ? null : styles.headPhone]}>
          <BackButton to="/profile" label="Profile" testID="stats-back" />
          {wide ? null : (
            <Select
              value={period}
              onChange={onPeriod}
              label="Time range"
              options={options}
              testID="stats-range"
            />
          )}
          <View style={[styles.titles, wide ? null : styles.titlesRight]}>
            {/* No caption under the name: the window's own control says which
                window this is, and said it twice. */}
            <Text
              style={[styles.heading, wide ? null : styles.titleRight]}
              accessibilityRole="header"
            >
              Stats
            </Text>
          </View>
          {wide ? (
            <View style={styles.controls}>
              <Segmented value={period} onChange={onPeriod} label="Time range" options={options} />
              <ReportLink pill />
            </View>
          ) : null}
        </View>
        <Arriving
          order={STATS_PERIODS.indexOf(period)}
          style={wide ? styles.stackWide : styles.stack}
        >
          {children}
        </Arriving>
        {wide ? null : <ReportLink pill={false} />}
        <ChromeSpacer />
      </ScrollView>
    </SafeAreaView>
  )
}

/** "View Report": a pill in the computer's header, the page's last line on a phone. */
function ReportLink({ pill }: { pill: boolean }): ReactNode {
  const router = useRouter()
  return (
    <Pressable
      onPress={() => router.push(REPORT_HREF)}
      accessibilityRole="link"
      accessibilityLabel="View Report"
      testID="stats-report"
      style={({ pressed }) => [
        pill ? styles.pill : styles.line,
        pressed && (pill ? styles.pillPressed : styles.linePressed),
      ]}
    >
      <Text style={pill ? styles.pillText : styles.linkText}>View Report</Text>
      {pill ? null : <ChevronRight size={16} tone="textMuted" />}
    </Pressable>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40, gap: 12 },
  // `S2`'s gutters: 40 to 48 on a computer's page, 20 on a phone's.
  contentWide: { paddingTop: 40, paddingHorizontal: 44, gap: 14 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 20 },
  // The blocks of the page are this view's children, not the scroll content's,
  // so the page's gap has to be repeated here or the cards and the ranking sit
  // flush against each other (Xiao, 2026-09-21).
  stack: { gap: 12 },
  stackWide: { gap: 14 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  headPhone: { justifyContent: 'flex-start', alignItems: 'flex-start' },
  titles: { gap: 2, flexShrink: 1 },
  titlesRight: { marginLeft: 'auto', minWidth: 0, alignItems: 'flex-end' },
  titleRight: { textAlign: 'right' },
  heading: pageTitle(theme.colors),
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  pill: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    justifyContent: 'center',
  },
  pillPressed: { backgroundColor: theme.colors.surface3 },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: HIT_TARGET,
  },
  linePressed: { opacity: 0.6 },
  pillText: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  linkText: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
}))
