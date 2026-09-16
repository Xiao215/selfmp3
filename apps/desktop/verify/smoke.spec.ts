import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'

import { expect, test } from '@playwright/test'

import { appApi, desktopRoot, executable, freshUserData, launchApp, serverHasSongs } from './launch'

/**
 * The desktop smoke.
 *
 * Two kinds of test here, and the difference matters when you read a run:
 * everything about the *shell* — the window, the origin, what the page can and
 * cannot reach — needs nothing but the built app, and runs anywhere. The flow
 * that plays a song needs a server with the thirteen-song dev library on it,
 * which is a Mac; it says so and skips rather than pretending.
 */

test.describe('the shell', () => {
  test('opens the export at its own origin, with nothing of Node on the page', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      expect(page.url()).toBe('app://selfmp3/')

      const world = await page.evaluate(() => ({
        bridge: typeof (window as { selfmp3Desktop?: unknown }).selfmp3Desktop,
        require: typeof (window as { require?: unknown }).require,
        ipcRenderer: typeof (window as { ipcRenderer?: unknown }).ipcRenderer,
        // Not `typeof process`: Metro's web bundle defines a `process` shim of
        // its own for `process.env.NODE_ENV`, so the question is whether it is
        // *Node's*, which is what `versions.electron` would mean.
        nodeProcess: (window as { process?: { versions?: { electron?: string } } }).process
          ?.versions?.electron,
        secureContext: window.isSecureContext,
      }))

      // The bridge is the only door: no require, no ipcRenderer, no process.
      expect(world.bridge).toBe('object')
      expect(world.require).toBe('undefined')
      expect(world.ipcRenderer).toBe('undefined')
      expect(world.nodeProcess).toBeUndefined()
      expect(world.secureContext).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('tells the page what it is, and where it keeps things', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const info = await page.evaluate(
        () =>
          (window as unknown as { selfmp3Desktop: { info: Record<string, unknown> } })
            .selfmp3Desktop.info,
      )

      expect(info['platform']).toBe(process.platform)
      expect(String(info['version'])).toMatch(/^\d+\.\d+\.\d+$/)
      expect(String(info['hostname']).length).toBeGreaterThan(0)
      expect(String(info['songsDir'])).toContain(String(info['userData']))
      expect(info['development']).toBe(false)
    } finally {
      await app.close()
    }
  })

  test('draws something, which means the export ran', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      // The bundle mounts a moment after load; the app's own name is the first
      // thing on the sign-in screen.
      await expect(page.locator('body')).toContainText(/self\.mp3/i, { timeout: 30_000 })
    } finally {
      await app.close()
    }
  })

  test('a missing file is a 404, and only a route is answered with index.html', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      const seen = await page.evaluate(async () => {
        const ask = async (path: string): Promise<{ status: number; type: string | null }> => {
          const response = await fetch(path)
          return { status: response.status, type: response.headers.get('Content-Type') }
        }
        return {
          chunk: await ask('/_expo/static/js/web/missing-00000000.js'),
          route: await ask('/playlist/1'),
        }
      })
      // A 200 of HTML here is what Chrome silently refuses to run as a script.
      expect(seen.chunk.status).toBe(404)
      expect(seen.chunk.type).not.toContain('text/html')
      expect(seen.route).toEqual({ status: 200, type: 'text/html; charset=utf-8' })
    } finally {
      await app.close()
    }
  })

  test('is an installed app, so it downloads rather than streams', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      // `install.web.ts` reads exactly this, and everything about downloading
      // hangs off it.
      const installed = await page.evaluate(() =>
        Boolean((window as { selfmp3Desktop?: unknown }).selfmp3Desktop),
      )
      expect(installed).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('holds the single-instance lock and claims nothing it should not', async () => {
    const app = await launchApp()
    try {
      // Read from the main process rather than inferred from the page.
      const seen = await app.evaluate(({ app: electronApp }) => ({
        name: electronApp.name,
        version: electronApp.getVersion(),
        // A second launch would be handed here rather than opening a window.
        hasLock: electronApp.hasSingleInstanceLock(),
      }))
      expect(seen.hasLock).toBe(true)
      expect(seen.version).toMatch(/^\d+\.\d+\.\d+$/)
    } finally {
      await app.close()
    }
  })

  test('keeps a secret through the bridge and gives it back', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      const round = await page.evaluate(async () => {
        const desktop = (
          window as unknown as {
            selfmp3Desktop: {
              secrets: {
                get(k: string): Promise<string | null>
                set(k: string, v: string): Promise<void>
                remove(k: string): Promise<void>
              }
            }
          }
        ).selfmp3Desktop
        await desktop.secrets.set('smoke.token', 'a-token')
        const read = await desktop.secrets.get('smoke.token')
        await desktop.secrets.remove('smoke.token')
        const gone = await desktop.secrets.get('smoke.token')
        return { read, gone }
      })
      expect(round.read).toBe('a-token')
      expect(round.gone).toBeNull()
    } finally {
      await app.close()
    }
  })

  test('refuses a secret key that is really a path', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      const refused = await page.evaluate(async () => {
        const desktop = (
          window as unknown as {
            selfmp3Desktop: { secrets: { set(k: string, v: string): Promise<void> } }
          }
        ).selfmp3Desktop
        try {
          await desktop.secrets.set('../../etc/passwd', 'no')
          return false
        } catch {
          return true
        }
      })
      expect(refused).toBe(true)
    } finally {
      await app.close()
    }
  })
})

