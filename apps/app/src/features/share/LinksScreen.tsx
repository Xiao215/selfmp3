import { useCallback, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import type { GestureResponderEvent } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { plural } from '@selfmp3/shared'
import type { ShareAskEntry, ShareSummary } from '@selfmp3/shared'
import { radius, shareLinkUrl, space, type } from '@selfmp3/client'
import { copyText } from '../../ports/clipboard'
import { linkAddress } from '../../ports/linkAddress'
import { openInNewTab } from '../../ports/newTab'
import { shareLink } from '../../ports/shareLink'
import { modifiersOf, useSelection } from '../../selection/useSelection'
import { useLayoutValue } from '../../shell/useLayout'
import { lineSub, pageFrame } from '../../ui/surfaces'
import { showToast } from '../../ui/toast'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { Trash } from '../../ui/components/Icons'
import { PageHeader } from '../../ui/components/PageHeader'
import { PageLoading } from '../../ui/components/PageLoading'
import { Press } from '../../ui/components/Press'
import { Reveal } from '../../ui/components/Reveal'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { ScrollView } from '../../ui/components/Scroll'
import { SectionHead } from '../../ui/components/SectionHead'
import {
  SELECTION_BAR_SPACE,
  SelectionLane,
  type BarAction,
} from '../../ui/components/SelectionLane'
import { Sheet, SheetItem } from '../../ui/components/Sheet'
import { RoomFace } from '../room/RoomFace'
import { sayRoomFailure } from '../room/roomFailure'
import { LinkRow } from './LinkRow'
import {
  ENDED_SHOWN,
  removeLinksWords,
  sentCountLine,
  sentSections,
  shareStage,
  shareWords,
} from './share.model'
import { shareApi, useSentLinks, useShareAct } from './shareLinks'
import { useMinute } from './useMinute'

const LINK_NOUN = { one: 'link', many: 'links' } as const
// Where a row's own edge falls on a computer: its margin and its padding.
const ROW_EDGE_WIDE = space.sm + space.snug

/**
 * `/links`, Links you shared (docs/features/share-links.md, F1 + F2), drawn
 * the way Library is so its rows read as ones you know: friends asking for an
 * ended link again at the head, with Share again; then the links, as Playing
 * and Ended (C3), each a Library row with no play (A1). A press opens the
 * link's page — a new tab in a browser (K1) — and ⋯ holds Share, Keep it
 * longer, End now and Remove.
 *
 * They are picked as songs are, with the same selection bar. "All" is chosen
 * by the bar's checkbox, and each section's head selects just its own links,
 * so "every one that has stopped playing" is a click (C3, H1). The bar's one
 * button is Remove, which takes playing links too, after saying so (D2, D3);
 * More has Share again, End and Copy links.
 */
export function LinksScreen(): ReactNode {
  const router = useRouter()
  const wide = useLayoutValue(layout => layout.wide)
  const { data: links, isLoading } = useSentLinks()
  const act = useShareAct()
  const now = useMinute()
  const [menu, setMenu] = useState<ShareSummary | null>(null)
  // What a confirmation is asking about: ending one link, ending or removing many.
  const [ending, setEnding] = useState<readonly ShareSummary[] | null>(null)
  const [removing, setRemoving] = useState<readonly ShareSummary[] | null>(null)
  // Past five, the ended ones fold under "Show 3 more" (J2).
  const [unfolded, setUnfolded] = useState(false)
  const [foldHovered, setFoldHovered] = useState(false)
  const moreRef = useRef<View>(null)

  const { playing, ended } = useMemo(() => sentSections(links ?? [], now), [links, now])
  // Every link, folded ones too: whatever selects a folded one unfolds the list
  // first, so nothing ticked is ever out of sight.
  const ordered = useMemo(() => [...playing, ...ended], [playing, ended])
  const ids = useMemo(() => ordered.map(link => link.id), [ordered])
  const selection = useSelection(ids)
  const selected = useMemo(
    () => ordered.filter(link => selection.has(link.id)),
    [ordered, selection],
  )
  const asks = (links ?? []).flatMap(link => link.asks.map(ask => ({ link, ask })))
  const folded = !unfolded && ended.length > ENDED_SHOWN
  const endedShown = folded ? ended.slice(0, ENDED_SHOWN) : ended

  const renew = (link: ShareSummary, said: string): void => {
    void act(link.id, { type: 'renew' }).then(() => showToast(said, 'good'), sayRoomFailure)
  }
  // Many at once: each asked of the doorman on its own, and one toast for all.
  const actOnMany = (
    many: readonly ShareSummary[],
    action: 'renew' | 'end' | 'forget',
    said: string,
  ): void => {
    void Promise.all(many.map(link => act(link.id, { type: action }))).then(() => {
      showToast(said, 'good')
      selection.clear()
    }, sayRoomFailure)
  }

  const open = useCallback(
    (link: ShareSummary): void => {
      if (openInNewTab(`/l/${link.id}/${link.key}`)) return
      router.push({ pathname: '/l/[id]/[key]', params: { id: link.id, key: link.key } })
    },
    [router],
  )
  const onPress = useCallback(
    (event: GestureResponderEvent, link: ShareSummary): void => {
      if (selection.click(link.id, modifiersOf(event))) return
      open(link)
    },
    [selection, open],
  )
  // Ticking a circle, or holding a row, turns choosing on: then a press ticks
  // rather than opening a page (B).
  const pick = useCallback((link: ShareSummary) => selection.enter(link.id), [selection])
  const onMore = useCallback((link: ShareSummary) => setMenu(link), [])

  /** A section's head: tick all of its links, or untick them once they all are. */
  const pickSection = (section: readonly ShareSummary[]): void => {
    if (section === ended) setUnfolded(true)
    const every = section.every(link => selection.has(link.id))
    for (const link of section) {
      if (every) selection.toggle(link.id)
      else if (!selection.has(link.id)) selection.enter(link.id)
    }
  }
  const selectAll = (): void => {
    setUnfolded(true)
    selection.selectAll()
  }

  const renewable = selected.filter(link => link.ended?.why !== 'removed')
  const stillPlaying = selected.filter(link => shareStage(link, now) !== 'ended')
  const actions: readonly BarAction[] = [
    {
      key: 'remove',
      label: 'Remove',
      Glyph: Trash,
      danger: true,
      onPress: () => setRemoving(selected),
    },
  ]

  const rows = (section: readonly ShareSummary[]): ReactNode =>
    section.map(link => (
      <LinkRow
        key={link.id}
        link={link}
        cover={link.cover ? shareApi.fileUrl(link, link.cover, 'cover') : null}
        now={now}
        selected={selection.has(link.id)}
        picking={selection.active}
        onPress={onPress}
        onLongPress={pick}
        onToggle={pick}
        onMore={onMore}
      />
    ))

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={[styles.head, wide && styles.headWide]}>
        <PageHeader
          title="Links you shared"
          back={{ to: '/settings' }}
          subtitle={links && links.length > 0 ? sentCountLine(links, now) : undefined}
          subtitleTestID="links-count"
        />
      </View>

      {/* The selection bar takes a lane above the list, as Library's does. */}
      <View style={styles.listArea}>
        <SelectionLane
          shown={selection.active}
          count={selected.length}
          total={ordered.length}
          noun={LINK_NOUN}
          scope=""
          allSelected={selection.allSelected}
          onSelectAll={selectAll}
          onDeselectAll={selection.clear}
          onDone={selection.clear}
          actions={actions}
          moreRef={moreRef}
          summary={namesOf(selected)}
          menu={close => (
            <>
              {renewable.length > 0 ? (
                <SheetItem
                  label={`Share again ${renewable.length}`}
                  detail="Another month, from now"
                  onPress={() => {
                    close()
                    actOnMany(
                      renewable,
                      'renew',
                      `${plural(renewable.length, 'link', 'links')} last another month`,
                    )
                  }}
                />
              ) : null}
              {stillPlaying.length > 0 ? (
                <SheetItem
                  label={`End ${stillPlaying.length}`}
                  detail="It stops playing for everyone"
                  danger
                  onPress={() => {
                    close()
                    setEnding(stillPlaying)
                  }}
                />
              ) : null}
              <SheetItem
                label="Copy links"
                onPress={() => {
                  close()
                  const text = selected.map(link => shareLinkUrl(linkAddress(), link)).join('\n')
                  void copyText(text).then(done => {
                    if (done)
                      showToast(selected.length === 1 ? 'Link copied' : 'Links copied', 'good')
                  })
                }}
              />
            </>
          )}
        />

        <ScrollView
          contentContainerStyle={[
            styles.page,
            selection.active && !wide ? { paddingBottom: SELECTION_BAR_SPACE + 140 } : null,
          ]}
          testID="links"
        >
          {isLoading ? <PageLoading /> : null}
          {asks.length > 0 ? (
            <View style={[styles.asks, wide && styles.asksWide]}>
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
            </View>
          ) : null}
          {links && links.length === 0 ? (
            <Text style={[styles.text, styles.empty, wide && styles.asksWide]}>
              Links you share are kept here. Share link is in a song’s ⋯ menu, and on a tag’s or a
              playlist’s page.
            </Text>
          ) : null}

          <LinkSection
            title="Playing"
            count={playing.length}
            every={playing.length > 0 && playing.every(link => selection.has(link.id))}
            picking={selection.active}
            onPick={() => pickSection(playing)}
            testID="links-playing"
          >
            {rows(playing)}
          </LinkSection>
          <LinkSection
            title="Ended"
            count={ended.length}
            every={ended.length > 0 && ended.every(link => selection.has(link.id))}
            picking={selection.active}
            onPick={() => pickSection(ended)}
            testID="links-ended"
          >
            {rows(endedShown)}
            {folded ? (
              <Press
                feedback="wash"
                onPress={() => setUnfolded(true)}
                onHoverIn={() => setFoldHovered(true)}
                onHoverOut={() => setFoldHovered(false)}
                accessibilityRole="button"
                style={[
                  styles.fold,
                  wide ? styles.foldWide : styles.foldPhone,
                  foldHovered && styles.foldHovered,
                ]}
                testID="links-unfold"
              >
                <Text style={styles.foldText}>Show {ended.length - ENDED_SHOWN} more</Text>
              </Press>
            ) : null}
          </LinkSection>
        </ScrollView>
      </View>

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
                void shareLink(words, shareLinkUrl(linkAddress(), menu)).then(how => {
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
                  setEnding([menu])
                }}
              />
            )}
          </>
        ) : null}
      </Sheet>
      <ConfirmDialog
        open={ending !== null}
        title={
          ending && ending.length > 1 ? `End ${ending.length} links now?` : 'End this link now?'
        }
        body={
          ending && ending.length > 1
            ? 'Nobody can play them from these links any more. You can share them again later.'
            : `Nobody can play “${ending?.[0]?.name ?? ''}” from it any more. You can share it again later.`
        }
        confirmLabel={ending && ending.length > 1 ? `End ${ending.length}` : 'End it'}
        danger
        onConfirm={() => {
          const many = ending ?? []
          setEnding(null)
          if (many.length === 1) void act(many[0]!.id, { type: 'end' }).catch(sayRoomFailure)
          else actOnMany(many, 'end', `Ended ${plural(many.length, 'link', 'links')}`)
        }}
        onCancel={() => setEnding(null)}
      />
      <ConfirmDialog
        open={removing !== null}
        {...removeLinksWords(removing ?? [], now)}
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          const many = removing ?? []
          setRemoving(null)
          actOnMany(many, 'forget', `Removed ${plural(many.length, 'link', 'links')}`)
        }}
        onCancel={() => setRemoving(null)}
      />
    </SafeAreaView>
  )
}

