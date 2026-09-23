import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { ReactNode } from 'react'
import {
  dataAnswer,
  downloadAsk,
  isDownloaded,
  onWifi,
  pendingIds,
  playBlock,
  shouldAutoDownload,
  type DownloadAsk,
  type NetworkKind,
  type PlayBlock,
  type SyncSituation,
  useLibrary,
  useManifest,
  useSameArray,
} from '@selfmp3/client'
import { installedApp } from '../ports/install'
import { bucketMedia } from '../ports/bucketMedia'
import {
  clearRecent,
  forgetRecent,
  keepRecentlyPlayed,
  promoteRecent,
  recentUri,
} from '../ports/recentCopies'
import { prefs as prefStore } from '../ports/prefs'
import { useConnection } from '../connection/ConnectionProvider'
import { useConnectionKind } from './connectionKind'
import { downloadQueue, type DownloadQueue, type DownloadState } from './downloads'

/**
 * React's view of the download queue, and the rules around it.
 *
 * The queue itself is a module-level singleton (downloads outlive screens);
 * this mirrors its state into React, keeps it pointed at the current server
 * and library, and applies the downloading and streaming design: download on
 * Wi-Fi by itself, ask once on mobile data, wait for a tap over 500 MB, and
 * say why a song that is not here cannot play (`syncPolicy.ts` in
 * packages/client decides; this carries it out).
 */

/** This device's two settings, kept on this device. */
interface DownloadPrefs {
  /** "Download automatically on Wi-Fi". */
  readonly autoOnWifi: boolean
  /** "Play songs that aren't downloaded". */
  readonly streamUndownloaded: boolean
}

/** Something that needs a yes or no before it happens. */
export type DownloadQuestion =
  | {
      readonly kind: 'download'
      readonly ask: Exclude<DownloadAsk, 'none'>
      readonly songIds: readonly number[]
      readonly bytes: number
    }
  | {
      readonly kind: 'play'
      readonly block: PlayBlock
      readonly songId: number
      readonly retry: () => void
    }

interface DownloadsContextValue {
  /**
   * The queue as of its last change of shape: what is kept, what is queued,
   * which song is in flight, paused, the error. Its `bytesWritten` and
   * `totalBytes` are as of that change too, and do not follow a transfer
   * chunk by chunk: every screen reads this, so following each chunk here
   * renders all of them. A bar that moves reads `useDownloadProgress()`.
   */
  readonly state: DownloadState
  readonly queue: DownloadQueue
  readonly installed: boolean
  readonly network: NetworkKind
  readonly prefs: DownloadPrefs
  setPrefs: (patch: Partial<DownloadPrefs>) => void
  /** Songs in the library not on this device, leaving out ones removed by hand. */
  readonly missingIds: readonly number[]
  /**
   * Every song in the library not on this device, removed by hand or not, and
   * their size: what a button pressed on purpose offers. Removed by hand keeps a
   * song out of downloading by itself, not out of being asked for again — the
   * panel said "35 of 36 downloaded" over a greyed "Everything is downloaded".
   */
  readonly absentIds: readonly number[]
  readonly absentBytes: number
  readonly situation: SyncSituation
  /** Download these, asking first about mobile data or a large total. */
  requestDownload: (songIds: readonly number[]) => void
  /** Download these now; a song picked by hand is always allowed. */
  downloadByHand: (songIds: readonly number[]) => void
  /** Remove these, and keep them removed. */
  removeByHand: (songIds: readonly number[]) => Promise<void>
  /**
   * These songs are leaving the library: their copies here go with them.
   *
   * Not `removeByHand`, which keeps the song and remembers the removal so the
   * next automatic pass does not fetch it straight back. A song that is gone
   * has nothing to remember, and its id can be handed to a different song
   * later — a cloud library numbers its own — so remembering it would keep the
   * wrong song off this device.
   */
  dropDownloads: (songIds: readonly number[]) => Promise<void>
  /** Delete these files, whatever their songs are: the leftovers button. */
  removeFiles: (songIds: readonly number[]) => Promise<void>
  /** Remove every download, and stop downloading by itself, or they would come back. */
  removeAll: () => Promise<void>
  /**
   * Forget which songs were removed by hand: signing out. The ids are this
   * account's, and another account's library hands the same numbers to other
   * songs, which would then quietly never download by themselves.
   */
  forgetExcluded: () => void
  /**
   * A removal is running. The buttons that start one are disabled while it is,
   * and starting a second does nothing: two passes over the same index would
   * have the later one write back the entries the earlier one deleted.
   */
  readonly removing: boolean
  /** A song just counted as a play: keep a copy where songs are streamed from the bucket. */
  keepPlayed: (songId: number) => void
  /** Whether a song can start here now, without asking. */
  mayPlay: (songId: number) => boolean
  /** True when the song can start; otherwise the reason is put to the person, with `retry`. */
  checkPlay: (songId: number, retry: () => void) => boolean
  readonly question: DownloadQuestion | null
  answer: (yes: boolean) => void
}

