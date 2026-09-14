/**
 * Marks a box that is the visible field around a borderless text input — the
 * library's search: an icon, the input, a clear button, all in one bordered
 * row. In a browser the box takes the accent while the input has focus (see
 * `shell/FocusStyle.web.tsx`); a phone ignores it.
 *
 * Spread onto the box: `<View style={styles.searchBox} {...focusWithin()}>`.
 */
export function focusWithin(): { dataSet: { focusWithin: string } } {
  return { dataSet: { focusWithin: 'true' } }
}
