import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { ConfirmRemoveSongs } from './ConfirmRemoveSongs'

/**
 * The confirmation, and the question it does or does not ask.
 *
 * On a computer the box is the whole point: "remove from my list" and "delete
 * the files" are different things and must never be one mis-tap apart. On a
 * phone there is nothing to tick — removing a song is removing it, and the
 * download goes with it — and offering the choice there only invites the state
 * nobody wants, a file on the device for a song the library has never heard of.
 */

jest.mock('../../shell/useLayout', () => ({
  useLayout: () => ({ wide: false, dense: false, compact: true, finePointer: false, width: 390 }),
}))

const song = (id: number): Song =>
  ({ id, title: `Song ${id}`, artist: 'Artist' }) as unknown as Song

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
}

const draw = (props: Partial<Parameters<typeof ConfirmRemoveSongs>[0]> = {}) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <OverlayProvider>
        <ConfirmRemoveSongs
          songs={[song(1), song(2)]}
          onCancel={() => undefined}
          onConfirm={() => undefined}
          {...props}
        />
      </OverlayProvider>
    </SafeAreaProvider>,
  )

describe('ConfirmRemoveSongs', () => {
  it('offers the file as a separate choice where there is a library folder', async () => {
    await draw()

    expect(screen.getByRole('checkbox')).toBeTruthy()
    expect(screen.getByText('Also delete the 2 audio files from disk')).toBeTruthy()
  })

  it('asks once, and only once, where removing takes the copy with it', async () => {
    const onConfirm = jest.fn()
    await draw({ takesTheCopy: true, onConfirm })

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Remove 2 songs from your library?')).toBeTruthy()
    expect(screen.getByText(/deleted from this device/)).toBeTruthy()

    fireEvent.press(screen.getByRole('button', { name: 'Remove 2 songs' }))
    // Never the server's files: that is the choice a phone does not make.
    expect(onConfirm).toHaveBeenCalledWith(false)
  })
})
