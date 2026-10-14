import { useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { ShareAskEntry, ShareSummary } from '@selfmp3/shared'
import { radius, shareLinkUrl, space, type } from '@selfmp3/client'
import { appAddress, shareLink } from '../../ports/shareLink'
import { lineSub, pageTitle } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { BackButton } from '../../ui/components/BackButton'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { More } from '../../ui/components/Icons'
import { PageLoading } from '../../ui/components/PageLoading'
import { Press } from '../../ui/components/Press'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { RoomFace } from '../room/RoomFace'
import { sayRoomFailure } from '../room/roomFailure'
import { sentLine, shareStage, shareWords } from './share.model'
import { shareApi, useSentLinks, useShareAct } from './shareLinks'
import { useMinute } from './useMinute'

/**
 * `/links`, Links you shared (docs/features/share-links.md, F1 + F2): friends
 * asking for an ended link again at the head, with Share again; then every
 * link you sent, who opened it and how long it has, its ⋯ holding Share,
 * Keep it longer, End now and Remove.
 */
export function LinksScreen(): ReactNode {
  const router = useRouter()
  const { data: links, isLoading } = useSentLinks()
  const act = useShareAct()
  const [menu, setMenu] = useState<ShareSummary | null>(null)
  const [ending, setEnding] = useState<ShareSummary | null>(null)
  const now = useMinute()
  const asks = (links ?? []).flatMap(link => link.asks.map(ask => ({ link, ask })))

  const renew = (link: ShareSummary, said: string): void => {
    void act(link.id, { type: 'renew' }).then(() => showToast(said, 'good'), sayRoomFailure)
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.page} testID="links">
        <BackButton to="/settings" />
        <Text style={styles.big} accessibilityRole="header">
          Links you shared
        </Text>
        {isLoading ? <PageLoading /> : null}
        {asks.map(({ link, ask }) => (
          <AskCard
            key={ask.id}
            ask={ask}
            link={link}
            onShare={() => renew(link, `Shared “${link.name}” again`)}
            onDismiss={() =>
              void act(link.id, { type: 'dismiss', askId: ask.id }).catch(sayRoomFailure)
            }
          />
        ))}
        {links && links.length === 0 ? (
          <Text style={styles.text}>
            Links you share are kept here. Share link is in a song’s ⋯ menu, and on a tag’s or a
            playlist’s page.
          </Text>
        ) : null}
        {(links ?? []).map(link => (
          <Press
            key={link.id}
            depth="row"
            style={styles.row}
            onPress={() =>
              router.push({ pathname: '/l/[id]/[key]', params: { id: link.id, key: link.key } })
            }
            accessibilityRole="link"
            accessibilityLabel={`Open ${link.name}`}
            testID={`links-row-${link.id}`}
          >
            <View style={shareStage(link, now) === 'ended' ? styles.faded : undefined}>
              <Cover
                uri={link.cover ? shareApi.fileUrl(link, link.cover, 'cover') : null}
                title={link.name}
                size={44}
              />
            </View>
            <View style={styles.words}>
              <Text style={styles.title} numberOfLines={1}>
                {link.name}
              </Text>
              <Text style={styles.text} numberOfLines={1}>
                {sentLine(link, now)}
              </Text>
            </View>
            <IconButton label={`More for ${link.name}`} onPress={() => setMenu(link)}>
              <More tone="textSecondary" />
            </IconButton>
          </Press>
        ))}
      </ScrollView>

      <Sheet open={menu !== null} onClose={() => setMenu(null)} title={menu?.name ?? ''}>
        {menu ? (
          <>
            <SheetItem
              label="Share link"
              onPress={() => {
                setMenu(null)
                // A summary carries no songs, so a song's goes without its artist.
                const words = shareWords({
                  name: menu.name,
                  kind: menu.kind,
                  artist: null,
                  songs: menu.songs,
                })
                void shareLink(words, shareLinkUrl(appAddress(), menu)).then(how => {
                  if (how === 'copied') showToast('Link copied', 'good')
                })
              }}
            />
            {menu.ended?.why !== 'removed' ? (
              <SheetItem
                label={shareStage(menu, now) === 'ended' ? 'Share it again' : 'Keep it longer'}
                detail="Another month, from now"
                onPress={() => {
                  setMenu(null)
                  renew(menu, `“${menu.name}” lasts another month`)
                }}
              />
            ) : null}
            {shareStage(menu, now) === 'ended' ? (
              <SheetItem
                label="Remove"
                detail="Its page goes too"
                danger
                onPress={() => {
                  setMenu(null)
                  void act(menu.id, { type: 'forget' }).catch(sayRoomFailure)
                }}
              />
            ) : (
              <SheetItem
                label="End now"
                detail="It stops playing for everyone"
                danger
                onPress={() => {
                  setMenu(null)
                  setEnding(menu)
                }}
              />
            )}
          </>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={ending !== null}
        title="End this link now?"
        body={`Nobody can play “${ending?.name ?? ''}” from it any more. You can share it again later.`}
        confirmLabel="End it"
        danger
        onConfirm={() => {
          const link = ending
          setEnding(null)
          if (link) void act(link.id, { type: 'end' }).catch(sayRoomFailure)
        }}
        onCancel={() => setEnding(null)}
      />
    </SafeAreaView>
  )
}

/** "Ken asked for 晴天 again", with Share again and Not now (F1). */
export function AskCard({
  ask,
  link,
  onShare,
  onDismiss,
}: {
  ask: ShareAskEntry
  link: Pick<ShareSummary, 'name'>
  onShare: () => void
  onDismiss: () => void
}): ReactNode {
  return (
    <View style={styles.ask} testID={`share-ask-${ask.id}`}>
      <View style={styles.askHead}>
        <RoomFace name={ask.name} colour={1} picture={null} size={24} />
        <Text style={styles.askText} numberOfLines={2}>
          {ask.name} asked for <Text style={styles.strong}>{link.name}</Text> again
        </Text>
      </View>
      <View style={styles.askButtons}>
        <Button label="Share again" variant="primary" onPress={onShare} />
        <Button label="Not now" variant="text" onPress={onDismiss} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
    gap: space.md,
    padding: space.gutter,
    paddingBottom: 140,
  },
  big: pageTitle(theme.colors),
  text: lineSub(theme.colors),
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.xs },
  faded: { opacity: 0.45 },
  words: { flex: 1, minWidth: 0, gap: 2 },
  title: { color: theme.colors.textPrimary, fontSize: type.body, fontWeight: '600' },
  ask: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.card,
    backgroundColor: theme.colors.surface2,
  },
  askHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  askText: { flex: 1, minWidth: 0, color: theme.colors.textPrimary, fontSize: type.body },
  strong: { fontWeight: '600' },
  askButtons: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm },
}))
