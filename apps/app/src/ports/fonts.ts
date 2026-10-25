import { Platform } from 'react-native'
import { fonts as families } from '@selfmp3/client'

/**
 * The design's two faces, by the name this platform finds them under.
 *
 * A browser and Android know them by the names `expo-font` gives them (the
 * file's name, `fonts` in packages/client). iOS has them embedded by the
 * `expo-font` config plugin and knows them by their PostScript names. It
 * draws the alias too, but sizes the text in the system font first, which is
 * narrower: "Your tags" came out six points short of its own words and drew
 * as "Your ta…" (2026-10-24).
 */
export const fonts: { readonly [face in keyof typeof families]: string } =
  Platform.OS === 'ios'
    ? {
        serif: 'InstrumentSerif-Regular',
        serifItalic: 'InstrumentSerif-Italic',
        display: 'BricolageGrotesque-SemiBold',
      }
    : families