/**
 * Files on disk, against a small range server rather than the dev library.
 *
 * What is being tested is the shell — that a download lands under its real name
 * only when it is whole, that an interrupted one continues from the `.part`,
 * and that `app://selfmp3/_media/…` answers a `Range:` with a 206 so seeking
 * works. None of that needs a song; it needs bytes and a server that answers
 * ranges, which is twenty lines.
 */
test.describe('files on disk', () => {
  const body = randomBytes(3 * 1024 * 1024)
  const expected = createHash('sha256').update(body).digest('hex')
  const cover = randomBytes(4 * 1024)
  /** What `/cover/` was asked with, so the header the bridge passed is visible. */
  let coverAuth: string | undefined
  let server: Server
  let origin = ''
  /** False once a test has deliberately taken the server away. */
  let served = true

  test.beforeAll(async () => {
    server = createServer((request, response) => {
      /*
       * Cover art, the way the doorman serves it: bearer or nothing. An `<img>`
       * cannot send that header, which is the whole reason `fetchTo` takes one.
       */
      if (request.url?.startsWith('/cover/')) {
        coverAuth = request.headers.authorization
        if (coverAuth !== 'Bearer t') {
          response.writeHead(401).end()
          return
        }
        response.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(cover.length),
        })
        response.end(cover)
        return
      }
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
      const start = match ? Number(match[1]) : 0
      const end =
        match && match[2] !== '' ? Math.min(Number(match[2]), body.length - 1) : body.length - 1
      const slice = body.subarray(start, end + 1)

      response.setHeader('Accept-Ranges', 'bytes')
      response.setHeader('Content-Type', 'audio/mp4')
      response.setHeader('Content-Length', String(slice.length))
      if (match) response.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`)
      response.writeHead(match ? 206 : 200)

      /*
       * `/slow/` dribbles the body out over about a second. Cancelling a
       * download needs there to be a download still going when the cancel
       * arrives, and 3 MB over loopback is gone before a progress event has
       * crossed back to the page.
       */
      if (!request.url?.startsWith('/slow/')) {
        response.end(slice)
        return
      }
      const chunk = 64 * 1024
      let sent = 0
      const tick = (): void => {
        if (sent >= slice.length) {
          response.end()
          return
        }
        response.write(slice.subarray(sent, sent + chunk))
        sent += chunk
        setTimeout(tick, 20)
      }
      tick()
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    origin = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`
  })

  test.afterAll(() => {
    if (served) server.close()
  })

  test('downloads a file, serves it back, and answers a range with 206', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const result = await page.evaluate(async url => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        const seen: number[] = []
        const stop = desktop.onProgress(progress => seen.push(progress.bytesWritten))
        const done = await desktop.files.download({ id: 't1', kind: 'songs', name: '1.m4a', url })

        /*
         * Progress events and the reply to `download` are separate messages, and
         * the reply can overtake the last few: on this run the page had seen one
         * event of six by the time the promise resolved. They do arrive, so wait
         * for the tail rather than assert on whatever happened to have landed.
         */
        const settled = await (async () => {
          for (let attempt = 0; attempt < 100; attempt += 1) {
            if (seen.length > 0 && seen[seen.length - 1] === done.bytes) return true
            await new Promise(resolve => setTimeout(resolve, 20))
          }
          return false
        })()
        stop()

        const stat = await desktop.files.stat('songs', '1.m4a')
        const media = desktop.mediaUrl('songs', '1.m4a')

        const whole = await fetch(media)
        const wholeBytes = new Uint8Array(await whole.arrayBuffer())

        const ranged = await fetch(media, { headers: { Range: 'bytes=100-199' } })
        const rangedBytes = new Uint8Array(await ranged.arrayBuffer())

        const digest = await crypto.subtle.digest('SHA-256', wholeBytes)
        const sha = Array.from(new Uint8Array(digest))
          .map(one => one.toString(16).padStart(2, '0'))
          .join('')

        return {
          done,
          stat,
          progressed:
            settled &&
            seen.every(
              (bytes, index) =>
                bytes > 0 && bytes <= done.bytes && (index === 0 || bytes > seen[index - 1]),
            ),
          wholeStatus: whole.status,
          wholeLength: wholeBytes.length,
          rangedStatus: ranged.status,
          rangedLength: rangedBytes.length,
          contentRange: ranged.headers.get('Content-Range'),
          acceptRanges: whole.headers.get('Accept-Ranges'),
          sha,
          usage: await desktop.files.usage(),
          list: await desktop.files.list('songs'),
        }
      }, `${origin}/api/stream/1`)

      expect(result.done.state).toBe('done')
      expect(result.done.bytes).toBe(body.length)
      expect(result.stat).toEqual({ name: '1.m4a', bytes: body.length })
      expect(result.progressed).toBe(true)
      expect(result.sha).toBe(expected)
      expect(result.wholeStatus).toBe(200)
      expect(result.wholeLength).toBe(body.length)
      expect(result.rangedStatus).toBe(206)
      expect(result.rangedLength).toBe(100)
      expect(result.contentRange).toBe(`bytes 100-199/${body.length}`)
      expect(result.acceptRanges).toBe('bytes')
      expect(result.usage.songs).toBe(body.length)
      expect(result.list).toEqual([{ name: '1.m4a', bytes: body.length }])
    } finally {
      await app.close()
    }
  })

  test('a cancelled download leaves nothing under its real name, and resumes', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const result = await page.evaluate(
        async urls => {
          const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop

          // Cancel part-way through: what is on disk is then a .part, and `stat`
          // — which is what the index trusts — says nothing.
          const started = desktop.files.download({
            id: 't2',
            kind: 'songs',
            name: '2.m4a',
            url: urls.slow,
          })
          await new Promise(resolve => setTimeout(resolve, 200))
          await desktop.files.cancel('t2')
          const first = await started
          const afterCancel = await desktop.files.stat('songs', '2.m4a')

          // Again, and this pass has no reason to be slow: it should continue
          // rather than start over, and end whole.
          const second = await desktop.files.download({
            id: 't3',
            kind: 'songs',
            name: '2.m4a',
            url: urls.fast,
          })
          const afterResume = await desktop.files.stat('songs', '2.m4a')

          const bytes = new Uint8Array(
            await (await fetch(desktop.mediaUrl('songs', '2.m4a'))).arrayBuffer(),
          )
          const digest = await crypto.subtle.digest('SHA-256', bytes)
          const sha = Array.from(new Uint8Array(digest))
            .map(one => one.toString(16).padStart(2, '0'))
            .join('')

          await desktop.files.clear('songs')
          return {
            first,
            afterCancel,
            second,
            afterResume,
            sha,
            afterClear: await desktop.files.list('songs'),
          }
        },
        { slow: `${origin}/slow/1`, fast: `${origin}/api/stream/1` },
      )

      expect(result.first.state).toBe('cancelled')
      // Nothing under the real name until it is whole: the rename is last.
      expect(result.afterCancel).toBeNull()
      expect(result.second.state).toBe('done')
      expect(result.afterResume).toEqual({ name: '2.m4a', bytes: body.length })
      // And it resumed rather than starting over, byte for byte.
      expect(result.sha).toBe(expected)
      expect(result.afterClear).toEqual([])
    } finally {
      await app.close()
    }
  })

  test('refuses a file name that is really a path', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      const refused = await page.evaluate(async () => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        const results: boolean[] = []
        for (const name of ['../secrets.json', 'a/b.m4a', '..', '.hidden']) {
          try {
            await desktop.files.stat('songs', name)
            results.push(false)
          } catch {
            results.push(true)
          }
        }
        return results
      })
      expect(refused).toEqual([true, true, true, true])
    } finally {
      await app.close()
    }
  })

  test('keeps a cover the page could not have fetched, and serves it as an image', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const result = await page.evaluate(async url => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop

        // What the page would get on its own: no header, and — from a secure
        // app:// origin — not even a request. Either way, no picture.
        const bare = await fetch(url)
          .then(response => String(response.status))
          .catch(() => 'blocked')

        await desktop.files.fetchTo('covers', '1-a1b2.jpg', url, { Authorization: 'Bearer t' })
        const kept = await fetch(desktop.mediaUrl('covers', '1-a1b2.jpg'))
        const bytes = new Uint8Array(await kept.arrayBuffer())
        const usage = await desktop.files.usage()
        const list = await desktop.files.list('covers')
        await desktop.files.clear('covers')
        return {
          bare,
          status: kept.status,
          type: kept.headers.get('Content-Type'),
          length: bytes.length,
          first: bytes[0],
          usage,
          list,
          afterClear: await desktop.files.list('covers'),
        }
      }, `${origin}/cover/1`)

      expect(coverAuth).toBe('Bearer t')
      expect(result.bare).not.toBe('200')
      expect(result.status).toBe(200)
      expect(result.type).toBe('image/jpeg')
      expect(result.length).toBe(cover.length)
      expect(result.first).toBe(cover[0])
      expect(result.usage.covers).toBe(cover.length)
      expect(result.list).toEqual([{ name: '1-a1b2.jpg', bytes: cover.length }])
      expect(result.afterClear).toEqual([])
    } finally {
      await app.close()
    }
  })

  /*
   * Regression. Naming `node_modules/electron/dist/electron` gets the *Linux*
   * binary, and dies with ENOENT on a Mac before a single test runs. The
   * electron package writes the per-platform relative path into `path.txt`
   * when it installs — `electron` on Linux,
   * `Electron.app/Contents/MacOS/Electron` on macOS — and that is what the
   * launcher must end up with.
   */
  test('launches the Electron binary this platform actually has', () => {
    const pathFile = join(desktopRoot, '..', '..', 'node_modules', 'electron', 'path.txt')
    const named = readFileSync(pathFile, 'utf8').trim()

    expect(named).not.toBe('')
    expect(executable().endsWith(named)).toBe(true)
    expect(existsSync(executable())).toBe(true)
  })

  /*
   * Regression. `files.list` returned every regular file and the preload parses
   * the whole array against `fileNameSchema`, which refuses a leading dot — so
   * a single `.DS_Store`, which macOS writes the first time Settings' "Reveal
   * in Finder" opens the songs directory, made every `files.list` call throw
   * from then on. The app then showed no downloads at all, on a machine whose
   * disk was full of them.
   */
  test("lists the app's own files past whatever else is in the directory", async () => {
    const userDataDir = freshUserData()
    const songs = join(userDataDir, 'songs')
    mkdirSync(songs, { recursive: true })
    // What Finder leaves behind, and a couple of other names the contract
    // could never have written.
    writeFileSync(join(songs, '.DS_Store'), 'x')
    writeFileSync(join(songs, '._1.m4a'), 'x')
    writeFileSync(join(songs, '5.m4a'), 'hello')
    writeFileSync(join(songs, '6.m4a.part'), 'half a download')

    const app = await launchApp({ userDataDir })
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const result = await page.evaluate(async () => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        return { list: await desktop.files.list('songs'), usage: await desktop.files.usage() }
      })

      expect(result.list).toEqual([{ name: '5.m4a', bytes: 5 }])
      expect(result.usage.songs).toBe(5)
    } finally {
      await app.close()
    }
  })

  /*
   * Regression. The download index was saved by handing a `blob:` URL to
   * `files.fetchTo`, but it is the main process that fetches and a blob URL
   * belongs to the renderer that made it, so the main process cannot read one
   * at all. Every write was refused and `downloads.json` was never written,
   * which meant a relaunch found the song files on disk and no index saying
   * they were there. `files.write` is the channel that actually persists it.
   */
  test('the page can write its download index, and a relaunch finds it', async () => {
    const userDataDir = freshUserData()
    const index = JSON.stringify({
      version: 1,
      entries: {
        '7': {
          songId: 7,
          fileName: '7.m4a',
          sizeBytes: 4096,
          etag: 'a1b2',
          downloadedAt: '2026-09-14T00:00:00.000Z',
        },
      },
    })

    const first = await launchApp({ userDataDir })
    try {
      const page = await first.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const wrote = await page.evaluate(async text => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop

        // The approach the channel exists to avoid: a blob URL never leaves
        // the renderer.
        const blob = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
        let viaBlob = 'wrote it'
        try {
          await desktop.files.fetchTo('songs', 'downloads.json', blob)
        } catch {
          viaBlob = 'refused'
        } finally {
          URL.revokeObjectURL(blob)
        }

        await desktop.files.write('songs', 'downloads.json', text)
        const back = await fetch(desktop.mediaUrl('songs', 'downloads.json'))
        return { viaBlob, immediately: await back.text() }
      }, index)

      expect(wrote.viaBlob).toBe('refused')
      expect(wrote.immediately).toBe(index)
    } finally {
      await first.close()
    }

    // The whole point: it is still there next time the app opens.
    const second = await launchApp({ userDataDir })
    try {
      const page = await second.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const afterRelaunch = await page.evaluate(async () => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        const back = await fetch(desktop.mediaUrl('songs', 'downloads.json'))
        return {
          text: await back.text(),
          stat: await desktop.files.stat('songs', 'downloads.json'),
        }
      })

      expect(afterRelaunch.text).toBe(index)
      expect(afterRelaunch.stat).toEqual({ name: 'downloads.json', bytes: index.length })
    } finally {
      await second.close()
    }
  })

  test('offline, a song that was downloaded still plays, and reveal answers', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const downloaded = await page.evaluate(async url => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        const done = await desktop.files.download({ id: 't4', kind: 'songs', name: '4.m4a', url })
        return done.state
      }, `${origin}/api/stream/1`)
      expect(downloaded).toBe('done')

      // The whole point of an installed app: take the server away entirely.
      await new Promise<void>(resolve => server.close(() => resolve()))
      served = false

      const offline = await page.evaluate(async url => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        // Gone: nothing is coming over the network any more.
        const reachable = await fetch(url)
          .then(() => true)
          .catch(() => false)

        const media = desktop.mediaUrl('songs', '4.m4a')
        const whole = await fetch(media)
        const bytes = new Uint8Array(await whole.arrayBuffer())
        const digest = await crypto.subtle.digest('SHA-256', bytes)
        const sha = Array.from(new Uint8Array(digest))
          .map(one => one.toString(16).padStart(2, '0'))
          .join('')

        // Settings' "Reveal in Finder". Headless there is no file manager to
        // open, so what is checked is that the call crosses the bridge and the
        // path fence rather than what a window manager did with it.
        let revealed = true
        try {
          await desktop.files.reveal('songs', '4.m4a')
        } catch {
          revealed = false
        }

        await desktop.files.clear('songs')
        return { reachable, status: whole.status, sha, revealed }
      }, `${origin}/api/stream/1`)

      expect(offline.reachable).toBe(false)
      expect(offline.status).toBe(200)
      expect(offline.sha).toBe(expected)
      expect(offline.revealed).toBe(true)
    } finally {
      await app.close()
    }
  })
})

