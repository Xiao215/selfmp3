import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter, type Href } from 'expo-router'
import { plural, SHARE_MAX_SONGS, type RoomSong, type ShareLink } from '@selfmp3/shared'
import { failureText, radius, shareLinkUrl, space, type } from '@selfmp3/client'
import { linkAddress } from '../../ports/linkAddress'
import { shareLink } from '../../ports/shareLink'
import { library as cloudLibrary } from '../../replica'
import { lineSub } from '../../ui/surfaces'
import { useSongsById } from '../../ui/songsById'
import { showToast } from '../../ui/toast'
import { Button } from '../../ui/components/Button'
import { Sheet } from '../../ui/components/Sheet'
import { Spinner } from '../../ui/components/Spinner'
import { useCloudSession } from '../profile/useCloudSession'
import { RoomQr } from '../room/RoomQr'
import { nameToJoinWith } from '../shared/shared.model'
import { shareWords } from './share.model'
import { SharePictureButton } from './SharePoster'
import { createShareLink, useShareMade } from './shareLinks'
import { closeShareSheet, useShareRequest, type ShareRequest } from './shareSheet.store'

/**
 * The share sheet (docs/features/share-links.md, A1): the link is made as it
 * opens — Share link is what was asked for — and shown with its QR code and
 * the one line that says how long it lasts. Share as picture is for
 * WeChat, which draws no card for the link. Drawn once, by the shell, and by
 * the phone's Now Playing while it covers the shell.
 */

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

export function ShareSheet({ go = null }: { go?: ((href: Href) => void) | null }): ReactNode {
  const request = useShareRequest()
  const router = useRouter()
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
  // Your own copies of what went in: the song's artist, and the picture's covers.
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
      title={request?.name ?? ''}
      subtitle="Anyone with the link can listen. It ends a week after the last play."
      testID="share-sheet"
      width={420}
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
        ) : url ? (
          <>
            <View style={styles.card}>
              <RoomQr text={url} size={120} />
              <Text style={styles.link} selectable numberOfLines={4} testID="share-sheet-link">
                {url}
              </Text>
            </View>
            <Button
              label="Share link"
              variant="primary"
              onPress={() =>
                void shareLink(words, url).then(how => {
                  if (how === 'copied') showToast('Link copied', 'good')
                })
              }
              testID="share-sheet-share"
            />
            {request && link ? (
              <SharePictureButton
                name={request.name}
                kind={request.kind}
                songs={yours}
                count={link.entries.length}
                from={link.from.name}
                url={url}
                fileName={`selfmp3-${link.id}.png`}
              />
            ) : null}
            <Button
              label="Links you shared"
              variant="text"
              onPress={() => {
                closeShareSheet()
                if (go) go('/links')
                else router.push('/links')
              }}
            />
          </>
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

const styles = StyleSheet.create(theme => ({
  body: { gap: space.md, paddingBottom: space.sm },
  text: lineSub(theme.colors),
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  link: { flex: 1, minWidth: 0, color: theme.colors.textSecondary, fontSize: type.small },
  making: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 120 },
}))
