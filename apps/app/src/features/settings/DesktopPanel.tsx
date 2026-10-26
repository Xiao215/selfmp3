import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { loginItem } from '../../ports/loginItem'
import { Toggle } from '../../ui/components/Toggle'
import { Card, Row } from './SettingsParts'

/**
 * The thing only an installed desktop app has: opening at login. Drawn
 * nowhere else, because `loginItem.available` is false anywhere else — a tab
 * cannot open at login. Its updates are on the About card.
 *
 * The toggle shows what the operating system currently has rather than what was
 * last asked for, so turning it off in System Settings › General › Login Items
 * is reflected here the next time Settings is opened.
 */
export function DesktopPanel(): ReactNode {
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    let alive = true
    void loginItem.get().then(value => {
      if (alive) setOpen(value)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <Card title="Desktop app">
      <Row label="Open at login" hint="Starts self.mp3 when you log in." last>
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
    </Card>
  )
}
