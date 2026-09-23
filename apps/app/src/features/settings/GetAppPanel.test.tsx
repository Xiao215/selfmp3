import { fireEvent, render, screen, waitFor } from '@testing-library/react-native'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Linking } from 'react-native'
import { RELEASES_URL, type MacChip, type MacInstallers } from '@selfmp3/shared'

import { GetAppPanel } from './GetAppPanel'

/**
 * Settings › Mac app, in a browser tab on a Mac.
 *
 * What matters is which file the leading button opens: the two dmgs are named
 * for the chip, and the Intel one installs on an M1 without a word and runs
 * under Rosetta. So a Chromium browser, which can say the chip, gets that chip
 * first; Safari, which cannot, gets both and a line saying how to tell; and
 * with no release at all there is one button, to the page that will have it.
 */

const mockPort: { chip: MacChip | null; latest: () => Promise<MacInstallers | null> } = {
  chip: null,
  latest: () => Promise.resolve(null),
}
jest.mock('../../ports/macApp', () => ({
  macApp: {
    offered: true,
    chip: () => Promise.resolve(mockPort.chip),
    latest: () => mockPort.latest(),
  },
}))

const RELEASE: MacInstallers = {
  version: '1.0.0',
  page: `${RELEASES_URL}/tag/desktop-v1.0.0`,
  dmg: { arm64: 'https://dl/arm64.dmg', x64: 'https://dl/x64.dmg' },
}

let client: QueryClient

/**
 * The chip and the release both arrive on a promise, so every test waits for
 * what it expects to be drawn rather than reading straight after `render`.
 */
const draw = async (): Promise<void> => {
  // Nothing is collected on a timer: a pending one keeps jest from exiting.
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  await render(
    <QueryClientProvider client={client}>
      <GetAppPanel anchor={() => undefined} />
    </QueryClientProvider>,
  )
}

const press = async (testID: string): Promise<void> => {
  await fireEvent.press(screen.getByTestId(testID))
}

describe('Settings › Mac app', () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true)
  beforeEach(() => open.mockClear())
  afterEach(() => client.clear())

  it('leads with this Mac’s chip where the browser can say, and opens that dmg', async () => {
    mockPort.chip = 'arm64'
    mockPort.latest = () => Promise.resolve(RELEASE)
    await draw()
    await screen.findByTestId('get-app-arm64')
    expect(screen.getByText('Download for Apple silicon')).toBeTruthy()
    expect(screen.getByText('Download for Intel')).toBeTruthy()
    // The chip's own button first: what is pressed without reading.
    const labels = screen.getAllByText(/^Download for /).map(node => node.props['children'])
    expect(labels).toEqual(['Download for Apple silicon', 'Download for Intel'])
    expect(screen.getByText(/^Version 1\.0\.0\./)).toBeTruthy()
    expect(screen.queryByText(/About This Mac/)).toBeNull()

    await press('get-app-arm64')
    expect(open).toHaveBeenCalledWith('https://dl/arm64.dmg')
  })

  it('offers both and says how to tell, when the browser cannot name the chip', async () => {
    mockPort.chip = null
    mockPort.latest = () => Promise.resolve(RELEASE)
    await draw()
    await screen.findByTestId('get-app-x64')
    expect(screen.getByText(/About This Mac/)).toBeTruthy()
    await press('get-app-x64')
    expect(open).toHaveBeenCalledWith('https://dl/x64.dmg')
  })

  it('sends to the releases page while there is no release, and when GitHub does not answer', async () => {
    mockPort.chip = 'arm64'
    mockPort.latest = () => Promise.resolve(null)
    await draw()
    await waitFor(() => expect(screen.getByText(/^No release yet\./)).toBeTruthy())
    await press('get-app-releases')
    expect(open).toHaveBeenCalledWith(RELEASES_URL)

    mockPort.latest = () => Promise.reject(new Error('GitHub answered 403'))
    await screen.unmount()
    await draw()
    await waitFor(() => expect(screen.getByText(/^Could not reach GitHub\./)).toBeTruthy())
  })
})
