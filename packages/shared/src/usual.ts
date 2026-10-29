/**
 * Which hour of which kind of day a moment is, for "Usually at this hour"
 * (docs/features/wrapped-and-gems.md): the server files plays by it and Home
 * looks its tile up by it, so both have to read the clock the same way.
 *
 * A day starts at five in the morning, not at midnight: one in the morning on a
 * Saturday is still Friday night, and Friday night is a weekday's.
 */
export const DAY_STARTS_AT_HOUR = 5

/** The local hour, and whether the day it belongs to is a Saturday or a Sunday. */
export function usualSlot(date: Date): { readonly hour: number; readonly weekend: boolean } {
  const day = new Date(date.getTime())
  day.setHours(day.getHours() - DAY_STARTS_AT_HOUR)
  const weekday = day.getDay()
  return { hour: date.getHours(), weekend: weekday === 0 || weekday === 6 }
}
