import type { ReactNode } from 'react'
import { View } from 'react-native'

/**
 * The web half: the browser's own tooltip, through `title`.
 *
 * The web app draws its own with `data-tip`, and matching that exactly is
 * phase 4's business — this is the primitive, and a real tooltip needs a
 * positioned layer, a delay and a pointer test to be worth anything. `title`
 * is honest in the meantime: it appears on hover, it is announced, and it
 * costs nothing.
 */
export function Tooltip({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <View
      // `title` is not in React Native's View props and is real in the DOM,
      // which is exactly the kind of thing a `.web.tsx` file is for.
      {...({ title: label } as { title: string })}
    >
      {children}
    </View>
  )
}
