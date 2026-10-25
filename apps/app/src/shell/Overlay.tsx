import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { createValueStore } from '../state/valueStore.model'
import { useValueStore } from '../state/useValueStore'

/**
 * One place, at the root of the app, where sheets and popovers are drawn.
 *
 * **Not `Modal`s.** A `Modal` on iOS is its own `UIWindow`, and presenting a
 * second one after a first has been dismissed takes the app's entire view tree
 * out of the accessibility hierarchy: the list, the tab bar and the mini
 * player stay on screen and become invisible to VoiceOver and to anything
 * driving the app. The sort sheet followed by a song's menu is exactly that
 * sequence.
 *
 * So an overlay is an absolutely positioned view at the top of the shell,
 * above the tab bar and the mini player because it is the shell's last child
 * rather than because it is a different window. One tree, which VoiceOver and
 * Maestro can both read, and which is also the "root-level host on web"
 * `docs/ARCHITECTURE.md` calls for.
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

  // An entry keeps its place: the host paints in the order overlays opened,
  // which is the order `useEscape` closes them in. Moving a re-rendered one
  // to the end would put whichever owner rendered last on top, so a popover
  // under a sheet would come over it the moment its screen re-rendered.
  const set = useCallback((id: string, node: ReactNode) => {
    setNodes(current => {
      const index = current.findIndex(entry => entry.id === id)
      if (index === -1) return [...current, { id, node }]
      if (current[index]?.node === node) return current
      const next = [...current]
      next[index] = { id, node }
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
        <PressHold />
      </View>
    </OverlayContext.Provider>
  )
}

/** Whether presses are held, after an answer that takes its own buttons away (`holdPresses`). */
const held = createValueStore(false)
let release: ReturnType<typeof setTimeout> | undefined

/**
 * Takes the next presses for `ms`, anywhere: for an answer that takes away
 * the very thing pressed. Delete playlist in its dialog closed the dialog and
 * left the page in the same press, and the second press of a double tap
 * landed on whatever the next page had there — a playlist's tile opened, or
 * the deleted playlist's own page. A dialog fading out keeps its own buttons;
 * a page gone takes them with it, so this sits at the root, past every page.
 */
export function holdPresses(ms: number = PRESS_HOLD_MS): void {
  clearTimeout(release)
  held.set(true)
  release = setTimeout(() => held.set(false), ms)
}

/** A slow double tap's length. */
const PRESS_HOLD_MS = 400

/** A clear pane over everything while presses are held: it takes them, and nothing answers. */
function PressHold(): ReactNode {
  return useValueStore(held) ? <View style={StyleSheet.absoluteFill} testID="press-hold" /> : null
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
  //
  // A layout effect, so the host has caught up before the event that caused
  // this render is done. After a keystroke, React puts a text box back to the
  // value it last drew; with a passive effect the host would not have drawn
  // the new one yet, so every key would write the old text into the box and
  // then the new. Each write cancels an input method's composition, and
  // pinyin typed into the Search box would come out as "nninihnihanihao你好".
  useLayoutEffect(() => {
    if (!api) return
    if (active) api.set(id, node)
    else api.remove(id)
  })

  useEffect(() => () => api?.remove(id), [api, id])
}
