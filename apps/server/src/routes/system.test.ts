import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SettingsSchema } from '@selfmp3/shared'
import type { Container } from '../container.js'
import { startLibrary, type TestLibrary } from '../fixtures/library.js'

/**
 * Settings through the real app and a real database: a change takes hold at
 * once, without a restart, and a value out of range changes nothing.
 * (`/api/health` and who hears what of it is `http/auth.test.ts`.)
 */
describe('PATCH /api/settings', () => {
  let library: TestLibrary
  let container: Container

  beforeAll(async () => {
    library = await startLibrary()
    container = library.container
  })

  afterAll(() => library.close())

  it('keeps the change, and has the queue and the folder watch take it up now', async () => {
    const kick = vi.spyOn(container.importQueue, 'kick')
    const apply = vi.spyOn(container.libraryWatcher, 'apply')
    try {
      const response = await library.send('PATCH', '/api/settings', { smartFeatures: false })

      expect(response.status).toBe(200)
      expect(SettingsSchema.parse(await response.json()).smartFeatures).toBe(false)
      const reread = SettingsSchema.parse(await (await library.send('GET', '/api/settings')).json())
      expect(reread.smartFeatures).toBe(false)
      expect(kick).toHaveBeenCalledOnce()
      expect(apply).toHaveBeenCalledOnce()
    } finally {
      kick.mockRestore()
      apply.mockRestore()
    }
  })

  it('refuses a value out of range, or no setting it knows, and changes nothing', async () => {
    const before = container.settings.get()
    for (const patch of [{ importConcurrency: 9 }, { noSuchSetting: true }]) {
      const response = await library.send('PATCH', '/api/settings', patch)
      expect(response.status, JSON.stringify(patch)).toBe(400)
    }
    expect(container.settings.get()).toEqual(before)
  })
})
