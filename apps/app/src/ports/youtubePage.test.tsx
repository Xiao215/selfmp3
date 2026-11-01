import { act, render } from '@testing-library/react-native'
import { deviceDownloader, warmDeviceDownloads, youtubePageWanted } from './deviceDownloads'
import { YouTubePage } from './youtubePage'

/** What the WebView was drawn with, and what its page was told to run. */
const mockWebView: { props: Record<string, unknown> | null; injected: string[] } = {
  props: null,
  injected: [],
}

jest.mock('react-native-webview', () => {
  const { forwardRef, useImperativeHandle } = jest.requireActual<typeof import('react')>('react')
  return {
    WebView: forwardRef((props: Record<string, unknown>, ref) => {
      mockWebView.props = props
      useImperativeHandle(ref, () => ({
        injectJavaScript: (script: string) => mockWebView.injected.push(script),
      }))
      return null
    }),
  }
})

type Handler = (event: { nativeEvent: Record<string, unknown> }) => void
const call = (name: string, nativeEvent: Record<string, unknown> = {}): void => {
  ;(mockWebView.props?.[name] as Handler)({ nativeEvent })
}

describe('the phone’s YouTube page', () => {
  it('opens when warmed, is used once it says it is ready, and is never waited for', async () => {
    const view = await render(<YouTubePage />)
    expect(mockWebView.props).toBeNull()

    // Not ready yet: the server takes this one, and the page starts to open.
    await expect(deviceDownloader()).resolves.toBeNull()
    expect(youtubePageWanted.get()).toBe(true)
    await act(async () => undefined)
    expect(mockWebView.props?.['source']).toMatchObject({ baseUrl: 'https://www.youtube.com/' })

    await act(() => {
      call('onLoadStart')
      call('onMessage', { data: JSON.stringify({ kind: 'ready' }) })
    })
    await act(async () => undefined)
    const youtube = await deviceDownloader()
    expect(youtube).not.toBeNull()

    // A question goes into the page as a call to its function.
    void youtube?.describe('https://www.youtube.com/watch?v=aaaaaaaaaaa').catch(() => undefined)
    expect(mockWebView.injected.at(-1)).toBe(
      'window.__selfmp3Receive({"kind":"describe","id":0,"url":"https://www.youtube.com/watch?v=aaaaaaaaaaa"});true;',
    )

    // The page went: nothing is waited on, and a new one starts to open.
    await act(() => call('onContentProcessDidTerminate'))
    await expect(deviceDownloader()).resolves.toBeNull()
    expect(youtubePageWanted.get()).toBe(true)

    // That one never loads: the server has the songs, and no page is tried again for a while.
    await act(async () => undefined)
    await act(() => call('onError', { description: 'offline' }))
    expect(youtubePageWanted.get()).toBe(false)
    warmDeviceDownloads()
    expect(youtubePageWanted.get()).toBe(false)
    await act(async () => view.unmount())
  })

  it('goes nowhere but its own page', async () => {
    youtubePageWanted.set(true)
    await render(<YouTubePage />)
    const allowed = mockWebView.props?.['onShouldStartLoadWithRequest'] as (request: {
      url: string
      isTopFrame: boolean
    }) => boolean
    expect(allowed({ url: 'https://www.youtube.com/', isTopFrame: true })).toBe(true)
    expect(allowed({ url: 'https://accounts.google.com/', isTopFrame: true })).toBe(false)
  })
})
