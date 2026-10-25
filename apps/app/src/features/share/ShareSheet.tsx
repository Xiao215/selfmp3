import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import {
  artistOr,
  plural,
  SHARE_MAX_SONGS,
  type RoomSong,
  type ShareLink,
  type Song,
} from '@selfmp3/shared'
import { failureText, radius, shareLinkUrl, space } from '@selfmp3/client'
import { linkAddress } from '../../ports/linkAddress'
import { copyText } from '../../ports/clipboard'
import { hasTabs, openInNewTab } from '../../ports/newTab'
import { canShareLink, shareLink } from '../../ports/shareLink'
import { useArt } from '../../offline/useArt'
import { library as cloudLibrary } from '../../replica'
import { hint, lineSub, smallTitle, textColumn } from '../../ui/surfaces'
import { useSongsById } from '../../ui/songsById'
import { showToast } from '../../ui/toast'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { Press } from '../../ui/components/Press'
import { Check, QrCode, ShareOut } from '../../ui/components/Icons'
import { Sheet } from '../../ui/components/Sheet'
import { Spinner } from '../../ui/components/Spinner'
import { useCloudSession } from '../profile/useCloudSession'
import { RoomQr } from '../room/RoomQr'
import { nameToJoinWith } from '../shared/shared.model'
import { shareWords } from './share.model'
import { createShareLink, useShareMade } from './shareLinks'
import { closeShareSheet, useShareRequest, type ShareRequest } from './shareSheet.store'

/**
 * The share sheet (docs/features/share-links.md, A1): the link is made as it
 * opens — Share link is what was asked for — and shown as what it sends, the
 * cover and the name, with Copy at the end of that row and Share… under it.
 * There is one thing to send, the link: the doorman draws its card wherever
 * a chat draws cards. The QR code waits behind its button for a friend
 * standing beside you. Drawn once, by the shell, and by the phone's Now
 * Playing while it covers the shell.
 */

/** How long Copy says Copied before it is Copy again. */
const COPIED_MS = 2000

/** One link per opening, however often a render or a strict effect asks for it. */
const making = new WeakMap<ShareRequest, Promise<ShareLink>>()

type Made = { readonly link: ShareLink } | { readonly failed: string } | null

/** The songs asked for that are in storage, as a link carries them: the first hundred. */
function lendable(request: ShareRequest): RoomSong[] {
  return request.songIds
    .slice(0, SHARE_MAX_SONGS)
    .map(id => cloudLibrary.cloudRoomSongNow(id))
    .filter((song): song is RoomSong => song !== null)
}

export function ShareSheet(): ReactNode {
  const request = useShareRequest()
  const { data: me } = useCloudSession()
  const byId = useSongsById()
  const made = useShareMade()
  const [result, setResult] = useState<{ for: ShareRequest; made: Made } | null>(null)
  const shown = result && result.for === request ? result.made : null

  // What of it can be lent: a song not in storage yet cannot.
  const songs = request ? lendable(request) : []
  const nothing =
    request && songs.length === 0
      ? request.songIds.length === 1
        ? 'That song isn’t in your storage yet.'
        : 'None of those songs are in your storage yet.'
      : null

  useEffect(() => {
    // Your name goes on the link: wait for the session that says it.
    if (!request || me === undefined) return
    let held = making.get(request)
    if (!held) {
      const given = lendable(request)
      if (given.length === 0) return
      held = createShareLink({
        name: request.name.slice(0, 300),
        kind: request.kind,
        you: nameToJoinWith(me),
        songs: given,
      })
      making.set(request, held)
    }
    let live = true
    held.then(
      link => {
        made()
        if (live) setResult({ for: request, made: { link } })
      },
      (error: unknown) => {
        making.delete(request)
        if (live) {
          setResult({
            for: request,
            made: { failed: failureText('Couldn’t make the link', error) },
          })
        }
      },
    )
    return () => {
      live = false
    }
  }, [request, me, made])

  const count = request?.songIds.length ?? 0
  const left = Math.max(0, count - SHARE_MAX_SONGS)
  const link = shown && 'link' in shown ? shown.link : null
  const url = link ? shareLinkUrl(linkAddress(), link) : null
  // Your own copies of what went in: the song's artist, and the cover.
  const yours =
    request && link
      ? request.songIds.slice(0, SHARE_MAX_SONGS).flatMap(id => byId.get(id) ?? [])
      : []
  const words =
    request && link
      ? shareWords({
          name: request.name,
          kind: request.kind,
          artist: yours[0]?.artist ?? null,
          songs: link.entries.length,
        })
      : ''

  return (
    <Sheet
      open={request !== null}
      onClose={closeShareSheet}
      // What it sends is the row's to say, under its cover; the head says what this is.
      title="Share link"
      subtitle="Anyone with the link can listen."
      testID="share-sheet"
      width={420}
      scroll
    >
      <View style={styles.body}>
        {left > 0 ? (
          <Text style={styles.text}>
            A link holds {SHARE_MAX_SONGS} songs: the first {SHARE_MAX_SONGS} of these go in, and{' '}
            {plural(left, 'song', 'songs')} stay out.
          </Text>
        ) : null}
        {nothing ? (
          <Text style={styles.text}>{nothing}</Text>
        ) : shown && 'failed' in shown ? (
          <Text style={styles.text}>{shown.failed}</Text>
        ) : request && link && url ? (
          // Keyed by the link, so a second link opens with its QR folded and Copy fresh.
          <MadeLink
            key={link.id}
            name={request.name}
            sub={
              request.kind === 'list'
                ? plural(link.entries.length, 'song', 'songs')
                : artistOr(yours[0]?.artist)
            }
            song={coverOf(yours)}
            url={url}
            path={`/l/${link.id}/${link.key}`}
            words={words}
          />
        ) : (
          <View style={styles.making}>
            <Spinner />
            <Text style={styles.text}>Making the link…</Text>
          </View>
        )}
      </View>
    </Sheet>
  )
}

