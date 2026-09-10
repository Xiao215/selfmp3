import { describe, expect, it } from 'vitest'
import { ImportEnqueueSchema, ImportShareRequestSchema } from './import.js'

describe('ImportShareRequestSchema', () => {
  it('accepts a bare url and fills the defaults', () => {
    const parsed = ImportShareRequestSchema.parse({ url: ' https://youtu.be/x ' })
    expect(parsed).toEqual({ url: 'https://youtu.be/x', tagIds: [], createPlaylist: false })
  })

  it('accepts tags and the create-playlist flag', () => {
    const parsed = ImportShareRequestSchema.parse({
      url: 'https://music.youtube.com/playlist?list=LM',
      tagIds: [1, 2],
      createPlaylist: true,
    })
    expect(parsed.tagIds).toEqual([1, 2])
    expect(parsed.createPlaylist).toBe(true)
  })

  it('rejects an empty or missing url and bad tag ids', () => {
    expect(ImportShareRequestSchema.safeParse({}).success).toBe(false)
    expect(ImportShareRequestSchema.safeParse({ url: '   ' }).success).toBe(false)
    expect(ImportShareRequestSchema.safeParse({ url: 'https://x.y', tagIds: ['a'] }).success).toBe(
      false,
    )
    expect(ImportShareRequestSchema.safeParse({ url: 'https://x.y', tagIds: [0] }).success).toBe(
      false,
    )
  })
})

describe('ImportEnqueueSchema createPlaylistName', () => {
  it('defaults to null and trims', () => {
    const base = { items: [{ url: 'https://x.y/z' }] }
    expect(ImportEnqueueSchema.parse(base).createPlaylistName).toBeNull()
    expect(
      ImportEnqueueSchema.parse({ ...base, createPlaylistName: '  Liked Music ' })
        .createPlaylistName,
    ).toBe('Liked Music')
    expect(ImportEnqueueSchema.safeParse({ ...base, createPlaylistName: '' }).success).toBe(false)
  })
})
