import { describe, expect, it } from 'vitest'

import { contentTypeFor, resolveWithinRoot } from './paths.js'

const ROOT = '/Applications/self.mp3.app/Contents/Resources/app/web'

describe('resolveWithinRoot', () => {
  it('resolves an ordinary asset', () => {
    expect(resolveWithinRoot(ROOT, '/_expo/static/js/web/index.js')).toBe(
      `${ROOT}/_expo/static/js/web/index.js`,
    )
  })

  it('decodes what the URL escaped', () => {
    expect(resolveWithinRoot(ROOT, '/assets/a%20song.png')).toBe(`${ROOT}/assets/a song.png`)
  })

  it('answers null for the root itself, which means index.html', () => {
    expect(resolveWithinRoot(ROOT, '/')).toBeNull()
    expect(resolveWithinRoot(ROOT, '')).toBeNull()
  })

  it('refuses to climb out of the web root', () => {
    expect(resolveWithinRoot(ROOT, '/../../../../etc/passwd')).toBeNull()
    expect(resolveWithinRoot(ROOT, '/assets/../../../secrets.json')).toBeNull()
  })

  it('refuses an escaped climb, which is the one that gets through', () => {
    expect(resolveWithinRoot(ROOT, '/%2e%2e/%2e%2e/etc/passwd')).toBeNull()
  })

  it('refuses a null byte, which truncates the path for the OS but not for us', () => {
    expect(resolveWithinRoot(ROOT, '/index.html%00.png')).toBeNull()
  })

  it('refuses a malformed escape rather than throwing', () => {
    expect(resolveWithinRoot(ROOT, '/%zz')).toBeNull()
  })

  it('does not mistake a sibling directory for the root', () => {
    expect(resolveWithinRoot('/app/web', '/../web-other/secret.txt')).toBeNull()
  })
})

describe('contentTypeFor', () => {
  it('knows the export\'s kinds', () => {
    expect(contentTypeFor('/index.html')).toBe('text/html; charset=utf-8')
    expect(contentTypeFor('/_expo/static/js/web/index-abc.js')).toBe(
      'text/javascript; charset=utf-8',
    )
    expect(contentTypeFor('/manifest.webmanifest')).toBe('application/manifest+json; charset=utf-8')
  })

  it('knows what the library holds', () => {
    expect(contentTypeFor('/songs/1.m4a')).toBe('audio/mp4')
    expect(contentTypeFor('/songs/1.MP3')).toBe('audio/mpeg')
  })

  it('serves anything else as bytes rather than guessing', () => {
    expect(contentTypeFor('/whatever')).toBe('application/octet-stream')
    expect(contentTypeFor('/thing.wat')).toBe('application/octet-stream')
  })
})
