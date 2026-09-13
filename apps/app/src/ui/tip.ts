/**
 * A hover caption, in a browser: `data-tip`, which the shell's `TooltipHost`
 * shows after a short rest of the pointer, at once on keyboard focus, and
 * never on a touch. React Native for web turns `dataSet` into `data-*`
 * attributes, and a phone ignores it.
 *
 * Spread onto the element that should carry it: `<Pressable {...tip('Next')} />`.
 */
export function tip(text: string | null | undefined): { dataSet?: { tip: string } } {
  return text ? { dataSet: { tip: text } } : {}
}
