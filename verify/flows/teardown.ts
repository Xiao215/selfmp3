import { appApi, FLOW_DEVICE_IDS } from '../env.js'

/**
 * After a run, forget the two devices the flows ran as, so the server's device
 * list is left as the run found it.
 *
 * Plain `fetch` against the server's own API. A server that has already gone,
 * or never saw one of them, is not a failed run.
 */
export default async function teardown(): Promise<void> {
  await Promise.all(
    Object.values(FLOW_DEVICE_IDS).map(id =>
      fetch(`${appApi}/api/devices/${id}`, { method: 'DELETE' }).catch(() => undefined),
    ),
  )
}
