import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { NOT_THE_API, PUBLIC_DIR } from './admin.js'

/**
 * The admin page is mounted last and catches every path the API did not, so
 * the two things worth pinning down are that it cannot swallow an API path and
 * that the files it serves are actually there. Both fail silently otherwise:
 * the first as HTML where a client expected JSON, the second as a blank page.
 */

describe('the page answers everything but the API', () => {
  it.each(['/', '/settings', '/library', '/apiary', '/api', '/anything/deep'])(
    'answers %s',
    path => {
      expect(NOT_THE_API.test(path)).toBe(true)
    },
  )

  it.each(['/api/', '/api/cloud', '/api/health', '/api/import/queue'])('leaves %s alone', path => {
    expect(NOT_THE_API.test(path)).toBe(false)
  })
})

describe('the files it serves', () => {
  it.each(['admin.html', 'admin.css', 'admin.js'])('ships %s', name => {
    expect(fs.existsSync(path.join(PUBLIC_DIR, name))).toBe(true)
  })

  it('serves a page that asks for both of the others', () => {
    const html = fs.readFileSync(path.join(PUBLIC_DIR, 'admin.html'), 'utf8')
    expect(html).toContain('/admin.css')
    expect(html).toContain('/admin.js')
  })
})
