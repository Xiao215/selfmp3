/**
 * The layers drawn over the page — sheets, popovers, dialogs, the palette —
 * that are open now, oldest first, so the last one is on top. `useEscape`
 * keeps it: a layer joins as it opens and leaves as it closes.
 *
 * Kept apart from the hook so that what stands aside for an open layer can
 * ask: a list's ⌘A must not select the songs under an open menu.
 */
const open: string[] = []

export function openLayer(id: string): void {
  open.push(id)
}

export function closeLayer(id: string): void {
  const index = open.lastIndexOf(id)
  if (index !== -1) open.splice(index, 1)
}

/** Whether `id` is the topmost open layer. */
export function onTop(id: string): boolean {
  return open[open.length - 1] === id
}

/** Whether anything is drawn over the page. */
export function layerOpen(): boolean {
  return open.length > 0
}
