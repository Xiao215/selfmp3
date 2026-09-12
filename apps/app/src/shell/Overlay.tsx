import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'

/**
 * One place, at the root of the app, where sheets and popovers are drawn.
 *
 * Sheets used to be `Modal`s, one per sheet. A `Modal` on iOS is its own
 * `UIWindow`, and presenting a second one after a first has been dismissed
 * takes the app's entire view tree out of the accessibility hierarchy: the
 * list, the tab bar and the mini player stay on screen and become invisible to
 * VoiceOver and to anything driving the app. The sort sheet followed by a
 * song's menu is exactly that sequence, which is how the smoke flow found it —
 * the menu was plainly on screen and could not be seen at all.
 *
 * So there are no windows now. An overlay is an absolutely positioned view at
 * the top of the shell, above the tab bar and the mini player because it is
 * the shell's last child rather than because it is a different window. One
 * tree, which VoiceOver and Maestro can both read, and which is also what the
 * web needs — `docs/UNIVERSAL.md` calls for "a root-level host on web", and
 * this is that host on every platform.
 *
 * `pointerEvents="box-none"` on the host so an empty overlay is not a sheet of
 * glass over the app.
 */

interface OverlayApi {
  set: (id: string, node: ReactNode) => void
  remove: (id: string) => void
}

const OverlayContext = createContext<OverlayApi | null>(null)

export function OverlayProvider({ children }: { children: ReactNode }): ReactNode {
  const [nodes, setNodes] = useState<readonly { id: string; node: ReactNode }[]>([])

  const set = useCallback((id: string, node: ReactNode) => {
    setNodes(current => {
      const next = current.filter(entry => entry.id !== id)
      next.push({ id, node })
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setNodes(current =>
      current.some(entry => entry.id === id) ? current.filter(entry => entry.id !== id) : current,
    )
  }, [])

  const api = useMemo<OverlayApi>(() => ({ set, remove }), [set, remove])

  return (
    <OverlayContext.Provider value={api}>
      {/* A container of its own, so "absolutely positioned" has something
          definite to be positioned against: the whole app, tab bar included. */}
      <View style={styles.root}>
        {children}
        <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
          {nodes.map(entry => (
            <View key={entry.id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {entry.node}
            </View>
          ))}
        </View>
      </View>
    </OverlayContext.Provider>
  )
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
})

/**
 * Draw something at the root, from wherever in the tree this is called.
 *
 * Keyed by a stable id, so a re-render replaces the node rather than removing
 * and re-adding it — an animation part-way through survives.
 */
export function useOverlay(node: ReactNode, active: boolean): void {
  const api = useContext(OverlayContext)
  const id = useId()

  // Deliberately without a dependency array: the node is a fresh element on
  // every render, and the point is to keep the host showing the current one.
  // Replacing the entry under the same key updates that subtree rather than
  // remounting it.
  useEffect(() => {
    if (!api) return
    if (active) api.set(id, node)
    else api.remove(id)
  })

  useEffect(() => () => api?.remove(id), [api, id])
}
