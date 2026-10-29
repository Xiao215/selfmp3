/**
 * The layers drawn over the page — sheets, popovers, dialogs, the palette —
 * that are open now, oldest first, so the last one is on top. `useEscape`
 * keeps it: a layer joins as it opens and leaves as it closes.
 *
 * Kept apart from the hook so that what stands aside for an open layer can
 * ask: a list's ⌘A must not select the songs under an open menu.
 */
const open: { readonly id: string; readonly close: () => void }[] = []
const listeners = new Set<() => void>()

/** `close` is what Escape would do: how `closeLayers` takes it away. */
export function openLayer(id: string, close: () => void = () => {}): void {
  open.push({ id, close })
  for (const listener of listeners) listener()
}

export function closeLayer(id: string): void {
  for (let index = open.length - 1; index >= 0; index--) {
    if (open[index]?.id !== id) continue
    open.splice(index, 1)
    for (const listener of listeners) listener()
    return
  }
}

/** Told whenever a layer opens or closes: a first-run tip waits for them (`guideBusy`). */
export function subscribeLayers(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** How many layers are open now. */
export function layerCount(): number {
  return open.length
}

/** Whether `id` is the topmost open layer. */
export function onTop(id: string): boolean {
  return open[open.length - 1]?.id === id
}

/**
 * Close every open layer, topmost first, as Escape pressed until none is left.
 *
 * For whatever takes the person to another page from outside the page — a menu
 * bar command, a `selfmp3://` link — so a song's menu or the palette does not
 * stay open, and still working, over a page it has nothing to do with.
 */
export function closeLayers(): void {
  for (const layer of [...open].reverse()) layer.close()
}

/** Whether anything is drawn over the page. */
export function layerOpen(): boolean {
  return open.length > 0
}
