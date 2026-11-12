import fs from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createApp } from '../app.js'
import { loadConfig } from '../config.js'
import { createContainer, type Container } from '../container.js'

/**
 * One library behind the real app, on a real database in a temporary folder,
 * for the tests that go through HTTP (docs/ARCHITECTURE.md, "Layers, strictly").
 */

/** Variables to set, `undefined` to unset; the returned function puts back what was there. */
export function setEnv(values: Readonly<Record<string, string | undefined>>): () => void {
  const saved = Object.keys(values).map(name => [name, process.env[name]] as const)
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

export interface TestLibrary {
  /** The temporary folder the data and library folders are in. */
  readonly root: string
  readonly container: Container
  readonly server: http.Server
  readonly port: number
  /** `http://127.0.0.1:<port>`. */
  readonly origin: string
  /** One request with the library's token, `body` sent as JSON. */
  send(method: string, url: string, body?: unknown): Promise<Response>
  /** The server and the database closed, the folder deleted and the variables put back. */
  close(): Promise<void>
}

/**
 * A library on a free port.
 *
 * The folders are set in the environment, so they win over whatever a `.env`
 * on this machine says, and the API answers nothing without a bucket, so a
 * folder stands in for one. `env` adds to those or replaces them, from the
 * temporary folder; `host` is where the server listens.
 */
export async function startLibrary(
  options: {
    env?: (root: string) => Readonly<Record<string, string | undefined>>
    host?: string
  } = {},
): Promise<TestLibrary> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'selfmp3-library-'))
  const restore = setEnv({
    SELFMP3_DATA_DIR: path.join(root, 'data'),
    SELFMP3_LIBRARY_DIR: path.join(root, 'library'),
    SELFMP3_LOG_LEVEL: 'silent',
    SELFMP3_CLOUD_DIR: 'bucket',
    ...options.env?.(root),
  })
  const container = createContainer(loadConfig())
  const server = http.createServer(createApp(container))
  await new Promise<void>(resolve => server.listen(0, options.host ?? '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const origin = `http://127.0.0.1:${port}`

  return {
    root,
    container,
    server,
    port,
    origin,
    send: (method, url, body) =>
      fetch(`${origin}${url}`, {
        method,
        headers: {
          Authorization: `Bearer ${container.config.authToken}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    close: async () => {
      // An event stream left open would hold the close for good.
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
      container.close()
      fs.rmSync(root, { recursive: true, force: true })
      restore()
    },
  }
}
