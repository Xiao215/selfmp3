/**
 * Where the app is, where its server is, and who the flows are when they get
 * there — read from the environment once, here, and nowhere else.
 *
 * Two addresses, because they are two processes. The server on 4600 serves its
 * own admin page, not the app, so the app comes from its web dev server on
 * 4601 — `npm run dev` starts both — and has to be told where the API is. Every
 * spec that asks the server something directly needs the same answer, and for
 * a while each one had its own default: two fell back to `''`, which Playwright
 * resolved against the *app's* address, where there is no `/api`, so they
 * failed whenever the variable was unset. One default each, applied once.
 *
 * Both can be pointed elsewhere:
 *
 *   SELFMP3_WEB_URL=http://localhost:8090 \
 *   SELFMP3_APP_API=http://localhost:4610 npm run verify:flows
 */

/** An address as a base: no trailing slash, so `${base}/api/...` is one path. */
function address(value: string): string {
  return value.replace(/\/+$/, '')
}

/** The app: the config's `baseURL`, and the origin the device id is seeded into. */
export const webUrl = address(process.env.SELFMP3_WEB_URL ?? 'http://localhost:4601')

/** The server, for the app (through `localStorage`) and for the specs' own `fetch`es. */
export const appApi = address(process.env.SELFMP3_APP_API ?? 'http://localhost:4600')

/**
 * A production build of the app, for `flows/pwa.spec.ts`.
 *
 * Only a build registers the service worker, so that spec wants one where the
 * other flows are happy with the dev server. It is the app's own address
 * unless `SELFMP3_BUILD_URL` names another; on a dev server the spec skips.
 */
export const buildUrl = process.env.SELFMP3_BUILD_URL
  ? address(process.env.SELFMP3_BUILD_URL)
  : webUrl

/**
 * One device per width, the same on every run.
 *
 * A fresh browser context has no device id, so every flow otherwise registers
 * with the server under test as a brand-new device — a few days of runs is
 * thousands of rows called "Windows PC · Chrome" (Playwright's desktop Chrome
 * says it runs on Windows). With a fixed id per project a run is two devices,
 * and `flows/teardown.ts` forgets those two when it ends.
 */
export const FLOW_DEVICE_IDS = { desktop: 'playwright-desktop', phone: 'playwright-phone' } as const
