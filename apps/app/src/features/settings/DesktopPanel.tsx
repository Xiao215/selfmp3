import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Linking, View } from 'react-native'
import { loginItem } from '../../ports/loginItem'
import { updates, type UpdateState } from '../../ports/updates'
import { Button } from '../../ui/components/Button'
import { Toggle } from '../../ui/components/Toggle'
import { Panel, Row } from './SettingsParts'

/**
 * The things only an installed desktop app has. Drawn nowhere else, because
 * `loginItem.available` is false anywhere else — a tab cannot open at login.
 *
 * The toggle shows what the operating system currently has rather than what was
 * last asked for, so turning it off in System Settings › General › Login Items
 * is reflected here the next time Settings is opened.
 */
export function DesktopPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const [open, setOpen] = useState<boolean | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [looking, setLooking] = useState(false)

  useEffect(() => {
    let alive = true
    void loginItem.get().then(value => {
      if (alive) setOpen(value)
    })
    return () => {
      alive = false
    }
  }, [])

  // The menu's "Check for Updates…" is the same call, so a check started there
  // shows here without Settings asking again.
  useEffect(() => updates.on(setUpdate), [])

  const look = (): void => {
    setLooking(true)
    void updates
      .check()
      .then(setUpdate)
      .finally(() => setLooking(false))
  }

  return (
    <Panel
      title="Desktop app"
      hint={updates.version === null ? 'on this computer' : `version ${updates.version}`}
      anchor={anchor}
    >
      <Row
        label="Open at login"
        hint="Starts self.mp3 when you log in to this computer. macOS keeps this in System Settings › General › Login Items, and turning it off there turns it off here."
      >
        <Toggle
          value={open ?? false}
          label="Open at login"
          onChange={next => {
            setOpen(next)
            // What the OS ends up with, not what was asked: it can refuse.
            void loginItem.set(next).then(setOpen)
          }}
          testID="setting-login-item"
        />
      </Row>
      <Row label="Updates" hint={updateHint(update, looking)} last>
        {update?.state === 'ready' && update.canInstall ? (
          <Button
            label="Restart to update"
            onPress={() => void updates.install()}
            testID="update-install"
          />
        ) : update?.state === 'available' && update.releaseUrl ? (
          <Button
            label="Open release page"
            onPress={() => void Linking.openURL(update.releaseUrl ?? '')}
            testID="update-open"
          />
        ) : (
          <Button
            label={looking ? 'Checking…' : 'Check for updates'}
            onPress={look}
            disabled={looking}
            testID="update-check"
          />
        )}
      </Row>
    </Panel>
  )
}

/** One line saying where the update check has got to, in plain words. */
function updateHint(update: UpdateState | null, looking: boolean): string {
  if (looking || update?.state === 'checking') return 'Looking…'
  switch (update?.state) {
    case 'none':
      return 'This is the latest version.'
    case 'available':
      return update.canInstall
        ? `Version ${update.version ?? ''} is available.`
        : `Version ${update.version ?? ''} is available. This copy was not signed, so it cannot replace itself — download it from the release page.`
    case 'downloading':
      return `Downloading version ${update.version ?? ''}…`
    case 'ready':
      return `Version ${update.version ?? ''} is ready. It will be in place the next time self.mp3 starts.`
    case 'error':
      return `Could not check: ${update.message ?? 'no answer from GitHub'}.`
    default:
      return 'self.mp3 does not check by itself.'
  }
}
