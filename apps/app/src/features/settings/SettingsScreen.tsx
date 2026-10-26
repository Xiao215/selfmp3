import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { space, useHealth } from '@selfmp3/client'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { installedApp } from '../../ports/install'
import { loginItem } from '../../ports/loginItem'
import { macApp } from '../../ports/macApp'
import { bucketCapped } from '../library/library.model'
import { useBucketHold } from '../profile/useBucketHold'
import { useLayoutFlags } from '../../shell/useLayout'
import { PageHeader } from '../../ui/components/PageHeader'
import { Segmented } from '../../ui/components/Segmented'
import { engineCapabilities } from '../../ports/engine'
import { setCrossfadeSeconds, useCrossfadeSeconds } from '../../player/crossfadePref'
import { pageFrame } from '../../ui/surfaces'
import { useConnection } from '../../connection/ConnectionProvider'
import { ScrollView } from '../../ui/components/Scroll'
import { thisPlace } from '../../ports/place'
import { AboutCard } from './AboutCard'
import { AccentCard, ThemeTile } from './AppearancePanel'
import { Confirmations } from './Confirmations'
import { AccountRow } from './ConnectionPanel'
import { DevicesPanel } from './DevicesPanel'
import { DownloadTiles, OfflinePanel, RemoveAllFromDevice } from './OfflinePanel'
import { Card, DangerButton, LinkRow, Row, StackedRows, TileGrid } from './SettingsParts'
import { SmartTile, useAskNotesCount } from './SmartPanel'
import {
  ADVANCED_ROUTE,
  CROSSFADE_STEPS,
  crossfadeLabel,
  healthLine,
  nearestStep,
  onThisDevice,
  REMEMBERED_ROUTE,
  type Confirming,
} from './settings.model'

/** How wide Settings' column grows on a computer: a phone's page, with room to breathe. */
export const SETTINGS_WIDTH = 640

/**
 * Settings (redesign B, 2026-10-26).
 *
 * Which self.mp3 this is first, as a card of its own (About), then whose
 * library it is in one row that opens the Account page. Under them the quick
 * tiles: what is turned more than anything else — the theme, smart features,
 * and on a device that keeps songs, downloading on Wi-Fi and streaming the
 * rest — each a press on the tile itself. Then the accent, crossfade where the
 * engine can fade, what this device keeps, the devices, and two rows into
 * pages of their own: what Ask remembers, and Advanced (the library's folder
 * and how it imports, the desktop app). What cannot be undone — signing out,
 * removing every song from this device — is at the foot, in red.
 *
 * One column, a phone's width even on a computer: there is too little here for
 * an index, which the page carried while it was three screens long.
 */
export function SettingsScreen(): ReactNode {
  const { wide } = useLayoutFlags()
  const { fromCloud } = useConnection()
  const router = useRouter()
  const health = useHealth()
  // The bucket refusing for the day, which the health cannot see: in the cloud
  // it is the doorman's, and the doorman answers while the bucket will not.
  const capped = useBucketHold() !== null || bucketCapped(health.error)
  // Under the title only when something needs you (E1).
  const healthNote = healthLine(health.data, {
    loading: health.isPending,
    error: health.isError ? health.error : null,
    capped,
    compact: !wide,
  })
  const notes = useAskNotesCount()
  const [confirming, setConfirming] = useState<Confirming>(null)
  const place = thisPlace()
  const advancedLine = [
    'Library folder',
    'importing',
    ...(loginItem.available ? ['desktop app'] : []),
    ...(macApp.offered ? ['Mac app'] : []),
  ].join(', ')

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.content, pageFrame(wide)]}>
        <StackedRows value={!wide}>
          <View style={styles.column}>
            <PageHeader
              title="Settings"
              back={{ to: '/profile', testID: 'settings-back' }}
              subtitle={
                healthNote === null ? undefined : (
                  <Text style={capped ? styles.subCapped : undefined}>
                    {capped ? '● ' : null}
                    {healthNote}
                  </Text>
                )
              }
              subtitleTestID="settings-health"
            />

            <AboutCard />
            <AccountRow />

            <TileGrid wide={wide}>
              <ThemeTile />
              <SmartTile />
              {/* A browser streams and keeps nothing: only an installed app has songs on it. */}
              {installedApp ? <DownloadTiles /> : null}
            </TileGrid>

            <AccentCard />

            {/*
              Crossfade, this device's own (`crossfadePref.ts`), where its
              engine can fade one song into the next — a browser and the
              installed app can. A phone plays gapless and cannot fade, and
              steps that do nothing there are worse than none.
            */}
            {engineCapabilities.crossfade ? <CrossfadeCard /> : null}

            {installedApp ? <OfflinePanel title={onThisDevice(place)} /> : null}

            <DevicesPanel />

            <Card flush>
              {notes !== null && notes > 0 ? (
                <LinkRow
                  label="What Ask remembers"
                  value={String(notes)}
                  onPress={() => router.push(REMEMBERED_ROUTE)}
                  testID="settings-remembered"
                />
              ) : null}
              <LinkRow
                label="Advanced"
                hint={advancedLine}
                onPress={() => router.push(ADVANCED_ROUTE)}
                testID="settings-advanced"
              />
            </Card>

            <View style={styles.foot}>
              {fromCloud ? (
                <DangerButton
                  label="Sign out"
                  outlined
                  onPress={() => setConfirming('sign-out')}
                  testID="cloud-sign-out"
                />
              ) : null}
              {installedApp ? <RemoveAllFromDevice onConfirm={setConfirming} /> : null}
            </View>
          </View>
        </StackedRows>
        <ChromeSpacer />
      </ScrollView>

      <Confirmations confirming={confirming} onDone={() => setConfirming(null)} />
    </SafeAreaView>
  )
}

/** Crossfade as a few steps (C4a): a length is chosen, not dragged to. */
function CrossfadeCard(): ReactNode {
  const seconds = useCrossfadeSeconds()
  return (
    <Card title="Playback">
      <Row label="Crossfade" stack last>
        <Segmented
          value={String(nearestStep(seconds))}
          options={CROSSFADE_STEPS.map(step => ({
            value: String(step),
            label: crossfadeLabel(step),
          }))}
          onChange={value => setCrossfadeSeconds(Number(value))}
          label="Crossfade"
        />
      </Row>
    </Card>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  column: { width: '100%', maxWidth: SETTINGS_WIDTH, gap: space.xl },
  subCapped: { color: theme.colors.danger },
  foot: { gap: space.sm, paddingTop: space.sm },
}))
