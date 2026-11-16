import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys, space } from '@selfmp3/client'
import { runMove, type MoveProgress } from '@selfmp3/replica'
import { DRIVE_REFUSAL_WORDS, type DoormanStorage } from '@selfmp3/shared'
import { session as cloud } from '../../replica'
import { onSignInBack, signInReturnUrl } from '../../ports/signInReturn'
import { useLayoutFlags } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { Spinner } from '../../ui/components/Spinner'
import { StatusLine } from '../../ui/components/StatusLine'
import { lineSub } from '../../ui/surfaces'
import { BucketEntry } from '../welcome/BucketEntry'
import { OnboardingFootnote, OnboardingPage } from '../welcome/OnboardingPage'
import { WhitePill } from '../welcome/WhitePill'
import {
  bucketEntryMissing,
  bucketEntryReady,
  cloudConnectInput,
  CONNECTED_LOOKS_MS,
  movedLine,
  moveProgressLine,
  moveTarget,
  NEW_BUCKET_ENTRY,
  unfinishedMoveLine,
  WAITING_FOR_GOOGLE,
  whereItIs,
  type BucketEntryValue,
} from '../welcome/storage.model'
import { ACCOUNT_ROUTE } from './settings.model'

/**
 * Move your library: from Settings › Account, the one thing to do about where
 * the library is (docs/features/storage-providers.md, "Moving").
 *
 * The account has one storage and the page only ever names one other place:
 * a library in a bucket can go to Google Drive, and one in Google Drive to a
 * bucket. The new place is connected the way Where it lives connects it — a
 * yes on Google's page, or a bucket's key — but only as where the move is
 * going. Then this device copies the library across through the doorman
 * (`runMove`), saying how far it has got, and the new place becomes the
 * storage only when everything is there.
 *
 * Until that moment nothing has changed, so every way out is safe: Stop, the
 * page closed, the phone locked. A move left unfinished is offered again the
 * next time the page is opened, and carries on from what is already across.
 * The old place is never touched; the page says so at the end, and that its
 * copy can be deleted there.
 */

type Stage =
  /** Reading what the account has and whether a move was begun before. */
  | { readonly at: 'loading' }
  /** Nothing under way: the new place is asked for. */
  | { readonly at: 'asking' }
  /** Google's page is open somewhere. */
  | { readonly at: 'google' }
  /** A move was begun before and left. */
  | { readonly at: 'unfinished'; readonly to: DoormanStorage }
  | { readonly at: 'moving'; readonly progress: MoveProgress }
  | { readonly at: 'moved'; readonly from: DoormanStorage; readonly to: DoormanStorage }

