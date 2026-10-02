import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated as RNAnimated, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import Animated, { LayoutAnimationConfig } from 'react-native-reanimated'
import ReanimatedSwipeable from 'react-native-gesture-handler/ReanimatedSwipeable'
import type { ImportJob, ImportPacing, ImportRun, Tag } from '@selfmp3/shared'
import {
  ApiError,
  clockIn,
  dismissable,
  finishedLabel,
  foldQueue,
  hasLink,
  jobAction,
  jobSubtitle,
  jobTone,
  linkHint,
  matchingTag,
  queueControls,
  radius,
  reviewFrom,
  sharedLinks,
  stepFraction,
  timeLeft,
  type QueueChange,
  type ServerConnection,
} from '@selfmp3/client'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayout } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { card, label as groupLabel, pageTitle } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, ListMusic, More, Refresh, X } from '../../ui/components/Icons'
import { Popover } from '../../ui/components/Popover'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { SheetItem } from '../../ui/components/Sheet'
import { ease, timing, useFade } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { useRowMotion } from '../../ui/rowMotion'
import { QueueRing } from './QueueRing'
import { TagItPill } from './ImportTags'
import { draftFor, useImportDraft } from './importDraft'
import { draftSourceFor } from './importDraft.model'
import { reviewUrls, useRefreshReview } from './useRefreshReview'
import { useImportSource } from './importSource'
import { countLabel, reviewName } from './review.model'

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
  const rowMotion = useRowMotion()
  /** "Show all" under Earlier today: the whole history is read only then. */
  const [showAll, setShowAll] = useState(false)
  const source = useImportSource(via, { history: showAll })
  const { api, library, tools, refetchTools, queue, history } = source
  const viaServer = via !== undefined
  const params = useLocalSearchParams<{ url?: string; text?: string; title?: string }>()

  // The draft outlives this screen (importDraft.store.ts); only the error is the screen's.
  const key = draftSourceFor(via)
  const [draft, patchDraft] = useImportDraft(key)
  const { links, review, tagIds } = draft
  // The card offering a kept review counts songs coming in: as the library is now.
  useRefreshReview(api, key, reviewUrls(review))
  const [error, setError] = useState<string | null>(null)
  const [linksFocused, setLinksFocused] = useState(false)
  /** What the pasted links take up, so the box grows with them. */
  const [linksHeight, setLinksHeight] = useState(0)
  /*
   * A request that never reached the server is not an import that failed. The
   * browser's words for it are "Failed to fetch", which tell a person nothing
   * and used to be all this screen said — while the way forward, leaving the
   * link for the server to take when it wakes, sat on a screen it never showed
   * because the look-out only looks every twenty seconds, and not at all in a
   * tab that is in the background.
   */
  const failed = (err: Error): void => {
    if (viaServer && err instanceof ApiError && err.isOffline) {
      setError('Your server stopped answering. Looking for it again…')
      onUnreachable?.()
      return
    }
    setError(err.message)
  }

  const tags = library?.tags ?? []

  const preview = useMutation({
    mutationFn: (input: string) => api.importPreview(input),
    onSuccess: result => {
      const next = reviewFrom(result)
      // A link named like a tag you already have — an artist's page, a search
      // for them — is tagged that way without asking, on top of the tags
      // chosen here for whatever arrives.
      const match = matchingTag(tags, next.playlistTitle)
      const chosen = new Set(draftFor(key).tagIds)
      if (match !== null) chosen.add(match)
      patchDraft({ review: next, tagIds: chosen })
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
  const act = (change: QueueChange, request: () => Promise<unknown>): void => {
    source.editQueue(change)
    send(request())
  }

  const hint = linkHint(links)
  const folded = queue ? foldQueue(queue.jobs) : null
  const controls = folded ? queueControls(folded.importing) : null
  const ready = hasLink(links) && !preview.isPending && tools?.ytdlp !== false

  const form = (
    <View style={styles.form}>
      <Text style={styles.explain}>
        Paste a YouTube or YouTube Music link. A playlist link brings the whole playlist, and an
        artist’s page their top songs.
        {viaServer
          ? ' This goes through your server, which downloads the songs and syncs them to every device.'
          : ''}
      </Text>
      {/*
       * A compose card: room for several links, one per line, with what
       * happens to them along its foot — the tag they arrive with on the left,
       * the commit on the right. It grows with what is pasted, and the whole
       * card carries the focus ring, since the whole card is the control.
       */}
      <View style={[styles.compose, linksFocused && styles.composeFocused]}>
        <TextInput
          style={[styles.linksInput, { height: Math.max(LINKS_MIN_HEIGHT, linksHeight) }]}
          value={links}
          onChangeText={next => patchDraft({ links: next })}
          onContentSizeChange={event => setLinksHeight(event.nativeEvent.contentSize.height)}
          onFocus={() => setLinksFocused(true)}
          onBlur={() => setLinksFocused(false)}
          placeholder="Paste links here, one per line"
          placeholderTextColor={theme.colors.textMuted}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          accessibilityLabel="Links to import"
        />
        {hint ? (
          <Text style={styles.linkHint} accessibilityRole="alert">
            {hint}
          </Text>
        ) : null}
        <View style={styles.composeFoot}>
          <TagItPill
            tags={tags}
            createTag={source.createTag}
            selected={tagIds}
            onChange={next => patchDraft({ tagIds: next })}
          />
          <Button
            label={preview.isPending ? 'Looking…' : 'Look it up'}
            variant="primary"
            disabled={!ready}
            onPress={() => {
              if (hasLink(links)) lookUp(links.trim())
            }}
            testID="import-look-up"
          />
        </View>
      </View>
    </View>
  )

  const notices = (
    <>
      {tools && !tools.ytdlp ? (
        <View style={styles.notice}>
          <View style={styles.noticeBody}>
            <Text style={styles.noticeText}>
              <Text style={[styles.strong, styles.strongWarn]}>yt-dlp isn’t installed.</Text>{' '}
              Importing needs it. Install both tools with:
            </Text>
            <Text style={styles.code} selectable>
              brew install yt-dlp ffmpeg
            </Text>
          </View>
          <Button
            label="Check again"
            icon={<Refresh size={13} color={theme.colors.textPrimary} />}
            onPress={() => void refetchTools()}
          />
        </View>
      ) : null}
      {tools?.ytdlp && !tools.ffmpeg ? (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            <Text style={styles.strong}>ffmpeg isn’t installed.</Text> Downloads still work, but
            cover art and tags won’t be embedded. brew install ffmpeg
          </Text>
        </View>
      ) : null}
      {error ? (
        <View style={[styles.notice, styles.noticeError]} accessibilityRole="alert">
          <Text style={[styles.noticeText, styles.noticeTextError]}>{error}</Text>
          <IconButton onPress={() => setError(null)} label="Dismiss">
            <X size={15} color={theme.colors.textMuted} />
          </IconButton>
        </View>
      ) : null}
      {/* A review left with Back is still in the draft, one tap from where it was. */}
      {review && review.items.length > 0 && !preview.isPending ? (
        <Pressable
          style={({ pressed }) => [styles.linkCard, pressed && styles.linkCardPressed]}
          onPress={() => router.push('/import/review')}
          accessibilityRole="link"
          accessibilityLabel={`Go on reviewing ${reviewName(review)}`}
          testID="import-resume-review"
        >
          <View style={styles.linkCardText}>
            <Text style={styles.linkCardTitle} numberOfLines={1}>
              {reviewName(review)}
            </Text>
            <Text style={styles.linkCardSub}>{countLabel(review, true)} · not imported yet</Text>
          </View>
          <ChevronRight size={16} color={theme.colors.textMuted} />
        </Pressable>
      ) : null}
    </>
  )

  // Migrating asks whatever answers this device, which through a server is still the bucket.
  const migrate = viaServer ? null : (
    <Pressable
      style={({ pressed }) => [styles.migrate, pressed && styles.migratePressed]}
      onPress={() => router.push('/import/migrate')}
      accessibilityRole="link"
      accessibilityLabel="Migrate a playlist from another app"
    >
      <ListMusic size={18} tone="accent" />
      <View style={styles.linkCardText}>
        <Text style={styles.linkCardTitle}>Migrate a playlist from another app</Text>
        <Text style={styles.linkCardSub}>
          A Spotify link, a CSV export or a list of songs, each matched to a YouTube upload for you
          to check first.
        </Text>
      </View>
      <ChevronRight size={16} color={theme.colors.textMuted} />
    </Pressable>
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
  const rowProps = (job: ImportJob) => ({
    job,
    tags,
    nextLine: job.id === nextUp && queue ? nextLine(queue.pacing) : null,
    onPause: () => act({ kind: 'pause', id: job.id }, () => api.cancelImport(job.id)),
    onResume: () => act({ kind: 'resume', id: job.id }, () => api.retryImport(job.id)),
    onRetry: () => act({ kind: 'retry', id: job.id }, () => api.retryImport(job.id)),
    onDismiss: () => act({ kind: 'remove', id: job.id }, () => api.dismissImport(job.id)),
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
        keyboardShouldPersistTaps="handled"
        testID="import-screen"
      >
        <View style={styles.head}>
          {/* On a phone Import is a page over Home or Profile, and the ‹ goes
              back to it, drawn as every other way back is (`BackButton`). */}
          <BackButton to="/profile" label="Profile" testID="import-back" />
          <Text style={styles.heading} accessibilityRole="header">
            Import
          </Text>
        </View>

        {wide ? (
          // One column, the page's width, and what arrived under it at the foot
          // of the page: a second column beside the form was squeezed to a
          // strip of covers wherever the window was not wide enough for both.
          <View style={styles.stack}>
            <View style={styles.formColumn}>
              {form}
              {notices}
              <View style={styles.otherWays}>
                <Text style={styles.otherTitle}>Other ways in</Text>
                <Text style={styles.otherBody}>
                  Share a link from the browser extension, or to self.mp3 from YouTube itself. It
                  lands here.
                </Text>
                {migrate}
              </View>
            </View>
            {jobs}
          </View>
        ) : (
          <View style={styles.stack}>
            {form}
            {notices}
            {jobs}
            {/* Under the queue, so it slides as the queue's rows come and go. */}
            <Animated.View layout={rowMotion.layout} style={styles.stack}>
              {migrate}
              <Text style={styles.shareHint}>
                You can also share a link to self.mp3 from YouTube itself. It lands here.
              </Text>
            </Animated.View>
          </View>
        )}
        <ChromeSpacer />
      </ScrollView>
    </SafeAreaView>
  )
}

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
      <Animated.View {...motion} style={[styles.groupHead, !first && styles.groupApart]}>
        <Text style={styles.groupLabel} accessibilityRole="header" testID={testID}>
          {title}
        </Text>
        <View style={styles.groupActions}>{actions}</View>
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
  const fraction = run.total > 0 ? run.done / run.total : 0
  const [drawn] = useState(() => new RNAnimated.Value(fraction))
  const sent = useRef(fraction)
  useEffect(() => {
    if (sent.current === fraction) return
    sent.current = fraction
    // A width is no transform: the native driver cannot move it.
    timing(drawn, fraction, MOVE_MS.ringFill, undefined, { easing: ease.out, native: false })
  }, [fraction, drawn])
  const [width] = useState(() =>
    drawn.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'], extrapolate: 'clamp' }),
  )
  return (
    <View style={styles.run} testID="import-run">
      <View style={styles.runLine}>
        <Text style={styles.runCount}>{`${run.done} of ${run.total} in`}</Text>
        <Text style={styles.runLeft}>{run.leftMs === null ? 'Paused' : timeLeft(run.leftMs)}</Text>
      </View>
      <View
        style={styles.runTrack}
        accessibilityRole="progressbar"
        accessibilityLabel="Songs imported"
        accessibilityValue={{ min: 0, max: run.total, now: run.done }}
      >
        <RNAnimated.View style={[styles.runFill, { width }]} />
      </View>
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
      <Animated.View {...motion} style={[styles.groupHead, !first && styles.groupApart]}>
        <Text style={styles.groupLabel} accessibilityRole="header" testID="import-finished">
          {today ? 'Earlier today' : 'Earlier'}
        </Text>
        <FoldAction label="Clear" accessibilityLabel="Clear finished imports" onPress={onClear} />
      </Animated.View>
      {shown.map(job => (
        <Animated.View key={job.id} {...motion} style={styles.job}>
          <Cover uri={job.thumbnail} title={job.title || job.url} size={46} />
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
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      hitSlop={{ top: 8, bottom: 8 }}
      style={({ pressed }) => [styles.foldAction, pressed && styles.pressed]}
      testID={testID}
    >
      <Text style={styles.foldActionText}>{label}</Text>
    </Pressable>
  )
}

/**
 * One import: its cover, where it is up to, and one ring (`QueueRing`) that
 * is both how far it has got and the one thing to do to it — pause, resume,
 * retry (`jobAction`). Taking it off the queue is quieter, since it is rarer
 * and not undone: a ⋯ that comes with the pointer on a computer, a swipe to
 * the left on a phone. Neither is offered once the song is adding itself to
 * the library, when nothing can stop it.
 */
function JobRow({
  job,
  tags,
  nextLine: next,
  onPause,
  onResume,
  onRetry,
  onDismiss,
}: {
  job: ImportJob
  tags: readonly Tag[]
  /** For the song whose turn is next: when it starts. */
  nextLine: string | null
  onPause: () => void
  onResume: () => void
  onRetry: () => void
  onDismiss: () => void
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
      <Cover uri={job.thumbnail} title={job.title || job.url} size={46} />
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
          testID={`import-more-${job.id}`}
          removeTestID={`import-dismiss-${job.id}`}
        />
      ) : null}
    </View>
  )

  if (wide || !removable) return row
  return (
    <SwipeToRemove name={name} onRemove={onDismiss} testID={`import-dismiss-${job.id}`}>
      {row}
    </SwipeToRemove>
  )
}

/**
 * A computer's ⋯ on an import's row, and the menu it opens. Its place is kept
 * when there is nothing to offer, so the rings of every row line up.
 */
function RowMore({
  shown,
  enabled,
  name,
  open,
  onOpen,
  onRemove,
  testID,
  removeTestID,
}: {
  shown: boolean
  enabled: boolean
  name: string
  open: boolean
  onOpen: (open: boolean) => void
  onRemove: () => void
  testID: string
  removeTestID: string
}): ReactNode {
  const { theme } = useUnistyles()
  const anchor = useRef<View>(null)
  const opacity = useFade(shown, MOVE_MS.hoverIn, MOVE_MS.hoverOut)
  return (
    <RNAnimated.View style={{ opacity }} pointerEvents={enabled ? 'auto' : 'none'}>
      <View ref={anchor} collapsable={false}>
        <IconButton
          onPress={() => onOpen(true)}
          label={`More for ${name}`}
          caption="More"
          disabled={!enabled}
          testID={testID}
        >
          <More size={17} color={theme.colors.textMuted} />
        </IconButton>
      </View>
      <Popover open={open} onClose={() => onOpen(false)} anchorRef={anchor} width={220}>
        <View testID={removeTestID}>
          <SheetItem
            label="Remove from queue"
            icon={<X size={15} color={theme.colors.danger} />}
            danger
            onPress={() => {
              onOpen(false)
              onRemove()
            }}
          />
        </View>
      </Popover>
    </RNAnimated.View>
  )
}

/**
 * A phone's way to take an import off the queue: swipe the row left and press
 * Remove behind it, as Mail and Messages do — or, with a screen reader, the
 * row's own Remove action, since a swipe is not one it can make.
 */
function SwipeToRemove({
  name,
  onRemove,
  testID,
  children,
}: {
  name: string
  onRemove: () => void
  testID: string
  children: ReactNode
}): ReactNode {
  return (
    <ReanimatedSwipeable
      friction={1.6}
      rightThreshold={40}
      overshootRight={false}
      renderRightActions={(_progress, _translation, swipeable) => (
        <Pressable
          onPress={() => {
            swipeable.close()
            onRemove()
          }}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name} from the queue`}
          style={({ pressed }) => [styles.swipeRemove, pressed && styles.pressed]}
          testID={testID}
        >
          <Text style={styles.swipeRemoveText}>Remove</Text>
        </Pressable>
      )}
    >
      <View
        accessibilityActions={[{ name: 'remove', label: 'Remove from queue' }]}
        onAccessibilityAction={event => {
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
  contentWide: { paddingTop: 40, paddingHorizontal: 48 },
  contentPhone: { paddingTop: 6, paddingHorizontal: 20 },
  pressed: { opacity: 0.6 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  heading: pageTitle(theme.colors),
  formColumn: { gap: 22 },
  stack: { gap: 24 },
  form: { gap: 10 },
  explain: { color: theme.colors.textSecondary, fontSize: 14, lineHeight: 20 },
  // The compose card: the links' room, then its foot. Focused, the card wears the accent ring.
  compose: {
    ...card(theme.colors),
    gap: 8,
    paddingTop: 14,
    paddingBottom: 10,
    paddingHorizontal: 18,
  },
  composeFocused: {
    boxShadow: `0 0 0 1.5px ${theme.colors.accent}, 0 1px 2px ${theme.colors.cardShadow}, 0 8px 24px ${theme.colors.cardShadow}`,
  },
  linksInput: {
    color: theme.colors.textPrimary,
    fontSize: 15,
    lineHeight: 22,
    _web: { outlineStyle: 'none' },
  },
  composeFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
    marginLeft: -4,
  },
  linkHint: { color: theme.colors.danger, fontSize: 12, lineHeight: 17 },
  strong: { color: theme.colors.textPrimary, fontWeight: '600' },
  // With no edge around the notice, its first words carry the warning's colour.
  strongWarn: { color: theme.colors.warning },
  // On the notice's card, so one step up from it.
  code: {
    marginTop: 6,
    color: theme.colors.textPrimary,
    fontSize: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.coverSm,
  },
  // A notice is a card; a warning or an error is told by its words, not an edge.
  notice: {
    ...card(theme.colors),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  noticeError: { paddingRight: 4 },
  noticeBody: { flex: 1 },
  noticeText: { flex: 1, color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  noticeTextError: { color: theme.colors.danger },
  linkCard: {
    ...card(theme.colors),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  linkCardPressed: { backgroundColor: theme.colors.surface2 },
  linkCardText: { flex: 1, minWidth: 0, gap: 3 },
  linkCardTitle: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' },
  linkCardSub: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  migrate: {
    ...card(theme.colors),
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  migratePressed: { backgroundColor: theme.colors.surface2 },
  // `C13`'s card: the other ways a song gets here, and the migration among them.
  otherWays: { ...card(theme.colors), gap: 6, paddingVertical: 16, paddingHorizontal: 18 },
  otherTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '600' },
  otherBody: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  shareHint: { color: theme.colors.textMuted, fontSize: 13, lineHeight: 18 },
  jobs: { gap: 6 },
  groupApart: { marginTop: 12 },
  groupHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  groupLabel: groupLabel(theme.colors),
  foldAction: { alignSelf: 'flex-start', paddingVertical: 4 },
  foldActionText: { color: theme.colors.accent, fontSize: 13, fontWeight: '600' },
  job: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 62 },
  jobMeta: { flex: 1, minWidth: 0, gap: 3 },
  jobTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  mutedText: { color: theme.colors.textMuted },
  jobSub: { color: theme.colors.textSecondary, fontSize: 13 },
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
    paddingHorizontal: 10,
  },
  swipeRemove: {
    width: 92,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.danger,
    borderRadius: radius.cover,
    marginLeft: 8,
  },
  swipeRemoveText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  run: { gap: 8, marginTop: 6, marginBottom: 6 },
  runLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  runCount: { color: theme.colors.textPrimary, fontSize: 18, fontWeight: '700' },
  runLeft: { color: theme.colors.textSecondary, fontSize: 13 },
  runTrack: {
    height: 5,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  runFill: { height: 5, borderRadius: radius.pill, backgroundColor: theme.colors.accent },
}))
