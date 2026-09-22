/**
 * Artwork the operating system's Now Playing can show.
 *
 * Chromium takes a media session image only from http, https, data and blob
 * addresses. A cover the installed app keeps is `app://selfmp3/_media/covers/…`,
 * which it drops with a console warning — and macOS then keeps the picture of
 * whatever played before, so Control Center showed the last song's cover under
 * this song's name. A kept cover is the only one a signed-in library has, so
 * it is read here and handed over as a `data:` address instead.
 */

/** Addresses Chromium loads for a media session image as they are. */
const LOADABLE = /^(https?|data|blob):/i

/** The last few covers read, so going back a song or pausing reads nothing. */
const REMEMBERED = 12

function artworkLoadable(src: string): boolean {
  return LOADABLE.test(src)
}

interface ArtworkInliner {
  /** A loadable address as it is; anything else as `data:`, or null if it cannot be read. */
  readonly load: (src: string) => Promise<string | null>
  /** What `load` would give without waiting, if it already has it. */
  readonly ready: (src: string) => string | null
}

export function artworkInliner(read: (src: string) => Promise<Blob> = fetchBlob): ArtworkInliner {
  const inlined = new Map<string, string>()
  return {
    ready: src => (artworkLoadable(src) ? src : (inlined.get(src) ?? null)),
    load: async src => {
      if (artworkLoadable(src)) return src
      const known = inlined.get(src)
      if (known) return known
      try {
        const url = await dataUrl(await read(src))
        inlined.set(src, url)
        if (inlined.size > REMEMBERED) {
          const oldest = inlined.keys().next().value
          if (oldest !== undefined) inlined.delete(oldest)
        }
        return url
      } catch {
        // No picture beats someone else's: the caller shows none.
        return null
      }
    },
  }
}

async function fetchBlob(src: string): Promise<Blob> {
  const response = await fetch(src)
  if (!response.ok) throw new Error(`${response.status} for artwork`)
  return response.blob()
}

/** `data:<type>;base64,…`, without FileReader, which only a browser has. */
async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let start = 0; start < bytes.length; start += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(start, start + CHUNK))
  }
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`
}
