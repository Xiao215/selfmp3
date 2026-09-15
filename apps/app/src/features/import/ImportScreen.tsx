import { Fragment, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useMutation } from '@tanstack/react-query'
import { formatDuration, type ImportJob, type ImportPreviewItem } from '@selfmp3/shared'
import { radius, type ServerConnection } from '@selfmp3/client'
import { useLayout } from '../../shell/useLayout'
import { useAccent } from '../../ui/accent'
import { Button } from '../../ui/components/Button'
import { Checkbox } from '../../ui/components/Checkbox'
import { IconButton } from '../../ui/components/IconButton'
import {
  CheckCircle,
  ChevronRight,
  Clock,
  Download,
  ListMusic,
  Refresh,
  X,
} from '../../ui/components/Icons'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { Select } from '../../ui/components/Select'
import { TagChooser } from '../../ui/components/TagChooser'
import { Toggle } from '../../ui/components/Toggle'
import {
  chooseAll,
  chosenItems,
  enqueueRequest,
  finishedLabel,
  foldQueue,
  hasLink,
  importButtonLabel,
  isSquareCover,
  jobAction,
  jobLabel,
  jobSubtitle,
  jobTone,
  linkHint,
  matchingTag,
  patchItem,
  queueActivity,
  reviewFrom,
  reviewHeading,
  selectedCount,
  sharedLinks,
  toggleChosen,
  type Review,
} from './import.model'
import { ListenBar, ListenButton, useListen } from './ImportListen'
import { useImportDraft } from './importDraft'
import { useImportSource } from './importSource'
import { canListen, listeningLeftReview, type Listening } from './listen.model'
import { canListenHere } from '../../ports/listen'

/** "Don't add to a playlist": the playlist select holds numbers, and no playlist is 0. */
const NO_PLAYLIST = 0

/**
 * Importing.
 *
 * Paste links, fetch their details, review and correct them, then import. The
 * queue takes the review's place once it is sent, and the YouTube library
 * panel sits under both.
 *
 * Links shared to the app arrive as `/import?url=…&text=…`, which is the web's
 * Web Share Target; they are fetched straight away and cleared from the URL.
 *
 * `via` is a server reached directly from a cloud library (ImportViaServer): every
 * request here goes to it, and its tags and playlists are the ones offered.
 */
