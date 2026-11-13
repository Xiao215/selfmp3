import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the compose box grows with what is pasted, drawn as the page's own words
import { Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import Reanimated, { LayoutAnimationConfig } from 'react-native-reanimated'
import { artistOr, plural, type ImportJob, type Song } from '@selfmp3/shared'
import {
  canImportNext,
  canLookUp,
  describePaste,
  dismissable,
  foldQueue,
  matchingTag,
  queueControls,
  radius,
  reviewFrom,
  searchQuery,
  sharedLinks,
  type,
  type QueueChange,
  type ServerConnection,
  textStyle,
  leading,
  iconSize,
  space,
  useLibrary,
} from '@selfmp3/client'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayoutFlags } from '../../shell/useLayout'
import { PageHeader } from '../../ui/components/PageHeader'
import { NavRow } from '../../ui/components/NavRow'
import { NoticeCard, NoticeText } from '../../ui/components/NoticeCard'
import { card, pageFrame } from '../../ui/surfaces'
import { SectionHead } from '../../ui/components/SectionHead'
import { Button } from '../../ui/components/Button'
import { ArrowRight, Check, Refresh, Search } from '../../ui/components/Icons'
import { IconButton } from '../../ui/components/IconButton'
import { SongLine } from '../../ui/components/SongLine'
import { Spinner } from '../../ui/components/Spinner'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { isComposing } from '../../shell/composing'
import { textBoxGrows } from '../../ports/textBoxGrows'
import { FoldAction, Finished, JobGroup, JobRow, RunProgress } from './ImportQueue'
import { Fold } from '../../ui/components/Fold'
import { useKeptWhileClosing } from '../../ui/motion'
import { useFadeMotion } from '../../ui/rowMotion'
import { nextLine } from './importQueue.model'
import { previewImport, warmImports } from './deviceImports'
import { draftFor, useImportDraft } from './importDraft'
import { draftSourceFor } from './importDraft.model'
import { reviewUrls, useRefreshReview } from './useRefreshReview'
import { useImportFailure } from './ImportPage'
import { useImportSource } from './importSource'
import { comingIn, countLabel, reviewName } from './review.model'
import { relativeDay } from '../playlists/playlists.model'
import { songLink } from '../song/song.model'
import { ScrollView } from '../../ui/components/Scroll'
import { Guide } from '../guide/Guide'
import { guideSeen } from '../guide/guideMemory'
import { useGuide } from '../guide/useGuide'
import { NO_AUTOFILL } from '../../ui/noAutofill'
import { useArt } from '../../offline/useArt'

/**
 * Importing (docs/ui-mock `P29`, `C13`).
 *
 * Paste a link and look it up; what it holds opens on its own page to review
 * (`/import/review`, ImportReview.tsx), and from there into the queue, which
 * this page shows as Couldn't import, Currently importing and Earlier today; with
 * nothing in it, the songs added last, under "Recently imported". One field,
 * with its arrow inside it, which lights in the accent once there is something
 * to send; what arrives is tagged at review, where the songs can be seen (J1,
 * 2026-10-25). On a phone this page is Home's + and
 * a row under Profile, and "Done" goes back; on a computer it is in the sidebar,
 * the form across the page and the queue under it, at the foot of the page.
 *
 * Links shared to the app arrive as `/import?url=…&text=…`, which is the web's
 * Web Share Target; they are looked up straight away and cleared from the URL.
 *
 * `via` is a server reached directly from a cloud library (ImportViaServer): every
 * request here goes to it, and its tags are the ones offered.
 */
