import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { parseSecrets, secretStore, serialiseSecrets } from './secrets.js'

const userData = vi.hoisted(() => ({ dir: '' }))

vi.mock('electron', () => ({
  app: { getPath: () => userData.dir },
  safeStorage: { isEncryptionAvailable: () => false },
}))

describe('the secrets document', () => {
  it('round-trips', () => {
    const secrets = { 'cloud.session': 'k:c2VhbGVk', 'server.token': 'p:YWxzbw==' }
    expect(parseSecrets(serialiseSecrets(secrets))).toEqual(secrets)
  })

  it('sorts, so a write does not churn the file', () => {
    expect(serialiseSecrets({ b: 'k:2', a: 'k:1' })).toBe(serialiseSecrets({ a: 'k:1', b: 'k:2' }))
  })

  it('reads a half-written file as empty rather than throwing', () => {
    expect(parseSecrets('{"a": "b"')).toEqual({})
    expect(parseSecrets('')).toEqual({})
  })

  it('ignores anything that is not a sealed string', () => {
    expect(parseSecrets('{"a": 1, "b": null, "c": {"d": 1}, "ok": "k:x"}')).toEqual({ ok: 'k:x' })
  })

  it('refuses a document that is not an object', () => {
    expect(parseSecrets('["a"]')).toEqual({})
    expect(parseSecrets('null')).toEqual({})
    expect(parseSecrets('"a string"')).toEqual({})
  })
})

describe('the secrets file', () => {
  it('is not written over when it is there and cannot be read', () => {
    userData.dir = mkdtempSync(join(tmpdir(), 'selfmp3-secrets-'))
    const path = join(userData.dir, 'secrets.json')
    writeFileSync(path, serialiseSecrets({ 'cloud.session': 'p:a2VwdA==' }))
    chmodSync(path, 0o000)
    try {
      expect(() => secretStore.set('server.token', 'new')).toThrow()
    } finally {
      chmodSync(path, 0o600)
    }
    expect(parseSecrets(readFileSync(path, 'utf8'))).toEqual({ 'cloud.session': 'p:a2VwdA==' })
    // Readable again, it is read rather than remembered as empty.
    expect(secretStore.get('cloud.session')).toBe('kept')
  })
})
