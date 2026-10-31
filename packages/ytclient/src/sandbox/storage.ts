/*
 * A frame without `allow-same-origin` throws on the first touch of its
 * storage — `localStorage`, `sessionStorage`, `document.cookie` — and YouTube's
 * scripts touch them, BotGuard among them. Each is given one that keeps
 * nothing past the frame: there is nothing here worth keeping, and nothing of
 * the page's to reach.
 */
function memoryStorage(): Storage {
  const items = new Map<string, string>()
  return {
    get length() {
      return items.size
    },
    clear: () => items.clear(),
    getItem: key => items.get(key) ?? null,
    key: index => [...items.keys()][index] ?? null,
    removeItem: key => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  }
}
for (const name of ['localStorage', 'sessionStorage'] as const) {
  Object.defineProperty(window, name, { value: memoryStorage(), configurable: true })
}
let cookies = ''
Object.defineProperty(document, 'cookie', {
  configurable: true,
  get: () => cookies,
  set: (value: string) => {
    const pair = String(value).split(';')[0] ?? ''
    const name = pair.split('=')[0]?.trim()
    if (!name) return
    const kept = cookies.split('; ').filter(each => each && !each.startsWith(`${name}=`))
    cookies = [...kept, pair.trim()].join('; ')
  },
})

export {}
