import { fireEvent, render, screen } from '@testing-library/react-native'
import type { DoormanAccess } from '@selfmp3/shared'

import { AccessPanel } from './AccessPanel'

/**
 * Settings › Who can sign in: drawn for the doorman's owner only, and every
 * change sends the whole list.
 */

const mockAccess: { data: DoormanAccess | undefined } = { data: undefined }
const mockUpdate = { mutate: jest.fn(), isPending: false, error: null as Error | null }
jest.mock('@selfmp3/client', () => ({
  ...jest.requireActual('@selfmp3/client'),
  useAccess: () => mockAccess,
  useUpdateAccess: () => mockUpdate,
}))

const OWNED: DoormanAccess = {
  anyone: false,
  emails: ['whyharry9@gmail.com'],
  owners: ['me@example.com'],
}

describe('AccessPanel', () => {
  beforeEach(() => {
    mockUpdate.mutate.mockClear()
    mockAccess.data = undefined
  })

  it('draws nothing for anyone but the owner', async () => {
    await render(<AccessPanel />)
    expect(screen.queryByText('Who can sign in')).toBeNull()
  })

  it('lists the owner and the people let in, and removes one', async () => {
    mockAccess.data = OWNED
    await render(<AccessPanel />)
    expect(screen.getByText('me@example.com')).toBeTruthy()
    expect(screen.getByText('Owner · always let in')).toBeTruthy()
    await fireEvent.press(screen.getByTestId('access-remove'))
    expect(mockUpdate.mutate).toHaveBeenCalledWith({ anyone: false, emails: [] })
  })

  it('adds an address, and says what is wrong with one that is not', async () => {
    mockAccess.data = OWNED
    await render(<AccessPanel />)
    await fireEvent.changeText(screen.getByTestId('access-email'), 'nope')
    await fireEvent.press(screen.getByTestId('access-add'))
    expect(screen.getByText('That isn’t an email address.')).toBeTruthy()
    expect(mockUpdate.mutate).not.toHaveBeenCalled()

    await fireEvent.changeText(screen.getByTestId('access-email'), 'Friend@Gmail.com')
    await fireEvent.press(screen.getByTestId('access-add'))
    expect(mockUpdate.mutate.mock.calls[0]?.[0]).toEqual({
      anyone: false,
      emails: ['whyharry9@gmail.com', 'friend@gmail.com'],
    })
  })
})
