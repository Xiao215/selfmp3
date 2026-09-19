import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { fonts } from '@selfmp3/client'
import { lookInk, receiptLook, type ReceiptLine } from '../looks.model'
import { mono, type LookProps } from './parts'

/** `P34`'s slip: 320 wide, as long as a month's receipt runs. */
export const RECEIPT_SIZE = { width: 320, height: 600 } as const

/*
 * The tear lines are printed dashes, as a till prints them, rather than a
 * dashed border: a character row is what a receipt has, and it keeps an edge
 * off the page.
 */
const TEAR = '- '.repeat(40)

/**
 * Receipt (`P34`): the period itemised. The top songs are the items, the facts
 * are lines, the minutes are the total, and the days of the window are the
 * bar code at the foot.
 */
export function ReceiptLook({ input, hue }: LookProps): ReactNode {
  const look = receiptLook(input)
  const ink = lookInk('receipt', hue)
  const text = { color: ink.ink }
  const tear = (
    <Text style={[styles.tear, text]} numberOfLines={1} ellipsizeMode="clip">
      {TEAR}
    </Text>
  )
  return (
    <View style={[styles.slip, { backgroundColor: ink.ground }]}>
      <View style={styles.head}>
        <Text style={[styles.title, text]}>{look.head}</Text>
        <Text style={[styles.line, text, styles.centered]}>{look.sub}</Text>
      </View>
      {tear}
      <Lines lines={look.items} color={ink.ink} />
      {tear}
      <Lines lines={look.lines} color={ink.ink} />
      {tear}
      <View style={styles.total}>
        <Text style={[styles.totalLabel, text]}>TOTAL</Text>
        <Text style={[styles.totalFigure, text]}>{look.total}</Text>
      </View>
      <View style={styles.bars} accessibilityElementsHidden importantForAccessibility="no">
        {look.bars.map((share, i) => (
          <View
            key={i}
            style={[
              styles.bar,
              { height: `${Math.max(6, share * 100)}%`, backgroundColor: ink.ink },
            ]}
          />
        ))}
      </View>
      <View style={styles.foot}>
        {look.footer.map((line, i) => (
          <Text key={i} style={[styles.line, text, styles.centered]}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  )
}

function Lines({ lines, color }: { lines: readonly ReceiptLine[]; color: string }): ReactNode {
  return (
    <View>
      {lines.map((line, i) => (
        // Two songs can share a title; the position is what tells the lines apart.
        <View key={i} style={styles.row}>
          <Text style={[styles.line, styles.name, { color }]} numberOfLines={1}>
            {line.name}
          </Text>
          <Text style={[styles.line, { color }]}>{line.value}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  slip: {
    width: RECEIPT_SIZE.width,
    height: RECEIPT_SIZE.height,
    paddingTop: 26,
    paddingHorizontal: 24,
    paddingBottom: 20,
    gap: 10,
  },
  head: { alignItems: 'center', gap: 2 },
  title: { fontFamily: mono, fontSize: 16, fontWeight: '600', letterSpacing: 2 },
  line: { fontFamily: mono, fontSize: 12, lineHeight: 20 },
  centered: { textAlign: 'center' },
  tear: { fontFamily: mono, fontSize: 12, lineHeight: 12, overflow: 'hidden' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  name: { flex: 1, minWidth: 0 },
  total: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  totalLabel: { fontFamily: mono, fontSize: 14, fontWeight: '600' },
  totalFigure: { fontFamily: fonts.serif, fontSize: 44, lineHeight: 46 },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 40, marginTop: 4 },
  bar: { flex: 1 },
  // The thanks sit at the foot of the slip however few the items were.
  foot: { marginTop: 'auto', alignItems: 'center' },
})
