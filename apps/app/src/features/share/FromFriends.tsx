import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { plural, type ShareSummary } from '@selfmp3/shared'
import { space } from '@selfmp3/client'
import { lineSub } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { ROW_COVER_SIZE } from '../../offline/coverStore'
import { Cover } from '../../ui/components/Cover'
import { NavRow } from '../../ui/components/NavRow'
import { SectionHead } from '../../ui/components/SectionHead'
import { Shelf, ShelfCard } from '../../ui/components/Shelf'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { sayRoomFailure } from '../room/roomFailure'
import { AskCard } from './LinksScreen'
import { receivedLine, shareStage } from './share.model'
import { shareApi, useReceivedLinks, useSentLinks, useShareAct } from './shareLinks'
import { useMinute } from './useMinute'
import { useOwnCover } from './useOwnCover'

/**
 * Share links on Home (docs/features/share-links.md): the songs friends sent
 * you (C1), an ended one gone grey with "Ended" and opening its card (E1);
 * and, when a friend asked for one of yours again, the ask (F1).
 */

/** Home's From friends: the links you opened signed in, newest first. */
export function FromFriends({ wide }: { wide: boolean }): ReactNode {
  const router = useRouter()
  const { data: links } = useReceivedLinks()
  const act = useShareAct()
  const [menu, setMenu] = useState<ShareSummary | null>(null)
  const now = useMinute()
  // A song you have yourself draws your own copy's cover: no read of its sender's bucket.
  const coverOf = useOwnCover(ROW_COVER_SIZE)
  if (!links || links.length === 0) return null
  const size = wide ? 132 : 92
  return (
    <View style={styles.stack}>
      <SectionHead title="From friends" />
      <Shelf testID="home-from-friends" contentStyle={styles.shelf}>
        {links.map(link => {
          const ended = shareStage(link, now) === 'ended'
          return (
            <ShelfCard
              key={link.id}
              width={size}
              testID={`home-share-${link.id}`}
              onPress={() =>
                router.push({ pathname: '/l/[id]/[key]', params: { id: link.id, key: link.key } })
              }
              onLongPress={() => setMenu(link)}
              onMenu={() => setMenu(link)}
              label={`Open ${link.name}, from ${link.from.name}`}
              cover={
                <View style={ended ? styles.faded : undefined}>
                  <Cover
                    uri={coverOf(
                      link.coverSong,
                      link.cover ? shareApi.fileUrl(link, link.cover, 'cover') : null,
                    )}
                    title={link.name}
                    size={size}
                  />
                </View>
              }
              title={link.name}
              lines={[receivedLine(link, now)]}
            />
          )
        })}
      </Shelf>
      <Sheet
        open={menu !== null}
        onClose={() => setMenu(null)}
        title={menu?.name ?? ''}
        role="menu"
        scroll
      >
        <SheetItem
          label="Take it off Home"
          onPress={() => {
            const link = menu
            setMenu(null)
            if (link)
              void act(link.id, { type: 'forget' }).then(
                () => showToast(`Took “${link.name}” off Home`, 'good'),
                sayRoomFailure,
              )
          }}
          testID="home-share-forget"
        />
      </Sheet>
    </View>
  )
}

/**
 * A friend asking for a link of yours again (F1), at the head of Home: the
 * first ask with Share again, or how many there are, behind Links you shared.
 */
export function ShareAsks(): ReactNode {
  const router = useRouter()
  const { data: links } = useSentLinks()
  const act = useShareAct()
  const asks = (links ?? []).flatMap(link => link.asks.map(ask => ({ link, ask })))
  const first = asks[0]
  if (!first) return null
  if (asks.length > 1) {
    return (
      <NavRow
        card
        title={`${plural(asks.length, 'friend asks', 'friends ask')} for songs again`}
        hint={asks.map(({ ask }) => ask.name).join(', ')}
        onPress={() => router.push('/links')}
        testID="home-share-asks"
      />
    )
  }
  return (
    <View style={styles.stack}>
      <AskCard
        ask={first.ask}
        link={first.link}
        onShare={() =>
          void act(first.link.id, { type: 'renew' }).then(
            () => showToast(`Shared “${first.link.name}” again`, 'good'),
            sayRoomFailure,
          )
        }
        onDismiss={() =>
          void act(first.link.id, { type: 'dismiss', askId: first.ask.id }).catch(sayRoomFailure)
        }
      />
      <Text style={styles.text}>The same link works again, for another month.</Text>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  stack: { gap: space.snug },
  shelf: { paddingRight: space.gutter },
  faded: { opacity: 0.45 },
  text: lineSub(theme.colors),
}))
