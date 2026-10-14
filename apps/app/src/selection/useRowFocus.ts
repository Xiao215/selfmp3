/**
 * A song row keeping the keyboard's place in a list as it scrolls out of the
 * drawn rows and back, on a computer (`useRowFocus.web.ts`). A phone has no
 * focus to keep, so here it does nothing.
 */
export function useRowFocus(_listKey: string | undefined, _songId: number): void {}
