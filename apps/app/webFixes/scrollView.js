// react-native-web's ScrollView, with a ref that keeps up (metro.config.js
// resolves react-native-web's own `./exports/ScrollView` here).
//
// RNW's ScrollView is a class that hands its node to `forwardedRef` from one
// bound method, so the node is handed over once at mount and once at unmount.
// A different ref passed on a later render is never called. Unistyles passes a
// different one on every render (`createUnistylesElement`), and each one only
// knows the node it was itself given. At unmount the newest one, never given
// the node, has nothing to remove from Unistyles' registry. So the registry
// kept every unmounted ScrollView, and with it the page it was on: the node
// carries ScrollView's methods, the methods hold the component, and the
// component holds its tree. Home, Library and Stats each left one behind on
// every visit, a whole page apiece.
//
// Here the node goes to whichever ref is current, as it would for a plain
// host component: a new ref takes it over and the old one lets go.

import { createElement, forwardRef, useCallback, useLayoutEffect, useRef } from 'react'
import RNWScrollView from 'react-native-web/dist/exports/ScrollView'

/** Gives `ref` the node; what to call to take it back. */
function attach(ref, node) {
  if (typeof ref === 'function') {
    const cleanup = ref(node)
    return typeof cleanup === 'function' ? cleanup : () => ref(null)
  }
  if (ref) {
    ref.current = node
    return () => {
      ref.current = null
    }
  }
  return () => {}
}

const ScrollView = forwardRef(function ScrollView(props, ref) {
  const latest = useRef({ ref, node: null, detach: () => {} })

  const own = useCallback(node => {
    const held = latest.current
    held.detach()
    held.detach = () => {}
    held.node = node
    if (node) held.detach = attach(held.ref, node)
  }, [])

  useLayoutEffect(() => {
    const held = latest.current
    if (held.ref === ref) return
    held.ref = ref
    if (!held.node) return
    held.detach()
    held.detach = attach(ref, held.node)
  })

  return createElement(RNWScrollView, { ...props, ref: own })
})

ScrollView.displayName = 'ScrollView'

export default ScrollView
