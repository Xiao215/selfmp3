import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { MenuCommand } from '../../ports/menuKeys'
import { Kbd } from '../../ui/components/Kbd'
import { Card, partStyles } from './SettingsParts'
import { LIST_ROWS_TAKE_KEYS } from '../../selection/useListKeys'
import { listShortcutRows, shortcutRows } from './shortcuts.model'
import { space } from '@selfmp3/client'

/**
 * The menu's keys, read from the menu itself (`menuKeys` port), so this lists
 * what the menu bar really has — or, on an iPad with a keyboard attached, what
 * it registers from the same list — and then a song list's keys. Nowhere else:
 * a browser tab has no shortcuts of its own, and a finger has no keys.
 */
export function ShortcutsPanel({ items }: { items: readonly MenuCommand[] }): ReactNode {
  const rows = useMemo(
    () => [...shortcutRows(items), ...listShortcutRows(LIST_ROWS_TAKE_KEYS)],
    [items],
  )
  return (
    <Card title="Keyboard shortcuts">
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
    </Card>
  )
}

const styles = StyleSheet.create(() => ({
  shortcut: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 5 },
  keys: { flexDirection: 'row', gap: 3, minWidth: 116 },
}))
