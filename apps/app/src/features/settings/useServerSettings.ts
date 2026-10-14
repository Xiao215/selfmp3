import { useCallback } from 'react'
import type { Settings } from '@selfmp3/shared'
import { useSettings, useUpdateSettings, type Api } from '@selfmp3/client'

type SetSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void

/**
 * The library's settings as a panel uses them: what they are, once the server
 * has said, and a way to change one. `api` is the server (`useServerApi`), or
 * null while it is away — and then there is nothing to show.
 */
export function useServerSettings(api: Api | null): {
  readonly settings: Settings | undefined
  readonly set: SetSetting
} {
  const { data } = useSettings(api)
  const { mutate } = useUpdateSettings(api)
  const set = useCallback<SetSetting>(
    (key, value) => mutate({ [key]: value } as Partial<Settings>),
    [mutate],
  )
  return { settings: data, set }
}