/** "咲き誇れ · 干杯 and 2 more": enough to recognise what is ticked. */
function namesOf(links: readonly ShareSummary[]): string | null {
  if (links.length === 0) return null
  const names = links.slice(0, 2).map(link => link.name)
  return links.length > 2 ? `${names.join(' · ')} and ${links.length - 2} more` : names.join(' · ')
}

/**
 * Playing, or Ended: the small uppercase head and the count, and at its other
 * end "Select 3" — which with a mouse waits for the pointer over the section,
 * or for choosing to be on (H1); a finger always has it.
 */
function LinkSection({
  title,
  count,
  every,
  picking,
  onPick,
  testID,
  children,
}: {
  title: string
  count: number
  /** All of its links are ticked, so its head unticks them. */
  every: boolean
  picking: boolean
  onPick: () => void
  testID: string
  children: ReactNode
}): ReactNode {
  const wide = useLayoutValue(layout => layout.wide)
  const dense = useLayoutValue(layout => layout.dense)
  const [hovered, setHovered] = useState(false)
  if (count === 0) return null
  const pickButton = (
    <Press
      feedback="dim"
      onPress={onPick}
      accessibilityRole="button"
      accessibilityLabel={every ? `Deselect the ${title.toLowerCase()} links` : undefined}
      hitSlop={8}
      testID={`${testID}-select`}
    >
      <Text style={styles.pick}>{every ? 'Deselect' : `Select ${count}`}</Text>
    </Press>
  )
  return (
    <View
      testID={testID}
      onPointerEnter={dense ? () => setHovered(true) : undefined}
      onPointerLeave={dense ? () => setHovered(false) : undefined}
    >
      <SectionHead
        title={`${title} · ${count}`}
        look="label"
        style={wide ? styles.sectionWide : styles.sectionPhone}
        end={dense ? <Reveal shown={hovered || picking}>{pickButton}</Reveal> : pickButton}
      />
      {children}
    </View>
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
  head: pageFrame(false),
  // In line with the rows below rather than the page's usual 40: the way
  // back, the title and the section heads share one edge.
  headWide: { ...pageFrame(true), paddingHorizontal: ROW_EDGE_WIDE },
  /* A box over which the selection bar is laid; the list fills it. */
  listArea: { flex: 1, minHeight: 0 },
  page: { paddingTop: space.xs, paddingBottom: 140 },
  text: lineSub(theme.colors),
  empty: { paddingHorizontal: space.gutter, paddingTop: space.sm },
  asks: { gap: space.md, paddingHorizontal: space.gutter, paddingBottom: space.sm },
  asksWide: { paddingHorizontal: ROW_EDGE_WIDE },
  sectionWide: {
    paddingHorizontal: ROW_EDGE_WIDE,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  sectionPhone: {
    paddingHorizontal: space.xs + space.lg,
    paddingTop: space.lg,
    paddingBottom: space.xs,
  },
  pick: { color: theme.colors.accent, fontSize: type.small, fontWeight: '600' },
  fold: { borderRadius: radius.row, paddingVertical: space.snug },
  foldWide: { marginHorizontal: space.sm, paddingHorizontal: space.snug },
  foldPhone: { marginHorizontal: space.xs, paddingHorizontal: space.lg },
  foldHovered: { backgroundColor: theme.colors.surface1 },
  foldText: { color: theme.colors.textSecondary, fontSize: type.sub, fontWeight: '600' },
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
