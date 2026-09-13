/**
 * In a browser the safe-area view is used as it comes.
 *
 * Unistyles already recolours it there: on the web a themed stylesheet is CSS
 * variables, which follow a theme change on any element. And the phone's
 * wrapper would do harm here. `withUnistyles` styles its component's child
 * (`.hash > *`), and Unistyles names a style by its content, so a screen's
 * `{ flex: 1, backgroundColor: surface0 }` shares its class with the shell's
 * root, whose children, the bottom tabs among them, would all stretch to fill.
 */
export { SafeAreaView } from 'react-native-safe-area-context'
