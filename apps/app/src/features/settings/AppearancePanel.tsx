import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { buildAccent } from '@selfmp3/client'
import { ACCENT_PRESETS, useAccent } from '../../ui/accent'
import type { ThemeChoice } from '../../ui/appearancePrefs'
import { Select } from '../../ui/components/Select'
import { Slider } from '../../ui/components/Slider'
import { Panel, Row } from './SettingsParts'
import { accentName } from './settings.model'

/**
 * Each preset's swatch colour, worked out once: the panel redraws on every
 * frame of a hue drag, and building seven accents per frame was most of it.
 */
const PRESET_SWATCHES = ACCENT_PRESETS.map(preset => ({
  ...preset,
  color: buildAccent(preset.hue).accent,
}))

export function AppearancePanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const { theme: ui } = useUnistyles()
  const accent = useAccent()
  return (
    <Panel title="Appearance" hint="on this device" anchor={anchor}>
      <Row label="Theme" hint="System follows this device.">
        <Select<ThemeChoice>
          value={accent.theme}
          onChange={accent.setTheme}
          options={[
            { value: 'dark', label: 'Dark' },
            { value: 'light', label: 'Light' },
            { value: 'system', label: 'System' },
          ]}
          label="Theme"
        />
      </Row>
      <Row
        label="Accent colour"
        hint={`Tints the whole app · ${accentName(accent.hue, ACCENT_PRESETS)}`}
        last
      >
        <View style={styles.swatches}>
          {PRESET_SWATCHES.map(preset => (
            <Pressable
              key={preset.hue}
              onPress={() => accent.setHue(preset.hue)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={preset.name}
              accessibilityState={{ selected: accent.hue === preset.hue }}
              style={[
                styles.swatch,
                { backgroundColor: preset.color },
                accent.hue === preset.hue && { borderColor: ui.colors.textPrimary },
              ]}
            />
          ))}
        </View>
        <Slider
          value={accent.hue}
          min={0}
          max={359}
          step={1}
          label="Accent hue"
          hue
          width={156}
          onChange={accent.setHue}
        />
      </Row>
    </Panel>
  )
}

const styles = StyleSheet.create(() => ({
  swatches: { flexDirection: 'row', gap: 6 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
}))