const DownloadsContext = createContext<DownloadsContextValue | null>(null)

const PREFS_KEY = 'downloads.prefs'
const EXCLUDED_KEY = 'downloads.excluded'
const DEFAULT_PREFS: DownloadPrefs = { autoOnWifi: true, streamUndownloaded: true }

function readPrefs(): DownloadPrefs {
  try {
    const raw = prefStore.get(PREFS_KEY)
    const parsed: unknown = raw === null ? null : JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_PREFS
    const stored = parsed as Partial<Record<keyof DownloadPrefs, unknown>>
    return {
      autoOnWifi:
        typeof stored.autoOnWifi === 'boolean' ? stored.autoOnWifi : DEFAULT_PREFS.autoOnWifi,
      streamUndownloaded:
        typeof stored.streamUndownloaded === 'boolean'
          ? stored.streamUndownloaded
          : DEFAULT_PREFS.streamUndownloaded,
    }
  } catch {
    return DEFAULT_PREFS
  }
}

function readExcluded(): ReadonlySet<number> {
  try {
    const raw = prefStore.get(EXCLUDED_KEY)
    const parsed: unknown = raw === null ? [] : JSON.parse(raw)
    return new Set(
      Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : [],
    )
  } catch {
    return new Set()
  }
}

export function DownloadsProvider({ children }: { children: ReactNode }): ReactNode {
  const { connection, fromCloud } = useConnection()
  const library = useLibrary()
  const manifest = useManifest()
  const network = useConnectionKind()
  const [view, setView] = useState(() => ({ state: downloadQueue.getState(), batchTotal: 0 }))
  const [prefs, setPrefsState] = useState<DownloadPrefs>(readPrefs)
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(readExcluded)
  const [dataAllowedAnswer, setDataAllowed] = useState(false)
  const [question, setQuestion] = useState<DownloadQuestion | null>(null)
  const state = view.state

  useEffect(
    () =>
      downloadQueue.subscribe(next =>
        setView(previous => {
          // Bytes alone are `useDownloadProgress`'s to show. The same object back
          // is React's cue to render nothing, here or in any screen below.
          if (sameShape(previous.state, next)) return previous
          // "12 of 40": the run grows as songs are added and ends when the queue empties.
          const before = previous.state.queue.length
          const after = next.queue.length
          const batchTotal =
            after === 0
              ? 0
              : after > before
                ? (before === 0 ? 0 : previous.batchTotal) + (after - before)
                : previous.batchTotal
          return { state: next, batchTotal }
        }),
      ),
    [],
  )

  useEffect(() => {
    void downloadQueue.load()
  }, [])

  useEffect(() => {
    // The answer, once there is one, is the library: a kept song it does not
    // name was removed on some device, and goes here too.
    downloadQueue.configure(connection, library.data?.songs ?? [], {
      authoritative: library.data !== undefined,
    })
  }, [connection, library.data])

  useEffect(() => {
    downloadQueue.setManifest(manifest.data ?? null)
  }, [manifest.data])

  // The mobile data answer lasts until Wi-Fi comes back.
  const dataAllowed = dataAnswer(dataAllowedAnswer, network)
  useEffect(() => {
    if (!dataAllowedAnswer || !onWifi(network)) return undefined
    const timer = setTimeout(() => setDataAllowed(false), 0)
    return () => clearTimeout(timer)
  }, [dataAllowedAnswer, network])

  // A failure stops automatic downloads while it stands. Wi-Fi coming back is
  // a fresh start, and what is still missing is tried again.
  useEffect(() => {
    if (onWifi(network)) downloadQueue.clearError()
  }, [network])

  // The same array while they are the same ids: every list below, and the
  // context value with them, is remade from it, and an edit to one song's
  // heart is not a change to which songs there are.
  const songIds = useSameArray(
    useMemo(() => (library.data?.songs ?? []).map(song => song.id), [library.data]),
  )
  const missingIds = useMemo(
    () => pendingIds(state.index, songIds).filter(id => !excluded.has(id)),
    [state.index, songIds, excluded],
  )
  /*
   * Each song's size, from the manifest when there is one and the library when
   * not. Built once per change rather than walked again per question — a
   * finished download asks one.
   */
  const sizeById = useMemo(
    () =>
      manifest.data
        ? new Map(manifest.data.entries.map(entry => [entry.id, entry.sizeBytes]))
        : new Map((library.data?.songs ?? []).map(song => [song.id, song.sizeBytes])),
    [manifest.data, library.data],
  )
  const bytesFor = useCallback(
    (ids: readonly number[]): number =>
      pendingIds(state.index, ids).reduce((sum, id) => sum + (sizeById.get(id) ?? 0), 0),
    [sizeById, state.index],
  )
  const missingBytes = useMemo(() => bytesFor(missingIds), [bytesFor, missingIds])
  const absentIds = useMemo(() => pendingIds(state.index, songIds), [state.index, songIds])
  const absentBytes = useMemo(() => bytesFor(absentIds), [bytesFor, absentIds])

  const situation = useMemo<SyncSituation>(
    () => ({
      installed: installedApp,
      network,
      autoOnWifi: prefs.autoOnWifi,
      missing: missingIds.length,
      missingBytes,
      queued: state.queue.length,
      batchTotal: view.batchTotal,
      paused: state.paused,
      error: state.error,
    }),
    [network, prefs.autoOnWifi, missingIds.length, missingBytes, state, view.batchTotal],
  )

  // On Wi-Fi, keep this device in step without being asked.
  const auto = library.data !== undefined && shouldAutoDownload(situation)
  useEffect(() => {
    if (!auto) return undefined
    const timer = setTimeout(() => downloadQueue.enqueue(missingIds), 0)
    return () => clearTimeout(timer)
  }, [auto, missingIds])

  const setPrefs = useCallback((patch: Partial<DownloadPrefs>) => {
    setPrefsState(current => {
      const next = { ...current, ...patch }
      prefStore.set(PREFS_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const changeExcluded = useCallback((ids: readonly number[], add: boolean) => {
    setExcluded(current => {
      const next = new Set(current)
      for (const id of ids) {
        if (add) next.add(id)
        else next.delete(id)
      }
      prefStore.set(EXCLUDED_KEY, JSON.stringify([...next]))
      return next
    })
  }, [])

  const downloadByHand = useCallback(
    (ids: readonly number[]) => {
      changeExcluded(ids, false)
      // Asked for by hand, so it stays: no longer a copy the budget may let go.
      promoteRecent(ids)
      downloadQueue.enqueue(ids)
    },
    [changeExcluded],
  )

  // Made once, reading the sizes at the moment of the request: `bytesFor` is
  // remade with every library edit, and this was remade with it, and the
  // context value with this — a render of everything that reads downloads.
  const sizing = useRef(bytesFor)
  useEffect(() => {
    sizing.current = bytesFor
  }, [bytesFor])
  const requestDownload = useCallback(
    (ids: readonly number[]) => {
      const bytes = sizing.current(ids)
      const ask = downloadAsk(network, dataAllowed, bytes)
      if (ask === 'none') downloadByHand(ids)
      else setQuestion({ kind: 'download', ask, songIds: ids, bytes })
    },
    [network, dataAllowed, downloadByHand],
  )

  const removeByHand = useCallback(
    async (ids: readonly number[]) => {
      changeExcluded(ids, true)
      forgetRecent(ids)
      await downloadQueue.remove(ids)
    },
    [changeExcluded],
  )

  const dropDownloads = useCallback(
    async (ids: readonly number[]) => {
      // Forgotten rather than remembered: see `dropDownloads` on the context.
      changeExcluded(ids, false)
      forgetRecent(ids)
      await downloadQueue.remove(ids)
    },
    [changeExcluded],
  )

  /*
   * One removal at a time, so a button that starts one can be disabled for as
   * long as it runs and a second press is a no-op rather than a second pass.
   * Both the flag and the ref: the ref is read by the press that has just
   * happened, before React has rendered the flag.
   */
  const [removing, setRemoving] = useState(false)
  const removingNow = useRef(false)
  const runRemoval = useCallback(async (work: () => Promise<void>): Promise<void> => {
    if (removingNow.current) return
    removingNow.current = true
    setRemoving(true)
    try {
      await work()
    } finally {
      removingNow.current = false
      setRemoving(false)
    }
  }, [])

  const removeFiles = useCallback(
    (ids: readonly number[]) => runRemoval(() => downloadQueue.remove(ids)),
    [runRemoval],
  )

  const removeAll = useCallback(
    () =>
      runRemoval(async () => {
        setPrefs({ autoOnWifi: false })
        clearRecent()
        await downloadQueue.removeAll()
      }),
    [runRemoval, setPrefs],
  )

  const forgetExcluded = useCallback(() => {
    setExcluded(new Set())
    // The store has no delete; an empty list reads back as nothing excluded.
    prefStore.set(EXCLUDED_KEY, '[]')
  }, [])

  // The player's commands are made once; they read the latest rules through this.
  const songsById = useMemo(
    () => new Map((library.data?.songs ?? []).map(song => [song.id, song])),
    [library.data],
  )
  const rules = useRef({
    index: state.index,
    network,
    prefs,
    fromCloud,
    dataAllowed,
    excluded,
    songsById,
  })
  useEffect(() => {
    rules.current = {
      index: state.index,
      network,
      prefs,
      fromCloud,
      dataAllowed,
      excluded,
      songsById,
    }
  }, [state.index, network, prefs, fromCloud, dataAllowed, excluded, songsById])

  const keepPlayed = useCallback((songId: number) => {
    const now = rules.current
    // Only where songs come from the bucket; reaching a server, this device either
    // holds the files already or streams them from home. Playing a song removed
    // by hand is not asking for it back, and one downloading everything anyway
    // has nothing to second-guess.
    if (!now.fromCloud || now.excluded.has(songId)) return
    // A browser streams and keeps nothing, played or not.
    if (!installedApp) return
    if (now.prefs.autoOnWifi) return
    // A copy is a second fetch of a song already streaming, so it answers to
    // the rule every other download does: not over mobile data nobody agreed to.
    if (now.network === 'cellular' && !now.dataAllowed) return
    const song = now.songsById.get(songId)
    if (song) void keepRecentlyPlayed(song)
  }, [])

  const blockFor = useCallback((songId: number): PlayBlock | null => {
    const now = rules.current
    return playBlock({
      // A copy kept because it was played is a file here like any other, and
      // plays with no signal; it is only left out of what is *listed* as here.
      // Asked second: it goes to the disk, and a download is the common answer.
      downloaded: isDownloaded(now.index, songId) || recentUri(songId) !== null,
      installed: installedApp,
      network: now.network,
      streamUndownloaded: now.prefs.streamUndownloaded,
      fromCloud: now.fromCloud,
      bucketStreams: bucketMedia !== null,
      dataAllowed: now.dataAllowed,
    })
  }, [])

  const mayPlay = useCallback((songId: number) => blockFor(songId) === null, [blockFor])

  const checkPlay = useCallback(
    (songId: number, retry: () => void) => {
      const block = blockFor(songId)
      if (block === null) return true
      setQuestion({ kind: 'play', block, songId, retry })
      return false
    },
    [blockFor],
  )

  const answer = useCallback(
    (yes: boolean) => {
      const asked = question
      setQuestion(null)
      if (!yes || !asked) return
      if (asked.kind === 'download') {
        if (asked.ask === 'data' || asked.ask === 'data-large') setDataAllowed(true)
        downloadByHand(asked.songIds)
        return
      }
      switch (asked.block) {
        case 'data':
          setDataAllowed(true)
          // The answer is in state on the next render; the retry must not wait for it.
          rules.current = { ...rules.current, dataAllowed: true }
          asked.retry()
          return
        case 'streaming-off':
        case 'cloud':
          downloadByHand([asked.songId])
          return
        case 'offline':
          return
      }
    },
    [question, downloadByHand],
  )

  const value = useMemo<DownloadsContextValue>(
    () => ({
      state,
      queue: downloadQueue,
      installed: installedApp,
      network,
      prefs,
      setPrefs,
      missingIds,
      absentIds,
      absentBytes,
      situation,
      requestDownload,
      downloadByHand,
      removeByHand,
      dropDownloads,
      removeFiles,
      removeAll,
      forgetExcluded,
      removing,
      keepPlayed,
      mayPlay,
      checkPlay,
      question,
      answer,
    }),
    [
      state,
      network,
      prefs,
      setPrefs,
      missingIds,
      absentIds,
      absentBytes,
      situation,
      requestDownload,
      downloadByHand,
      removeByHand,
      dropDownloads,
      removeFiles,
      removeAll,
      forgetExcluded,
      removing,
      keepPlayed,
      mayPlay,
      checkPlay,
      question,
      answer,
    ],
  )

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>
}

export function useDownloads(): DownloadsContextValue {
  const value = useContext(DownloadsContext)
  if (!value) throw new Error('useDownloads must be used inside a DownloadsProvider')
  return value
}

/** Everything about the queue but how far the song in flight has got. */
function sameShape(a: DownloadState, b: DownloadState): boolean {
  return (
    a.index === b.index &&
    a.queue === b.queue &&
    a.activeSongId === b.activeSongId &&
    a.paused === b.paused &&
    a.error === b.error
  )
}

/** How far the song in flight has got. */
export interface DownloadProgress {
  readonly activeSongId: number | null
  readonly bytesWritten: number
  /** The expected size when the platform does not know it; 0 with nothing in flight. */
  readonly totalBytes: number
}

let progressNow: DownloadProgress = { activeSongId: null, bytesWritten: 0, totalBytes: 0 }

/** The same object until a number changes, which is what `useSyncExternalStore` compares. */
function readProgress(): DownloadProgress {
  const { activeSongId, bytesWritten, totalBytes } = downloadQueue.getState()
  if (
    progressNow.activeSongId !== activeSongId ||
    progressNow.bytesWritten !== bytesWritten ||
    progressNow.totalBytes !== totalBytes
  ) {
    progressNow = { activeSongId, bytesWritten, totalBytes }
  }
  return progressNow
}

function subscribeProgress(onChange: () => void): () => void {
  return downloadQueue.subscribe(() => onChange())
}

/**
 * Byte progress, for the few things that draw a moving bar.
 *
 * Kept out of `useDownloads()` on purpose: that value reaches every list, and
 * a transfer changes this several times a second (the queue holds it to four).
 * Only a component that calls this renders when it moves. Read straight from
 * the queue, so it needs no provider.
 */
export function useDownloadProgress(): DownloadProgress {
  return useSyncExternalStore(subscribeProgress, readProgress, readProgress)
}
