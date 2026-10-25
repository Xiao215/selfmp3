import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
// eslint-disable-next-line @typescript-eslint/no-restricted-imports -- the compose box grows with what is pasted, drawn as the page's own words
import { Animated as RNAnimated, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated'
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import {
  plural,
  type ImportJob,
  type ImportPacing,
  type ImportRun,
  type Tag,
} from '@selfmp3/shared'
import {
  canImportNext,
  canLookUp,
  clockIn,
  describePaste,
  dismissable,
  finishedLabel,
  foldQueue,
  jobAction,
  jobSubtitle,
  jobTone,
  matchingTag,
  queueControls,
  radius,
  reviewFrom,
  searchQuery,
  sharedLinks,
  stepFraction,
  timeLeft,
  type,
  type QueueChange,
  type ServerConnection,
  textStyle,
  iconSize,
  coverSize,
  space,
} from '@selfmp3/client'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayout } from '../../shell/useLayout'
import { PageHeader } from '../../ui/components/PageHeader'
import { NavRow } from '../../ui/components/NavRow'
import { ProgressBar } from '../../ui/components/ProgressBar'
import { NoticeCard, NoticeText } from '../../ui/components/NoticeCard'
import { card, pageFrame, rowTitle } from '../../ui/surfaces'
import { SectionHead } from '../../ui/components/SectionHead'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Check, Next, Refresh, Search, X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { useFade } from '../../ui/motion'
import { isComposing } from '../../shell/composing'
import { MOVE_MS } from '../../ui/motion.model'
import { useRowMotion } from '../../ui/rowMotion'
import { QueueRing } from './QueueRing'
import { TagItPill } from './ImportTags'
import { draftFor, useImportDraft } from './importDraft'
import { draftSourceFor } from './importDraft.model'
import { reviewUrls, useRefreshReview } from './useRefreshReview'
import { useImportFailure } from './ImportPage'
import { useImportSource } from './importSource'
import { comingIn, countLabel, reviewName } from './review.model'
import { ScrollView } from '../../ui/components/Scroll'
import { Press } from '../../ui/components/Press'
import { MoreMenu, type MenuItem } from '../../ui/components/MoreMenu'
import { Guide, useOpenWith } from '../guide/Guide'
import { guideSeen } from '../guide/guideMemory'
import { useGuide, type GuideHandle, type GuideTarget } from '../guide/useGuide'
import { NO_AUTOFILL } from '../../ui/noAutofill'

/** How many of today's finished imports are listed before "Show all". */
const FINISHED_SHOWN = 5

/**
 * How many rows Currently importing and Couldn't import each list before
 * "Show more": a three-hundred-song playlist was three hundred rows, and the
 * page under them out of reach.
 */
const ROWS_SHOWN = 20