export function ImportScreen({ via }: { via?: ServerConnection } = {}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const router = useRouter()
  const { wide } = useLayout()
  const source = useImportSource(via)
  const { api, library, tools, refetchTools, queue } = source
  const viaServer = via !== undefined
  const params = useLocalSearchParams<{ url?: string; text?: string; title?: string }>()

  // The draft outlives this screen (importDraft.ts); only the error is the screen's.
  const [draft, patchDraft] = useImportDraft(via?.baseUrl ?? 'own')
  const { links, review, tagIds, playlistId, createPlaylist } = draft
  const setLinks = (next: string): void => patchDraft({ links: next })
  const setReview = (next: Review | null): void => patchDraft({ review: next })
  const setTagIds = (next: ReadonlySet<number>): void => patchDraft({ tagIds: next })
  const setPlaylistId = (next: number): void => patchDraft({ playlistId: next })
  const setCreatePlaylist = (next: boolean): void => patchDraft({ createPlaylist: next })
  const [error, setError] = useState<string | null>(null)
  /** Whether the folded "13 added today" row is open. */
  const [showFinished, setShowFinished] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const listen = useListen(via)
  const queueTop = useRef(0)

  const tags = library?.tags ?? []
  const manualPlaylists = (library?.playlists ?? []).filter(list => list.kind === 'manual')

  const preview = useMutation({
    mutationFn: (input: string) => api.importPreview(input),
    onSuccess: result => {
      const next = reviewFrom(result)
      // A link named like a tag you already have — an artist's page, a search
      // for them — is tagged that way without asking.
      const match = matchingTag(tags, next.playlistTitle)
      patchDraft({
        review: next,
        createPlaylist: false,
        tagIds: match === null ? new Set() : new Set([match]),
      })
      setError(null)
    },
    onError: (err: Error) => setError(err.message),
  })

  const enqueue = useMutation({
    mutationFn: (current: Review) =>
      api.importEnqueue(
        enqueueRequest(current, {
          tagIds,
          playlistId: playlistId === NO_PLAYLIST ? null : playlistId,
          createPlaylist,
        }),
      ),
    onSuccess: result => {
      patchDraft({ review: null, links: '' })
      // The review just collapsed; bring the new jobs into view once they are drawn.
      void source.invalidateQueue().then(() => {
        requestAnimationFrame(() =>
          scrollRef.current?.scrollTo({ y: Math.max(0, queueTop.current - 16), animated: true }),
        )
      })
      if (result.playlistId !== null) void source.invalidateLibrary()
    },
    onError: (err: Error) => setError(err.message),
  })

  const fetchLinks = (input: string): void => {
    patchDraft({ links: input, review: null })
    preview.mutate(input)
  }

  // Read a share once, fetch it, and clear it so coming back does not fetch it again.
  const shared = sharedLinks(params)
  const sharedOnce = useRef(false)
  useEffect(() => {
    if (!shared || sharedOnce.current) return
    sharedOnce.current = true
    fetchLinks(shared)
    router.setParams({ url: undefined, text: undefined, title: undefined })
    // Only `shared` matters here; the ref guards against a second run anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared])

  const afterJob = (promise: Promise<unknown>): void => {
    void promise.then(() => source.invalidateQueue())
  }

  // A preview whose track has left the review (cancelled, imported, or a new
  // link fetched) stops with it, and what played before it stays paused: you
  // did not ask for music, you asked for songs. Editing a row keeps its url.
  const leftReview = listeningLeftReview(listen.listening, review?.items ?? null)
  useEffect(() => {
    if (leftReview) listen.close({ resume: false })
    // Only whether it left matters; `close` is a new function every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftReview])

  const activity = queue ? queueActivity(queue) : null
  const heading = review ? reviewHeading(review) : null
  const chosenCount = review ? chosenItems(review).length : 0
  const hint = linkHint(links)
  const folded = queue ? foldQueue(queue.jobs) : null

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[styles.content, wide ? styles.contentWide : styles.contentNarrow]}
        keyboardShouldPersistTaps="handled"
        testID="import-screen"
      >
        <Text style={[styles.heading, !wide && styles.headingNarrow]} accessibilityRole="header">
          Import
        </Text>
        <Text style={styles.sub}>
          Paste one or more links, one per line. A playlist expands into its tracks, and an artist’s
          page into their top songs.
          {viaServer
            ? ' This goes through your server, which downloads the songs and syncs them to every device.'
            : ''}
        </Text>

        {tools && !tools.ytdlp ? (
          <View style={[styles.notice, styles.noticeWarn]}>
            <View style={styles.noticeBody}>
              <Text style={styles.noticeText}>
                <Text style={styles.strong}>yt-dlp isn’t installed.</Text> Importing needs it.
                Install both tools with:
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

        <View style={[styles.form, !wide && styles.formNarrow]}>
          <TextInput
            style={[
              styles.linksInput,
              wide && styles.linksInputWide,
              hint !== null && { borderColor: theme.colors.danger },
            ]}
            value={links}
            onChangeText={setLinks}
            placeholder={
              'https://music.youtube.com/watch?v=…\nhttps://music.youtube.com/playlist?list=…\nhttps://music.youtube.com/@artist'
            }
            placeholderTextColor={theme.colors.textMuted}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="Links to import"
          />
          <Button
            label={preview.isPending ? 'Reading…' : 'Fetch details'}
            variant="primary"
            grow={!wide}
            disabled={preview.isPending || !hasLink(links) || tools?.ytdlp === false}
            onPress={() => {
              if (hasLink(links)) preview.mutate(links.trim())
            }}
          />
        </View>

        {hint ? (
          <Text style={styles.linkHint} accessibilityRole="alert">
            {hint}
          </Text>
        ) : null}

        <Text style={styles.hint}>
          Links from <Text style={styles.strong}>music.youtube.com</Text> carry proper track, artist
          and album metadata. Regular youtube.com links usually just have a video title.
        </Text>

        {/* Migrating asks whatever answers this device, which through a server is still the bucket. */}
        {viaServer ? null : (
          <Pressable
            style={({ pressed }) => [styles.migrateCard, pressed && styles.migrateCardPressed]}
            onPress={() => router.push('/import/migrate')}
            accessibilityRole="link"
            accessibilityLabel="Migrate a playlist from another app"
          >
            <ListMusic size={18} color={accent.accent} />
            <View style={styles.migrateText}>
              <Text style={styles.migrateTitle}>Migrate a playlist from another app</Text>
              <Text style={styles.migrateSub}>
                Paste a Spotify link, a CSV export or a list of songs; each one is matched to a
                YouTube upload for you to check before importing.
              </Text>
            </View>
            <ChevronRight size={16} color={theme.colors.textMuted} />
          </Pressable>
        )}

        {error ? (
          <View style={[styles.notice, styles.noticeError]} accessibilityRole="alert">
            <Text style={styles.noticeText}>{error}</Text>
            <IconButton onPress={() => setError(null)} label="Dismiss">
              <X size={15} color={theme.colors.textMuted} />
            </IconButton>
          </View>
        ) : null}

        {review && heading && review.items.length > 0 ? (
          <View style={styles.review} testID="import-review">
            <View style={styles.reviewHead}>
              <Text style={styles.reviewTitle} accessibilityRole="header">
                {heading.found}
                {heading.duplicates ? (
                  <Text style={styles.hint}> · {heading.duplicates}</Text>
                ) : null}
              </Text>
              <View style={styles.reviewActions}>
                <Text style={styles.hint}>{selectedCount(review)}</Text>
                <Text
                  style={[styles.linkText, { color: accent.accent }]}
                  onPress={() => setReview({ ...review, chosen: chooseAll(review.items) })}
                  accessibilityRole="button"
                >
                  select all
                </Text>
                <Text
                  style={[styles.linkText, { color: accent.accent }]}
                  onPress={() => setReview({ ...review, chosen: new Set() })}
                  accessibilityRole="button"
                >
                  select none
                </Text>
              </View>
            </View>

            <View accessibilityRole="list" accessibilityLabel="Tracks to import">
              {wide ? (
                <View style={[styles.itemRow, styles.itemHead]} aria-hidden>
                  <View style={styles.colCheck} />
                  <View style={styles.colThumb} />
                  <Text style={[styles.headLabel, styles.colTitle]}>Title</Text>
                  <Text style={[styles.headLabel, styles.colOther]}>Artist</Text>
                  <Text style={[styles.headLabel, styles.colOther]}>Album</Text>
                  <Text style={[styles.headLabel, styles.colSide]}>Length</Text>
                </View>
              ) : null}
              {review.items.map((item, index) => {
                const playing = listen.listening
                return (
                  <Fragment key={`${item.url}-${index}`}>
                    <ReviewRow
                      item={item}
                      index={index}
                      wide={wide}
                      chosen={review.chosen.has(index)}
                      onToggle={() =>
                        setReview({ ...review, chosen: toggleChosen(review.chosen, index) })
                      }
                      onPatch={patch =>
                        setReview({ ...review, items: patchItem(review.items, index, patch) })
                      }
                      listening={playing}
                      onListen={() => listen.toggle(item)}
                    />
                    {/* The playhead sits right under the song it plays, not under the whole list. */}
                    {playing && playing.track.url === item.url ? (
                      <ListenBar
                        listening={playing}
                        onToggle={() => listen.toggle(playing.track)}
                        onSeek={listen.seek}
                        onClose={() => listen.close()}
                      />
                    ) : null}
                  </Fragment>
                )
              })}
            </View>

            <View style={styles.options}>
              <View style={styles.option}>
                <Text style={styles.fieldLabel}>Tag these as</Text>
                <TagChooser tags={tags} selected={tagIds} onChange={setTagIds} />
              </View>

              {review.playlistTitle && playlistId === NO_PLAYLIST ? (
                <View style={styles.optionCheck}>
                  <Toggle
                    value={createPlaylist}
                    onChange={setCreatePlaylist}
                    label={`Also create playlist ${review.playlistTitle}`}
                  />
                  <Text style={styles.fieldLabel}>
                    Also create playlist <Text style={styles.strong}>“{review.playlistTitle}”</Text>
                  </Text>
                </View>
              ) : null}

              {manualPlaylists.length > 0 ? (
                <View style={styles.option}>
                  <Text style={styles.fieldLabel}>Add to playlist</Text>
                  <View style={styles.selectWrap}>
                    <Select<number>
                      value={playlistId}
                      onChange={setPlaylistId}
                      options={[
                        { value: NO_PLAYLIST, label: 'Don’t add to a playlist' },
                        ...manualPlaylists.map(list => ({ value: list.id, label: list.name })),
                      ]}
                      label="Add to playlist"
                    />
                  </View>
                </View>
              ) : null}
            </View>

            <View style={styles.submit}>
              <Button
                label={importButtonLabel(chosenCount)}
                icon={<Download size={16} color={accent.onAccent} />}
                variant="primary"
                disabled={chosenCount === 0 || enqueue.isPending}
                onPress={() => enqueue.mutate(review)}
              />
              <Button label="Cancel" onPress={() => setReview(null)} />
            </View>
          </View>
        ) : null}

        {/*
         * The queue takes the review's place, above the library panel: below
         * it, a just-started import landed off-screen and looked like the
         * button had done nothing.
         */}
        {queue && folded && queue.jobs.length > 0 ? (
          <View
            style={styles.queue}
            onLayout={event => {
              queueTop.current = event.nativeEvent.layout.y
            }}
            testID="import-queue"
          >
            <View style={styles.queueHead}>
              <Text style={styles.reviewTitle} accessibilityRole="header">
                Queue
                {activity ? <Text style={styles.hint}> · {activity}</Text> : null}
              </Text>
            </View>
            <View style={styles.jobs} aria-live="polite">
              {folded.open.map(job => (
                <JobRow
                  key={job.id}
                  job={job}
                  onCancel={() => afterJob(api.cancelImport(job.id))}
                  onRetry={() => afterJob(api.retryImport(job.id))}
                />
              ))}
              {/*
               * Finished jobs fold into one row: each added a song the library
               * already shows, and a morning's imports were a screen of green
               * ticks pushing the one that failed out of sight.
               */}
              {folded.finished.length > 0 ? (
                <View style={styles.job} testID="import-finished">
                  <View style={styles.jobStatus}>
                    <CheckCircle size={16} color={theme.colors.good} />
                  </View>
                  <Text style={[styles.jobTitle, styles.jobMeta]} numberOfLines={1}>
                    {finishedLabel(folded.finished)}
                  </Text>
                  <FoldAction
                    label={showFinished ? 'Hide' : 'Show'}
                    accessibilityLabel={showFinished ? 'Hide finished imports' : 'Show finished imports'}
                    expanded={showFinished}
                    onPress={() => setShowFinished(open => !open)}
                  />
                  <FoldAction
                    label="Clear"
                    accessibilityLabel="Clear finished imports"
                    onPress={() => {
                      setShowFinished(false)
                      afterJob(api.clearImports())
                    }}
                  />
                </View>
              ) : null}
              {showFinished
                ? folded.finished.map(job => (
                    <JobRow
                      key={job.id}
                      job={job}
                      onCancel={() => afterJob(api.cancelImport(job.id))}
                      onRetry={() => afterJob(api.retryImport(job.id))}
                    />
                  ))
                : null}
            </View>
          </View>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  )
}

/** One track in the review. Three inputs on a line when there is room. */
function ReviewRow({
  item,
  index,
  wide,
  chosen,
  onToggle,
  onPatch,
  listening,
  onListen,
}: {
  item: ImportPreviewItem
  index: number
  wide: boolean
  chosen: boolean
  onToggle: () => void
  onPatch: (patch: Partial<Pick<ImportPreviewItem, 'title' | 'artist' | 'album'>>) => void
  listening: Listening | null
  onListen: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()

  const field = (key: 'title' | 'artist' | 'album', label: string, style: object): ReactNode => (
    <TextInput
      style={[styles.itemInput, style]}
      value={item[key]}
      onChangeText={value => onPatch({ [key]: value })}
      placeholder={label}
      placeholderTextColor={theme.colors.textMuted}
      autoCorrect={false}
      accessibilityLabel={`${label} of track ${index + 1}`}
    />
  )

  const side = item.alreadyHave ? (
    <View style={styles.dup}>
      <CheckCircle size={12} color={theme.colors.textSecondary} />
      <Text style={styles.dupText}>Have it</Text>
    </View>
  ) : item.duration > 0 ? (
    <Text style={styles.hint}>{formatDuration(item.duration)}</Text>
  ) : null

  const check = (
    <Pressable
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: chosen }}
      accessibilityLabel={`Import ${item.title}`}
      hitSlop={8}
      style={[styles.colCheck, item.alreadyHave && styles.faded]}
    >
      <Checkbox checked={chosen} />
    </Pressable>
  )

  const thumb = canListenHere && canListen(item) ? (
    <ListenButton item={item} listening={listening} onToggle={onListen} />
  ) : item.thumbnail ? (
    <Image
      source={{ uri: item.thumbnail }}
      style={[
        styles.thumb,
        isSquareCover(item.thumbnail) && styles.thumbSquare,
        item.alreadyHave && styles.faded,
      ]}
    />
  ) : (
    <View style={[styles.thumb, styles.thumbEmpty]} />
  )

  const rowStyle = [
    styles.itemRow,
    chosen && [styles.itemChosen, { borderColor: accent.accentDim }],
  ]

  if (wide) {
    return (
      <View style={rowStyle} accessibilityRole="none">
        {check}
        {thumb}
        {field('title', 'Title', styles.colTitle)}
        {field('artist', 'Artist', styles.colOther)}
        {field('album', 'Album', styles.colOther)}
        <View style={[styles.colSide, styles.sideCell]}>{side}</View>
      </View>
    )
  }

  // At a narrow width the three stack: the title with its length beside it,
  // then artist and album each on a line of their own, so neither is cut off.
  return (
    <View style={[rowStyle, styles.itemRowNarrow]}>
      {check}
      {thumb}
      <View style={styles.narrowFields}>
        <View style={styles.narrowTitle}>
          {field('title', 'Title', styles.half)}
          {side}
        </View>
        {field('artist', 'Artist', styles.fullWidth)}
        {field('album', 'Album', styles.fullWidth)}
      </View>
    </View>
  )
}

/** "Show" and "Clear" on the folded row: quiet, in the accent, a finger's height. */
function FoldAction({
  label,
  accessibilityLabel,
  expanded,
  onPress,
}: {
  label: string
  accessibilityLabel: string
  expanded?: boolean
  onPress: () => void
}): ReactNode {
  const accent = useAccent()
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      hitSlop={{ top: 8, bottom: 8 }}
      style={({ pressed }) => [styles.foldAction, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.foldActionText, { color: accent.accent }]}>{label}</Text>
    </Pressable>
  )
}

/** One download. */
function JobRow({
  job,
  onCancel,
  onRetry,
}: {
  job: ImportJob
  onCancel: () => void
  onRetry: () => void
}): ReactNode {
  const { theme } = useUnistyles()
  const accent = useAccent()
  const tone = jobTone(job)
  const action = jobAction(job)
  const label = jobLabel(job)
  const muted = tone === 'done' || tone === 'cancelled'
  const toneColor =
    tone === 'error' ? theme.colors.danger : tone === 'waiting' ? theme.colors.warning : null

  const icon =
    tone === 'running' ? (
      <ActivityIndicator size="small" color={accent.accent} />
    ) : tone === 'done' ? (
      <CheckCircle size={16} color={theme.colors.good} />
    ) : tone === 'waiting' ? (
      <Clock size={16} color={theme.colors.warning} />
    ) : tone === 'error' || tone === 'cancelled' ? (
      <X size={16} color={tone === 'error' ? theme.colors.danger : theme.colors.textMuted} />
    ) : (
      <View style={styles.jobDot} />
    )

  return (
    <View
      style={[
        styles.job,
        tone === 'running' && { borderColor: accent.accentDim },
        tone === 'error' && { borderColor: theme.colors.danger },
        tone === 'waiting' && { borderColor: theme.colors.warning },
      ]}
    >
      <View style={styles.jobStatus} accessibilityLabel={label} accessible>
        {icon}
      </View>
      <View style={styles.jobMeta}>
        <Text style={[styles.jobTitle, muted && styles.mutedText]} numberOfLines={1}>
          {job.title || job.url}
        </Text>
        <Text style={[styles.jobSub, toneColor ? { color: toneColor } : null]} numberOfLines={2}>
          {jobSubtitle(job)}
        </Text>
      </View>

      {/*
       * Only the download reports a percentage, so only it draws a bar; the
       * steps around it (resolving, converting, saving, uploading) are named
       * in the line under the title, with the spinner on the left. A dim bar
       * at a made-up width stood in for them once, and read as a second kind
       * of progress. The space is kept, so the row does not change width.
       */}
      {tone === 'running' && job.progress !== null ? (
        <>
          <View
            style={styles.progress}
            accessibilityRole="progressbar"
            accessibilityLabel={`${job.title || 'Track'} progress`}
            accessibilityValue={{ min: 0, max: 100, now: job.progress }}
          >
            <View
              style={[
                styles.progressBar,
                { backgroundColor: accent.accent, width: `${job.progress}%` },
              ]}
            />
          </View>
          <Text style={styles.percent}>{Math.round(job.progress)}%</Text>
        </>
      ) : tone === 'running' ? (
        <View style={styles.progressPlace} />
      ) : null}

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
    </View>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  content: { paddingBottom: 40 },
  contentWide: { paddingTop: 28, paddingHorizontal: 32 },
  contentNarrow: { paddingTop: 18, paddingHorizontal: 16 },
  heading: { color: theme.colors.textPrimary, fontSize: 26, fontWeight: '700' },
  headingNarrow: { fontSize: 22 },
  sub: {
    color: theme.colors.textMuted,
    fontSize: 13,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 19,
  },
  strong: { color: theme.colors.textPrimary, fontWeight: '600' },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  linkText: { fontSize: 12, textDecorationLine: 'underline' },
  code: {
    marginTop: 6,
    color: theme.colors.textPrimary,
    fontSize: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: theme.colors.surface0,
    borderRadius: radius.sm,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  noticeWarn: { borderColor: theme.colors.warning },
  noticeError: { borderColor: theme.colors.danger, marginTop: 14, paddingRight: 4 },
  noticeBody: { flex: 1 },
  noticeText: { flex: 1, color: theme.colors.textSecondary, fontSize: 13, lineHeight: 19 },
  form: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 },
  formNarrow: { flexDirection: 'column', alignItems: 'stretch' },
  linksInput: {
    minHeight: 74,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: theme.colors.textPrimary,
    fontSize: 12,
    lineHeight: 18,
    textAlignVertical: 'top',
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  linksInputWide: { flex: 1 },
  linkHint: { color: theme.colors.danger, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  migrateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  migrateCardPressed: {
    backgroundColor: theme.colors.surface2,
    borderColor: theme.colors.borderStrong,
  },
  migrateText: { flex: 1, minWidth: 0, gap: 3 },
  migrateTitle: { color: theme.colors.textPrimary, fontSize: 14, fontWeight: '600' },
  migrateSub: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  review: {
    marginTop: 26,
    padding: 18,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.md,
  },
  reviewHead: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 14,
  },
  reviewTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  reviewActions: { flexDirection: 'row', alignItems: 'baseline', gap: 12 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 5,
    paddingHorizontal: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'transparent',
    marginBottom: 2,
  },
  itemRowNarrow: { alignItems: 'flex-start' },
  itemHead: { paddingBottom: 7 },
  itemChosen: { backgroundColor: theme.colors.surface0 },
  headLabel: {
    color: theme.colors.textMuted,
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  colCheck: { width: 18, alignItems: 'center' },
  colThumb: { width: 56 },
  colTitle: { flex: 1.5, minWidth: 0 },
  colOther: { flex: 1, minWidth: 0 },
  colSide: { width: 78, textAlign: 'right' },
  sideCell: { alignItems: 'flex-end' },
  thumb: { width: 56, height: 34, borderRadius: 4 },
  // Album art is square; a video's still is not. The column stays 56 wide either way.
  thumbSquare: { width: 40, height: 40, marginHorizontal: 8 },
  thumbEmpty: { backgroundColor: theme.colors.surface2 },
  faded: { opacity: 0.55 },
  itemInput: {
    minHeight: 30,
    paddingHorizontal: 8,
    paddingVertical: 4,
    color: theme.colors.textPrimary,
    fontSize: 13,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: radius.sm,
  },
  narrowFields: { flex: 1, minWidth: 0, gap: 6 },
  narrowTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fullWidth: { alignSelf: 'stretch' },
  half: { flex: 1, minWidth: 0 },
  dup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingLeft: 6,
    paddingRight: 8,
    borderRadius: 999,
    backgroundColor: theme.colors.surface3,
  },
  dupText: { color: theme.colors.textSecondary, fontSize: 11, fontWeight: '600' },
  options: {
    gap: 14,
    marginTop: 18,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  option: { gap: 7 },
  optionCheck: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  fieldLabel: { color: theme.colors.textSecondary, fontSize: 12, fontWeight: '500' },
  selectWrap: { alignSelf: 'stretch' },
  submit: { flexDirection: 'row', gap: 10, marginTop: 18 },
  queue: { marginTop: 30 },
  queueHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  jobs: { gap: 4 },
  foldAction: { paddingVertical: 4, paddingHorizontal: 6 },
  foldActionText: { fontSize: 13, fontWeight: '600' },
  job: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 46,
    paddingVertical: 9,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: radius.sm,
    backgroundColor: theme.colors.surface1,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  jobStatus: { width: 20, alignItems: 'center' },
  jobDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors.textMuted },
  jobMeta: { flex: 1, minWidth: 0 },
  jobTitle: { color: theme.colors.textPrimary, fontSize: 13, fontWeight: '500' },
  mutedText: { color: theme.colors.textMuted },
  jobSub: { color: theme.colors.textMuted, fontSize: 11, marginTop: 1 },
  progress: {
    width: 120,
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: theme.colors.surface3,
  },
  progressBar: { height: 4, borderRadius: 2 },
  /** The bar's and the number's width together, plus the gap between them. */
  progressPlace: { width: 120 + 12 + 36 },
  percent: {
    width: 36,
    textAlign: 'right',
    color: theme.colors.textMuted,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
}))
