import { createContext, createElement, useContext, type ReactElement, type ReactNode } from 'react'

/**
 * The one thing the query hooks need that changes while the app runs: whether
 * there is a server to ask yet.
 *
 * The browser always has one — its own origin — so it says `true` and forgets
 * about it. The phone does not: it reads an address out of the keychain and
 * looks for a cloud session at launch, and until one of those answers there is
 * nowhere to send a request. Without this the library query fires immediately,
 * fails, and shows an error for the half second before the address arrives.
 *
 * Deliberately not the API client itself — that is module state in
 * `runtime.ts`, for the reasons written there. This is a context because it is
 * the part that genuinely changes and that React has to re-render for.
 */
export interface ClientState {
  /** False while the app is still working out where to talk to. */
  readonly ready: boolean
}

const ClientStateContext = createContext<ClientState>({ ready: true })

export function ClientStateProvider({
  ready,
  children,
}: {
  ready: boolean
  children: ReactNode
}): ReactElement {
  // `createElement` rather than JSX: this package compiles without the DOM, and
  // a .ts file keeps it honest about being platform-free.
  return createElement(ClientStateContext.Provider, { value: { ready } }, children)
}

/**
 * Defaults to ready, so an app that never mounts the provider — the web app,
 * which has nothing to wait for — behaves exactly as it did.
 */
export function useClientState(): ClientState {
  return useContext(ClientStateContext)
}
