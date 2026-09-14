/**
 * After a run, forget the devices the flows ran as (`FLOW_DEVICE_IDS` in the
 * config), so the server's device list is left as the run found it.
 *
 * Plain `fetch` against the server's own API. A server that has already gone,
 * or never saw one of them, is not a failed run.
 */
const DEVICE_IDS = [
  'playwright-desktop',
  'playwright-phone',
  'playwright-ipad',
  'playwright-ipad-split',
]

export default async function teardown(): Promise<void> {
  const api = (
    process.env.SELFMP3_APP_API ??
    process.env.SELFMP3_WEB_URL ??
    'http://localhost:4600'
  ).replace(/\/$/, '')
  await Promise.all(
    DEVICE_IDS.map(id =>
      fetch(`${api}/api/devices/${id}`, { method: 'DELETE' }).catch(() => undefined),
    ),
  )
}
