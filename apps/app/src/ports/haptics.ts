import * as Haptics from 'expo-haptics'

/**
 * A light tap from the phone's engine. Only a phone has one; a browser and
 * the desktop app get the web port's nothing, and a phone without the engine
 * (a simulator) fails quietly.
 */
export function lightTap(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}

/** A firmer tap: the end of something under the finger, such as the start of a song while scrubbing. */
export function firmTap(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined)
}
