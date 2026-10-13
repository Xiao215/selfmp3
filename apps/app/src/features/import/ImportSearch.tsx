import { useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { leading, space, type, type Review, type ServerConnection } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { pageFrame } from '../../ui/surfaces'
import { SectionHead } from '../../ui/components/SectionHead'
import { PageHeader } from '../../ui/components/PageHeader'
import { NoticeCard } from '../../ui/components/NoticeCard'
import { Button } from '../../ui/components/Button'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SearchField } from '../../ui/components/SearchField'
import { ImportFoot, useImportPage } from './ImportPage'
import { useFindSongs } from './useFindSongs'
import { useSongSearch } from './useSongSearch'
import { comingIn, importRequest, stillFinding } from './review.model'
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
  const page = useImportPage(via, onUnreachable)
  const { source, draft, patchDraft, listen, backTo, failed } = page
  const key = page.draftKey
  const { search, tagIds } = draft
  const params = useLocalSearchParams<{ q?: string }>()
  /** The words in the field: what Import's box sent, or the search this page was left with. */
  const [words, setWords] = useState(() => params.q ?? search?.query ?? '')
  const query = words.trim() || null
  const searching = useSongSearch(source.api, key, query, search?.query ?? null)
  // A 网易云 song it only previews, with no YouTube Music answer surely the same, is found as it shows.
  const finder = useFindSongs(source.api, key, search?.review ?? null, 'search')
  /** "Show more" pressed for these words; new words start short again. */
  const [moreFor, setMoreFor] = useState<string | null>(null)

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
                  <SectionHead look="label" title="Picked" style={styles.group} />
                  {rows.slice(0, kept)}
                </>
              ) : null}
              {rows.length > kept && (kept > 0 || !wide) ? (
                <SectionHead
                  look="label"
                  title="Songs"
                  style={[styles.group, kept > 0 && styles.apart]}
                />
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

      <ImportFoot
        error={page.error}
        onDismissError={() => page.setError(null)}
        finder={finder}
        tags={tags}
        createTag={source.createTag}
        tagIds={tagIds}
        onTags={next => patchDraft({ tagIds: next })}
        count={picked}
        finding={finding}
        busy={enqueue.isPending}
        onImport={() => {
          if (search) enqueue.mutate(search.review)
        }}
        onGround={closeOpen}
        testID="import-search-commit"
      />
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
  group: { paddingTop: 8, paddingBottom: 4 },
  apart: { marginTop: 14 },
  more: { alignItems: 'flex-start' },
  none: { color: theme.colors.textSecondary, fontSize: type.sub, paddingVertical: 8 },
  looking: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14 },
  lookingText: { color: theme.colors.textSecondary, fontSize: type.sub },
  searchError: { marginBottom: 8 },
}))
