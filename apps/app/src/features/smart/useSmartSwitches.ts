import { useSettings } from '@selfmp3/client'

/** Which smart features are on (Settings › Smart features). */
interface SmartSwitches {
  readonly ask: boolean
  readonly tidy: boolean
  readonly tags: boolean
  readonly written: boolean
  readonly metadata: boolean
}

/**
 * The switches, shared across devices with the rest of the settings. Until
 * the settings arrive every feature counts as on, which is the default: a way
 * in that flickers out a moment after the page draws is better than one that
 * flickers in, and the server refuses a feature that is off either way.
 */
export function useSmartSwitches(): SmartSwitches {
  const { data } = useSettings()
  return {
    ask: data?.smartAsk ?? true,
    tidy: data?.smartTidy ?? true,
    tags: data?.smartTags ?? true,
    written: data?.smartWritten ?? true,
    metadata: data?.smartMetadata ?? true,
  }
}