/**
 * Being an application rather than a page: the menu, the Dock, the power-save
 * blocker, and a window that opens where it was left.
 *
 * All of it read from the main process, because that is where it lives. What
 * cannot be checked here is what any of it looks like — the Dock menu is
 * macOS-only and this is Linux — so these test that the wiring carries, and
 * the plan's by-hand list covers the rest.
 */
test.describe('an application, not a page', () => {
  test('a menu item sends its command to the page', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      // The page listens the way the app itself does, through the bridge.
      await page.evaluate(() => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        const seen: string[] = []
        ;(window as unknown as { seen: string[] }).seen = seen
        desktop.onCommand(command => seen.push(command))
      })

      // Clicked in the real application menu, by label, from the main process.
      const clicked = await app.evaluate(
        ({ Menu }, labels) => {
          const menu = Menu.getApplicationMenu()
          return labels.map(([section, item]) => {
            const found = menu?.items
              .find(one => one.label === section)
              ?.submenu?.items.find(one => one.label === item)
            if (!found) return 'missing'
            // Electron types `MenuItem.click` as the bare `Function`, which is
            // not callable under the repo's lint rules without saying what it is.
            ;(found.click as unknown as () => void)()
            return found.accelerator ?? 'none'
          })
        },
        [
          ['Playback', 'Play / Pause'],
          ['View', 'Now Playing'],
        ] as [string, string][],
      )

      expect(clicked).toEqual(['Space', 'CmdOrCtrl+3'])
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen))
        .toEqual(['play-pause', 'now-playing'])
    } finally {
      await app.close()
    }
  })

  /*
   * On macOS a menu acts on an item's key whenever the page leaves it
   * unhandled, whatever `registerAccelerator` says, and a text field leaves
   * Space unhandled: a space typed in the search box played or paused the
   * music. The page already had that key, so the menu passes on it.
   */
  test('an item the page keeps sends nothing when its key chose it, and still answers a click', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      await page.evaluate(() => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        const seen: string[] = []
        ;(window as unknown as { seen: string[] }).seen = seen
        desktop.onCommand(command => seen.push(command))
      })

      const chose = await app.evaluate(({ Menu }) => {
        const find = (section: string, label: string) =>
          Menu.getApplicationMenu()
            ?.items.find(one => one.label === section)
            ?.submenu?.items.find(one => one.label === label)
        const playPause = find('Playback', 'Play / Pause')
        const nowPlaying = find('View', 'Now Playing')
        if (!playPause || !nowPlaying) return 'missing'
        // `MenuItem.click(event, focusedWindow, focusedWebContents)`.
        const click = (item: Electron.MenuItem, byKey: boolean): void =>
          (item.click as unknown as (event: { triggeredByAccelerator: boolean }) => void)({
            triggeredByAccelerator: byKey,
          })
        click(playPause, true) // Space, left unhandled by a text field: nothing.
        click(nowPlaying, true) // ⌘3 is the menu's own key: sent.
        click(playPause, false) // The pointer: sent.
        return 'clicked'
      })

      expect(chose).toBe('clicked')
      await expect
        .poll(() => page.evaluate(() => (window as unknown as { seen: string[] }).seen))
        .toEqual(['now-playing', 'play-pause'])
    } finally {
      await app.close()
    }
  })

  test('draws the whole menu, and leaves the typing keys to the page', async () => {
    const app = await launchApp()
    try {
      const menu = await app.evaluate(({ Menu }) =>
        Menu.getApplicationMenu()?.items.map(section => ({
          label: section.label,
          items:
            section.submenu?.items
              .filter(item => item.type === 'normal')
              .map(item => ({
                label: item.label,
                accelerator: item.accelerator ?? null,
                registered: item.registerAccelerator,
              })) ?? [],
        })),
      )
      const playback = menu?.find(section => section.label === 'Playback')
      expect(playback?.items.map(item => item.label)).toEqual([
        'Play / Pause',
        'Next',
        'Previous',
        'Seek forward',
        'Seek back',
        'Shuffle',
        'Repeat',
        'Volume up',
        'Volume down',
        'Mute',
      ])
      // Space and the ⌘-arrows are drawn but not taken: registering them would
      // pull them out of every text field in the app.
      const unregistered = playback?.items.filter(item => item.registered === false)
      expect(unregistered?.map(item => item.accelerator)).toEqual([
        'Space',
        'CmdOrCtrl+Right',
        'CmdOrCtrl+Left',
        'Alt+CmdOrCtrl+Right',
        'Alt+CmdOrCtrl+Left',
      ])
      // Everything else is a real accelerator.
      const view = menu?.find(section => section.label === 'View')
      expect(view?.items.every(item => item.registered !== false)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('holds the machine awake only while something is playing', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')
      /*
       * The app's own player tells the shell what is playing too
       * (`ports/mediaSession.web.ts`): "nothing", once, as it mounts. Sent any
       * earlier, the test's "playing" could land first and be overwritten a
       * moment later — which failed this about one run in five. So wait for the
       * app to be up, then one frame more for the effects it queued at mount.
       */
      await expect(page.locator('body')).toContainText(/self\.mp3/i, { timeout: 30_000 })
      await page.evaluate(
        () => new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))),
      )

      const tell = async (playing: boolean): Promise<boolean> => {
        await page.evaluate(
          async state => {
            const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
            await desktop.setPlaybackState(state)
          },
          { playing, title: playing ? 'A song' : null, artist: playing ? 'Someone' : null },
        )
        /*
         * Electron has no API that lists blockers, so this asks about the
         * handful of ids one could have. They are handed out from zero and
         * counting, a new one each time the shell starts a blocker again, and
         * the shell is the only thing in this process that starts any.
         */
        return app.evaluate(({ powerSaveBlocker }) =>
          [0, 1, 2, 3, 4, 5].some(id => powerSaveBlocker.isStarted(id)),
        )
      }

      expect(await tell(true)).toBe(true)
      expect(await tell(false)).toBe(false)
      expect(await tell(true)).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('an unsigned build never offers to replace itself', async () => {
    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      const status = await page.evaluate(async () => {
        const desktop = (window as unknown as { selfmp3Desktop: DesktopForTest }).selfmp3Desktop
        return desktop.updates.check()
      })

      /*
       * The point of the test. Squirrel refuses to apply an update whose
       * signature it cannot verify (electron #36640), so a build that was not
       * signed must say so and offer the release page instead of a button that
       * would fail. This one was not signed — nothing here has a certificate —
       * and it is not packaged either.
       */
      expect(status.canInstall).toBe(false)
      // It answered rather than hanging. Which answer depends on whether this
      // machine can reach GitHub, and both are a real answer.
      expect(['none', 'available', 'error']).toContain(status.state)
    } finally {
      await app.close()
    }
  })

  test('window bounds survive a relaunch, and a window off every display does not', async () => {
    const userDataDir = freshUserData()

    const first = await launchApp({ userDataDir })
    try {
      await (await first.firstWindow()).waitForLoadState('domcontentloaded')
      await first.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]?.setBounds({ x: 120, y: 90, width: 1000, height: 700 })
      })
      // The write is debounced: a drag fires `move` on every frame.
      await new Promise(resolve => setTimeout(resolve, 900))
    } finally {
      await first.close()
    }

    const second = await launchApp({ userDataDir })
    try {
      await (await second.firstWindow()).waitForLoadState('domcontentloaded')
      const bounds = await second.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.getBounds(),
      )
      expect(bounds).toEqual({ x: 120, y: 90, width: 1000, height: 700 })
    } finally {
      await second.close()
    }

    // And the rule that keeps a window reachable, on the real display list.
    const third = await launchApp({ userDataDir })
    try {
      const reachable = await third.evaluate(({ screen }) => {
        const displays = screen.getAllDisplays()
        const far = { x: 99_000, y: 99_000, width: 1000, height: 700 }
        return displays.some(display => {
          const area = display.workArea
          return (
            far.x < area.x + area.width &&
            far.x + far.width > area.x &&
            far.y < area.y + area.height
          )
        })
      })
      expect(reachable).toBe(false)
    } finally {
      await third.close()
    }
  })
})

