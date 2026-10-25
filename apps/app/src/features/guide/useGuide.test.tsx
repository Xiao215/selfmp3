import { useEffect } from 'react'
import type { ReactNode } from 'react'
import type { View } from 'react-native'
import { act, render } from '@testing-library/react-native'
import { closeLayer, openLayer } from '../../shell/layers'
import type { Box } from './guide.model'
import { holdGuides, setFingers, setTyping } from './guideBusy'
import { forgetGuides, guideSeen } from './guideMemory'
import { useGuide, type GuideHandle } from './useGuide'

let mockPathname = '/library'
jest.mock('expo-router', () => ({ usePathname: () => mockPathname }))

/**
 * When a first-run guide comes up, against the one boundary it cannot run
 * here: where the platform laid out what it lights. Everything else is the
 * guide's own: its memory, the busy store and the layer stack.
 */

let where: Box = { x: 0, y: 100, width: 390, height: 64 }
const laidOut = {
  measureInWindow: (done: (x: number, y: number, width: number, height: number) => void) =>
    done(where.x, where.y, where.width, where.height),
} as unknown as View

let handle: GuideHandle | null = null

function Screen({ ready = true, layers = 0 }: { ready?: boolean; layers?: number }): ReactNode {
  const [target, guide] = useGuide('tag-hold', ready, { layers })
  useEffect(() => target(laidOut), [target])
  useEffect(() => {
    handle = guide
  })
  return null
}

const shown = (): boolean => handle?.shown ?? false
const wait = async (ms: number): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
}
/** Something outside React changing, as the root or a row would change it. */
const happen = async (change: () => void): Promise<void> => {
  await act(async () => {
    change()
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  forgetGuides()
  setFingers(0)
  setTyping(false)
  holdGuides('row', false)
  mockPathname = '/library'
  where = { x: 0, y: 100, width: 390, height: 64 }
  handle = null
})

afterEach(() => {
  jest.useRealTimers()
})

describe('a guide comes', () => {
  it('once the page has settled, and is remembered as it does', async () => {
    await render(<Screen />)
    await wait(300)
    expect(shown()).toBe(false)
    await wait(500)
    expect(shown()).toBe(true)
    expect(handle?.box).toEqual(where)
    expect(guideSeen('tag-hold')).toBe(true)
  })

  it('not while a finger is down, and not as it lets go, but a settle later', async () => {
    await render(<Screen />)
    await happen(() => setFingers(1))
    await wait(2000)
    expect(shown()).toBe(false)
    // The finger that was holding lets go: that release must not land on it.
    await happen(() => setFingers(0))
    expect(shown()).toBe(false)
    await wait(300)
    expect(shown()).toBe(false)
    await wait(500)
    expect(shown()).toBe(true)
  })

  it('not while a row is held or carried, though React has lost the touch', async () => {
    await render(<Screen />)
    await wait(500)
    await happen(() => holdGuides('row', true))
    await wait(2000)
    expect(shown()).toBe(false)
    await happen(() => holdGuides('row', false))
    await wait(800)
    expect(shown()).toBe(true)
  })

  it('not while a field has the keys', async () => {
    await render(<Screen />)
    await happen(() => setTyping(true))
    await wait(5000)
    expect(shown()).toBe(false)
    expect(guideSeen('tag-hold')).toBe(false)
    await happen(() => setTyping(false))
    await wait(800)
    expect(shown()).toBe(true)
  })

  it('not over a menu or an editor opened on its screen', async () => {
    await render(<Screen />)
    await happen(() => openLayer('menu'))
    await wait(3000)
    expect(shown()).toBe(false)
    await happen(() => closeLayer('menu'))
    await wait(800)
    expect(shown()).toBe(true)
  })

  it('over the layer its own screen is drawn in, but not one opened over that', async () => {
    await happen(() => openLayer('sheet'))
    await render(<Screen layers={1} />)
    await happen(() => openLayer('menu'))
    await wait(3000)
    expect(shown()).toBe(false)
    await happen(() => closeLayer('menu'))
    await wait(800)
    expect(shown()).toBe(true)
    await happen(() => closeLayer('sheet'))
  })
})

describe('a guide that is up', () => {
  const up = async (): Promise<void> => {
    await render(<Screen />)
    await wait(800)
    expect(shown()).toBe(true)
  }

  it('stays closed once its last step is passed, however often it is tapped', async () => {
    await up()
    await happen(() => handle?.next(2))
    expect(handle?.step).toBe(1)
    await happen(() => handle?.next(2))
    expect(shown()).toBe(false)
    // A second tap as it fades out began the guide again.
    await happen(() => handle?.next(2))
    await happen(() => handle?.next(2))
    expect(shown()).toBe(false)
    expect(handle?.step).toBe(-1)
  })

  it('follows what it lights when that moves or grows', async () => {
    await up()
    where = { x: 0, y: 130, width: 390, height: 120 }
    await wait(400)
    expect(handle?.box).toEqual(where)
  })

  it('goes when another page opens over its own', async () => {
    const { rerender } = await render(<Screen />)
    await wait(800)
    expect(shown()).toBe(true)
    mockPathname = '/search'
    await rerender(<Screen />)
    expect(shown()).toBe(false)
  })
})
