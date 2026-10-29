import { describe, expect, it } from 'vitest'

import { shellFiles } from './shellFiles.mjs'

/*
 * What the service worker keeps at install. The bundle missing from it is the
 * blank page offline after a first visit; anything extra is a download every
 * deploy for nothing.
 */
describe('shellFiles', () => {
  it('keeps the bundle, the fonts and pictures it loads, and the icons', () => {
    expect(
      shellFiles([
        'index.html',
        '_expo/static/js/web/index-149153a4.js',
        'assets/__node_modules/@expo-google-fonts/instrument-serif/400Regular/InstrumentSerif_400Regular.ttf',
        'icons/icon.svg',
        'favicon.ico',
      ]),
    ).toEqual([
      '_expo/static/js/web/index-149153a4.js',
      'assets/__node_modules/@expo-google-fonts/instrument-serif/400Regular/InstrumentSerif_400Regular.ttf',
      'favicon.ico',
      'icons/icon.svg',
    ])
  })

  it('leaves out the plain pages, their fonts, the worker and the 404 copy', () => {
    expect(
      shellFiles([
        'privacy.html',
        'install/index.html',
        'bucket.html',
        'fonts/InstrumentSerif-Regular.ttf',
        'sw.js',
        '404.html',
        'metadata.json',
        'shell.json',
      ]),
    ).toEqual([])
  })

  it('leaves out source maps and dot files', () => {
    expect(
      shellFiles(['_expo/static/js/web/index-1.js.map', 'assets/.DS_Store', 'icons/icon-180.png']),
    ).toEqual(['icons/icon-180.png'])
  })

  it('writes Windows paths the way the web names them', () => {
    expect(shellFiles(['_expo\\static\\js\\web\\index-1.js'])).toEqual([
      '_expo/static/js/web/index-1.js',
    ])
  })
})
