import { renderHook } from '@testing-library/react-native'
import { focusManager } from '@tanstack/react-query'
import { useCloudLook } from './useCloudLook'

/*
 * What asks a cloud library whether the bucket has news: once a minute while
 * the app is in front, never in the background, never for a server — and
 * never by way of a render.
 */

const mockLibraryVersion = jest.fn(() => Promise.resolve({ version: 1, songCount: 0 }))
jest.mock('../api/client', () => ({ api: { libraryVersion: () => mockLibraryVersion() } }))

beforeEach(() => {
  jest.useFakeTimers()
  mockLibraryVersion.mockClear()
  focusManager.setFocused(true)
})

afterEach(() => {
  focusManager.setFocused(undefined)
  jest.useRealTimers()
})

it('asks once a minute while the app is in front', async () => {
  const { unmount } = await renderHook(() => useCloudLook(true))
  jest.advanceTimersByTime(59_000)
  expect(mockLibraryVersion).not.toHaveBeenCalled()
  jest.advanceTimersByTime(1_000)
  expect(mockLibraryVersion).toHaveBeenCalledTimes(1)

  focusManager.setFocused(false)
  jest.advanceTimersByTime(5 * 60_000)
  expect(mockLibraryVersion).toHaveBeenCalledTimes(1)

  await unmount()
  focusManager.setFocused(true)
  jest.advanceTimersByTime(5 * 60_000)
  expect(mockLibraryVersion).toHaveBeenCalledTimes(1)
})

it('asks nothing of a server', async () => {
  await renderHook(() => useCloudLook(false))
  jest.advanceTimersByTime(5 * 60_000)
  expect(mockLibraryVersion).not.toHaveBeenCalled()
})
