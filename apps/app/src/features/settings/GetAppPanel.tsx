import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Linking, View } from 'react-native'
import { useQuery } from '@tanstack/react-query'
import { MAC_CHIP_NAMES, MAC_CHIPS, RELEASES_URL, type MacChip } from '@selfmp3/shared'
import { macApp } from '../../ports/macApp'
import { Button } from '../../ui/components/Button'
import { Panel, Row } from './SettingsParts'
import { downloadHint } from './settings.model'

/**
 * The desktop app, offered from a browser tab on a Mac — the one place it is
 * drawn, because `macApp.offered` is false everywhere else.
 *
 * One button per chip, straight to that release's dmg. Where the browser can
 * say which Mac this is (Chromium can, Safari cannot) that chip's button leads
 * and is the commit pill; otherwise both are tonal and the hint says how to
 * tell. With no release to offer, or no answer from GitHub, the one button is
 * the releases page, which always exists.
 */
export function GetAppPanel({ anchor }: { anchor: (node: View | null) => void }): ReactNode {
  const release = useQuery({
    queryKey: ['github', 'latest-release'],
    queryFn: () => macApp.latest(),
    retry: false,
    staleTime: 60 * 60_000,
  })
  const [chip, setChip] = useState<MacChip | null>(null)

  useEffect(() => {
    let alive = true
    void macApp.chip().then(found => {
      if (alive) setChip(found)
    })
    return () => {
      alive = false
    }
  }, [])

  const installers = release.data ?? null
  // This Mac's chip first, so the leading button is the one to press.
  const chips = chip ? [chip, ...MAC_CHIPS.filter(other => other !== chip)] : MAC_CHIPS
  const offers = installers ? chips.filter(one => installers.dmg[one] !== null) : []

  return (
    <Panel title="Mac app" hint="for this computer" anchor={anchor}>
      <Row
        label="self.mp3 for Mac"
        hint={downloadHint({
          loading: release.isPending,
          error: release.isError,
          version: installers?.version ?? null,
          offers: offers.length,
          chip,
        })}
        last
      >
        {offers.length > 0 ? (
          offers.map(one => (
            <Button
              key={one}
              label={`Download for ${MAC_CHIP_NAMES[one]}`}
              variant={one === chip ? 'primary' : 'secondary'}
              onPress={() => void Linking.openURL(installers?.dmg[one] ?? RELEASES_URL)}
              testID={`get-app-${one}`}
            />
          ))
        ) : (
          <Button
            label="Open releases page"
            onPress={() => void Linking.openURL(installers?.page ?? RELEASES_URL)}
            disabled={release.isPending}
            testID="get-app-releases"
          />
        )}
      </Row>
    </Panel>
  )
}
