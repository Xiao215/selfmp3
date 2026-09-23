import { fireEvent, render, screen } from '@testing-library/react-native'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import type { Song } from '@selfmp3/shared'

import { OverlayProvider } from '../../shell/Overlay'
import { ConfirmRemoveSongs } from './ConfirmRemoveSongs'

/**
 * The confirmation asks one question. Removing a song is removing it on every
 * device, and whatever this device downloaded of it goes too; there is no
 * "keep the file" to tick, because the server keeps no copy to keep.
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
  it('asks once, with no file to keep, and says the download here goes too', async () => {
    const onConfirm = jest.fn()
    await draw({ onConfirm })

    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText('Remove 2 songs from your library?')).toBeTruthy()
    expect(screen.getByText(/deleted from this device/)).toBeTruthy()
    expect(screen.getByText(/on every device/)).toBeTruthy()

    await fireEvent.press(screen.getByRole('button', { name: 'Remove 2 songs' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('names the first few songs and counts the rest', async () => {
    await draw({ songs: [song(1), song(2), song(3), song(4), song(5)] })

    expect(screen.getByText('Song 1')).toBeTruthy()
    expect(screen.getByText('Song 3')).toBeTruthy()
    expect(screen.getByText('and 2 more songs')).toBeTruthy()
  })
})
