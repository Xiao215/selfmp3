import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { buildAccent } from '@selfmp3/client'
import { ACCENT_PRESETS, useAccent, type ThemeChoice } from '../../ui/accent'
import { Select } from '../../ui/components/Select'
import { Slider } from '../../ui/components/Slider'
import { Panel, Row } from './SettingsParts'
import { accentName } from './settings.model'
import {} from '../metadata/metadata.model'

export function AppearancePanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const { theme: ui } = useUnistyles()
  const accent = useAccent()
  const chooseTheme = (choice: ThemeChoice): void => {
    accent.setTheme(choice)
  }
  return (
    <Panel title="Appearance" hint="on this device" anchor={anchor}>
      <Row
        label="Theme"
        hint={`“System” follows this device’s own light and dark setting, and changes with it. Your accent colour holds either way.`}
      >
        <Select<ThemeChoice>
          value={accent.theme}
          onChange={chooseTheme}
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
        hint={`Drives every colour in the app — the surfaces are tinted from it too, so a change is felt rather than spotted. ${accentName(accent.hue, ACCENT_PRESETS)}.`}
        last
      >
        <View style={styles.swatches}>
          {ACCENT_PRESETS.map(preset => (
            <Pressable
              key={preset.hue}
              onPress={() => accent.setHue(preset.hue)}
              hitSlop={4}
              accessibilityRole="button"
              accessibilityLabel={preset.name}
              accessibilityState={{ selected: accent.hue === preset.hue }}
              style={[
                styles.swatch,
                { backgroundColor: buildAccent(preset.hue).accent },
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

// ---------------------------------------------------------- confirmations

const styles = StyleSheet.create(() => ({
  swatches: { flexDirection: 'row', gap: 6 },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: 'transparent' },
}))
