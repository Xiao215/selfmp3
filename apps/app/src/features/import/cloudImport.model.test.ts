import { describe, expect, it } from 'vitest'
import {
  canCancelCloudImport,
  describeCloudImport,
  finishedCloudImports,
} from './cloudImport.model'

const now = new Date('2026-09-13T12:00:00Z')
const base = { songIds: [], error: null, requestedAt: '2026-09-13T11:55:00Z' }

describe('describeCloudImport', () => {
  it('says how long a waiting request has waited', () => {
    expect(describeCloudImport({ ...base, state: 'waiting' }, now)).toBe(
      'Waiting for your Mac · asked 5m ago',
    )
  })

  it('says the Mac is on it', () => {
    expect(describeCloudImport({ ...base, state: 'working' }, now)).toBe('Downloading on your Mac…')
  })

  it('counts what a finished request added', () => {
    expect(describeCloudImport({ ...base, state: 'done', songIds: [4] }, now)).toBe('Added 1 song')
    expect(describeCloudImport({ ...base, state: 'done', songIds: [4, 5] }, now)).toBe(
      'Added 2 songs',
    )
    expect(describeCloudImport({ ...base, state: 'done' }, now)).toBe('Already in your library')
  })

  it('gives the reason a request failed, or a general one', () => {
    expect(describeCloudImport({ ...base, state: 'failed', error: 'Private video' }, now)).toBe(
      'Couldn’t import it: Private video',
    )
    expect(describeCloudImport({ ...base, state: 'failed' }, now)).toBe(
      'Couldn’t import it: something went wrong',
    )
  })

  it('says a request was cancelled', () => {
    expect(describeCloudImport({ ...base, state: 'cancelled' }, now)).toBe('Cancelled')
  })
})

describe('canCancelCloudImport', () => {
  it('allows it only before the Mac has finished', () => {
    expect(canCancelCloudImport({ state: 'waiting' })).toBe(true)
    expect(canCancelCloudImport({ state: 'working' })).toBe(true)
    expect(canCancelCloudImport({ state: 'done' })).toBe(false)
    expect(canCancelCloudImport({ state: 'failed' })).toBe(false)
    expect(canCancelCloudImport({ state: 'cancelled' })).toBe(false)
  })
})

describe('finishedCloudImports', () => {
  it('counts the finished ones', () => {
    expect(finishedCloudImports([{ state: 'done' }, { state: 'waiting' }, { state: 'done' }])).toBe(2)
  })
})
