import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { ApiError, leading, space, type, type Review, type ServerConnection } from '@selfmp3/client'
import { useFootInset } from '../../shell/bottomInset'
import { useLayout } from '../../shell/useLayout'
import { label as groupLabel, pageFrame } from '../../ui/surfaces'
import { PageHeader } from '../../ui/components/PageHeader'
import { NoticeCard } from '../../ui/components/NoticeCard'
import { Button } from '../../ui/components/Button'
import { useBackTo } from '../../ui/useBackTo'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SearchField } from '../../ui/components/SearchField'
import { useListen } from './ImportListen'
import { TagThem } from './ImportTags'
import { useImportDraft } from './importDraft'
import { draftSourceFor } from './importDraft.model'
import { useImportSource } from './importSource'
import { useFindSongs } from './useFindSongs'
import { useSongSearch } from './useSongSearch'
import { comingIn, importLabel, importRequest, stillFinding } from './review.model'
import { ReviewGridHead, useReviewRows } from './ReviewRows'
import { ScrollView } from '../../ui/components/Scroll'

/** How many of a search's songs show before "Show more", under the songs picked before it. */
const FOUND_SHOWN = 12

/**
 * Searching for songs to import (`/import/search`, docs/features/import-sources.md,
 * "Searching"): a page of its own, as a link's review is, opened from
 * Import's box with the words typed there.
 *
 * Its field searches YouTube Music and 网易云 again as it is edited, and what
 * they found is the review's rows (ReviewRows.tsx): tick a song to import it,
 * tap it to hear it, open it to fix its name or take it from the other place.
 * Nothing starts ticked. Songs ticked stay ticked above the next search's under
 * Picked, so a few songs can be gathered over several searches, and the foot
 * imports them with its tags, then goes back to Import.
 *
 * The search and its ticks are in the import draft, so Back keeps them and
 * Import offers them again; a reload finds them as they were.
 */
