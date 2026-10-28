import { ShareLinkSchema, SHARE_IDLE_MS, type RoomSong, type ShareLink } from '@selfmp3/shared'
import { describe, expect, it } from 'vitest'
import { harness, type Harness } from './fakes.js'

/**
 * A share link's own address (linkPage.ts): a chat app reads the song's card
 * from it, and a person is sent on to the app.
 */

const DISCORD = 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'
const MESSAGES =
  'Mozilla/5.0 (Macintosh) AppleWebKit/601.2.4 facebookexternalhit/1.1 Facebot Twitterbot/1.0'
const SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1'

const SHA = 'ab'.repeat(32)
const SONG: RoomSong = {
  uid: SHA.slice(0, 32),
  title: '干杯',
  artist: '五月天',
  album: '第二人生',
  duration: 291.4,
  audio: { key: `audio/${SHA}.m4a`, size: 3, mime: 'audio/mp4' },
  cover: { key: `covers/${SHA}.jpg`, size: 7 },
  coverTone: { hue: 60, chroma: 0.12, palette: [{ l: 0.6, c: 0.12, h: 60, share: 1 }] },
  lyrics: null,
  sourceUrl: null,
  link: null,
  artwork: null,
}

async function made(): Promise<{ h: Harness; link: ShareLink; me: string }> {
  const h = harness()
  h.allow({ anyone: true })
  const me = await h.signIn()
  expect((await h.connect(me, { prefix: 'selfmp3' })).status).toBe(200)
  h.bucket.put(`selfmp3/${SONG.cover?.key}`, 'cover')
  const response = await h.call('/v1/share', {
    token: me,
    json: { name: SONG.title, kind: 'song', you: 'Xiao', songs: [SONG] },
  })
  return { h, me, link: ShareLinkSchema.parse(await response.json()) }
}

const visit = (h: Harness, path: string, agent: string) =>
  h.call(path, { headers: { 'user-agent': agent } })

/** The card's tags, as a chat app reads them. */
function tags(html: string): Record<string, string> {
  const found: Record<string, string> = {}
  for (const [, name = '', content = ''] of html.matchAll(
    /<meta (?:property|name)="([^"]+)" content="([^"]*)">/g,
  )) {
    found[name] = content.replace(/&amp;/g, '&')
  }
  return found
}

