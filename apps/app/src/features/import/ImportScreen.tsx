import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import type { ImportJob, Tag } from '@selfmp3/shared'
import {
  ApiError,
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
  type ServerConnection,
} from '@selfmp3/client'
import { ChromeSpacer } from '../../shell/ChromeSpacer'
import { useLayout } from '../../shell/useLayout'
import { BackButton } from '../../ui/components/BackButton'
import { card, label as groupLabel, pageTitle } from '../../ui/surfaces'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { IconButton } from '../../ui/components/IconButton'
import { ChevronRight, ListMusic, Refresh, X } from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { TagItPill } from './ImportTags'
import { draftFor, useImportDraft } from './importDraft'
import { draftSourceFor } from './importDraft.model'
import { reviewUrls, useRefreshReview } from './useRefreshReview'
import { useImportSource } from './importSource'
import { countLabel, reviewName } from './review.model'

/** How many of today's finished imports are listed before "Show all". */
const FINISHED_SHOWN = 5

/**
 * Importing (docs/ui-mock `P29`, `C13`).
 *
 * Paste a link and look it up; what it holds opens on its own page to review
 * (`/import/review`, ImportReview.tsx), and from there into the queue, which
 * this page shows as Now and Earlier today. The tags chosen here — "Tag it …
 * as it arrives" — are the review's too. On a phone this page is Home's + and
 * a row under You, and "Done" goes back; on a computer it is in the sidebar,
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
  const source = useImportSource(via)
  const { api, library, tools, refetchTools, queue } = source
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

  const afterJob = (promise: Promise<unknown>): void => {
    void promise.then(() => source.invalidateQueue())
  }

  const hint = linkHint(links)
  const folded = queue ? foldQueue(queue.jobs) : null
  const controls = folded ? queueControls(folded.open) : null
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
   * What is happening, then what arrived. What needs you — running, waiting,
   * failed — is always first; the day's arrivals come after it, a few at a
   * time, since a morning's imports were a screen of rows pushing the one that
   * failed out of sight.
   *
   * Beside Now, the whole queue at once: Pause all while anything is still
   * downloading or waiting, Resume all while anything was paused. Forty rows
   * each with its own Cancel or Retry were forty taps.
   */
  const jobs =
    queue && folded && controls && queue.jobs.length > 0 ? (
      <View style={styles.jobs} testID="import-queue">
        {folded.open.length > 0 ? (
          <View style={styles.group} aria-live="polite">
            <View style={styles.groupHead}>
              <Text style={styles.groupLabel} accessibilityRole="header">
                Now
              </Text>
              <View style={styles.groupActions}>
                {controls.pausable > 0 ? (
                  <FoldAction
                    label="Pause all"
                    accessibilityLabel="Pause every download"
                    onPress={() => afterJob(api.pauseImports())}
                    testID="import-pause-all"
                  />
                ) : null}
                {controls.resumable > 0 ? (
                  <FoldAction
                    label="Resume all"
                    accessibilityLabel="Resume every paused download"
                    onPress={() => afterJob(api.resumeImports())}
                    testID="import-resume-all"
                  />
                ) : null}
              </View>
            </View>
            {folded.open.map(job => (
              <JobRow
                key={job.id}
                job={job}
                tags={tags}
                onCancel={() => afterJob(api.cancelImport(job.id))}
                onRetry={() => afterJob(api.retryImport(job.id))}
                onDismiss={() => afterJob(api.dismissImport(job.id))}
              />
            ))}
          </View>
        ) : null}
        {folded.finished.length > 0 ? (
          <Finished
            jobs={folded.finished}
            tags={tags}
            onClear={() => afterJob(api.clearImports())}
          />
        ) : null}
      </View>
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
            {migrate}
            <Text style={styles.shareHint}>
              You can also share a link to self.mp3 from YouTube itself. It lands here.
            </Text>
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
 * Earlier today: the songs that arrived, a few at once, and a way to clear
 * them. Clear takes these and nothing else — a row under Now that failed or
 * was paused keeps its reason, its Retry and its own Dismiss.
 */
function Finished({
  jobs,
  tags,
  onClear,
}: {
  jobs: readonly ImportJob[]
  tags: readonly Tag[]
  onClear: () => void
}): ReactNode {
  const [all, setAll] = useState(false)
  const today = finishedLabel(jobs).endsWith('today')
  const shown = all ? jobs : jobs.slice(0, FINISHED_SHOWN)
  return (
    <View style={styles.group} testID="import-finished">
      <View style={styles.groupHead}>
        <Text style={styles.groupLabel} accessibilityRole="header">
          {today ? 'Earlier today' : 'Earlier'}
        </Text>
        <FoldAction label="Clear" accessibilityLabel="Clear finished imports" onPress={onClear} />
      </View>
      {shown.map(job => (
        <View key={job.id} style={styles.job}>
          <Cover uri={job.thumbnail} title={job.title || job.url} size={46} />
          <View style={styles.jobMeta}>
            <Text style={styles.jobTitle} numberOfLines={1}>
              {job.title || job.url}
            </Text>
            <Text style={[styles.jobSub, styles.good]} numberOfLines={1}>
              {arrivedLine(job, tags)}
            </Text>
          </View>
        </View>
      ))}
      {jobs.length > FINISHED_SHOWN ? (
        <FoldAction
          label={all ? 'Show fewer' : `Show all ${jobs.length}`}
          accessibilityLabel={all ? 'Hide finished imports' : 'Show finished imports'}
          expanded={all}
          onPress={() => setAll(open => !open)}
        />
      ) : null}
    </View>
  )
}

/** "Clear", "Pause all" and "Show all": quiet, in the accent, a finger's height. */
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
 * One download under Now: its cover, how it is going, and a thin line while
 * it downloads. A row that stopped — failed, or paused — offers Retry and,
 * beside it, the same × a moving row has, here meaning off the list for good.
 */
function JobRow({
  job,
  tags,
  onCancel,
  onRetry,
  onDismiss,
}: {
  job: ImportJob
  tags: readonly Tag[]
  onCancel: () => void
  onRetry: () => void
  onDismiss: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const tone = jobTone(job)
  const action = jobAction(job)
  const toneStyle =
    tone === 'running'
      ? styles.running
      : tone === 'error'
        ? styles.failed
        : tone === 'waiting'
          ? styles.waiting
          : tone === 'done'
            ? styles.good
            : null
  const status =
    tone === 'done'
      ? arrivedLine(job, tags)
      : tone === 'running' && job.step === 'downloading' && job.progress !== null
        ? `Downloading · ${Math.round(job.progress)} %`
        : jobSubtitle(job)

  return (
    <View>
      <View style={styles.job}>
        <Cover uri={job.thumbnail} title={job.title || job.url} size={46} />
        <View style={styles.jobMeta}>
          <Text
            style={[styles.jobTitle, tone === 'cancelled' && styles.mutedText]}
            numberOfLines={1}
          >
            {job.title || job.url}
          </Text>
          <Text style={[styles.jobSub, toneStyle]} numberOfLines={2}>
            {status}
          </Text>
        </View>
        {action === 'cancel' ? (
          <IconButton onPress={onCancel} label={`Cancel ${job.title || 'this import'}`}>
            <X size={15} color={theme.colors.textMuted} />
          </IconButton>
        ) : action === 'retry' || action === 'try-now' ? (
          <Button
            label={action === 'try-now' ? 'Try now' : 'Retry'}
            icon={<Refresh size={13} color={theme.colors.textPrimary} />}
            onPress={onRetry}
            accessibilityLabel={`Retry ${job.title || 'this import'}`}
          />
        ) : null}
        {dismissable(job) ? (
          <IconButton
            onPress={onDismiss}
            label={`Dismiss ${job.title || 'this import'}`}
            testID={`import-dismiss-${job.id}`}
          >
            <X size={15} color={theme.colors.textMuted} />
          </IconButton>
        ) : null}
      </View>
      {/*
       * Only the download reports a percentage, so only it draws a line; the
       * steps around it (resolving, converting, saving, uploading) are named
       * in the words under the title instead.
       */}
      {tone === 'running' && job.progress !== null ? (
        <View
          style={styles.progress}
          accessibilityRole="progressbar"
          accessibilityLabel={`${job.title || 'Track'} progress`}
          accessibilityValue={{ min: 0, max: 100, now: job.progress }}
        >
          <View style={[styles.progressFill, { width: `${job.progress}%` }]} />
        </View>
      ) : null}
    </View>
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
  jobs: { gap: 18 },
  group: { gap: 6 },
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
  // Under the downloading song's words, starting where they start.
  progress: {
    height: 3,
    marginTop: -2,
    marginBottom: 6,
    marginLeft: 58,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface2,
  },
  progressFill: { height: 3, borderRadius: radius.pill, backgroundColor: theme.colors.accent },
}))
