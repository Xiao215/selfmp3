import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { space } from '@selfmp3/client'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { PageHeader } from '../../ui/components/PageHeader'
import { ScrollView } from '../../ui/components/Scroll'
import { pageFrame } from '../../ui/surfaces'
import { useLayoutFlags } from '../../shell/useLayout'
import { loginItem } from '../../ports/loginItem'
import { extensionBrowser } from '../../ports/deviceDownloads'
import { installedApp } from '../../ports/install'
import { macApp } from '../../ports/macApp'
import { useMenuCommands } from '../../ports/menuKeys'
import { BrowserImportsPanel } from './BrowserImportsPanel'
import { AccountCards } from './ConnectionPanel'
import { Confirmations } from './Confirmations'
import { DesktopPanel } from './DesktopPanel'
import { GetAppPanel } from './GetAppPanel'
import { ImportingPanel } from './ImportingPanel'
import { LibraryPanel } from './LibraryPanel'
import { StackedRows } from './SettingsParts'
import { SETTINGS_WIDTH } from './SettingsScreen'
import { ShortcutsPanel } from './ShortcutsPanel'
import { RememberedCard } from './SmartPanel'
import type { Confirming } from './settings.model'

/**
 * Settings' own pages (B, 2026-10-26), each reached by a row on Settings and
 * going back to it: the same column, the same cards.
 */
function SettingsPage({ title, children }: { title: string; children: ReactNode }): ReactNode {
  const { wide } = useLayoutFlags()
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, pageFrame(wide)]}>
        <StackedRows value={!wide}>
          <View style={styles.column}>
            <PageHeader title={title} back={{ to: '/settings', testID: 'settings-page-back' }} />
            {children}
          </View>
        </StackedRows>
        <ChromeSpacer />
      </ScrollView>
    </SafeAreaView>
  )
}

/** Settings › Account: the storage, the computers, and leaving the storage. */
export function AccountScreen(): ReactNode {
  const [confirming, setConfirming] = useState<Confirming>(null)
  return (
    <>
      <SettingsPage title="Account">
        <AccountCards onConfirm={setConfirming} />
      </SettingsPage>
      <Confirmations confirming={confirming} onDone={() => setConfirming(null)} />
    </>
  )
}

/**
 * Settings › Advanced: what is about running the server or the Mac app
 * rather than about using self.mp3 (O1) — the library's folder, how it
 * imports, the desktop app's own, and the keys where there are keys to press.
 */
export function AdvancedScreen(): ReactNode {
  const shortcuts = useMenuCommands()
  return (
    <SettingsPage title="Advanced">
      <LibraryPanel />
      <ImportingPanel />
      {/* This tab's own downloading (docs/features/client-download.md): only where the extension runs. */}
      {!installedApp && extensionBrowser ? <BrowserImportsPanel /> : null}
      {loginItem.available ? <DesktopPanel /> : null}
      {macApp.offered ? <GetAppPanel /> : null}
      {shortcuts ? <ShortcutsPanel items={shortcuts} /> : null}
    </SettingsPage>
  )
}

/** Settings › What Ask remembers. */
export function RememberedScreen(): ReactNode {
  return (
    <SettingsPage title="What Ask remembers">
      <RememberedCard />
    </SettingsPage>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  column: { width: '100%', maxWidth: SETTINGS_WIDTH, gap: space.xl },
}))
