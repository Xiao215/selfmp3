/**
 * Whether the app opens when the person logs in.
 *
 * Only an installed app can be a login item, so `available` is false in a
 * browser and on a phone and Settings shows no toggle at all. The value is read
 * back from the operating system rather than remembered here: someone can turn
 * it off in System Settings › General › Login Items, and a toggle that then
 * still reads "on" is one nobody believes again.
 */
export interface LoginItem {
  readonly available: boolean
  get(): Promise<boolean>
  /** Returns what the operating system has after the change. */
  set(open: boolean): Promise<boolean>
}

export const loginItem: LoginItem = {
  available: false,
  get: () => Promise.resolve(false),
  set: () => Promise.resolve(false),
}
