import { describe, expect, it } from 'vitest'
import { answer, BridgeRequestSchema, PageRequestSchema, REPLIES, type Handlers } from './bridge.js'

describe('the bridge', () => {
  it('has a reply schema for every request, and no other', () => {
    const types = BridgeRequestSchema.options.map(option => option.shape.type.value)
    expect(Object.keys(REPLIES).sort()).toEqual([...types].sort())
  })

  it('refuses a request it does not know, or one that is not whole', () => {
    expect(BridgeRequestSchema.safeParse({ type: 'eval', code: '1' }).success).toBe(false)
    expect(BridgeRequestSchema.safeParse({ type: 'enqueue', request: { items: [] } }).success).toBe(
      false,
    )
    expect(BridgeRequestSchema.safeParse({ type: 'cancel' }).success).toBe(false)
  })

  it('lets a page ask about videos by id, and nothing that is not one', () => {
    const owned = (videoIds: unknown) => PageRequestSchema.safeParse({ type: 'owned', videoIds })
    expect(owned(['ZRtdQ81jPUQ', '-7HvsNTYBqA']).success).toBe(true)
    expect(owned(['https://www.youtube.com/watch?v=ZRtdQ81jPUQ']).success).toBe(false)
    expect(owned(Array.from({ length: 501 }, () => 'ZRtdQ81jPUQ')).success).toBe(false)
  })

  it('hands each request to its own handler', async () => {
    const handlers = Object.fromEntries(
      Object.keys(REPLIES).map(type => [
        type,
        (request: { type: string }) => Promise.resolve(request.type),
      ]),
    ) as unknown as Handlers
    expect(await answer(handlers, { type: 'queue' })).toBe('queue')
    expect(await answer(handlers, { type: 'cancel', id: 'j1' })).toBe('cancel')
  })
})
