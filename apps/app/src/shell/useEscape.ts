/**
 * Call `onEscape` when Escape is pressed, while `active`.
 *
 * A phone has no Escape key, so on native this does nothing; the web half is
 * `useEscape.web.ts`. It lives in the shell because it is the shell's keyboard.
 */
export function useEscape(_active: boolean, _onEscape: () => void): void {}
