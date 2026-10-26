import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { buildAccent, iconSize, space } from '@selfmp3/client'
import { ACCENT_PRESETS, useAccent } from '../../ui/accent'
import type { ThemeChoice } from '../../ui/appearancePrefs'
import { HueSwatches } from '../../ui/components/HueSwatches'
import { Moon, Plus } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { Slider } from '../../ui/components/Slider'
import { Card, Tile } from './SettingsParts'

/**
 * Each preset's swatch colour, worked out once: the card redraws on every
 * frame of a hue drag, and building seven accents per frame was most of it.
 */
const PRESET_SWATCHES = ACCENT_PRESETS.map(preset => {
  const built = buildAccent(preset.hue)
  return { hue: preset.hue, name: preset.name, fill: built.accent, tick: built.onAccent }
})

/** The theme tile's steps, in the order a press goes through them. */
const THEMES: readonly { value: ThemeChoice; label: string }[] = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'system', label: 'Match this device' },
]

/** The theme as a quick tile (B): each press the next of Dark, Light and this device's own. */
export function ThemeTile(): ReactNode {
  const accent = useAccent()
  const at = Math.max(
    0,
    THEMES.findIndex(each => each.value === accent.theme),
  )
  const now = THEMES[at] ?? THEMES[0]!
  return (
    <Tile
      icon={<Moon size={iconSize.medium} tone="accent" />}
      label="Theme"
      state={now.label}
      on={false}
      role="button"
      onPress={() => accent.setTheme((THEMES[(at + 1) % THEMES.length] ?? THEMES[0]!).value)}
      testID="settings-theme"
    />
  )
}

/**
 * The accent: the presets as swatches, and one more for a colour of your own
 * that opens the hue strip under them. Open from the start when the accent
 * already is one of your own.
 */
export function AccentCard(): ReactNode {
  const { theme: ui } = useUnistyles()
  const accent = useAccent()
  const own = !ACCENT_PRESETS.some(preset => preset.hue === accent.hue)
  const [open, setOpen] = useState(own)
  // Ringed in the ink, whichever accent is chosen: the ring is the choice.
  const ring = ui.colors.textPrimary
  const swatches = useMemo(() => PRESET_SWATCHES.map(each => ({ ...each, ring })), [ring])
  return (
    <Card title="Accent">
      <View style={styles.swatches}>
        <HueSwatches
          value={accent.hue}
          options={swatches}
          label="Accent colour"
          onChange={accent.setHue}
          size={26}
        />
        <Press
          feedback="dim"
          onPress={() => setOpen(value => !value)}
          accessibilityRole="button"
          accessibilityLabel="A colour of your own"
          accessibilityState={{ expanded: open }}
          style={[styles.custom, own && styles.customOn]}
        >
          <Plus size={iconSize.small} tone={own ? 'onAccent' : 'textMuted'} />
        </Press>
      </View>
      {open ? (
        <View style={styles.strip}>
          <Slider
            value={accent.hue}
            min={0}
            max={359}
            step={1}
            label="Accent hue"
            hue
            width={240}
            onChange={accent.setHue}
          />
        </View>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create(theme => ({
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: space.md,
    paddingTop: space.lg,
  },
  custom: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  customOn: {
    borderStyle: 'solid',
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.accent,
  },
  strip: { paddingTop: space.lg },
}))
