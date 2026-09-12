export interface EscapeOptions {
  /**
   * Something drawn over the page — a sheet, a popover, a dialog. The topmost
   * open layer takes Escape and nothing underneath hears it. Without this the
   * hook is for the page itself, such as a selection, and yields to any
   * layer.
   */
  readonly layer?: boolean
}

/**
 * Call `onEscape` when Escape is pressed, while `active`.
 *
 * A phone has no Escape key, so on native this does nothing; the web half is
 * `useEscape.web.ts`. It lives in the shell because it is the shell's keyboard.
 */
export function useEscape(
  _active: boolean,
  _onEscape: () => void,
  _options: EscapeOptions = {},
): void {}
