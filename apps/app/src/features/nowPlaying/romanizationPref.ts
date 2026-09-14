import { useEffect } from 'react'
import { useSettings } from '@selfmp3/client'
import { prefs } from '../../ports/prefs'

/**
 * The romaji switch, on a device that cannot always ask.
 *
 * Romanization is a synced setting, the server's, so that every device shows
 * the same thing. Away from the server the settings query has no answer, and
 * without this the switch read as off — with the romaji sitting right there
 * in the kept lyrics. The last value heard is written down here, by the
 * shell, which is mounted from the first frame; the words read it back when
 * the query is empty.
 */

const KEY = 'lyricsRomanization'

/** Mounted once, in the shell: keep the last heard value on the device. */
export function useRomanizationMirror(): void {
  const settings = useSettings()
  const heard = settings.data?.lyricsRomanization
  useEffect(() => {
    if (heard !== undefined) prefs.set(KEY, heard)
  }, [heard])
}

/** Whether romaji is on: the server's answer when there is one, else the last heard. */
export function useRomanizationOn(): boolean {
  const settings = useSettings()
  return (settings.data?.lyricsRomanization ?? prefs.get(KEY)) === 'on'
}