export function ImportScreen({
  via,
  onUnreachable,
}: {
  via?: ServerConnection
  /**
   * The server this screen was pointed at stopped answering part-way. Whoever
   * found it (ImportViaServer) looks again, and shows the away screen — with
   * its "add it anyway" — when nothing is there.
   */
  onUnreachable?: () => void
} = {}): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide } = useLayoutFlags()
  /** "Show all" under Earlier today: the whole history is read only then. */
  const [showAll, setShowAll] = useState(false)
  const source = useImportSource(via, { history: showAll })
  // A phone's YouTube page takes a moment to load: it starts as the screen opens, not at the first link.
  useEffect(() => warmImports(), [])
  const { api, library, tools, refetchTools, queue, history } = source
  const params = useLocalSearchParams<{
    url?: string
    text?: string
    title?: string
    /** File › Import… (⌘I) in the Mac app: a fresh value each time, to focus the field. */
    focus?: string
  }>()

  // The draft outlives this screen (importDraft.store.ts); only the error is the screen's.
  const key = draftSourceFor(via)
  const [draft, patchDraft] = useImportDraft(key)
  const { links, review } = draft
  // What the paragraph over the box used to say, shown once on the first
  // visit, pointing at the box (D1, 2026-10-13); the sources row under the
  // box says the rest every time. Only over an empty box: once something is
  // in it, what the guide would say has been found out. (A box being typed
  // in, it waits out itself.)
  const [boxTarget, boxGuide] = useGuide('import-box', links === '')
  // The card offering a kept review counts songs coming in: as the library is now.
  useRefreshReview(api, key, reviewUrls(review))
  const { error, setError, failed } = useImportFailure(via, onUnreachable)
  // Kept as the card folds away, dismissed or answered by a try that worked.
  const shownError = useKeptWhileClosing(error !== null, error)
  const [linksFocused, setLinksFocused] = useState(false)
  /** What the pasted links take up, so a browser's box grows with them. */
  const [linksHeight, setLinksHeight] = useState(0)
  const tags = library?.tags ?? []

  const preview = useMutation({
    mutationFn: (input: string) => previewImport(api, input, source.lookUp),
    onSuccess: (result, input) => {
      const next = reviewFrom(result)
      // A link named like a tag you already have — an artist's page, a search
      // for them — is tagged that way without asking, on top of the tags
      // chosen here for whatever arrives.
      const match = matchingTag(tags, next.playlistTitle)
      const current = draftFor(key)
      const chosen = new Set(current.tagIds)
      if (match !== null) chosen.add(match)
      // A link looked up is the review now, offered back by "Go on reviewing";
      // left in the box it was there again on every visit, looking unlooked-at.
      // Anything typed while it was looked up is not that link, and stays.
      const links = current.links.trim() === input ? '' : current.links
      patchDraft({ review: next, tagIds: chosen, links })
      setError(null)
      router.push('/import/review')
    },
    onError: failed,
  })

  const lookUp = (input: string): void => {
    patchDraft({ links: input, review: null })
    preview.mutate(input)
  }

  // Read a share once, look it up, and clear it so coming back does not do it again.
  const shared = sharedLinks(params)
  const sharedOnce = useRef(false)
  useEffect(() => {
    if (!shared || sharedOnce.current) return
    sharedOnce.current = true
    lookUp(shared)
    router.setParams({ url: undefined, text: undefined, title: undefined })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only `shared` matters here; the ref guards against a second run anyway.
  }, [shared])

  // File › Import… in the Mac app: the field, ready for a paste.
  const linksRef = useRef<TextInput>(null)
  useEffect(() => {
    if (params.focus) linksRef.current?.focus()
  }, [params.focus])

  /**
   * A press on the queue: drawn at once (`editQueue`), so the row answers
   * under the finger and moves from there, then sent, then read back. What
   * the server refuses — a song that reached its saving step while Pause was
   * on its way — is said, and the read puts the row back as it is.
   */
  const send = (request: Promise<unknown>): void => {
    void request
      .catch((err: unknown) => failed(err instanceof Error ? err : new Error(String(err))))
      .finally(() => void source.invalidateQueue())
  }
  /*
   * The same press on the same row while the first is on its way is that
   * press again, not a second request: a double click on Remove sent two, and
   * the second, for a job already gone, came back as a red card.
   */
  const sending = useRef(new Set<string>())
  const act = (change: QueueChange, request: () => Promise<unknown>): void => {
    const key = `${change.kind}:${change.id ?? 'all'}`
    if (sending.current.has(key)) return
    sending.current.add(key)
    source.editQueue(change)
    send(
      request().finally(() => {
        sending.current.delete(key)
      }),
    )
  }

  const pasted = describePaste(links)
  /*
   * One line of words with no link is a search (docs/features/import-sources.md,
   * "Searching"), made on a page of its own as a link's review is: the words
   * go there and leave the box, as a link looked up does. Two lines or more
   * are a list of names, looked up as before.
   */
  const query = searchQuery(links)
  // The line under the box folds in and out, keeping what it said as it goes.
  const hint = query !== null ? 'search' : pasted || null
  const shownHint = useKeptWhileClosing(hint !== null, hint)
  // What arrived and what is arriving swap with a fade.
  const { entering: belowIn } = useFadeMotion()
  const search = draft.search
  const picked = search ? comingIn(search.review) : 0
  const openSearch = (words: string): void => {
    patchDraft({ links: '' })
    router.push({ pathname: '/import/search', params: { q: words } })
  }
  const folded = queue ? foldQueue(queue.jobs) : null
  const controls = folded ? queueControls(folded.importing) : null
  const ready = canLookUp(links) && !preview.isPending && tools?.ytdlp !== false
  /** The box's commit — Search for words, Look it up for links — as its button does it. */
  const submit = (): void => {
    if (query !== null) {
      if (tools?.ytdlp !== false) openSearch(query)
    } else if (ready) lookUp(links.trim())
  }

  const commit = query !== null ? 'Search' : preview.isPending ? 'Looking…' : 'Look it up'
  const live = query !== null ? tools?.ytdlp !== false : ready
  const form = (
    <View style={styles.form}>
      {/*
       * One field: room for several links or song names, one per line, its
       * arrow inside it, and what was pasted said under them (`describePaste`).
       * It grows with what is pasted, and the whole card carries the focus
       * ring, since the whole card is the control.
       */}
      <View
        ref={boxTarget}
        collapsable={false}
        style={[styles.compose, linksFocused && styles.composeFocused]}
        testID="import-box"
      >
        <View style={styles.composeRow}>
          <TextInput
            {...NO_AUTOFILL}
            ref={linksRef}
            style={[
              styles.linksInput,
              textBoxGrows
                ? { minHeight: LINKS_MIN_HEIGHT }
                : { height: Math.max(LINKS_MIN_HEIGHT, linksHeight) },
            ]}
            value={links}
            onChangeText={next => {
              patchDraft({ links: next })
              // What went wrong was about what the box held; an edit is the next try.
              setError(null)
            }}
            onContentSizeChange={event => setLinksHeight(event.nativeEvent.contentSize.height)}
            onFocus={() => setLinksFocused(true)}
            onBlur={() => setLinksFocused(false)}
            onKeyPress={event => {
              // Enter commits, as a search box's does; Shift+Enter is the new
              // line for a list of names. An input method's Enter picks its
              // candidate and is not ours. Only a keyboard's Enter carries
              // shiftKey: a phone's Return still starts a line.
              const key = event.nativeEvent as {
                key: string
                shiftKey?: boolean
                isComposing?: boolean
              }
              if (key.key !== 'Enter' || key.shiftKey !== false || isComposing(key)) return
              ;(event as unknown as { preventDefault: () => void }).preventDefault()
              submit()
            }}
            placeholder="Paste a link, or type a song"
            placeholderTextColor={theme.colors.textMuted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="Links to import"
          />
          {/*
           * Search for words, Look it up for links: the one commit, inside the
           * field. While it looks, it stays lit: dimmed onto the plain surface,
           * its spinner (the accent's ink, near-black in dark mode) was lost
           * against it. A press then does nothing, as `submit` waits on `ready`.
           */}
          <IconButton
            label={commit}
            filled={live || preview.isPending ? 'accent' : true}
            disabled={!live && !preview.isPending}
            size={COMMIT_SIZE}
            onPress={submit}
            testID={query !== null ? 'import-search' : 'import-look-up'}
          >
            {preview.isPending ? (
              <Spinner tone="onAccent" />
            ) : (
              <ArrowRight
                size={iconSize.button}
                color={live ? theme.colors.onAccent : theme.colors.textMuted}
              />
            )}
          </IconButton>
        </View>
        <Fold open={hint !== null}>
          {shownHint === 'search' ? (
            <View style={styles.pasted} testID="import-pasted">
              <Search size={iconSize.sub} tone="accent" />
              <Text style={[styles.pastedText, styles.searchText]}>
                Search YouTube Music and 网易云
              </Text>
            </View>
          ) : shownHint ? (
            <View style={styles.pasted} testID="import-pasted">
              <Check size={iconSize.sub} tone="good" />
              <Text style={styles.pastedText}>{shownHint}</Text>
            </View>
          ) : null}
        </Fold>
      </View>
      {/* What the box takes, named once and quietly: words, not buttons. */}
      <Text style={styles.sources} testID="import-sources">
        Works with {SOURCES.join(' · ')}
      </Text>
    </View>
  )

  const notices = (
    <>
      {tools && !tools.ytdlp ? (
        <NoticeCard
          tone="warn"
          title="yt-dlp isn’t installed"
          actions={
            <Button
              label="Check again"
              icon={<Refresh color={theme.colors.textPrimary} />}
              onPress={() => void refetchTools()}
            />
          }
        >
          <NoticeText>Importing needs it. Install both tools with:</NoticeText>
          <Text style={styles.code} selectable>
            brew install yt-dlp ffmpeg
          </Text>
        </NoticeCard>
      ) : null}
      {tools?.ytdlp && !tools.ffmpeg ? (
        <NoticeCard tone="warn" title="ffmpeg isn’t installed">
          <NoticeText>Downloads still work, but cover art and tags won’t be embedded.</NoticeText>
          <Text style={styles.code} selectable>
            brew install ffmpeg
          </Text>
        </NoticeCard>
      ) : null}
      <Fold open={error !== null}>
        {shownError ? (
          <NoticeCard tone="error" onDismiss={() => setError(null)}>
            {shownError}
          </NoticeCard>
        ) : null}
      </Fold>
      {/* Songs picked in a search and not imported yet: the search is in the draft, one tap away. */}
      {search && picked > 0 ? (
        <NavRow
          card
          title={`Search · ${search.query}`}
          hint={`${plural(picked, 'song', 'songs')} picked · not imported yet`}
          accessibilityLabel="Go on picking songs"
          onPress={() => router.push('/import/search')}
          testID="import-resume-search"
        />
      ) : null}
      {/* A review left with Back is still in the draft, one tap from where it was. */}
      {review && review.items.length > 0 && !preview.isPending ? (
        <NavRow
          card
          title={reviewName(review)}
          hint={`${countLabel(review, true)} · not imported yet`}
          accessibilityLabel={`Go on reviewing ${reviewName(review)}`}
          onPress={() => router.push('/import/review')}
          testID="import-resume-review"
        />
      ) : null}
    </>
  )

  /*
   * What failed, what is happening, then what arrived — each its own list, so
   * a long queue cannot push a failure out of sight, and each with what can
   * be done to all of it at once beside its name: Retry all and Remove all
   * for what failed, Pause all and Resume all for what is importing. Forty
   * rows each with its own Retry were forty taps.
   *
   * Every row moves (`useRowMotion`): one retried fades out of Couldn't
   * import while the failure under it glides up into its place, and fades in
   * under Currently importing, where it used to vanish in one frame and leave
   * the next one under the pointer. Couldn't import is first so that is what
   * comes up under the pointer: below Currently importing, the list growing
   * above it slid Couldn't import's own Retry all into the Retry just pressed.
   */
  const nextUp = folded?.importing.find(job => job.status === 'queued')?.id ?? null
  // A phone's rows swipe for Next and Remove, which nothing on them says:
  // shown once, on the first such row, when there are two or more to act on.
  const swipeable =
    !wide && folded ? [...folded.failed, ...folded.importing].filter(dismissable) : []
  // On a later visit than the box's guide: one guide a visit.
  const [boxSeenBefore] = useState(() => guideSeen('import-box'))
  const [swipeTarget, swipeGuide] = useGuide('import-rows', swipeable.length >= 2 && boxSeenBefore)
  const firstSwipe = swipeable[0]?.id ?? null
  // What the first row's swipe shows: a failed import has only Remove.
  const swipeShows =
    swipeable[0] !== undefined && canImportNext(swipeable[0], nextUp)
      ? 'Swipe left for Next and Remove'
      : 'Swipe left to remove'
  const rowProps = (job: ImportJob) => ({
    job,
    tags,
    guideTarget: job.id === firstSwipe ? swipeTarget : undefined,
    guide: job.id === firstSwipe ? swipeGuide : undefined,
    nextLine: job.id === nextUp && queue ? nextLine(queue.pacing) : null,
    onPause: () => act({ kind: 'pause', id: job.id }, () => api.cancelImport(job.id)),
    onResume: () => act({ kind: 'resume', id: job.id }, () => api.retryImport(job.id)),
    onRetry: () => act({ kind: 'retry', id: job.id }, () => api.retryImport(job.id)),
    onDismiss: () => act({ kind: 'remove', id: job.id }, () => api.dismissImport(job.id)),
    onNext: canImportNext(job, nextUp)
      ? () => act({ kind: 'next', id: job.id }, () => api.importNext(job.id))
      : null,
  })
  const jobs =
    queue && folded && controls && queue.jobs.length > 0 ? (
      <LayoutAnimationConfig skipEntering>
        <View style={styles.jobs} testID="import-queue">
          {folded.failed.length > 0 ? (
            <JobGroup
              title="Couldn’t import"
              first
              jobs={folded.failed}
              testID="import-failed"
              actions={
                // One failure has its own Retry, right beside it.
                folded.failed.length > 1 ? (
                  <>
                    <FoldAction
                      label="Retry all"
                      accessibilityLabel="Retry every import that failed"
                      onPress={() => act({ kind: 'retry' }, () => api.retryFailedImports())}
                      testID="import-retry-all"
                    />
                    <FoldAction
                      label="Clear"
                      accessibilityLabel="Clear every import that failed"
                      onPress={() => act({ kind: 'remove' }, () => api.removeFailedImports())}
                      testID="import-remove-failed"
                    />
                  </>
                ) : null
              }
              renderRow={job => <JobRow {...rowProps(job)} />}
            />
          ) : null}
          {folded.importing.length > 0 ? (
            <JobGroup
              title="Currently importing"
              first={folded.failed.length === 0}
              lead={queue.run ? <RunProgress run={queue.run} /> : null}
              jobs={folded.importing}
              testID="import-importing"
              actions={
                <>
                  {controls.pausable > 0 ? (
                    <FoldAction
                      label="Pause all"
                      accessibilityLabel="Pause every download"
                      onPress={() => act({ kind: 'pause' }, () => api.pauseImports())}
                      testID="import-pause-all"
                    />
                  ) : null}
                  {controls.resumable > 0 ? (
                    <FoldAction
                      label="Resume all"
                      accessibilityLabel="Resume every paused download"
                      onPress={() => act({ kind: 'resume' }, () => api.resumeImports())}
                      testID="import-resume-all"
                    />
                  ) : null}
                </>
              }
              renderRow={job => <JobRow {...rowProps(job)} />}
            />
          ) : null}
          {queue.done > 0 ? (
            <Finished
              first={folded.importing.length === 0 && folded.failed.length === 0}
              jobs={showAll && history ? foldQueue(history.jobs).finished : folded.finished}
              total={queue.done}
              tags={tags}
              all={showAll}
              onShowAll={setShowAll}
              onClear={() => send(api.clearImports())}
            />
          ) : null}
        </View>
      </LayoutAnimationConfig>
    ) : null

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentPhone]}
        testID="import-screen"
      >
        {/* On a phone Import is a page over Home or Profile, and the ‹ goes
            back to it; the name sits under it on the left (J1). */}
        <PageHeader
          title="Import"
          back={{ to: '/profile', testID: 'import-back' }}
          style={styles.head}
        />

        {/* One column, the page's width, and what arrived under it at the foot
            of the page: a second column beside the form was squeezed to a
            strip of covers wherever the window was not wide enough for both. */}
        <View style={styles.stack}>
          {form}
          {notices}
          {/* There as the page opens; it rises in only when one takes the
              other's place later, the queue starting or emptying. */}
          <LayoutAnimationConfig skipEntering>
            <Reanimated.View key={jobs ? 'jobs' : 'recent'} entering={belowIn}>
              {jobs ?? <RecentlyImported />}
            </Reanimated.View>
          </LayoutAnimationConfig>
        </View>
        <ChromeSpacer />
      </ScrollView>
      <Guide
        guide={boxGuide}
        at={{ x: 0.3, y: 0.4 }}
        radius={18}
        steps={[
          {
            gesture: 'tap',
            text: 'Search for a song, or paste a link',
            sub: wide
              ? 'A playlist link brings every song in it. The browser extension sends links here too.'
              : 'A playlist link brings every song in it. You can also share a link to self.mp3 from YouTube or 网易云音乐.',
          },
        ]}
      />
      <Guide
        guide={swipeGuide}
        steps={[{ gesture: 'swipe-left', text: swipeShows, distance: 120 }]}
      />
    </SafeAreaView>
  )
}

