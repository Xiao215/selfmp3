import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { MenuCommand } from '../../ports/menuKeys'
import { Kbd } from '../../ui/components/Kbd'
import { Panel, partStyles } from './SettingsParts'
import { listShortcutRows, shortcutRows } from './shortcuts.model'
import { space } from '@selfmp3/client'

/**
 * The installed app's menu keys, read from the menu itself (`menuKeys` port),
 * so this lists what the menu bar really has, and then a song list's keys.
 * Nowhere else: a browser tab has no shortcuts of its own, and a phone has no
 * keys.
 */
export function ShortcutsPanel({
  items,
  anchor,
}: {
  items: readonly MenuCommand[]
  anchor: (node: View | null) => void
}): ReactNode {
  const rows = useMemo(() => [...shortcutRows(items), ...listShortcutRows()], [items])
  return (
    <Panel title="Keyboard shortcuts" hint="on this device" anchor={anchor}>
      {rows.map(row => (
        <View key={row.label} style={styles.shortcut}>
          <View style={styles.keys}>
            {row.keys.map((key, index) => (
              <Kbd key={`${index}-${key}`}>{key}</Kbd>
            ))}
          </View>
          <Text style={partStyles.hint}>{row.label}</Text>
        </View>
      ))}
    </Panel>
  )
}

const styles = StyleSheet.create(() => ({
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 5 },
  keys: { flexDirection: 'row', gap: 3, minWidth: 116 },
}))
