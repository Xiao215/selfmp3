import { SafeAreaView as PlainSafeAreaView } from 'react-native-safe-area-context'
import { withUnistyles } from 'react-native-unistyles'

/**
 * The safe-area view every screen sits in, restyled when the theme changes.
 *
 * Unistyles updates the views its Babel plugin knows, which are React Native's
 * own. This one comes from react-native-safe-area-context, so without the
 * wrapper a screen's background keeps the old theme's colour until the screen
 * happens to render again: a light page on a dark ground, under a status bar
 * whose text has already turned dark.
 */
export const SafeAreaView = withUnistyles(PlainSafeAreaView)
