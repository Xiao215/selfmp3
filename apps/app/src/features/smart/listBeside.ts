import { createContext } from 'react'

/**
 * Ask on a computer opens a list beside its thread rather than as a page of
 * its own (A2, 2026-10-26): which one is open, and how a song answer's card
 * opens it there. Null wherever a card opens the answer's page.
 */
export const ListBeside = createContext<{
  open: string | null
  show: (answerId: string) => void
} | null>(null)
