/**
 * Spike harness for check 3: native tabs on the phone and `expo-router/ui` tabs
 * on the desktop share one set of route files.
 *
 * This is the check the whole shell rests on. docs/UNIVERSAL.md's target is a
 * sidebar above 820 and a tab bar below it, decided by width and not by
 * platform — which is only cheap if both are driven by the same routes. The
 * headless `Tabs` from `expo-router/ui` owns the navigation state, and the
 * chrome around it is ours to draw twice.
 *
 * Two things phase 2 needs to know, both learned the hard way here:
 *
 * 1. `TabList` and `TabTrigger` must be *direct, unwrapped* children of `Tabs`.
 *    The navigator reads its screens out of the element tree by component
 *    identity, so wrapping the list in a component of your own — the obvious
 *    way to render one shape or the other — fails at runtime with "Couldn't
 *    find any screens for the navigator".
 * 2. That rules out `withUnistyles()` on them too, for the same reason: the HOC
 *    changes the element type and the walk stops finding triggers. And a raw
 *    Unistyles style object handed to a third-party component arrives
 *    unresolved, so breakpoint variants quietly fall back to their base values.
 *
 * So the shell reads the breakpoint itself and passes plain styles. That is not
 * a workaround: foundation 5 names `src/shell` as the one place allowed to read
 * width. Everything below it still gets variants.
 *
 * The iOS half — `expo-router/unstable-native-tabs` giving a real UIKit tab bar
 * from these same files — needs a simulator and is .maestro/spike-tabs.yaml.
 */
import { Tabs, TabList, TabSlot, TabTrigger } from 'expo-router/ui'
import { Text } from 'react-native'
import { useUnistyles } from 'react-native-unistyles'

import '../../src/spike/unistyles'

export default function SpikeTabsLayout() {
  const { theme, rt } = useUnistyles()
  const desktop = rt.breakpoint === 'desktop'

  // Below 820 the list sits under the content; at and above it the row is
  // reversed, so the same second child becomes a sidebar on the left.
  const tabs = {
    flex: 1,
    backgroundColor: theme.colors.surface,
    flexDirection: (desktop ? 'row-reverse' : 'column') as 'row-reverse' | 'column',
  }

  const chrome = {
    backgroundColor: theme.colors.raised,
    flexDirection: (desktop ? 'column' : 'row') as 'column' | 'row',
    width: desktop ? 220 : ('100%' as const),
    paddingVertical: theme.gap(2),
  }

  const item = {
    paddingVertical: theme.gap(3),
    paddingHorizontal: theme.gap(4),
  }

  return (
    <Tabs style={tabs}>
      <TabSlot />
      <TabList style={chrome} testID="spike-chrome">
        <TabTrigger name="library" href="/spike-tabs" style={item}>
          <Text style={{ color: theme.colors.text }} testID="spike-trigger-library">
            Library
          </Text>
        </TabTrigger>
        <TabTrigger name="playlists" href="/spike-tabs/playlists" style={item}>
          <Text style={{ color: theme.colors.text }} testID="spike-trigger-playlists">
            Playlists
          </Text>
        </TabTrigger>
      </TabList>
    </Tabs>
  )
}
