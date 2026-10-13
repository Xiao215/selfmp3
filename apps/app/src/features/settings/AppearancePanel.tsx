import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'
import { buildAccent } from '@selfmp3/client'
import { ACCENT_PRESETS, useAccent } from '../../ui/accent'
import type { ThemeChoice } from '../../ui/appearancePrefs'
import { HueSwatches } from '../../ui/components/HueSwatches'
import { Select } from '../../ui/components/Select'
import { Slider } from '../../ui/components/Slider'
import { Panel, Row } from './SettingsParts'
import { accentName } from './settings.model'

/**
 * Each preset's swatch colour, worked out once: the panel redraws on every
 * frame of a hue drag, and building seven accents per frame was most of it.
 */
const PRESET_SWATCHES = ACCENT_PRESETS.map(preset => {
  const built = buildAccent(preset.hue)
  return { hue: preset.hue, name: preset.name, fill: built.accent, tick: built.onAccent }
})

export function AppearancePanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const { theme: ui } = useUnistyles()
  const accent = useAccent()
  // Ringed in the ink, whichever accent is chosen: the ring is the choice.
  const ring = ui.colors.textPrimary
  const swatches = useMemo(() => PRESET_SWATCHES.map(each => ({ ...each, ring })), [ring])
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
        <HueSwatches
          value={accent.hue}
          options={swatches}
          label="Accent colour"
          onChange={accent.setHue}
          size={22}
        />
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
