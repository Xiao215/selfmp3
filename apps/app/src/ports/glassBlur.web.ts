/**
 * A browser blurs what scrolls under the glass itself, with `backdrop-filter`,
 * which react-native-web passes through to the element's style.
 */
export const glassBlur = {
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
} as const
