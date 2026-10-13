import { useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { Redirect } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { ApiError, leading, space, type, type Review, type ServerConnection } from '@selfmp3/client'
import { useFootInset } from '../../shell/bottomInset'
import { useLayout } from '../../shell/useLayout'
import { canListenHere } from '../../ports/listen'
import { label as groupLabel, pageFrame, pageTitle } from '../../ui/surfaces'
import { PageHeader } from '../../ui/components/PageHeader'
import { NoticeCard } from '../../ui/components/NoticeCard'
import { Button } from '../../ui/components/Button'
import { useBackTo } from '../../ui/useBackTo'
import { Cover } from '../../ui/components/Cover'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useListen } from './ImportListen'
import { TagThem } from './ImportTags'
import { chooseAllIn, useImportDraft } from './importDraft'
import { draftSourceFor } from './importDraft.model'
import { useImportSource } from './importSource'
import { reviewUrls, useRefreshReview } from './useRefreshReview'
import { useFindSongs } from './useFindSongs'
import { canListen } from './listen.model'
import {
  comingIn,
  countLabel,
  importLabel,
  importRequest,
  mosaicCovers,
  reviewKicker,
  reviewName,
  stillFinding,
} from './review.model'
import { AllBox, ReviewGridHead, useReviewRows } from './ReviewRows'
import { ScrollView } from '../../ui/components/Scroll'

/**
 * Reviewing what a link holds, before any of it downloads (`/import/review`,
 * docs/ui-mock `P30` and `C14`).
 *
 * Every song starts ticked, and only ticked songs are imported: the box at the
 * left of a row takes it out and puts it back, and the one in the head does
 * that for every row. A song the library already has says "In library",
 * has no box, and is skipped. On a phone a tap plays the song and opens the
 * row in place once it is playing — its cover shows the wait meanwhile — to
 * hear it and fix its name, and a tap anywhere else closes it. On a computer
 * every row sits on one grid; play waits under the pointer, and the playing
 * row turns its title, artist and album into fields with its bar opening under
 * it.
 *
 * The rows are ReviewRows.tsx's, which a search's songs on Import share.
 *
 * A page of its own rather than a state of Import, because the review lives in
 * the draft (importDraft.store.ts), which outlives either page and the page's
 * own reload: Back keeps it, and Import offers it again. With no review in the
 * draft — imported, cancelled, never looked up — there is nothing to show, and
 * it goes to Import.
 */