/** The cover the row shows: a song's own; a list's first with a picture, or its first. */
function coverOf(songs: readonly Song[]): Song | null {
  return songs.find(song => song.hasArt) ?? songs[0] ?? null
}

/**
 * The link, made: what it sends with Copy beside it, the QR behind its button,
 * and Share…. In a browser the song opens the link's page in a new tab, to
 * see what a friend will.
 */
function MadeLink({
  name,
  sub,
  song,
  url,
  path,
  words,
}: {
  name: string
  sub: string
  song: Song | null
  url: string
  /** The link's page in this app. */
  path: string
  words: string
}): ReactNode {
  const artFor = useArt()
  const [qr, setQr] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return undefined
    const timer = setTimeout(() => setCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <>
      <View style={styles.link} testID="share-sheet-link">
        <Press
          feedback="dim"
          disabled={!hasTabs()}
          onPress={() => openInNewTab(path)}
          accessibilityRole={hasTabs() ? 'link' : undefined}
          accessibilityLabel={hasTabs() ? `Open the link to ${name} in a new tab` : undefined}
          style={styles.what}
          testID="share-sheet-open"
        >
          <Cover uri={song ? artFor(song) : null} title={name} size={44} />
          <View style={textColumn}>
            <Text style={styles.name} numberOfLines={1}>
              {name}
            </Text>
            <Text style={styles.sub} numberOfLines={1}>
              {sub}
            </Text>
          </View>
        </Press>
        <IconButton
          label={qr ? 'Hide the QR code' : 'Show the QR code'}
          caption="QR code"
          active={qr}
          onPress={() => setQr(shown => !shown)}
          testID="share-sheet-qr"
        >
          <QrCode tone={qr ? 'textPrimary' : 'textSecondary'} />
        </IconButton>
        <Button
          label={copied ? 'Copied' : 'Copy'}
          icon={copied ? <Check tone="onAccent" /> : undefined}
          variant="primary"
          size="small"
          accessibilityLabel={copied ? 'Link copied' : 'Copy link'}
          onPress={() =>
            void copyText(url).then(done => {
              if (done) setCopied(true)
              else showToast('Couldn’t copy the link', 'error')
            })
          }
          testID="share-sheet-copy"
        />
      </View>
      {qr ? (
        <View style={styles.qr}>
          <RoomQr text={url} size={200} />
        </View>
      ) : null}
      {canShareLink() ? (
        <Button
          label="Share…"
          icon={<ShareOut tone="textPrimary" />}
          onPress={() =>
            void shareLink(words, url).then(how => {
              if (how === 'copied') showToast('Link copied', 'good')
            })
          }
          testID="share-sheet-share"
        />
      ) : null}
      <Text style={styles.lasts}>It ends a week after the last play.</Text>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
  body: { gap: space.md, paddingBottom: space.sm },
  text: lineSub(theme.colors),
  // What the link sends, as one row: the cover, the name, then the QR and Copy.
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.sm,
    paddingRight: space.md,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  // The cover and the name, which open the link's page in a browser.
  what: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: space.md },
  name: smallTitle(theme.colors),
  sub: lineSub(theme.colors),
  lasts: { ...hint(theme.colors), textAlign: 'center' },
  qr: { alignItems: 'center' },
  making: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 60 },
}))
