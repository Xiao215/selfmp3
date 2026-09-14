import { describe, expect, it } from 'vitest'

import { parseSecrets, serialiseSecrets } from './secrets.js'

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
