import * as Haptics from 'expo-haptics'

/**
 * A light tap from the phone's engine. Only a phone has one; a browser and
 * the desktop app get the web port's nothing, and a phone without the engine
 * (a simulator) fails quietly.
 */
export function lightTap(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined)
}
