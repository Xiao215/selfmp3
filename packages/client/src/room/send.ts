import { doormanRequest, type DoormanFetch } from '@selfmp3/shared'

/**
 * One request to a room or a shared playlist, for roomApi.ts and sharedApi.ts:
 * packages/shared's doorman client, and the answer parsed by its schema. A GET
 * unless there is a body, which is a POST unless said otherwise. A refusal
 * throws shared's `DoormanError`, the doorman's own code and words in it.
 *
 * The two used to have a `send` each, near enough the same, each building its
 * own error from the answer's body.
 */
export function doormanSend(doormanUrl: string, fetch: DoormanFetch) {
  const request = doormanRequest(doormanUrl, fetch)
  return async <T>(
    path: string,
    parse: (body: unknown) => T,
    options: { json?: unknown; session?: string | null; method?: 'POST' | 'PUT' } = {},
  ): Promise<T> => {
    const response = await request(path, {
      method: options.json === undefined ? 'GET' : (options.method ?? 'POST'),
      token: options.session ?? null,
      ...(options.json === undefined ? {} : { json: options.json }),
    })
    // A 204 — leaving a shared playlist — has nothing to parse.
    const text = await response.text()
    return parse(text === '' ? null : JSON.parse(text))
  }
}