export function ImportSearch({
  via,
  onUnreachable,
}: {
  via?: ServerConnection
  /** As ImportScreen's: the server this page was pointed at stopped answering. */
  onUnreachable?: () => void
} = {}): ReactNode {
  const { wide, finePointer } = useLayout()
  const { theme } = useUnistyles()
  const source = useImportSource(via)
  const key = draftSourceFor(via)
  const [draft, patchDraft] = useImportDraft(key)
  const { search, tagIds } = draft
  const params = useLocalSearchParams<{ q?: string }>()
  /** The words in the field: what Import's box sent, or the search this page was left with. */
  const [words, setWords] = useState(() => params.q ?? search?.query ?? '')
  const query = words.trim() || null
  const searching = useSongSearch(source.api, key, query, search?.query ?? null)
  // A 网易云 song it only previews, with no YouTube Music answer surely the same, is found as it shows.
  const finder = useFindSongs(source.api, key, search?.review ?? null, 'search')
  const listen = useListen(via, source.api)
  const backTo = useBackTo()
  const footInset = useFootInset()
  const [error, setError] = useState<string | null>(null)
  /** "Show more" pressed for these words; new words start short again. */
  const [moreFor, setMoreFor] = useState<string | null>(null)

  const failed = (err: Error): void => {
    if (via && err instanceof ApiError && err.isOffline) {
      setError('Your library’s computer stopped answering. Looking for it again…')
      onUnreachable?.()
      return
    }
    setError(err.message)
  }

  const found = useReviewRows({
    draft: key,
    list: 'search',
    review: search?.review ?? null,
    listen,
    wide,
    finePointer,
    showFrom: true,
    unticked: 'picking',
  })

  const enqueue = useMutation({
    mutationFn: (current: Review) => source.api.importEnqueue(importRequest(current, tagIds)),
    onSuccess: () => {
      // The songs are in the queue, which Import shows; the search is done, and so are its tags.
      void source.invalidateQueue()
      listen.close({ resume: false })
      backTo('/import')
      patchDraft({ search: null, tagIds: new Set() })
    },
    onError: failed,
  })

  const picked = search ? comingIn(search.review) : 0
  const finding = search ? stillFinding(search.review) : 0
  const tags = source.library?.tags ?? []
  const shownFor = search?.query ?? null
  /*
   * Songs found for other words than the field's are not shown while the
   * field's are looked for: an artist searched for came up as the last
   * search's songs, for the second or three the answer took, and looked like
   * the answer. The songs picked stay, all of them, ticked in this search or
   * before it — they are coming in whatever is searched for next.
   */
  const current = query !== null && shownFor === query
  const pickedRows = search
    ? found.rows.filter((_, index) => index < search.picked || search.review.chosen.has(index))
    : []
  const kept = current ? (search?.picked ?? 0) : pickedRows.length
  const rows = current ? found.rows : pickedRows
  const closeOpen = wide || found.open === null ? undefined : found.closeRow

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <Pressable
        onPress={closeOpen}
        accessible={false}
        style={wide ? styles.headWide : styles.headPhone}
      >
        {/* As the review's head: the round ‹ back to Import, the name under it. */}
        <PageHeader title="Search" back={{ to: '/import', testID: 'import-search-back' }} />
        <SearchField
          value={words}
          onChangeText={setWords}
          placeholder="Songs on YouTube Music and 网易云"
          accessibilityLabel="Search for songs"
          autoFocus={words === ''}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.field}
          testID="import-search-field"
        />
        <Text style={styles.status} testID="import-search-status">
          {query === null
            ? 'Search YouTube Music and 网易云 for a song to import.'
            : searching.searching
              ? 'Searching YouTube Music and 网易云…'
              : 'From YouTube Music and 网易云. Tick the songs to import.'}
        </Text>
      </Pressable>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={wide ? styles.listWide : styles.listPhone}
        testID="import-search"
      >
        <Pressable onPress={closeOpen} accessible={false} style={styles.ground}>
          {searching.error ? (
            <NoticeCard
              tone="error"
              style={styles.searchError}
              actions={<Button label="Try again" variant="text" onPress={searching.retry} />}
            >
              {searching.error}
            </NoticeCard>
          ) : null}
          {search && rows.length > 0 ? (
            <View accessibilityRole="list" accessibilityLabel="Songs found">
              {wide ? <ReviewGridHead leading={null} showFrom /> : null}
              {kept > 0 ? (
                <>
                  <Text style={styles.groupLabel} accessibilityRole="header">
                    Picked
                  </Text>
                  {rows.slice(0, kept)}
                </>
              ) : null}
              {rows.length > kept && (kept > 0 || !wide) ? (
                <Text
                  style={[styles.groupLabel, kept > 0 && styles.apart]}
                  accessibilityRole="header"
                >
                  Songs
                </Text>
              ) : null}
              {rows.slice(kept, moreFor === shownFor ? undefined : kept + FOUND_SHOWN)}
              {moreFor !== shownFor && rows.length > kept + FOUND_SHOWN ? (
                <View style={styles.more}>
                  <Button
                    label="Show more"
                    variant="text"
                    onPress={() => setMoreFor(shownFor)}
                    testID="import-search-more"
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          {query !== null && !current && !searching.error ? (
            <View style={styles.looking} testID="import-search-looking">
              <ActivityIndicator size="small" color={theme.colors.textSecondary} />
              <Text style={styles.lookingText}>Searching for “{query}”…</Text>
            </View>
          ) : null}
          {current && !searching.searching && rows.length === kept ? (
            <Text style={styles.none}>Nothing found for “{query}”.</Text>
          ) : null}
        </Pressable>
      </ScrollView>

      {/*
       * The foot stays put under the list, as the review's does: the tags the
       * songs arrive with, and Import, in reach however far down the list is.
       */}
      <Pressable
        onPress={closeOpen}
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
          <Button
            label={importLabel(picked, finding)}
            variant="primary"
            grow={!wide}
            disabled={picked === 0 || finding > 0}
            busy={enqueue.isPending}
            onPress={() => {
              if (search) enqueue.mutate(search.review)
            }}
            testID="import-search-commit"
          />
        </View>
      </Pressable>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  // The list's ground fills the scroll so a tap under the last row lands on it too.
  ground: { flexGrow: 1 },
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  scroll: { flex: 1 },
  // As the review's head: the button, the name under it on the left, the field under that.
  headPhone: {
    alignItems: 'flex-start',
    gap: 12,
    ...pageFrame(false),
    paddingBottom: 10,
  },
  headWide: {
    alignItems: 'flex-start',
    gap: 14,
    ...pageFrame(true),
    paddingBottom: 10,
  },
  field: { alignSelf: 'stretch', maxWidth: 720 },
  status: { color: theme.colors.textSecondary, fontSize: type.sub, lineHeight: leading.sub },
  listPhone: { paddingHorizontal: space.gutter, flexGrow: 1 },
  listWide: { paddingHorizontal: 28 },
  groupLabel: { ...groupLabel(theme.colors), paddingTop: 8, paddingBottom: 4 },
  apart: { marginTop: 14 },
  more: { alignItems: 'flex-start' },
  none: { color: theme.colors.textSecondary, fontSize: type.sub, paddingVertical: 8 },
  looking: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  lookingText: { color: theme.colors.textSecondary, fontSize: type.sub },
  footPhone: { gap: 10, paddingTop: 8, paddingHorizontal: space.gutter },
  footWide: { gap: 10, paddingTop: 12, paddingHorizontal: space.gutterWide },
  footColumn: { gap: 10 },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  tagsWide: { flex: 1, minWidth: 0 },
  searchError: { marginBottom: 8 },
}))
