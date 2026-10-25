/**
 * Whether a view hears a browser's keys and says its state the browser's way:
 * react-native-web hands a view `onKeyDown`, and reads `aria-*` props where it
 * ignores `accessibilityState`. A phone does neither; an iPad's keyboard
 * reaches the app through key commands instead (`keyRegistry`).
 */
export const browserKeys: boolean = false
