import { describe, expect, it } from 'vitest'
import { pillLabel } from './pill.js'

const state = (patch: Partial<Parameters<typeof pillLabel>[0]>) =>
  pillLabel({ state: 'idle', progress: null, jobId: null, message: null, ...patch })

describe('what the pill says', () => {
  it('offers itself, then counts, then says it landed', () => {
    expect(state({}).text).toBe('self.mp3')
    expect(state({ state: 'importing', progress: 40 }).text).toBe('Importing 40%')
    expect(state({ state: 'importing', progress: null }).text).toBe('Importing')
    expect(state({ state: 'added', jobId: 'j1' }).text).toBe('Added')
  })

  it('is pressable only when there is something to do', () => {
    expect(state({}).busy).toBe(false)
    expect(state({ state: 'failed' }).busy).toBe(false)
    for (const done of ['have', 'importing', 'added'] as const) {
      expect(state({ state: done }).busy, done).toBe(true)
    }
  })

  it('says a song is already yours without offering to import it again', () => {
    const have = state({ state: 'have' })
    expect(have.text).toBe('In library')
    expect(have.busy).toBe(true)
  })

  it('shows the server’s own reason for a failure', () => {
    expect(state({ state: 'failed', message: 'Video unavailable' }).text).toBe('Video unavailable')
    expect(state({ state: 'failed' }).text).toBe('Could not import')
  })
})
