import { act, fireEvent, render, screen } from '@testing-library/react-native'
import { AccessibilityInfo } from 'react-native'
import type { MapPlace, Song } from '@selfmp3/shared'

import { FieldControl } from './fieldControl'
import { skyPoints } from './sky.model'
import { SoundField } from './SoundField'

/**
 * The sound map's field to a phone's screen reader (R7G-1): VoiceOver and
 * TalkBack reach the songs by swiping through them, hear each one, play one
 * with a double tap and draw a line with the field's own action. A browser's
 * keys are `fieldInput.web.test.tsx`'s.
 */

// The sky is drawn with Skia, whose module jest cannot load. These tests never
// lay the field out, so the sky is never drawn: what stands in is never reached.
jest.mock('./SkyLayer', () => ({ SkyLayer: () => null }))

const song = (id: number, title: string): Song =>
  ({ id, title, artist: `Artist ${id}`, album: '', duration: 200, playCount: 0 }) as unknown as Song

const songs = new Map(
  [song(1, 'Middle'), song(2, 'East'), song(3, 'Far north')].map(each => [each.id, each]),
)
const places = [
  { id: 1, x: 0.5, y: 0.5 },
  { id: 2, x: 0.62, y: 0.5 },
  { id: 3, x: 0.5, y: 0.1 },
]

async function field() {
  const control = new FieldControl()
  const onPress = jest.fn((_spot: MapPlace, _reach: number) => true)
  const onPathStart = jest.fn()
  const onPathMove = jest.fn()
  const onPathEnd = jest.fn(() => 3)
  const onPathCancel = jest.fn()
  const drawn = (lit: number | null) => (
    <SoundField
      control={control}
      armed={false}
      points={skyPoints(places, songs)}
      songs={songs}
      regions={[]}
      lens={null}
      takes={[]}
      stroke={[]}
      lit={lit}
      panel={0}
      onPress={onPress}
      onPathStart={onPathStart}
      onPathMove={onPathMove}
      onPathEnd={onPathEnd}
      onPathCancel={onPathCancel}
    />
  )
  const view = await render(drawn(null))
  // Laid out without drawing the sky: the songs are where the control says.
  await act(() => control.resize({ width: 400, height: 800 }))
  const map = screen.getByTestId('sound-map-field')
  const action = (actionName: string) =>
    fireEvent(map, 'accessibilityAction', { nativeEvent: { actionName } })
  /** The tray lighting a song: shown from its list, or under the pointer there. */
  const light = (lit: number | null) => view.rerender(drawn(lit))
  /** The tray's Show, which lights its song and flies to it. */
  const show = async (id: number) => {
    await light(id)
    await act(() => control.flyToSong(places.find(place => place.id === id)!))
  }
  return { map, action, light, show, onPress, onPathStart, onPathMove, onPathEnd, onPathCancel }
}

describe('SoundField with a screen reader', () => {
  it('is one adjustable element, named with the songs on it', async () => {
    const { map } = await field()
    expect(map.props['accessible']).toBe(true)
    expect(map.props['accessibilityRole']).toBe('adjustable')
    expect(map.props['accessibilityLabel']).toBe('Sound map, 3 songs')
    expect(map.props['accessibilityActions'].map((each: { name: string }) => each.name)).toEqual([
      'increment',
      'decrement',
      'activate',
      'draw',
    ])
  })

  it('steps to a song, says it, and plays it with a double tap', async () => {
    const { map, action, onPress } = await field()
    await action('increment')
    expect(map.props['accessibilityValue']).toEqual({ text: 'Middle, Artist 1' })
    await action('increment')
    const second = map.props['accessibilityValue'].text
    expect(second).not.toBe('Middle, Artist 1')
    await action('activate')
    expect(onPress).toHaveBeenCalledTimes(1)
    const [spot] = onPress.mock.calls[0]!
    const playedId = places.find(place => place.x === spot.x && place.y === spot.y)?.id
    expect(songs.get(playedId!)?.title).toBe(second.split(',')[0])
  })

  it('draws a line from one song to another with its action', async () => {
    const { map, action, onPathStart, onPathMove, onPathEnd } = await field()
    await action('draw')
    expect(onPathStart).toHaveBeenCalledWith(expect.objectContaining({ x: 0.5, y: 0.5 }))
    expect(map.props['accessibilityActions']).toContainEqual({
      name: 'draw',
      label: 'End the line here',
    })
    expect(map.props['accessibilityActions']).toContainEqual({ name: 'escape' })
    await action('increment')
    await action('draw')
    expect(onPathMove).toHaveBeenCalledTimes(1)
    expect(onPathEnd).toHaveBeenCalledTimes(1)
    expect(map.props['accessibilityActions']).toContainEqual({
      name: 'draw',
      label: 'Start a line here',
    })
  })

  it('stops drawing with a scrub, keeping the song', async () => {
    const { map, action, onPathCancel, onPathEnd } = await field()
    await action('draw')
    await action('escape')
    expect(onPathCancel).toHaveBeenCalledTimes(1)
    expect(onPathEnd).not.toHaveBeenCalled()
    expect(map.props['accessibilityValue']).toEqual({ text: 'Middle, Artist 1' })
  })

  it('says what a line took', async () => {
    const said = jest.spyOn(AccessibilityInfo, 'announceForAccessibility')
    const { action, onPathMove, onPathEnd } = await field()
    await action('draw')
    expect(said).toHaveBeenLastCalledWith('Drawing from Middle')
    await action('increment')
    await action('draw')
    // The song the line went to is kept however near the one before.
    expect(onPathMove).toHaveBeenCalledWith(expect.anything(), expect.any(Number), true)
    expect(onPathEnd).toHaveBeenCalledTimes(1)
    expect(said).toHaveBeenLastCalledWith('Added 3 songs to the tray')
    onPathEnd.mockReturnValueOnce(0)
    await action('draw')
    await action('draw')
    expect(said).toHaveBeenLastCalledWith('The line took no songs')
    said.mockRestore()
  })

  it('lets go of the song with a scrub', async () => {
    const { map, action } = await field()
    expect(map.props['accessibilityActions']).not.toContainEqual({ name: 'escape' })
    await action('increment')
    expect(map.props['accessibilityActions']).toContainEqual({ name: 'escape' })
    await action('escape')
    expect(map.props['accessibilityValue']).toBeUndefined()
    expect(map.props['accessibilityActions']).not.toContainEqual({ name: 'escape' })
  })

  it('lets go of the song when the tray lights another, the newer of the two', async () => {
    const { map, action, light } = await field()
    await action('increment')
    expect(map.props['accessibilityValue']).toEqual({ text: 'Middle, Artist 1' })
    await light(3)
    expect(map.props['accessibilityValue']).toBeUndefined()
    // Choosing again afterwards is newer than the tray's song.
    await action('increment')
    expect(map.props['accessibilityValue']).toEqual({ text: 'Middle, Artist 1' })
  })

  it('keeps a line being drawn when the tray lights a song', async () => {
    const { map, action, light, onPathCancel } = await field()
    await action('draw')
    await light(2)
    expect(onPathCancel).not.toHaveBeenCalled()
    expect(map.props['accessibilityValue']).toEqual({ text: 'Middle, Artist 1' })
  })

  it('lets go of the song at each Show, even of the song the tray already lit', async () => {
    const { map, action, show } = await field()
    await show(3)
    await action('increment')
    expect(map.props['accessibilityValue']).toEqual({ text: 'Middle, Artist 1' })
    await show(3)
    expect(map.props['accessibilityValue']).toBeUndefined()
  })
})
