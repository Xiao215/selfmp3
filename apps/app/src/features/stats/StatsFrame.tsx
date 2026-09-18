import type { ReactNode } from 'react'
import { ScrollView, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useLayout } from '../../shell/useLayout'
import { BackToYou } from '../../ui/components/BackToYou'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Segmented } from '../../ui/components/Segmented'
import { pageTitle } from '../../ui/surfaces'
import {
  periodLabel,
  STATS_PERIODS,
  STATS_TABS,
  type StatsPeriod,
  type StatsTab,
} from './stats.model'

/** What both tabs hand the frame: which tab, which window, and how to change either. */
export interface StatsFrameProps {
  tab: StatsTab
  onTab: (tab: StatsTab) => void
  period: StatsPeriod
  onPeriod: (period: StatsPeriod) => void
}

/**
 * The page both Stats tabs are drawn in: the title, the tabs, the one range,
 * and whatever the tab puts in the header's corner (Report's share).
 *
 * One header rather than a range control per tab, so the window chosen
 * survives changing tabs.
 */
export function StatsFrame({
  tab,
  onTab,
  period,
  onPeriod,
  actions,
  testID,
  children,
}: StatsFrameProps & {
  /** Icon buttons at the end of the title row. */
  actions?: ReactNode
  testID: string
  children: ReactNode
}): ReactNode {
  const { wide } = useLayout()

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        testID={testID}
      >
        <BackToYou />
        <View style={styles.titleRow}>
          <Text style={styles.heading} accessibilityRole="header">
            Stats
          </Text>
          {actions ? <View style={styles.actions}>{actions}</View> : null}
        </View>
        <View style={[styles.controls, !wide && styles.controlsNarrow]}>
          <Segmented value={tab} onChange={onTab} label="Stats view" options={STATS_TABS} />
          <Segmented
            value={period}
            onChange={onPeriod}
            label="Time range"
            options={STATS_PERIODS.map(option => ({
              value: option,
              label: periodLabel(option, wide),
            }))}
          />
        </View>
        {children}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 36,
  },
  heading: pageTitle(theme.colors),
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
    marginBottom: 20,
  },
  controlsNarrow: { flexDirection: 'column', alignItems: 'flex-start', gap: 8 },
}))
