import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
import Constants from 'expo-constants'
import { StyleSheet } from 'react-native-unistyles'
import { iconSize, radius, space, textStyle, type } from '@selfmp3/client'
import { updates, type UpdateState } from '../../ports/updates'
import { BrandMark } from '../../ui/components/BrandMark'
import { Button } from '../../ui/components/Button'
import { Check } from '../../ui/components/Icons'
import { card } from '../../ui/surfaces'
import { showFailure } from '../../ui/toast'
import { useIosUpdateStatus, versionLabel } from './IosUpdate'

/** Where an update check has got to, as the About card says it. */
export interface UpdateStatus {
  readonly tone: 'good' | 'ready' | 'quiet' | 'error'
  readonly line: string
  readonly action?: {
    readonly label: string
    readonly onPress: () => void
    readonly primary?: boolean
    readonly busy?: boolean
    readonly testID?: string
  }
}

/**
 * Settings' first card (B, 2026-10-26): which self.mp3 this is, and whether a
 * newer one is waiting. The app's mark, its name and version, and — where
 * this copy can be replaced, the desktop app and an iPhone's shared build —
 * one line on the update check with the one thing to do about it. A browser
 * tab is whatever the server last sent, so it has the version alone.
 */
export function AboutCard(): ReactNode {
  const ios = useIosUpdateStatus()
  const desktop = useDesktopUpdateStatus()
  const status = ios ?? desktop
  return (
    <View style={styles.card} testID="settings-about">
      <View style={styles.mark}>
        <BrandMark size={40} tone="onAccent" />
      </View>
      <Text style={styles.name} accessibilityRole="header" aria-level={2}>
        self.mp3
      </Text>
      <Text style={styles.version}>
        {`Version ${versionLabel(String(Constants.expoConfig?.version ?? '1.0.0'))}`}
      </Text>
      {status ? (
        <View style={styles.status}>
          <View
            style={[
              styles.chip,
              status.tone === 'good' && styles.chipGood,
              status.tone === 'ready' && styles.chipReady,
              status.tone === 'error' && styles.chipError,
            ]}
          >
            {status.tone === 'good' ? <Check size={iconSize.small} tone="good" /> : null}
            <Text
              style={[
                styles.chipText,
                status.tone === 'good' && styles.chipTextGood,
                status.tone === 'ready' && styles.chipTextReady,
                status.tone === 'error' && styles.chipTextError,
              ]}
            >
              {status.line}
            </Text>
          </View>
          {status.action ? (
            <Button
              label={status.action.label}
              size="small"
              variant={status.action.primary ? 'primary' : 'secondary'}
              busy={status.action.busy}
              onPress={status.action.onPress}
              testID={status.action.testID}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

/**
 * The desktop app's check, as its menu's "Check for Updates…" runs it too: a
 * check started there shows here without Settings asking again. Null where
 * this copy cannot be replaced (`updates.available`).
 */
function useDesktopUpdateStatus(): UpdateStatus | null {
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [looking, setLooking] = useState(false)
  useEffect(() => updates.on(setUpdate), [])
  if (!updates.available) return null

  const check = {
    label: looking ? 'Checking…' : update ? 'Check again' : 'Check',
    busy: looking,
    testID: 'update-check',
    onPress: () => {
      setLooking(true)
      void updates
        .check()
        .then(setUpdate)
        .catch((caught: unknown) => showFailure('Couldn’t check for updates', caught))
        .finally(() => setLooking(false))
    },
  }
  if (looking || update?.state === 'checking') {
    return { tone: 'quiet', line: 'Looking…', action: check }
  }
  switch (update?.state) {
    case 'none':
      return { tone: 'good', line: 'Up to date', action: check }
    case 'available':
      return update.canInstall
        ? { tone: 'ready', line: `Downloading ${update.version ?? 'an update'}` }
        : {
            tone: 'ready',
            line: `${update.version ?? 'A new version'} is out`,
            action: {
              label: 'Release page',
              onPress: () => void Linking.openURL(update.releaseUrl ?? ''),
              testID: 'update-open',
            },
          }
    case 'downloading':
      return { tone: 'ready', line: `Downloading ${update.version ?? 'an update'}` }
    case 'ready':
      return {
        tone: 'ready',
        line: `${update.version ?? 'An update'} is ready`,
        action: {
          label: 'Restart',
          primary: true,
          onPress: () => void updates.install(),
          testID: 'update-install',
        },
      }
    case 'error':
      return { tone: 'error', line: 'Couldn’t check', action: check }
    default:
      return { tone: 'quiet', line: 'Not checked yet', action: check }
  }
}

const styles = StyleSheet.create(theme => ({
  card: {
    ...card(theme.colors, radius.cardLg),
    alignItems: 'center',
    gap: space.xs,
    paddingTop: space.xl,
    paddingBottom: space.lg,
    paddingHorizontal: space.lg,
  },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.sm,
  },
  name: { color: theme.colors.textPrimary, fontSize: type.large, fontWeight: '800' },
  version: { color: theme.colors.textMuted, ...textStyle('sub') },
  status: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    gap: space.sm,
    marginTop: space.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.tight,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
  },
  chipGood: { backgroundColor: theme.colors.goodWash },
  chipReady: { backgroundColor: theme.colors.accentPill },
  chipError: { backgroundColor: theme.colors.dangerWash },
  chipText: { color: theme.colors.textSecondary, fontSize: type.sub, fontWeight: '600' },
  chipTextGood: { color: theme.colors.good },
  chipTextReady: { color: theme.colors.accent },
  chipTextError: { color: theme.colors.danger },
}))