export function MoveScreen(): ReactNode {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { wide } = useLayoutFlags()
  const [stage, setStage] = useState<Stage>({ at: 'loading' })
  const [storage, setStorage] = useState<DoormanStorage | null>(null)
  const [entry, setEntry] = useState<BucketEntryValue>(NEW_BUCKET_ENTRY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Stop was pressed: the copying ends after the files under way.
  const stopping = useRef(false)
  const [stopAsked, setStopAsked] = useState(false)
  // One run at a time, whatever is pressed while it starts.
  const running = useRef(false)

  const said = (caught: unknown, otherwise: string): string =>
    caught instanceof Error ? caught.message : otherwise

  /** Copy the library to the place the doorman holds for it, then make it the storage. */
  const run = useCallback(
    async (from: DoormanStorage, to: DoormanStorage): Promise<void> => {
      if (running.current) return
      running.current = true
      stopping.current = false
      setStopAsked(false)
      setError(null)
      setStage({ at: 'moving', progress: { phase: 'looking' } })
      try {
        const session = await cloud.loadSession()
        if (!session) throw new Error('Signed out meanwhile. Sign in again.')
        const finished = await runMove(cloud.moveApi(session), {
          onProgress: progress => setStage({ at: 'moving', progress }),
          stopped: () => stopping.current,
        })
        if (!finished) {
          setStage({ at: 'unfinished', to })
          return
        }
        // The account's storage is the new place now, for every screen that names it.
        await queryClient.invalidateQueries({ queryKey: queryKeys.cloudSession })
        await queryClient.invalidateQueries({ queryKey: queryKeys.storageSpace })
        setStage({ at: 'moved', from, to })
      } catch (caught) {
        setError(said(caught, 'The move stopped.'))
        setStage({ at: 'unfinished', to })
      } finally {
        running.current = false
      }
    },
    [queryClient],
  )

  // What the account has, and whether a move was begun before.
  useEffect(() => {
    let left = false
    void (async () => {
      try {
        const session = await cloud.loadSession()
        const fresh = session ? await cloud.refreshSession(session) : null
        if (left) return
        if (!fresh?.me.storage) {
          router.replace(ACCOUNT_ROUTE)
          return
        }
        setStorage(fresh.me.storage)
        const to = await cloud.movingTo(fresh)
        if (left) return
        // A run may have begun meanwhile, from Google's answer arriving first.
        setStage(now =>
          now.at !== 'loading' ? now : to ? { at: 'unfinished', to } : { at: 'asking' },
        )
      } catch (caught) {
        if (left) return
        setError(said(caught, 'Could not reach your storage.'))
        setStage({ at: 'asking' })
      }
    })()
    return () => {
      left = true
    }
  }, [router])

  // Back from Google: the Drive is where the move is going, once the doorman says so.
  useEffect(
    () =>
      onSignInBack('move', back => {
        if (back.kind === 'refused') {
          setError(DRIVE_REFUSAL_WORDS[back.refusal])
          setStage(now => (now.at === 'google' || now.at === 'loading' ? { at: 'asking' } : now))
          return
        }
        setError(null)
        void (async () => {
          try {
            const session = await cloud.loadSession()
            if (!session?.me.storage) return
            // The doorman keeps the answer in one place and may not have heard everywhere yet.
            for (const wait of CONNECTED_LOOKS_MS) {
              if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
              const to = await cloud.movingTo(session)
              if (to) {
                setStorage(session.me.storage)
                await run(session.me.storage, to)
                return
              }
            }
            throw new Error('Google Drive said yes, but it is not showing here yet. Try again.')
          } catch (caught) {
            setError(said(caught, 'Could not start the move.'))
            setStage({ at: 'asking' })
          }
        })()
      }),
    [run],
  )

  const toDrive = (): void => {
    if (busy || stage.at !== 'asking') return
    setError(null)
    setStage({ at: 'google' })
    void (async () => {
      try {
        const session = await cloud.loadSession()
        if (!session) throw new Error('Signed out meanwhile. Sign in again.')
        await cloud.beginDriveConnect(session, signInReturnUrl('move'), true)
      } catch (caught) {
        setError(said(caught, 'Could not open Google.'))
        setStage({ at: 'asking' })
      }
    })()
  }

  const toBucket = (): void => {
    if (busy || stage.at !== 'asking' || !storage) return
    if (!bucketEntryReady(entry)) {
      setError(bucketEntryMissing(entry))
      return
    }
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const session = await cloud.loadSession()
        if (!session) throw new Error('Signed out meanwhile. Sign in again.')
        const to = await cloud.startMove(
          session,
          entry.mode === 'backblaze'
            ? { backblaze: { keyId: entry.keyId, applicationKey: entry.applicationKey } }
            : { bucket: cloudConnectInput(entry.address) },
        )
        if (!to) throw new Error('Could not start the move.')
        setBusy(false)
        await run(storage, to)
      } catch (caught) {
        setError(said(caught, 'Could not start the move.'))
      } finally {
        setBusy(false)
      }
    })()
  }

  /** Forget the place the move was going to. The library is where it was. */
  const giveUp = (): void => {
    if (busy) return
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const session = await cloud.loadSession()
        if (session) await cloud.stopMove(session)
        setStage({ at: 'asking' })
      } catch (caught) {
        setError(said(caught, 'Could not stop the move.'))
      } finally {
        setBusy(false)
      }
    })()
  }

  const leave = (): void => router.replace(ACCOUNT_ROUTE)
  const target = storage ? moveTarget(storage) : null
  const width = wide ? 280 : undefined

  return (
    <OnboardingPage
      title="Move your library"
      face="display"
      keyboard
      lead={
        stage.at === 'moved'
          ? 'Done.'
          : target === 'drive'
            ? 'Everything is copied to a folder called self.mp3 in your own Google Drive, and only then does your library live there. Until it is finished, nothing changes.'
            : 'Everything is copied to a bucket you own, and only then does your library live there. Until it is finished, nothing changes.'
      }
    >
      {storage && stage.at !== 'moved' ? (
        <Text style={styles.now} testID="move-from">{`Now in ${whereItIs(storage)}`}</Text>
      ) : null}

      {stage.at === 'asking' && target === 'bucket' ? (
        <BucketEntry value={entry} onChange={setEntry} disabled={busy} testID="move" />
      ) : null}

      {stage.at === 'unfinished' ? (
        <Text style={styles.words} testID="move-unfinished">
          {unfinishedMoveLine(stage.to)}
        </Text>
      ) : null}

      {stage.at === 'moving' || stage.at === 'google' || stage.at === 'loading' || busy ? (
        <View style={styles.trying}>
          <Spinner tone="accent" />
          <Text style={styles.tryingText} testID="move-progress">
            {stage.at === 'moving'
              ? stopAsked
                ? 'Stopping after the files on their way…'
                : moveProgressLine(stage.progress)
              : stage.at === 'google'
                ? WAITING_FOR_GOOGLE
                : stage.at === 'loading'
                  ? 'Looking…'
                  : 'Trying the key…'}
          </Text>
        </View>
      ) : null}

      {stage.at === 'moved' ? (
        <Text style={styles.words} testID="move-done">
          {movedLine(stage.from, stage.to)}
        </Text>
      ) : null}
      {error ? <StatusLine>{error}</StatusLine> : null}

      <View style={[styles.actions, wide && styles.actionsWide]}>
        {stage.at === 'asking' && target === 'drive' ? (
          <WhitePill
            testID="move-drive"
            label="Move to Google Drive"
            width={width}
            onPress={toDrive}
          />
        ) : null}
        {stage.at === 'asking' && target === 'bucket' ? (
          <WhitePill
            testID="move-bucket"
            label={busy ? 'Trying the key…' : 'Move to this bucket'}
            busy={busy}
            width={width}
            onPress={toBucket}
          />
        ) : null}
        {stage.at === 'unfinished' && storage ? (
          <WhitePill
            testID="move-continue"
            label="Continue the move"
            disabled={busy}
            width={width}
            onPress={() => void run(storage, stage.to)}
          />
        ) : null}
        {stage.at === 'moved' ? (
          <WhitePill testID="move-leave" label="Done" width={width} onPress={leave} />
        ) : null}

        {stage.at === 'asking' && target === 'bucket' ? (
          <Button
            testID="move-mode"
            label={
              entry.mode === 'backblaze'
                ? 'Not Backblaze? Enter the address yourself'
                : 'Back to a Backblaze key'
            }
            variant="text"
            onPress={() => {
              setError(null)
              setEntry({ ...entry, mode: entry.mode === 'backblaze' ? 'address' : 'backblaze' })
            }}
          />
        ) : null}
        {stage.at === 'moving' ? (
          <Button
            testID="move-stop"
            label="Stop"
            variant="text"
            disabled={stopAsked || stage.progress.phase === 'finishing'}
            onPress={() => {
              stopping.current = true
              setStopAsked(true)
            }}
          />
        ) : null}
        {stage.at === 'unfinished' ? (
          <Button
            testID="move-give-up"
            label="Don’t move after all"
            variant="text"
            disabled={busy}
            onPress={giveUp}
          />
        ) : null}
        {stage.at === 'google' ? (
          <Button
            testID="move-google-cancel"
            label="Cancel"
            variant="text"
            onPress={() => setStage({ at: 'asking' })}
          />
        ) : null}
        {stage.at === 'asking' || stage.at === 'unfinished' ? (
          <Button testID="move-back" label="Not now" variant="text" onPress={leave} />
        ) : null}

        {stage.at === 'moved' ? null : (
          <View style={styles.footnote}>
            <OnboardingFootnote>
              {stage.at === 'moving'
                ? 'Keep this page open. If it closes, the move carries on from here the next time.'
                : 'The place your library is in now is left exactly as it is. You can delete that copy yourself afterwards.'}
            </OnboardingFootnote>
          </View>
        )}
      </View>
    </OnboardingPage>
  )
}

const styles = StyleSheet.create(theme => ({
  now: { ...lineSub(theme.colors), color: theme.colors.textMuted },
  words: lineSub(theme.colors),
  trying: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
  tryingText: { flex: 1, ...lineSub(theme.colors) },
  actions: { marginTop: 'auto', gap: space.xs, alignItems: 'stretch' },
  actionsWide: { alignItems: 'flex-start' },
  footnote: { paddingTop: space.sm },
}))