/** Where songs can come from, under the box. */
const SOURCES = ['YouTube', '网易云音乐', 'Spotify', 'a list of names'] as const

/**
 * One line of room, its padding included, before the box starts growing with
 * what is pasted. A phone's field grows by itself (`textBoxGrows`); given a
 * height from the size it reports, a page come back to kept the old field's
 * report and cut the placeholder in half.
 */
const LINKS_MIN_HEIGHT = leading.body + 2 * space.sm

/** The arrow in the field. */
const COMMIT_SIZE = 40

/** How many of the songs added last stand on an empty Import. */
const RECENTLY_IMPORTED = 5

/**
 * The songs added last, on an Import with nothing in its queue: what came in,
 * on the half of the page that was empty, and the way to the rest of them
 * (Library, newest first). This device's library, whichever server the
 * import goes through: its ids are the ones the song's page and covers know.
 */
function RecentlyImported(): ReactNode {
  const { data: library } = useLibrary()
  return library && library.songs.length > 0 ? <RecentSongs songs={library.songs} /> : null
}

function RecentSongs({ songs }: { songs: readonly Song[] }): ReactNode {
  const router = useRouter()
  const art = useArt()
  // The stamps sort as they read ("2026-10-25 09:12:03"), newest last.
  const recent = useMemo(
    () => [...songs].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, RECENTLY_IMPORTED),
    [songs],
  )
  const [now] = useState(() => new Date())
  if (recent.length === 0) return null
  return (
    <View style={styles.recent} testID="import-recent">
      <SectionHead
        title="Recently imported"
        action={{ label: 'See all', onPress: () => router.navigate('/library') }}
      />
      {recent.map(song => (
        <SongLine
          key={song.id}
          title={song.title}
          sub={[artistOr(song.artist), relativeDay(song.addedAt, now)].filter(Boolean).join(' · ')}
          artUri={art(song)}
          coverTitle={song.album || song.title}
          onPress={() => router.push(songLink(song.id))}
        />
      ))}
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  // As wide as Import through the server (`ImportViaServer`): unbounded, a
  // queue row's Retry sat 2,700 px from its song on a 3200 px screen.
  contentWide: { ...pageFrame(true), maxWidth: 820 },
  contentPhone: pageFrame(false),
  head: { marginBottom: 20 },
  stack: { gap: space.xl },
  form: { gap: space.snug },
  // The compose card: the links' room, then its foot. Focused, the card wears the accent ring.
  compose: {
    ...card(theme.colors),
    gap: space.sm,
    paddingVertical: space.snug,
    paddingLeft: 18,
    paddingRight: space.snug,
  },
  composeFocused: {
    boxShadow: `0 0 0 1.5px ${theme.colors.accent}, 0 1px 2px ${theme.colors.cardShadow}, 0 8px 24px ${theme.colors.cardShadow}`,
  },
  linksInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: space.sm,
    color: theme.colors.textPrimary,
    ...textStyle('body'),
    _web: { outlineStyle: 'none' },
  },
  // The words and the arrow: the arrow at the foot of what is typed, as a send is.
  composeRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  // The sources under the box: one quiet line.
  sources: { color: theme.colors.textMuted, ...textStyle('small'), paddingHorizontal: space.xs },
  recent: { gap: space.xs },
  // What the box holds, said under it before it is looked up.
  pasted: { flexDirection: 'row', alignItems: 'center', gap: space.tight },
  pastedText: { color: theme.colors.good, fontSize: type.small, fontWeight: '600' },
  searchText: { color: theme.colors.accent },
  // On the notice's card, so one step up from it.
  code: {
    marginTop: space.tight,
    color: theme.colors.textPrimary,
    fontSize: type.small,
    paddingVertical: space.tight,
    paddingHorizontal: space.snug,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.coverSm,
  },
  jobs: { gap: space.tight },
}))
