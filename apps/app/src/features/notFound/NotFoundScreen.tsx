import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { usePathname, useRouter, type Href } from 'expo-router'
import { radius, space } from '@selfmp3/client'
import { shownAddress } from '../../ports/pageAddress'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { ChevronLeft } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { pageTitle } from '../../ui/surfaces'

/**
 * The waveform's bars, left to right: a height each, and 0 for the one that
 * is not there. One of the tall ones is drawn in the accent.
 */
const BARS = [14, 24, 32, 20, 0, 18, 28, 12] as const
const ACCENT_BAR = 2

/** Where else to go, quietly, under the buttons. */
const PLACES: readonly { href: Href; label: string }[] = [
  { href: '/playlists', label: 'Playlists' },
  { href: '/import', label: 'Import' },
  { href: '/stats', label: 'Stats' },
  { href: '/settings', label: 'Settings' },
]

/**
 * An address no page answers, drawn inside the app rather than as Expo's
 * "Unmatched Route" — which is what the installed app showed for
 * `app://selfmp3/nope`, with no way back but quitting.
 *
 * The shell stays around it (the sidebar and player bar on a computer, the
 * tabs on a phone), so the way out is everywhere it usually is. The one
 * picture is a waveform with a bar missing: something should be here and
 * isn't. It names the address it was given, so a mistyped or broken link
 * shows as one, and offers the library first.
 *
 * A phone keeps it to the heading and one button: it has the tab bar for
 * everything else, and links arrive there from notes and messages, where the
 * address is not worth reading back.
 */
export function NotFoundScreen(): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const pathname = usePathname()
  const { wide } = useLayout()
  const canGoBack = router.canGoBack()

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.body} testID="not-found">
        <View
          style={styles.wave}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {BARS.map((height, index) => (
            <View
              key={index}
              style={[
                styles.bar,
                height === 0
                  ? styles.barMissing
                  : {
                      height,
                      backgroundColor: index === ACCENT_BAR ? accent.accent : theme.colors.surface3,
                    },
              ]}
            />
          ))}
        </View>

        <Text style={styles.title} accessibilityRole="header">
          Nothing plays at this address
        </Text>
        <Text style={styles.line}>
          {wide ? (
            <>
              <Text style={styles.address}>{shownAddress(pathname)}</Text> isn’t a page in self.mp3.
              It may be an old link.
            </>
          ) : (
            'It may be an old link.'
          )}
        </Text>

        <View style={styles.buttons}>
          <Button
            label="Go to your library"
            onPress={() => router.replace('/')}
            testID="not-found-library"
          />
          {wide && canGoBack ? (
            <Button
              label="Back"
              icon={<ChevronLeft size={15} color={theme.colors.textPrimary} />}
              onPress={() => router.back()}
            />
          ) : null}
        </View>

        {wide ? (
          <View style={styles.places}>
            {PLACES.map(place => (
              <Pressable
                key={place.label}
                onPress={() => router.replace(place.href)}
                accessibilityRole="link"
                style={({ pressed }) => [styles.place, pressed && styles.placePressed]}
              >
                <Text style={styles.placeText}>{place.label}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  wave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 40,
    marginBottom: space.sm,
  },
  bar: { width: 6, borderRadius: 3 },
  /* Not a bar at all: a flat stroke where one should be, with room either side. */
  barMissing: {
    height: 2,
    width: 6,
    marginHorizontal: 8,
    borderRadius: 1,
    backgroundColor: theme.colors.surface3,
  },
  title: { ...pageTitle(theme.colors), textAlign: 'center' },
  line: {
    color: theme.colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 460,
  },
  address: { color: theme.colors.textSecondary, fontWeight: '600' },
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.sm,
  },
  places: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 4,
    marginTop: space.xs,
  },
  place: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: radius.pill },
  placePressed: { backgroundColor: theme.colors.surface2 },
  placeText: { color: theme.colors.textMuted, fontSize: 13 },
}))
