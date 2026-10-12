import { fireEvent, render, screen } from '@testing-library/react-native'

import { Cover } from './Cover'

type View = Awaited<ReturnType<typeof render>>

/** The pictures the cover is drawing, as host images. */
const pictures = (view: View) =>
  view.container.queryAll(node => typeof node.props['source'] === 'object')

/** Their addresses. */
const drawn = (view: View): string[] =>
  pictures(view).map(image => (image.props['source'] as { uri: string }).uri)

/** The picture at `uri`, to fire its load or its error at. */
function picture(view: View, uri: string) {
  const found = pictures(view).find(image => (image.props['source'] as { uri: string }).uri === uri)
  if (!found) throw new Error(`no picture at ${uri}`)
  return found
}

describe('Cover', () => {
  it('keeps the last picture under a new one while it loads', async () => {
    const view = await render(<Cover uri="a.jpg" title="First light" />)
    await fireEvent(picture(view, 'a.jpg'), 'load')

    await view.rerender(<Cover uri="b.jpg" title="Second wind" />)
    expect(drawn(view)).toEqual(['a.jpg', 'b.jpg'])
  })

  it('draws the letter, and not the last song’s picture, when the new one fails', async () => {
    const view = await render(<Cover uri="a.jpg" title="First light" />)
    await fireEvent(picture(view, 'a.jpg'), 'load')

    await view.rerender(<Cover uri="b.jpg" title="Second wind" />)
    await fireEvent(picture(view, 'b.jpg'), 'error')

    expect(drawn(view)).toEqual([])
    expect(screen.getByText('S')).toBeTruthy()
  })
})
