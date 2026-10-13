import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { radius, type, withAlpha } from '@selfmp3/client'
import { useFade } from '../motion'
import { MOVE_MS } from '../motion.model'
import { useSlidingHighlight } from './SlidingHighlight'

/**
 * A row of mutually exclusive choices. For a range or a mode, where every
 * option is worth seeing at once.
 *
 * The chosen pill slides from the segment it was on to the one it is on now
 * (`useSlidingHighlight`) rather than jumping between them: it is the same
 * control as the tab bar's pill and the sidebar's highlight, and it moves the
 * same way, on the same spring. The chosen segment's ink crossfades with it over
 * `MOVE_MS.tab`, so half the change does not arrive at the first frame while the
 * other half is still on its way.
 *
 * `size="small"` sets it a size down, for a head with little room;
 * `ground="translucent"` draws the group as a veil of the ink rather than the
 * control surface, over a song's colour (Now Playing's Lyrics and Details).
 * `tabs` makes it a tab list, for a choice of what the page shows rather than
 * of a setting.
 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'regular',
  ground = 'solid',
  tabs = false,
  style,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  /** What is being chosen, e.g. "Time range". */
  label: string
  size?: 'regular' | 'small'
  ground?: 'solid' | 'translucent'
  tabs?: boolean
  style?: StyleProp<ViewStyle>
}): ReactNode {
  const pill = useSlidingHighlight(value, styles.itemActive)
  return (
    <View
      style={[styles.group, ground === 'translucent' && styles.groupTranslucent, style]}
      role={tabs ? 'tablist' : 'group'}
      accessibilityLabel={label}
    >
      {pill.highlight}
      {options.map(option => (
        <Segment
          key={option.value}
          label={option.label}
          active={option.value === value}
          // Its own fill only until the sliding pill has somewhere to be.
          placed={pill.placed}
          small={size === 'small'}
          translucent={ground === 'translucent'}
          tab={tabs}
          onLayout={pill.measure(option.value)}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  )
}

function Segment({
  label,
  active,
  placed,
  small,
  translucent,
  tab,
  onLayout,
  onPress,
}: {
  label: string
  active: boolean
  placed: boolean
  small: boolean
  translucent: boolean
  tab: boolean
  onLayout: (event: LayoutChangeEvent) => void
  onPress: () => void
}): ReactNode {
  const [hovered, setHovered] = useState(false)
  // With a mouse the segment under it lights up, and dims again a little more
  // slowly than it lit (`M3`, 3).
  const hover = useFade(hovered && !active, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  const lit = useFade(active, MOVE_MS.tab, MOVE_MS.tab)
  const hoverStyle = useMemo(() => ({ opacity: hover }), [hover])
  const litStyle = useMemo(() => ({ opacity: lit }), [lit])
  return (
    <Pressable
      onLayout={onLayout}
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole={tab ? 'tab' : 'button'}
      // Named outright: the label is drawn twice below, and a name read from
      // the two of them said "All timeAll time".
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      aria-pressed={tab ? undefined : active}
      aria-selected={tab ? active : undefined}
      style={({ pressed }) => [
        styles.item,
        pressed && !active && (translucent ? styles.itemVeiled : styles.itemHovered),
        active && !placed && styles.itemActive,
      ]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.hover, translucent && styles.itemVeiled, hoverStyle]}
      />
      <View style={[styles.pad, small && styles.padSmall]}>
        {/*
          The label twice over: the quiet one in the flow, which gives the
          segment its size, and the chosen one laid exactly over it, faded in as
          the pill arrives. A colour cannot be crossfaded on the native driver;
          an opacity can, and two stacked labels is what that costs.
        */}
        <Text style={[styles.label, small && styles.labelSmall]} numberOfLines={1}>
          {label}
        </Text>
        <Animated.View
          pointerEvents="none"
          aria-hidden
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.labelLayer, litStyle]}
        >
          <Text style={[styles.labelActive, small && styles.labelSmall]} numberOfLines={1}>
            {label}
          </Text>
        </Animated.View>
      </View>
    </Pressable>
  )
}

/** The label's own type, so the quiet copy and the lit copy sit exactly on each other. */
const LABEL = { fontSize: type.sub, fontWeight: '600' } as const

/** Every layer that fills its parent: the hover wash, the lit label. */
const FILL = { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as const

const styles = StyleSheet.create(theme => ({
  // A pill on the control surface; the chosen segment is a white pill inside
  // it, "on" as a chosen chip is (proposal P1). A lighter grey read as hovered.
  group: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    gap: 2,
    padding: 3,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
  },
  /*
   * The segment carries no padding of its own: the room around the label is an
   * inner view's, so the wash that fills the segment fills all of it and the
   * lit label lines up with the quiet one whatever the parent's padding does to
   * a layer laid over it.
   */
  // Over a song's colour, a veil of the ink: a surface read as a dark box there.
  groupTranslucent: { backgroundColor: theme.colors.veil },
  item: { borderRadius: radius.pill },
  pad: { paddingVertical: 6, paddingHorizontal: 14 },
  padSmall: { paddingHorizontal: 12 },
  itemHovered: { backgroundColor: theme.colors.surface3 },
  itemVeiled: { backgroundColor: withAlpha(theme.colors.textPrimary, 0.1) },
  itemActive: { backgroundColor: theme.colors.textPrimary, borderRadius: radius.pill },
  hover: { ...FILL, borderRadius: radius.pill, backgroundColor: theme.colors.surface3 },
  labelLayer: { ...FILL, alignItems: 'center', justifyContent: 'center' },
  label: { ...LABEL, color: theme.colors.textSecondary },
  labelSmall: { fontSize: type.small },
  labelActive: { ...LABEL, color: theme.colors.onPrimary },
}))
