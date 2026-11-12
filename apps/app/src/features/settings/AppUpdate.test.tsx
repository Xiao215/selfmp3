import { renderHook } from '@testing-library/react-native'
import { AppState, type AppStateStatus } from 'react-native'
import type { PhoneBuild } from '@selfmp3/shared'

import { useAppUpdateStatus } from './AppUpdate'

/**
 * Installing a newer iPhone build from inside the app. iOS asks whether to
 * replace the app, then puts the build in only once the app has left the
 * screen; Xiao asked (2026-11-01) for the app to step back by itself once
 * that question is answered, where a message with Home used to wait.
 *
 * iOS's question shows here as the app going inactive and active again,
 * which is all the app is told: the same for Install and Cancel.
 */

let opened: { resolve: () => void; reject: (error: Error) => void }
const mockUpdate = {
  offered: true,
  build: 100,
  downloads: false,
  browser: 'Safari',
  latest: jest.fn(),
  install: jest.fn(
    (handed: () => void) =>
      new Promise<void>((resolve, reject) => {
        opened = {
          resolve: () => {
            handed()
            resolve()
          },
          reject,
        }
      }),
  ),
  leave: jest.fn(),
}
// Read when used: the mocked module is loaded before this file's own lines run.
jest.mock('../../ports/appUpdate', () => ({
  get appUpdate() {
    return mockUpdate
  },
}))

const mockPrefs = new Map<string, string>()
jest.mock('../../ports/prefs', () => ({
  prefs: {
    get: (key: string) => mockPrefs.get(key) ?? null,
    set: (key: string, value: string) => mockPrefs.set(key, value),
  },
}))

const mockToasts: { say: string; actions: string[] }[] = []
jest.mock('../../ui/toast', () => ({
  showToast: (
    message: string | { say: string },
    _tone: string,
    options?: { actions?: { label: string }[] },
  ) => {
    mockToasts.push({
      say: typeof message === 'string' ? message : message.say,
      actions: (options?.actions ?? []).map(action => action.label),
    })
    return mockToasts.length
  },
  dismissToast: () => undefined,
}))

const mockNewer: PhoneBuild = { build: 101 } as PhoneBuild
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mockNewer, isFetching: false, isSuccess: true, isError: false }),
}))

let watching: ((state: AppStateStatus) => void)[]
const moveTo = (state: AppStateStatus) => {
  for (const handler of [...watching]) handler(state)
}
const settled = () => new Promise(resolve => setImmediate(resolve))

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['setImmediate'] })
  watching = []
  mockToasts.length = 0
  mockPrefs.clear()
  mockUpdate.leave.mockClear()
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
    const each = handler as (state: AppStateStatus) => void
    watching.push(each)
    return {
      remove: () => {
        watching = watching.filter(other => other !== each)
      },
    } as ReturnType<typeof AppState.addEventListener>
  })
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

async function pressInstall(): Promise<void> {
  const { result } = await renderHook(() => useAppUpdateStatus())
  expect(result.current?.line).toBe('Build 101 is ready')
  result.current?.action?.onPress()
}

it('steps back to the Home Screen once iOS’s question is answered, with nothing to press', async () => {
  await pressInstall()
  moveTo('inactive')
  opened.resolve()
  await settled()
  expect(mockUpdate.leave).not.toHaveBeenCalled()

  moveTo('active')
  expect(mockUpdate.leave).toHaveBeenCalledTimes(1)
  expect(mockToasts).toEqual([])
  expect(mockPrefs.get('appUpdateTried')).toBe('101')
})

it('watches from before the link opens, for a question that comes before the open settles', async () => {
  await pressInstall()
  moveTo('inactive')
  moveTo('active')
  expect(mockUpdate.leave).toHaveBeenCalledTimes(1)

  opened.resolve()
  await settled()
  jest.advanceTimersByTime(10_000)
  expect(mockUpdate.leave).toHaveBeenCalledTimes(1)
})

it('says the build hasn’t gone in on coming back, after Cancel stepped back too', async () => {
  await pressInstall()
  moveTo('inactive')
  opened.resolve()
  await settled()
  moveTo('active')
  moveTo('background')
  expect(mockToasts).toEqual([])

  moveTo('active')
  expect(mockToasts).toEqual([{ say: 'Build 101 hasn’t gone in', actions: ['Install', 'Page'] }])
})

it('steps back after a while where iOS asks nothing', async () => {
  await pressInstall()
  opened.resolve()
  await settled()
  jest.advanceTimersByTime(4000)
  expect(mockUpdate.leave).not.toHaveBeenCalled()

  jest.advanceTimersByTime(1000)
  expect(mockUpdate.leave).toHaveBeenCalledTimes(1)
})

it('waits out a question that comes slowly, as a manifest from far away does', async () => {
  await pressInstall()
  opened.resolve()
  await settled()
  jest.advanceTimersByTime(3000)
  moveTo('inactive')
  jest.advanceTimersByTime(10_000)
  expect(mockUpdate.leave).not.toHaveBeenCalled()

  moveTo('active')
  expect(mockUpdate.leave).toHaveBeenCalledTimes(1)
})

it('leaves it to the Home gesture when the app is put away while asked', async () => {
  await pressInstall()
  opened.resolve()
  await settled()
  moveTo('inactive')
  moveTo('background')
  moveTo('active')
  jest.advanceTimersByTime(10_000)

  expect(mockUpdate.leave).not.toHaveBeenCalled()
  expect(mockToasts.map(toast => toast.say)).toEqual(['Build 101 hasn’t gone in'])
})

it('stops watching when iOS won’t open the link', async () => {
  await pressInstall()
  opened.reject(new Error('no'))
  await settled()
  moveTo('inactive')
  moveTo('active')
  jest.advanceTimersByTime(10_000)

  expect(mockUpdate.leave).not.toHaveBeenCalled()
  expect(watching).toEqual([])
  expect(mockToasts.map(toast => toast.say)).toEqual(['Couldn’t start the install'])
})