describe("a share link's own address", () => {
  it('sends a person on to the same link in the app', async () => {
    const { h, link } = await made()
    const sent = await visit(h, `/l/${link.id}/${link.key}`, SAFARI)
    expect(sent.status).toBe(302)
    expect(sent.headers.get('location')).toBe(
      `https://xiao215.github.io/selfmp3/l/${link.id}/${link.key}`,
    )
    expect((await visit(h, '/', SAFARI)).headers.get('location')).toBe(
      'https://xiao215.github.io/selfmp3',
    )
  })

  it('sends a person on with a link cut short when it was copied, for the app to say so', async () => {
    const { h, link } = await made()
    const half = await visit(h, `/l/${link.id}/${link.key.slice(0, 8)}`, SAFARI)
    expect(half.status).toBe(302)
    expect(half.headers.get('location')).toBe(
      `https://xiao215.github.io/selfmp3/l/${link.id}/${link.key.slice(0, 8)}`,
    )
    expect((await visit(h, `/l/${link.id}`, SAFARI)).headers.get('location')).toBe(
      `https://xiao215.github.io/selfmp3/l/${link.id}/-`,
    )
    const card = tags(await (await visit(h, `/l/${link.id}`, DISCORD)).text())
    expect(card['og:description']).toBe('This link is gone.')
  })

  it('shows a chat app the song, who sent it and its cover, and counts nothing', async () => {
    const { h, link, me } = await made()
    const page = await visit(h, `/l/${link.id}/${link.key}`, DISCORD)
    expect(page.status).toBe(200)
    expect(page.headers.get('x-robots-tag')).toBe('noindex')
    const card = tags(await page.text())
    expect(card['og:title']).toBe('干杯')
    expect(card['og:description']).toBe('五月天 · Song · Shared by Xiao')
    expect(card['og:type']).toBe('music.song')
    expect(card['music:duration']).toBe('291')
    expect(card['theme-color']).toMatch(/^#[0-9a-f]{6}$/)
    const cover = new URL(card['og:image'] ?? '')
    expect(await (await h.call(cover.pathname + cover.search)).text()).toBe('cover')

    // Messages names itself as Facebook's reader does, and gets the same card.
    expect(
      tags(await (await visit(h, `/l/${link.id}/${link.key}`, MESSAGES)).text())['og:title'],
    ).toBe('干杯')

    const mine = ShareLinkSchema.parse(
      await (await h.call(`/v1/share/${link.id}?k=${link.key}`, { token: me })).json(),
    )
    expect(mine.guests).toBe(0)
    expect(mine.endsAt).toBe(link.endsAt)
  })

  it('says when the link has ended, and nothing for a wrong key', async () => {
    const { h, link } = await made()
    h.clock.now += SHARE_IDLE_MS + 1
    const ended = tags(await (await visit(h, `/l/${link.id}/${link.key}`, DISCORD)).text())
    expect(ended['og:description']).toBe('五月天 · Song · Link ended · ask Xiao for it again')

    const wrong = tags(await (await visit(h, `/l/${link.id}/${'0'.repeat(16)}`, DISCORD)).text())
    expect(wrong['og:title']).toBe('self.mp3')
    expect(wrong['og:description']).toBe('This link is gone.')
    expect(wrong['og:image']).toBe('https://xiao215.github.io/selfmp3/icons/icon-512.png')
  })

  it('carries where to start on to the app, written as a time, and drops one that is not', async () => {
    const { h, link } = await made()
    const at = (t: string) =>
      visit(h, `/l/${link.id}/${link.key}?t=${t}`, SAFARI).then(sent =>
        sent.headers.get('location'),
      )
    const app = `https://xiao215.github.io/selfmp3/l/${link.id}/${link.key}`
    expect(await at('0:42')).toBe(`${app}?t=0:42`)
    expect(await at('42')).toBe(`${app}?t=0:42`)
    expect(await at('1:02:03')).toBe(`${app}?t=1:02:03`)
    expect(await at('0%3A42')).toBe(`${app}?t=0:42`)
    for (const wrong of ['0:4', '0:60', '-1', '1:2:3', 'abc', '1e3', '', '99999999']) {
      expect(await at(wrong)).toBe(app)
    }
  })

  it('carries the song a list opens on to the app, and shows its cover on the card', async () => {
    const { h, me } = await made()
    const SHA2 = 'cd'.repeat(32)
    const other: RoomSong = {
      ...SONG,
      uid: SHA2.slice(0, 32),
      title: '倔强',
      audio: { key: `audio/${SHA2}.m4a`, size: 3, mime: 'audio/mp4' },
      cover: { key: `covers/${SHA2}.jpg`, size: 7 },
    }
    h.bucket.put(`selfmp3/${other.cover?.key}`, 'other cover')
    const response = await h.call('/v1/share', {
      token: me,
      json: { name: 'Mayday', kind: 'list', you: 'Xiao', songs: [SONG, other] },
    })
    const list = ShareLinkSchema.parse(await response.json())
    const second = list.entries[1]?.id ?? ''
    const path = `/l/${list.id}/${list.key}`
    const app = `https://xiao215.github.io/selfmp3${path}`
    const on = (query: string) =>
      visit(h, `${path}${query}`, SAFARI).then(sent => sent.headers.get('location'))
    expect(await on(`?s=${second}`)).toBe(`${app}?s=${second}`)
    expect(await on(`?s=${second}&t=0:42`)).toBe(`${app}?s=${second}&t=0:42`)
    for (const wrong of ['', 'nope', '../x', `${second}0`])
      expect(await on(`?s=${wrong}`)).toBe(app)

    const cover = async (query: string) => {
      const card = tags(await (await visit(h, `${path}${query}`, DISCORD)).text())
      const url = new URL(card['og:image'] ?? '')
      return (await h.call(url.pathname + url.search)).text()
    }
    expect(await cover('')).toBe('cover')
    expect(await cover(`?s=${second}`)).toBe('other cover')
  })

  it('names the line a link was shared from on its card, or where it starts', async () => {
    const { h, link, me } = await made()
    await h.call('/v1/share', {
      token: me,
      json: {
        name: SONG.title,
        kind: 'song',
        you: 'Xiao',
        songs: [SONG],
        line: { at: 42, text: '干杯 朋友', reading: 'gān bēi péng yǒu' },
      },
    })
    const card = async (query: string) =>
      tags(await (await visit(h, `/l/${link.id}/${link.key}${query}`, DISCORD)).text())
    const lined = await card('?t=0:42')
    expect(lined['og:title']).toBe('干杯')
    expect(lined['og:description']).toBe('“干杯 朋友” · 五月天 · Shared by Xiao')
    expect(lined['og:url']).toContain('?t=0:42')
    // A start it has no line for says where it starts.
    expect((await card('?t=1:00'))['og:description']).toBe(
      'From 1:00 · 五月天 · Song · Shared by Xiao',
    )
    // Without one, the card is as it always was.
    expect((await card(''))['og:description']).toBe('五月天 · Song · Shared by Xiao')
    expect((await card('?t=nope'))['og:description']).toBe('五月天 · Song · Shared by Xiao')
  })

  it('escapes what the sender named it', async () => {
    const { h, me } = await made()
    const response = await h.call('/v1/share', {
      token: me,
      json: { name: '"><script>x</script>', kind: 'list', you: 'Xiao', songs: [SONG] },
    })
    const list = ShareLinkSchema.parse(await response.json())
    const html = await (await visit(h, `/l/${list.id}/${list.key}`, DISCORD)).text()
    expect(html).not.toContain('<script>')
    expect(tags(html)['og:description']).toBe('1 song · Shared by Xiao')
  })
})
