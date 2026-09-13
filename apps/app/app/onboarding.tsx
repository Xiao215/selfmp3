import type { ReactNode } from 'react'
import { Redirect } from 'expo-router'

import { OnboardingScreen } from '../src/features/onboarding/OnboardingScreen'

/**
 * Connecting to a server by typing its address: development builds only.
 *
 * Every device starts with Google sign-in, and the library is the bucket's. The
 * address screen stays for the simulator tests, which cannot sign in to a Google
 * account; a normal build sends anyone who reaches this route to sign-in. The
 * server's own page still connects to itself, with nothing typed.
 */
export default function OnboardingRoute(): ReactNode {
  if (!__DEV__) return <Redirect href="/sign-in" />
  return <OnboardingScreen />
}
