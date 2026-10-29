import { useCallback } from 'react'
import type { Settings } from '@selfmp3/shared'
import { useSettings, useUpdateSettings, type Api } from '@selfmp3/client'

type SetSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void

/**
 * The library's settings as a panel uses them: what they are, once the server
 * has said, and a way to change one. `api` is the server (`useServerApi`), or
 * null while it is away — and then there is nothing to show — and `baseUrl`
 * its address, which its settings are kept by.
 */
export function useServerSettings(
  api: Api | null,
  baseUrl: string | null,
): {
  readonly settings: Settings | undefined
  /** No settings, because asking for them failed rather than being on its way. */
  readonly failed: boolean
  readonly retry: () => void
  readonly set: SetSetting
} {
  const { data, isError, refetch } = useSettings(api, baseUrl)
  const retry = useCallback(() => void refetch(), [refetch])
  const { mutate } = useUpdateSettings(api, baseUrl)
  const set = useCallback<SetSetting>(
    (key, value) => mutate({ [key]: value } as Partial<Settings>),
    [mutate],
  )
  return { settings: data, failed: data === undefined && isError, retry, set }
}
