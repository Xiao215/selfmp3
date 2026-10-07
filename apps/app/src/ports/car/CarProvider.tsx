import type { ReactNode } from 'react'

/**
 * The car's view of the library, where there is a car to show it to.
 *
 * Android Auto is the one integration there is, so this is Android's alone
 * (`CarProvider.android.tsx`). Everywhere else it passes its children through
 * and does nothing: no playlist is fetched for a car that cannot connect, and
 * nothing that reaches track-player is bundled where there is no track-player.
 */
export function CarProvider({ children }: { children: ReactNode }): ReactNode {
  return children
}
