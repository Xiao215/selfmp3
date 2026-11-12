import { act, fireEvent, render, screen } from '@testing-library/react-native'

import { DesktopPanel } from './DesktopPanel'

/**
 * Open at login shows what the operating system has: a change the shell
 * could not make goes back to what the system still says.
 */

let mockOpen = false
const mockSet = jest.fn<Promise<boolean>, [boolean]>()
jest.mock('../../ports/loginItem', () => ({
  loginItem: {
    available: true,
    get: () => Promise.resolve(mockOpen),
    set: (open: boolean) => mockSet(open),
  },
}))

it('goes back to what the system has when the change is refused', async () => {
  mockOpen = false
  mockSet.mockRejectedValue(new Error('The shell did not answer'))
  await render(<DesktopPanel />)
  const toggle = screen.getByTestId('setting-login-item')
  expect(toggle).not.toBeChecked()

  await act(async () => fireEvent.press(toggle))
  expect(mockSet).toHaveBeenCalledWith(true)
  expect(screen.getByTestId('setting-login-item')).not.toBeChecked()
})