/**
 * Importing (docs/ui-mock `P29`, `C13`).
 *
 * Paste a link and look it up; what it holds opens on its own page to review
 * (`/import/review`, ImportReview.tsx), and from there into the queue, which
 * this page shows as Couldn't import, Currently importing and Earlier today. The tags chosen here — "Tag it …
 * as it arrives" — are the review's too. On a phone this page is Home's + and
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
  const { wide } = useLayout()
  /*
   * What the paragraph over the box used to say, shown once on the first
   * visit, pointing at the box (D1, 2026-10-13); the sources row under the
   * box says the rest every time.
   */
  const [boxTarget, boxGuide] = useGuide('import-box', true)
  /** "Show all" under Earlier today: the whole history is read only then. */
  const [showAll, setShowAll] = useState(false)
  const source = useImportSource(via, { history: showAll })
  const { api, library, tools, refetchTools, queue, history } = source
  const params = useLocalSearchParams<{ url?: string; text?: string; title?: string }>()

  // The draft outlives this screen (importDraft.store.ts); only the error is the screen's.
  const key = draftSourceFor(via)
  const [draft, patchDraft] = useImportDraft(key)
  const { links, review, tagIds } = draft
  // The card offering a kept review counts songs coming in: as the library is now.
  useRefreshReview(api, key, reviewUrls(review))
  const { error, setError, failed } = useImportFailure(via, onUnreachable)
  const [linksFocused, setLinksFocused] = useState(false)
  /** What the pasted links take up, so the box grows with them. */
  const [linksHeight, setLinksHeight] = useState(0)
  const tags = library?.tags ?? []

  const preview = useMutation({
    mutationFn: (input: string) => api.importPreview(input),
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
    // Only `shared` matters here; the ref guards against a second run anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared])

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

  const form = (
    <View style={styles.form}>
      {/*
       * A compose card: room for several links or song names, one per line,
       * what was pasted said under them (`describePaste`), and what happens to
       * them along its foot — the tag they arrive with on the left,
       * the commit on the right. It grows with what is pasted, and the whole
       * card carries the focus ring, since the whole card is the control.
       */}
      <View
        ref={boxTarget}
        collapsable={false}
        style={[styles.compose, linksFocused && styles.composeFocused]}
        testID="import-box"
      >
        <TextInput
          {...NO_AUTOFILL}
          style={[styles.linksInput, { height: Math.max(LINKS_MIN_HEIGHT, linksHeight) }]}
          value={links}
          onChangeText={next => patchDraft({ links: next })}
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
          placeholder="Search for a song, or paste links or song names"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="Links to import"
        />
        {query !== null ? (
          <View style={styles.pasted} testID="import-pasted">
            <Search size={iconSize.sub} tone="accent" />
            <Text style={[styles.pastedText, styles.searchText]}>
              Search YouTube Music and 网易云
            </Text>
          </View>
        ) : pasted ? (
          <View style={styles.pasted} testID="import-pasted">
            <Check size={iconSize.sub} tone="good" />
            <Text style={styles.pastedText}>{pasted}</Text>
          </View>
        ) : null}
        <View style={styles.composeFoot}>
          <TagItPill
            tags={tags}
            createTag={source.createTag}
            selected={tagIds}
            onChange={next => patchDraft({ tagIds: next })}
          />
          {query !== null ? (
            <Button
              label="Search"
              variant="primary"
              disabled={tools?.ytdlp === false}
              onPress={submit}
              testID="import-search"
            />
          ) : (
            <Button
              label={preview.isPending ? 'Looking…' : 'Look it up'}
              variant="primary"
              disabled={!ready}
              onPress={submit}
              testID="import-look-up"
            />
          )}
        </View>
      </View>
      {/* What the box takes, named once and quietly: not buttons, only a reminder. */}
      <View
        style={styles.sources}
        accessible
        accessibilityLabel="Takes YouTube, 网易云音乐, Spotify or a list of names"
      >
        {SOURCES.map(name => (
          <Text key={name} style={styles.source}>
            {name}
          </Text>
        ))}
      </View>
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
      {error ? (
        <NoticeCard tone="error" onDismiss={() => setError(null)}>
          {error}
        </NoticeCard>
      ) : null}
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
                      label="Remove all"
                      accessibilityLabel="Remove every import that failed"
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
          {jobs}
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
        steps={[{ gesture: 'swipe-left', text: 'Swipe left for Next and Remove', distance: 120 }]}
      />
    </SafeAreaView>
  )
}

/** Where songs can come from, under the box. */
const SOURCES = ['YouTube', '网易云音乐', 'Spotify', 'a list of names'] as const

/** Three lines of links before the box starts growing. */
const LINKS_MIN_HEIGHT = 66

/** "In your library · tagged night drive": where a finished song went, and how. */
function arrivedLine(job: ImportJob, tags: readonly Tag[]): string {
  const names = tags.filter(tag => job.tagIds.includes(tag.id)).map(tag => tag.name)
  return names.length > 0 ? `In your library · tagged ${names.join(', ')}` : 'In your library'
}

/**
 * One of the queue's lists: its name and what can be done to all of it, a
 * line of counts when there is more than a glance takes in, then its rows —
 * the first `ROWS_SHOWN`, and "Show more" for the rest.
 *
 * Drawn as siblings in the queue's one column rather than a box of its own,
 * each moving by itself (`useRowMotion`): a browser moves a box whose height
 * changed by stretching it to the new height, rows and all, and a list losing
 * a row is exactly that. Siblings only ever slide.
 */
function JobGroup({
  title,
  first,
  lead,
  jobs,
  actions,
  renderRow,
  testID,
}: {
  title: string
  /** The queue's first list sits at the top; the others keep a gap above. */
  first: boolean
  /** Under the name, above the rows: Currently importing's progress. */
  lead?: ReactNode
  jobs: readonly ImportJob[]
  actions: ReactNode
  renderRow: (job: ImportJob) => ReactNode
  testID: string
}): ReactNode {
  const motion = useRowMotion()
  const [all, setAll] = useState(false)
  const shown = all ? jobs : jobs.slice(0, ROWS_SHOWN)
  const hidden = jobs.length - ROWS_SHOWN
  return (
    <>
      <Animated.View {...motion} style={!first && styles.groupApart}>
        <SectionHead
          look="label"
          title={title}
          titleTestID={testID}
          end={<View style={styles.groupActions}>{actions}</View>}
        />
      </Animated.View>
      {lead ? <Animated.View {...motion}>{lead}</Animated.View> : null}
      {shown.map(job => (
        <Animated.View key={job.id} {...motion}>
          {renderRow(job)}
        </Animated.View>
      ))}
      {hidden > 0 ? (
        <Animated.View {...motion}>
          <FoldAction
            label={all ? 'Show fewer' : `Show ${hidden} more`}
            accessibilityLabel={all ? `Show fewer of ${title}` : `Show all of ${title}`}
            expanded={all}
            onPress={() => setAll(!all)}
            testID={`${testID}-more`}
          />
        </Animated.View>
      ) : null}
    </>
  )
}

/**
 * "Starts in 0:38" under the song whose turn is next. The queue goes at the
 * pace YouTube allows this address (services/ytThrottle.ts) — signed out, a
 * song most of a minute — and the server says how long until the next may
 * go, so the wait is counted down rather than drawn as a download at 0 %.
 * The server's own wait already holds a rate-limit pause, when one is on.
 */
function nextLine(pacing: ImportPacing): string {
  if (pacing.waitMs <= 0) return 'Next'
  const why = pacing.pausedUntil !== null ? 'YouTube asked us to slow down' : 'pacing YouTube'
  return `Starts in ${clockIn(pacing.waitMs)} · ${why}`
}

/**
 * The queue's progress, which is the progress there is: "12 of 64 in", about
 * how long the rest will take (the server's guess from the run's own pace),
 * and one bar. A song's own bytes arrive in a fraction of a second, so a bar
 * per song sat at 0 % through the wait for its turn and then jumped to full.
 */
function RunProgress({ run }: { run: ImportRun }): ReactNode {
  return (
    <View style={styles.run} testID="import-run">
      <View style={styles.runLine}>
        <Text style={styles.runCount}>{`${run.done} of ${run.total} in`}</Text>
        <Text style={styles.runLeft}>{run.leftMs === null ? 'Paused' : timeLeft(run.leftMs)}</Text>
      </View>
      <ProgressBar
        fraction={run.total > 0 ? run.done / run.total : 0}
        label="Songs imported"
        animated
      />
    </View>
  )
}

/**
 * Earlier today: the songs that arrived, a few at once, and a way to clear
 * them. Clear takes these and nothing else — a row under Currently importing
 * or Couldn't import keeps its reason, its Retry and its own ×. The polled
 * queue carries only the newest few of these; "Show all" counts them all
 * (`total`) and reads the rest when pressed.
 */
function Finished({
  first,
  jobs,
  total,
  tags,
  all,
  onShowAll,
  onClear,
}: {
  first: boolean
  jobs: readonly ImportJob[]
  total: number
  tags: readonly Tag[]
  all: boolean
  onShowAll: (all: boolean) => void
  onClear: () => void
}): ReactNode {
  const motion = useRowMotion()
  const today = finishedLabel(jobs).endsWith('today')
  const shown = all ? jobs : jobs.slice(0, FINISHED_SHOWN)
  return (
    <>
      <Animated.View {...motion} style={!first && styles.groupApart}>
        <SectionHead
          look="label"
          title={today ? 'Earlier today' : 'Earlier'}
          titleTestID="import-finished"
          end={
            <FoldAction
              label="Clear"
              accessibilityLabel="Clear finished imports"
              onPress={onClear}
            />
          }
        />
      </Animated.View>
      {shown.map(job => (
        <Animated.View key={job.id} {...motion} style={styles.job}>
          <Cover uri={job.thumbnail} title={job.title || job.url} size={coverSize.row} />
          <View style={styles.jobMeta}>
            <Text style={styles.jobTitle} numberOfLines={1}>
              {job.title || job.url}
            </Text>
            <Text style={[styles.jobSub, styles.good]} numberOfLines={1}>
              {arrivedLine(job, tags)}
            </Text>
          </View>
        </Animated.View>
      ))}
      {total > FINISHED_SHOWN ? (
        <Animated.View {...motion}>
          <FoldAction
            label={all ? 'Show fewer' : `Show all ${total}`}
            accessibilityLabel={all ? 'Hide finished imports' : 'Show finished imports'}
            expanded={all}
            onPress={() => onShowAll(!all)}
            testID="import-show-all"
          />
        </Animated.View>
      ) : null}
    </>
  )
}

/** "Clear", "Pause all" and "Show more": quiet, in the accent, a finger's height. */
function FoldAction({
  label,
  accessibilityLabel,
  expanded,
  onPress,
  testID,
}: {
  label: string
  accessibilityLabel: string
  expanded?: boolean
  onPress: () => void
  testID?: string
}): ReactNode {
  return (
    <Button
      size="small"
      variant="text"
      label={label}
      accessibilityLabel={accessibilityLabel}
      expanded={expanded}
      onPress={onPress}
      testID={testID}
    />
  )
}

/**
 * One import: its cover, where it is up to, and one ring (`QueueRing`) that
 * is both how far it has got and the one thing to do to it — pause, resume,
 * retry (`jobAction`). Taking it off the queue is quieter, since it is rarer
 * and not undone: a ⋯ that comes with the pointer on a computer, a swipe to
 * the left on a phone. Neither is offered once the song is adding itself to
 * the library, when nothing can stop it. "Import next" sits beside it, in
 * the ⋯ or on the same swipe, for a song waiting behind others.
 */
function JobRow({
  job,
  tags,
  nextLine: next,
  onPause,
  onResume,
  onRetry,
  onDismiss,
  onNext,
  guideTarget,
  guide,
}: {
  job: ImportJob
  tags: readonly Tag[]
  /** Where the swipe guide lights, on the first row that swipes. */
  guideTarget?: GuideTarget
  /** That guide, which opens the row's swipe as its hand pulls. */
  guide?: GuideHandle
  /** For the song whose turn is next: when it starts. */
  nextLine: string | null
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onDismiss: () => void
  /** "Import next", while it would move the song (`canImportNext`). */
  onNext: (() => void) | null
}): ReactNode {
  const { wide, dense } = useLayout()
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const tone = jobTone(job)
  const action = jobAction(job)
  const name = job.title || 'this import'
  const toneStyle =
    tone === 'running'
      ? styles.running
      : tone === 'error'
        ? styles.failed
        : tone === 'waiting'
          ? styles.waiting
          : tone === 'done'
            ? styles.good
            : tone === 'cancelled'
              ? styles.mutedText
              : null
  const status =
    tone === 'done' ? arrivedLine(job, tags) : (job.status === 'queued' && next) || jobSubtitle(job)
  const removable = dismissable(job)

  const ring =
    action === 'cancel' ? (
      <QueueRing
        fill={stepFraction(job)}
        glyph="pause"
        waiting={job.status === 'queued'}
        label={`Pause ${name}`}
        onPress={onPause}
        testID={`import-pause-${job.id}`}
      />
    ) : action === 'resume' ? (
      <QueueRing
        fill={0}
        glyph="play"
        label={`Resume ${name}`}
        onPress={onResume}
        testID={`import-resume-${job.id}`}
      />
    ) : action === 'retry' || action === 'try-now' ? (
      <QueueRing
        fill={action === 'try-now' ? stepFraction({ ...job, status: 'running' }) : 0}
        glyph="retry"
        tone={action === 'try-now' ? 'warning' : 'danger'}
        label={action === 'try-now' ? `Try uploading ${name} now` : `Retry ${name}`}
        onPress={onRetry}
        testID={`import-retry-${job.id}`}
      />
    ) : (
      <QueueRing fill={stepFraction(job)} glyph={null} label={`${name}: ${status}`} />
    )

  const row = (
    <View
      style={[
        styles.job,
        styles.jobBody,
        wide && dense && (hovered || menuOpen) && styles.jobHovered,
      ]}
      onPointerEnter={wide && dense ? () => setHovered(true) : undefined}
      onPointerLeave={wide && dense ? () => setHovered(false) : undefined}
    >
      <Cover uri={job.thumbnail} title={job.title || job.url} size={coverSize.row} />
      <View style={styles.jobMeta}>
        <Text style={[styles.jobTitle, tone === 'cancelled' && styles.mutedText]} numberOfLines={1}>
          {job.title || job.url}
        </Text>
        <Text style={[styles.jobSub, toneStyle]} numberOfLines={2}>
          {status}
        </Text>
      </View>
      {ring}
      {wide ? (
        <RowMore
          // With a mouse it waits for the pointer; a tablet at this width shows it.
          shown={removable && (!dense || hovered || menuOpen)}
          enabled={removable}
          name={name}
          open={menuOpen}
          onOpen={setMenuOpen}
          onRemove={onDismiss}
          onNext={onNext}
          testID={`import-more-${job.id}`}
          removeTestID={`import-dismiss-${job.id}`}
          nextTestID={`import-next-${job.id}`}
        />
      ) : null}
    </View>
  )

  if (wide || !removable) return row
  const swipe = (
    <SwipeActions
      name={name}
      onRemove={onDismiss}
      onNext={onNext}
      testID={`import-dismiss-${job.id}`}
      nextTestID={`import-next-${job.id}`}
      guide={guide}
    >
      {row}
    </SwipeActions>
  )
  return guideTarget ? (
    <View ref={guideTarget} collapsable={false}>
      {swipe}
    </View>
  ) : (
    swipe
  )
}

/**
 * A computer's ⋯ on an import's row, and the menu it opens: Import next, for
 * a song waiting behind others, and Remove from queue. Its place is kept when
 * there is nothing to offer, so the rings of every row line up.
 */
function RowMore({
  shown,
  enabled,
  name,
  open,
  onOpen,
  onRemove,
  onNext,
  testID,
  removeTestID,
  nextTestID,
}: {
  shown: boolean
  enabled: boolean
  name: string
  open: boolean
  onOpen: (open: boolean) => void
  onRemove: () => void
  onNext: (() => void) | null
  testID: string
  removeTestID: string
  nextTestID: string
}): ReactNode {
  const opacity = useFade(shown, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  const items: MenuItem[] = [
    ...(onNext
      ? [
          {
            key: 'next',
            label: 'Import next',
            icon: <Next size={iconSize.button} tone="textPrimary" />,
            onPress: onNext,
            testID: nextTestID,
          },
        ]
      : []),
    {
      key: 'remove',
      label: 'Remove from imports',
      icon: <X size={iconSize.button} tone="danger" />,
      danger: true,
      onPress: onRemove,
      testID: removeTestID,
    },
  ]
  return (
    <RNAnimated.View style={{ opacity }} pointerEvents={enabled ? 'auto' : 'none'}>
      <MoreMenu
        name={name}
        filled={false}
        disabled={!enabled}
        caption="More"
        open={open}
        onOpenChange={onOpen}
        items={items}
        testID={testID}
      />
    </RNAnimated.View>
  )
}

/**
 * A phone's way to take an import off the queue: swipe the row left and press
 * Remove behind it, as Mail and Messages do. A song waiting behind others has
 * Next beside it ("Import next"), on the same swipe — the way Mail puts More
 * and Flag beside Trash. Both on one side: a swipeable's hidden side only goes
 * transparent, and on the web and Android it went on taking the presses meant
 * for the other. With a screen reader each is the row's own action, since a
 * swipe is not one it can make.
 */
function SwipeActions({
  name,
  onRemove,
  onNext,
  testID,
  nextTestID,
  guide,
  children,
}: {
  name: string
  onRemove: () => void
  onNext: (() => void) | null
  testID: string
  nextTestID: string
  guide?: GuideHandle
  children: ReactNode
}): ReactNode {
  const swipeable = useRef<SwipeableMethods>(null)
  useOpenWith(
    guide ?? null,
    () => swipeable.current?.openRight(),
    () => swipeable.current?.close(),
  )
  return (
    <ReanimatedSwipeable
      ref={swipeable}
      friction={1.6}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={(_progress, _translation, swipeable) => (
        <View style={styles.swipeActions}>
          {onNext ? (
            <Press
              feedback="dim"
              onPress={() => {
                swipeable.close()
                onNext()
              }}
              accessibilityRole="button"
              accessibilityLabel={`Import ${name} next`}
              style={[styles.swipeAction, styles.swipeNext]}
              testID={nextTestID}
            >
              <Text style={[styles.swipeActionText, styles.swipeNextText]}>Next</Text>
            </Press>
          ) : null}
          <Press
            feedback="dim"
            onPress={() => {
              swipeable.close()
              onRemove()
            }}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${name} from imports`}
            style={[styles.swipeAction, styles.swipeRemove]}
            testID={testID}
          >
            <Text style={styles.swipeActionText}>Remove</Text>
          </Press>
        </View>
      )}
    >
      <View
        accessibilityActions={[
          ...(onNext ? [{ name: 'next', label: 'Import next' }] : []),
          { name: 'remove', label: 'Remove from imports' },
        ]}
        onAccessibilityAction={event => {
          if (event.nativeEvent.actionName === 'next') onNext?.()
          if (event.nativeEvent.actionName === 'remove') onRemove()
        }}
      >
        {children}
      </View>
    </ReanimatedSwipeable>
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
    paddingTop: space.roomy,
    paddingBottom: space.snug,
    paddingHorizontal: 18,
  },
  composeFocused: {
    boxShadow: `0 0 0 1.5px ${theme.colors.accent}, 0 1px 2px ${theme.colors.cardShadow}, 0 8px 24px ${theme.colors.cardShadow}`,
  },
  linksInput: {
    color: theme.colors.textPrimary,
    ...textStyle('body'),
    _web: { outlineStyle: 'none' },
  },
  composeFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space.snug,
    marginLeft: -4,
  },
  // The sources under the box: quiet words on a faint pill, wrapping on a narrow phone.
  sources: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.tight,
    paddingHorizontal: space.xs,
  },
  source: {
    color: theme.colors.textMuted,
    ...textStyle('small'),
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface2,
    overflow: 'hidden',
  },
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
  groupApart: { marginTop: space.md },
  groupActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  job: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 62 },
  jobMeta: { flex: 1, minWidth: 0, gap: 3 },
  jobTitle: rowTitle(theme.colors),
  mutedText: { color: theme.colors.textMuted },
  jobSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  running: { color: theme.colors.accent },
  failed: { color: theme.colors.danger },
  waiting: { color: theme.colors.warning },
  good: { color: theme.colors.good },
  // Opaque, so a phone's Remove waits behind it until the row is swiped aside.
  jobBody: { backgroundColor: theme.colors.surface0, borderRadius: radius.cover },
  // A computer's row warms under the pointer, as a song's row does.
  jobHovered: {
    backgroundColor: theme.colors.surface1,
    marginHorizontal: -10,
    paddingHorizontal: space.snug,
  },
  swipeActions: { flexDirection: 'row', gap: space.sm, paddingLeft: space.sm },
  swipeAction: {
    width: 84,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.cover,
  },
  swipeNext: { backgroundColor: theme.colors.accent },
  // The ground Up next's rows are swiped off onto, with its ink.
  swipeRemove: { backgroundColor: theme.colors.remove },
  swipeActionText: rowTitle(theme.colors),
  swipeNextText: { color: theme.colors.onAccent },
  run: { gap: space.sm, marginTop: space.tight, marginBottom: space.tight },
  runLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
  },
  runCount: { color: theme.colors.textPrimary, fontSize: type.section, fontWeight: '700' },
  runLeft: { color: theme.colors.textSecondary, fontSize: type.sub },
}))