export function ImportReview({
  via,
  onUnreachable,
}: {
  via?: ServerConnection
  /** As ImportScreen's: the server this page was pointed at stopped answering. */
  onUnreachable?: () => void
} = {}): ReactNode {
  const { wide, finePointer } = useLayout()
  const source = useImportSource(via)
  const key = draftSourceFor(via)
  const [draft, patchDraft] = useImportDraft(key)
  const { review, tagIds } = draft
  // A kept review's "In library" is from when the link was looked up.
  useRefreshReview(source.api, key, reviewUrls(review))
  // Songs known only by name — a Spotify list, 网易云's VIP songs — are found as the review shows.
  const finder = useFindSongs(source.api, key, review)
  const listen = useListen(via, source.api)
  const backTo = useBackTo()
  const footInset = useFootInset()
  const [error, setError] = useState<string | null>(null)
  /** Imported or cancelled: the draft empties as the page leaves, which is not a review to go looking for. */
  const [leaving, setLeaving] = useState(false)

  const failed = (err: Error): void => {
    if (via && err instanceof ApiError && err.isOffline) {
      setError('Your library’s computer stopped answering. Looking for it again…')
      onUnreachable?.()
      return
    }
    setError(err.message)
  }

  /**
   * Back to Import with the review done. Imported, the draft starts afresh —
   * the links, and the tags too: the tags were for these songs, and the next
   * link arriving tagged the same way was a surprise found only once it had.
   * Cancelled, the tags stay for another look; the links went from the box
   * when they were looked up.
   */
  const leave = ({ imported }: { imported: boolean }): void => {
    setLeaving(true)
    listen.close({ resume: false })
    backTo('/import')
    patchDraft(imported ? { review: null, links: '', tagIds: new Set() } : { review: null })
  }

  const enqueue = useMutation({
    mutationFn: (current: Review) => source.api.importEnqueue(importRequest(current, tagIds)),
    onSuccess: () => {
      // The songs are in the queue now, which Import shows under Currently importing.
      void source.invalidateQueue()
      leave({ imported: true })
    },
    onError: failed,
  })

  // A From column only for a list whose songs come from more than where they were linked.
  const showFrom = review !== null && review.from !== 'youtube'
  const { rows, open, closeRow } = useReviewRows({
    draft: key,
    list: 'review',
    review,
    listen,
    wide,
    finePointer,
    showFrom,
  })
  const chooseAll = (on: boolean): void => chooseAllIn(key, on)

  if (!review) return leaving ? null : <Redirect href="/import" />

  const count = comingIn(review)
  const finding = stillFinding(review)
  const tags = source.library?.tags ?? []
  const anyToHear = canListenHere && review.items.some(canListen)

  const importButton = (
    <Button
      label={importLabel(count, finding)}
      variant="primary"
      grow={!wide}
      disabled={count === 0 || finding > 0}
      busy={enqueue.isPending}
      onPress={() => enqueue.mutate(review)}
      testID="import-commit"
    />
  )

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {wide ? (
        <View style={styles.headWide}>
          <Mosaic review={review} />
          <View style={styles.names}>
            <Text style={styles.kicker}>{reviewKicker(review)}</Text>
            <Text style={styles.nameWide} numberOfLines={1} accessibilityRole="header">
              {reviewName(review)}
            </Text>
          </View>
          <Text style={styles.count} testID="import-count">
            {countLabel(review, true)}
          </Text>
        </View>
      ) : (
        <Pressable
          onPress={open === null ? undefined : closeRow}
          accessible={false}
          style={styles.headPhone}
        >
          {/*
           * The head every page opened from another has on a phone: the round
           * ‹ (`BackButton`, as Import's own head), the name under it on the
           * left as the page's title (J1), and the count under that. The draft keeps the
           * review, and the preview stops with the page.
           */}
          <PageHeader
            title={reviewName(review)}
            subtitle={countLabel(review, false)}
            subtitleTestID="import-count"
            back={{ to: '/import', testID: 'import-review-back' }}
          />
        </Pressable>
      )}

      {/*
       * On a phone everything that is not a row is a press that closes the
       * open row: the head and the foot around their own buttons, and the
       * list's ground — the hint, the gap between rows, the space under the
       * last. A tap there puts the card away and stops what it was playing. A
       * scroll is not a tap, and a row's own press takes its tap first. With
       * no row open they have no press, and are never `disabled`: the web
       * writes that as `aria-disabled`, which disables every button inside.
       */}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={wide ? styles.listWide : styles.listPhone}
        testID="import-review"
      >
        <Pressable
          onPress={wide || open === null ? undefined : closeRow}
          accessible={false}
          style={styles.ground}
        >
          {wide ? (
            <ReviewGridHead
              leading={<AllBox review={review} onChange={chooseAll} wide />}
              showFrom={showFrom}
            />
          ) : (
            <>
              <Text style={styles.hint}>
                {anyToHear
                  ? 'Untick a song to leave it out. Tap a song to hear it and to fix its name.'
                  : 'Untick a song to leave it out. Tap a song to fix its name.'}
              </Text>
              <AllBox review={review} onChange={chooseAll} wide={false} />
            </>
          )}
          <View accessibilityRole="list" accessibilityLabel="Songs to import">
            {rows}
          </View>
        </Pressable>
      </ScrollView>

      {/*
       * The foot stays put under the list, the commit always in reach however
       * long the playlist; on a phone it stands clear of the floating chrome,
       * or of the home indicator on this page, which has no chrome.
       */}
      <Pressable
        onPress={wide || open === null ? undefined : closeRow}
        accessible={false}
        style={[wide ? styles.footWide : styles.footPhone, { paddingBottom: footInset + 12 }]}
      >
        {error ? (
          <NoticeCard tone="error" onDismiss={() => setError(null)}>
            {error}
          </NoticeCard>
        ) : null}
        {finder.error ? (
          <NoticeCard
            tone="error"
            actions={<Button label="Try again" variant="text" onPress={finder.retry} />}
          >
            {finder.error}
          </NoticeCard>
        ) : null}
        <View style={wide ? styles.footRow : styles.footColumn}>
          <View style={wide ? styles.tagsWide : null}>
            <TagThem
              tags={tags}
              createTag={source.createTag}
              selected={tagIds}
              onChange={next => patchDraft({ tagIds: next })}
            />
          </View>
          {wide ? (
            <Pressable
              onPress={() => leave({ imported: false })}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
            >
              <Text style={styles.cancelText}>Cancel</Text>
            </Pressable>
          ) : null}
          {importButton}
        </View>
      </Pressable>
    </SafeAreaView>
  )
}

/** The head's picture on a computer: four of the list's covers, or its one. */
function Mosaic({ review }: { review: Review }): ReactNode {
  const covers = mosaicCovers(review)
  const name = reviewName(review)
  if (covers.length < 4) {
    return <Cover uri={covers[0] ?? null} title={name} size={64} radius={14} />
  }
  return (
    <View style={styles.mosaic}>
      {covers.map(uri => (
        <Cover key={uri} uri={uri} title={name} size={32} radius={0} />
      ))}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  // The list's ground fills the scroll so a tap under the last row lands on it too.
  ground: { flexGrow: 1 },
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  scroll: { flex: 1 },
  pressed: { opacity: 0.6 },
  // As Import's head: the button, the words under it on the left, room above and below.
  headPhone: { ...pageFrame(false), paddingBottom: 14 },
  count: { color: theme.colors.textSecondary, fontSize: type.sub, fontVariant: ['tabular-nums'] },
  headWide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    ...pageFrame(true),
    paddingBottom: 14,
  },
  mosaic: {
    width: 64,
    height: 64,
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  names: { flex: 1, minWidth: 0, gap: 2 },
  kicker: { ...groupLabel(theme.colors), fontSize: type.small, color: theme.colors.textSecondary },
  nameWide: pageTitle(theme.colors),
  hint: {
    color: theme.colors.textSecondary,
    fontSize: type.sub,
    lineHeight: leading.sub,
    paddingTop: 12,
    paddingBottom: 4,
  },
  listPhone: { paddingHorizontal: space.gutter, flexGrow: 1 },
  listWide: { paddingHorizontal: 28 },
  footPhone: { gap: 10, paddingTop: 8, paddingHorizontal: space.gutter },
  footWide: { gap: 10, paddingTop: 12, paddingHorizontal: space.gutterWide },
  footColumn: { gap: 10 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tagsWide: { flex: 1, minWidth: 0 },
  cancel: { paddingHorizontal: 8, paddingVertical: 8 },
  cancelText: { color: theme.colors.textSecondary, fontSize: type.sub, fontWeight: '600' },
}))