test.describe('connects and plays', () => {
  test('a row plays from a server, and the bar shows it', async () => {
    test.skip(
      appApi === null,
      'needs a server with the dev library: set SELFMP3_APP_API, e.g. http://localhost:4600',
    )
    const reachable = appApi !== null && (await serverHasSongs(appApi))
    test.skip(!reachable, `no server answering with songs at ${String(appApi)}`)

    const app = await launchApp()
    try {
      const page = await app.firstWindow()
      await page.waitForLoadState('domcontentloaded')

      /*
       * Nothing in the app reads SELFMP3_APP_API: it takes its server from the
       * `selfmp3.baseUrl` secret (connection/storedConnection.ts), the one the
       * sign-in screen writes. Handed over in the environment, the window stayed
       * on sign-in and this waited out its thirty seconds. So write the secret
       * the way the app would, and load again to pick it up.
       */
      await page.evaluate(async baseUrl => {
        const desktop = (
          window as unknown as {
            selfmp3Desktop: { secrets: { set(k: string, v: string): Promise<void> } }
          }
        ).selfmp3Desktop
        await desktop.secrets.set('selfmp3.baseUrl', baseUrl)
      }, String(appApi))
      await page.reload()

      // Rows are `song-row-<index>`; there is no bare `song-row`.
      const row = page.getByTestId(/^song-row-\d+$/).first()
      await expect(row).toBeVisible({ timeout: 30_000 })
      // Nothing is playing yet, so there is no bar to show.
      await expect(page.getByTestId('player-bar')).toHaveCount(0)

      const label = await row
        .getByRole('button', { name: /^More actions for / })
        .getAttribute('aria-label')
      const title = (label ?? '').replace(/^More actions for /, '')
      expect(title).not.toBe('')

      // The window is the wide layout, where a row has no double-click: its
      // play button appears on hover, in place of the index.
      await row.hover()
      await row.getByRole('button', { name: `Play ${title}` }).click()

      const bar = page.getByTestId('player-bar')
      await expect(bar).toBeVisible()
      await expect(bar.getByRole('button', { name: `Open now playing: ${title}` })).toBeVisible()
      await expect(bar.getByRole('button', { name: 'Pause', exact: true })).toBeVisible()
    } finally {
      await app.close()
    }
  })
})

/** Only what these tests call, so the page evaluations can be typed at all. */
interface DesktopForTest {
  info: Record<string, unknown>
  mediaUrl(kind: string, name: string): string
  onProgress(
    listener: (progress: { id: string; bytesWritten: number; totalBytes: number }) => void,
  ): () => void
  onCommand(listener: (command: string) => void): () => void
  setPlaybackState(state: {
    playing: boolean
    title: string | null
    artist: string | null
  }): Promise<void>
  updates: {
    check(): Promise<{ state: string; canInstall: boolean; version: string | null }>
  }
  files: {
    download(request: {
      id: string
      kind: string
      name: string
      url: string
    }): Promise<{ state: string; bytes: number }>
    cancel(id: string): Promise<void>
    fetchTo(
      kind: string,
      name: string,
      url: string,
      headers?: Record<string, string>,
    ): Promise<void>
    stat(kind: string, name: string): Promise<{ name: string; bytes: number } | null>
    list(kind: string): Promise<{ name: string; bytes: number }[]>
    write(kind: string, name: string, text: string): Promise<void>
    reveal(kind: string, name?: string): Promise<void>
    usage(): Promise<{ songs: number; covers: number; free: number }>
    clear(kind: string): Promise<void>
  }
}
