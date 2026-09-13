import { Appearance } from 'react-native'
import { applyColorScheme, type ColorScheme } from '@selfmp3/client'

import { readHue, readTheme, resolveScheme } from './appearancePrefs'

/**
 * The theme, applied before anything draws.
 *
 * Every stylesheet copies its colours when it is created, so the palette has
 * to be filled first: this module is the first thing the entry file imports.
 * The scheme it chose is kept, so Settings can tell whether a new choice needs
 * the app to start again.
 */
export const launchScheme: ColorScheme = resolveScheme(readTheme(), Appearance.getColorScheme())

applyColorScheme(launchScheme, readHue())
