import { ChromeSpacer } from '../../shell/ChromeSpacer'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { STATS_RANGE_LABELS } from '@selfmp3/shared'
import { HIT_TARGET, radius } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { ChevronRight } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Segmented } from '../../ui/components/Segmented'
import { Select } from '../../ui/components/Select'
import { pageTitle } from '../../ui/surfaces'
import { periodLabel, statsRangeFor, STATS_PERIODS, type StatsPeriod } from './stats.model'

/** Where "The month as a page" goes: the Report, a page of its own. */
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
            <Text
              style={[styles.heading, wide ? null : styles.titleRight]}
              accessibilityRole="header"
            >
              Stats
            </Text>
            <Text style={[styles.sub, wide ? null : styles.titleRight]}>
              {STATS_RANGE_LABELS[statsRangeFor(period)]}
            </Text>
          </View>
          {wide ? (
            <View style={styles.controls}>
              <Segmented value={period} onChange={onPeriod} label="Time range" options={options} />
              <ReportLink pill />
            </View>
          ) : null}
        </View>
        {children}
        {wide ? null : <ReportLink pill={false} />}
        <ChromeSpacer />
      </ScrollView>
    </SafeAreaView>
  )
}

/** "The month as a page": a pill in the computer's header, the page's last line on a phone. */
function ReportLink({ pill }: { pill: boolean }): ReactNode {
  const router = useRouter()
  return (
    <Pressable
      onPress={() => router.push(REPORT_HREF)}
      accessibilityRole="link"
      accessibilityLabel="The month as a page"
      testID="stats-report"
      style={({ pressed }) => [
        pill ? styles.pill : styles.line,
        pressed && (pill ? styles.pillPressed : styles.linePressed),
      ]}
    >
      <Text style={pill ? styles.pillText : styles.linkText}>The month as a page</Text>
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
  sub: { color: theme.colors.textSecondary, fontSize: 13 },
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
