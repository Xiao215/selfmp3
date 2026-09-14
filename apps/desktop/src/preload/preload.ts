import { contextBridge, ipcRenderer } from 'electron'
import {
  BRIDGE_GLOBAL,
  CHANNELS,
  EVENTS,
  commandSchema,
  deepLinkSchema,
  desktopInfoSchema,
  secretReadSchema,
  type DesktopBridge,
  type DesktopInfo,
  type PlaybackState,
} from '@selfmp3/desktop-bridge'

/**
 * The only door.
 *
 * This file runs in the renderer's process with Node available and the page's
 * world walled off from it; `contextBridge` copies one plain object across, and
 * that object is everything `apps/app` can ever reach. No `ipcRenderer` goes
 * over — a page holding that could talk to every channel, including the ones it
 * was never given a method for.
 *
 * Every reply is parsed here too, not only in the main process. The direction
 * that matters most is the one people forget: a bug in the shell that answers
 * the wrong shape should be an error at this boundary rather than something
 * `undefined` three call frames into the player.
 */

/**
 * `info` is read once, at load, so the page may treat it as a constant.
 *
 * Synchronously, because a sandboxed preload is bundled as CommonJS and has no
 * top-level await — and because a bridge whose `info` is a promise would make
 * every port that reads it async for no reason.
 */
const info: DesktopInfo = desktopInfoSchema.parse(ipcRenderer.sendSync(CHANNELS.info))

function subscribe<T>(
  channel: string,
  parse: (value: unknown) => T,
  listener: (value: T) => void,
): () => void {
  const wrapped = (_event: unknown, raw: unknown): void => {
    let value: T
    try {
      value = parse(raw)
    } catch (error) {
      console.error(`self.mp3: the shell sent something unreadable on ${channel}`, error)
      return
    }
    listener(value)
  }
  ipcRenderer.on(channel, wrapped)
  // React effects unsubscribe; without this each mount leaves a listener behind
  // and Electron starts warning about a leak after ten of them.
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

const bridge: DesktopBridge = {
  info,

  secrets: {
    get: async key => secretReadSchema.parse(await ipcRenderer.invoke(CHANNELS.secretsGet, key)),
    set: async (key, value) => {
      await ipcRenderer.invoke(CHANNELS.secretsSet, key, value)
    },
    remove: async key => {
      await ipcRenderer.invoke(CHANNELS.secretsRemove, key)
    },
  },

  openExternal: async url => {
    await ipcRenderer.invoke(CHANNELS.openExternal, url)
  },

  onDeepLink: listener =>
    subscribe(EVENTS.deepLink, value => deepLinkSchema.parse(value), listener),

  onCommand: listener => subscribe(EVENTS.command, value => commandSchema.parse(value), listener),

  setPlaybackState: async (state: PlaybackState) => {
    await ipcRenderer.invoke(CHANNELS.setPlaybackState, state)
  },
}

contextBridge.exposeInMainWorld(BRIDGE_GLOBAL, bridge)
