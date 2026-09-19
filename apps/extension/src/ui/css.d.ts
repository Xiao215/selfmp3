/**
 * A stylesheet imported by a script arrives as its text. Only the content
 * script does it — the generated tokens, for the pill's shadow root — and
 * scripts/build.mjs loads `.css` as text in that one build.
 */
declare module '*.css' {
  const text: string
  export default text
}
