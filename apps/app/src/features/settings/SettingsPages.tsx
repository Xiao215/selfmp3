import { useState } from 'react'
import type { ReactNode } from 'react'
import { loginItem } from '../../ports/loginItem'
import { macApp } from '../../ports/macApp'
import { useMenuCommands } from '../../ports/menuKeys'
import { AccountCards } from './ConnectionPanel'
import { Confirmations } from './Confirmations'
import { DesktopPanel } from './DesktopPanel'
import { GetAppPanel } from './GetAppPanel'
import { ImportingPanel } from './ImportingPanel'
import { LibraryPanel } from './LibraryPanel'
import { SettingsPage } from './SettingsParts'
import { ShortcutsPanel } from './ShortcutsPanel'
import { RememberedCard } from './SmartPanel'
import type { Confirming } from './settings.model'

/**
 * Settings' own pages (B, 2026-10-26), each reached by a row on Settings and
 * going back to it.
 */
const BACK = { to: '/settings', testID: 'settings-page-back' } as const

/** Settings › Account: the storage, the computers, and leaving the storage. */
export function AccountScreen(): ReactNode {
  const [confirming, setConfirming] = useState<Confirming>(null)
  return (
    <>
      <SettingsPage title="Account" back={BACK}>
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
    <SettingsPage title="Advanced" back={BACK}>
      <LibraryPanel />
      <ImportingPanel />
      {loginItem.available ? <DesktopPanel /> : null}
      {macApp.offered ? <GetAppPanel /> : null}
      {shortcuts ? <ShortcutsPanel items={shortcuts} /> : null}
    </SettingsPage>
  )
}

/** Settings › What Ask remembers. */
export function RememberedScreen(): ReactNode {
  return (
    <SettingsPage title="What Ask remembers" back={BACK}>
      <RememberedCard />
    </SettingsPage>
  )
}
