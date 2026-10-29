// expo-router's browser history, with a page brought back up the stack added
// as a step (metro.config.js resolves expo-router's own
// `./createMemoryHistory` here).
//
// On the web a place or a page already open is brought back to the top when
// it is gone to again, rather than opened twice (`ports/singularPlaces.web.ts`).
// The stack stays the same length, and `useLinking` reads a stack that is no
// longer as a replace: Library → Stats → Library wrote the second Library over
// the Stats entry, so Back skipped Stats (bug bash, web-nav-library). Here a
// replace that brings a page back up (`broughtBackUp`) is pushed instead, as
// the step it is. Every other replace — after Back or Forward, a page swapped
// for another, the first entry — stays one.

import { createMemoryHistory as original } from 'expo-router/build/fork/createMemoryHistory'
import { broughtBackUp } from '../src/shell/historyState.model'

export function createMemoryHistory() {
  const history = original()
  const replace = history.replace
  history.replace = entry => {
    const here = history.get(history.index)
    if (here && here.path !== entry.path && broughtBackUp(here.state, entry.state)) {
      history.push(entry)
    } else {
      replace(entry)
    }
  }
  return history
}
