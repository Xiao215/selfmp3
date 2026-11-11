import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Animated as RNAnimated, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import Animated from 'react-native-reanimated'
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable'
import type { ImportJob, ImportRun, Tag } from '@selfmp3/shared'
import {
  dismissable,
  finishedLabel,
  iconSize,
  coverSize,
  jobAction,
  jobSubtitle,
  jobTone,
  radius,
  shortAddress,
  space,
  stepFraction,
  timeLeft,
  type,
} from '@selfmp3/client'
import { useLayoutFlags } from '../../shell/useLayout'
import { ProgressBar } from '../../ui/components/ProgressBar'
import { rowTitle } from '../../ui/surfaces'
import { SectionHead } from '../../ui/components/SectionHead'
import { Button } from '../../ui/components/Button'
import { Cover } from '../../ui/components/Cover'
import { Next, X } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { MoreMenu, type MenuItem } from '../../ui/components/MoreMenu'
import { useFade } from '../../ui/motion'
import { MOVE_MS } from '../../ui/motion.model'
import { useRowMotion } from '../../ui/rowMotion'
import { useOpenWith } from '../guide/Guide'
import type { GuideHandle, GuideTarget } from '../guide/useGuide'
import { QueueRing } from './QueueRing'
import { ImportCover } from './ImportCover'
import { arrivedLine, jobName } from './importQueue.model'

/*
 * The import queue's lists and rows, under Import's box (ImportScreen.tsx):
 * Couldn't import and Currently importing (`JobGroup`, `JobRow`), and what
 * arrived earlier (`Finished`).
 */

/** How many of today's finished imports are listed before "Show all". */
const FINISHED_SHOWN = 5

/**
 * How many rows Currently importing and Couldn't import each list before
 * "Show more": a three-hundred-song playlist was three hundred rows, and the
 * page under them out of reach.
 */
const ROWS_SHOWN = 20

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
export function JobGroup({
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
 * The queue's progress, which is the progress there is: "12 of 64 in", about
 * how long the rest will take (the server's guess from the run's own pace),
 * and one bar. A song's own bytes arrive in a fraction of a second, so a bar
 * per song sat at 0 % through the wait for its turn and then jumped to full.
 */
export function RunProgress({ run }: { run: ImportRun }): ReactNode {
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
export function Finished({
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
          <Cover uri={job.thumbnail} title={jobName(job)} size={coverSize.row} />
          <View style={styles.jobMeta}>
            <Text style={styles.jobTitle} numberOfLines={1}>
              {jobName(job)}
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
export function FoldAction({
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
export function JobRow({
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
  const { wide, dense } = useLayoutFlags()
  const [hovered, setHovered] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const tone = jobTone(job)
  const action = jobAction(job)
  const name = jobName(job)
  // A failure's reason is ordinary quiet words: its red is the dot on the picture (AB1).
  const toneStyle =
    tone === 'running'
      ? styles.running
      : tone === 'error'
        ? styles.mutedText
        : tone === 'waiting'
          ? styles.waiting
          : tone === 'done'
            ? styles.good
            : tone === 'cancelled'
              ? styles.mutedText
              : null
  const said =
    tone === 'done' ? arrivedLine(job, tags) : (job.status === 'queued' && next) || jobSubtitle(job)
  // A link nothing was found out about is named by its kind, and its address follows the reason.
  const status = job.title ? said : `${said} · ${shortAddress(job.url)}`
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
        tone={action === 'try-now' ? 'warning' : 'plain'}
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
      <ImportCover
        uri={job.thumbnail}
        title={name}
        size={coverSize.row}
        failed={tone === 'error'}
        untitled={!job.title}
      />
      <View style={styles.jobMeta}>
        <Text style={[styles.jobTitle, tone === 'cancelled' && styles.mutedText]} numberOfLines={1}>
          {name}
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

/** The queue row swiped open, if any: opening another closes it, as Mail's rows do. */
let swipedOpen: SwipeableMethods | null = null

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
  // A row gone (imported, removed) is not the one open.
  useEffect(() => {
    const mine = swipeable.current
    return () => {
      if (swipedOpen === mine) swipedOpen = null
    }
  }, [])
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
      onSwipeableWillOpen={() => {
        const opening = swipeable.current
        if (swipedOpen !== opening) swipedOpen?.close()
        swipedOpen = opening
      }}
      onSwipeableClose={() => {
        if (swipedOpen === swipeable.current) swipedOpen = null
      }}
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
  groupApart: { marginTop: space.md },
  groupActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  job: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 62 },
  jobMeta: { flex: 1, minWidth: 0, gap: 3 },
  jobTitle: rowTitle(theme.colors),
  mutedText: { color: theme.colors.textMuted },
  jobSub: { color: theme.colors.textSecondary, fontSize: type.sub },
  running: { color: theme.colors.accent },
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
