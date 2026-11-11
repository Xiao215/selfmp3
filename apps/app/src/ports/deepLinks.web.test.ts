import { describe, expect, it, vi } from 'vitest'

/**
 * The installed desktop app's links, as the shell hands them over: a sign-in
 * coming back goes to the sign-in queue whichever way it came back — with a
 * code, or refused — and never to the routes.
 */
const shell = vi.hoisted(() => ({ arrive: (_url: string): void => undefined }))
vi.mock('./desktop/bridge', () => ({
  desktop: {
    onDeepLink: (listener: (url: string) => void) => {
      shell.arrive = listener
    },
  },
}))

const { onDeepLinkRoute, onSignInLink } = await import('./deepLinks.web')

describe('desktop deep links', () => {
  it('hands a refused sign-in to the sign-in queue, as it does one with a code', () => {
    const signIns: string[] = []
    const routes: unknown[] = []
    const stopSignIns = onSignInLink(url => signIns.push(url))
    const stopRoutes = onDeepLinkRoute(route => routes.push(route))

    shell.arrive('selfmp3://welcome#signin-code=4F7K2QXM')
    shell.arrive('selfmp3://welcome#signin-refused=not-allowed&signin-email=a%40b.c')
    shell.arrive('selfmp3://now-playing')

    expect(signIns).toEqual([
      'selfmp3://welcome#signin-code=4F7K2QXM',
      'selfmp3://welcome#signin-refused=not-allowed&signin-email=a%40b.c',
    ])
    expect(routes).toEqual([{ kind: 'now-playing' }])
    stopSignIns()
    stopRoutes()
  })
})
