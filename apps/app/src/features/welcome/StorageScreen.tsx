import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AppState, Linking, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import { iconSize, radius, space, type, textStyle } from '@selfmp3/client'
import { session as cloud } from '../../replica'
import { deviceWord } from '../../ports/device'
import { installedApp } from '../../ports/install'
import { useConnection } from '../../connection/ConnectionProvider'
import { useLayoutFlags } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { SignOutDialog } from '../settings/SignOutDialog'
import { TextField } from '../../ui/components/TextField'
import { BucketAddressFields } from './BucketAddressFields'
import { useCloudSession } from '../profile/useCloudSession'
import { afterWelcome } from './firstSync.model'
import { storedFirstSync } from './firstSyncMemory'
import {
  BUCKET_GUIDE,
  BUCKET_GUIDE_URL,
  DRIVE_REFUSAL_WORDS,
  guideParts,
  type DoormanStorage,
} from '@selfmp3/shared'
import { onSignInBack, signInReturnUrl } from '../../ports/signInReturn'
import {
  addressReady,
  cloudConnectInput,
  backblazeReady,
  CONNECTED_LOOKS_MS,
  CONNECTED_NOT_SEEN,
  driveArrived,
  FINISHING_DRIVE,
  TRYING,
  WAITING_FOR_GOOGLE,
  type AddressFields,
  type StorageMode,
} from './storage.model'
import { WhitePill } from './WhitePill'
import { OnboardingCard, OnboardingFootnote, OnboardingPage } from './OnboardingPage'
import { StatusLine } from '../../ui/components/StatusLine'
import { Press } from '../../ui/components/Press'
import { Spinner } from '../../ui/components/Spinner'
import { ChevronDown, ChevronUp } from '../../ui/components/Icons'
import { rowTitle, lineSub, hint, textColumn } from '../../ui/surfaces'

/**
 * Where it lives: the page between the first Google sign-in on an account and
 * First sync, asking for the storage the account has none of yet
 * (`storage.model.ts` has the rules; the canvas "Your bucket, after sign-in",
 * option B, the picture).
 *
 * It opens on Google Drive: one button, which leaves for Google's page asking
 * whether self.mp3 may keep its own files in the account's Drive
 * (docs/features/storage-providers.md). The doorman connects it when Google
 * comes back, and the browser returns here saying only how it went
 * (`ports/signInReturn`, target `storage`), so the page asks the doorman what
 * the account has now. Where no link comes back — Google's page finished in
 * another browser — the page asks again each time the app returns to the front.
 *
 * A bucket of the person's own is the other choice: two strings and a button. The key ID and the application key Backblaze
 * showed go to the doorman, which asks Backblaze which bucket the key opens
 * and where, tries the key against it, and keeps it sealed. Under them, for
 * someone who has no bucket yet, the steps on Backblaze (`BUCKET_GUIDE`), each
 * with a way to the console page it happens on, and the published guide that
 * says the same at length. For
 * any other provider, the server's form: the address, the region where it
 * does not name one, the bucket and the folder.
 *
 * The account is named at the top with a way out: this is the one page a
 * person may reach with the wrong Google account and nothing else to go by.
 */
export function StorageScreen(): ReactNode {
  const router = useRouter()
  const { wide, finePointer } = useLayoutFlags()
  const { storageConnected } = useConnection()

  const [mode, setMode] = useState<StorageMode>('drive')
  const [keyId, setKeyId] = useState('')
  const [applicationKey, setApplicationKey] = useState('')
  const [address, setAddress] = useState<AddressFields>({
    endpoint: '',
    region: '',
    bucket: '',
    prefix: 'selfmp3',
    keyId: '',
    applicationKey: '',
  })
  const [helperOpen, setHelperOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)
  const email = useCloudSession().data?.email ?? null

  const ready = mode === 'backblaze' ? backblazeReady(keyId, applicationKey) : addressReady(address)

  /** The storage is there: the library comes down from it now, and the usual way on from Welcome takes over. */
  const gone = useRef(false)
  const onward = useCallback((): void => {
    // Once: a link back and the app coming to the front can both find Drive connected.
    if (gone.current) return
    gone.current = true
    storageConnected()
    router.replace(afterWelcome(true, storedFirstSync(), installedApp, false))
  }, [router, storageConnected])

  // Whether Google's page is open somewhere, and what the account had when it was opened.
  const [waiting, setWaiting] = useState(false)
  // Google said yes and the doorman is being asked: nothing to press meanwhile.
  const [finishing, setFinishing] = useState(false)
  // The same, for a second press in the frame before `waiting` is drawn.
  const leavingForGoogle = useRef(false)
  const before = useRef<DoormanStorage | null>(null)

  /**
   * What the doorman says the account has now. `sure`: a link said Drive was
   * connected, so "nothing yet" is the doorman not having heard everywhere,
   * and is asked again for a little while before it is believed.
   */
  const look = useCallback(
    async (sure: boolean): Promise<void> => {
      for (const wait of sure ? CONNECTED_LOOKS_MS : [0]) {
        if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
        const session = await cloud.loadSession()
        if (!session) return
        const { storage } = (await cloud.refreshSession(session)).me
        if (sure ? storage !== null : driveArrived(before.current, storage)) {
          onward()
          return
        }
      }
      if (sure) throw new Error(CONNECTED_NOT_SEEN)
    },
    [onward],
  )

  const stopWaiting = useCallback((): void => {
    leavingForGoogle.current = false
    setWaiting(false)
  }, [])

  const connectDrive = (): void => {
    if (busy || waiting || leavingForGoogle.current) return
    leavingForGoogle.current = true
    setError(null)
    setWaiting(true)
    void (async () => {
      try {
        const session = await cloud.loadSession()
        if (!session) {
          setError('Signed out meanwhile. Sign in again.')
          stopWaiting()
          return
        }
        before.current = session.me.storage
        await cloud.beginDriveConnect(session, signInReturnUrl('storage'))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not open Google.')
        stopWaiting()
      }
    })()
  }

  useEffect(
    () =>
      onSignInBack('storage', back => {
        if (back.kind === 'refused') {
          stopWaiting()
          setError(DRIVE_REFUSAL_WORDS[back.refusal])
          return
        }
        setError(null)
        // Still waiting, now on the doorman: the page keeps saying so until it answers.
        setFinishing(true)
        void look(true)
          .catch((caught: unknown) => {
            setError(caught instanceof Error ? caught.message : 'Could not connect.')
          })
          .finally(() => {
            setFinishing(false)
            stopWaiting()
          })
      }),
    [look, stopWaiting],
  )

  useEffect(() => {
    if (!waiting) return
    const sub = AppState.addEventListener('change', state => {
      // Offline, or the doorman is busy: the next time back will say.
      if (state === 'active') void look(false).catch(() => undefined)
    })
    return () => sub.remove()
  }, [waiting, look])

  const connect = (): void => {
    if (busy) return
    if (!ready) {
      setError(
        mode === 'backblaze'
          ? 'Both strings are needed: the key ID and the application key.'
          : 'The address, the bucket, the key ID and the application key are all needed.',
      )
      return
    }
    setBusy(true)
    setError(null)
    void (async () => {
      try {
        const session = await cloud.loadSession()
        if (!session) {
          setError('Signed out meanwhile. Sign in again.')
          return
        }
        if (mode === 'backblaze') {
          await cloud.connectBackblaze(session, { keyId, applicationKey })
        } else {
          await cloud.connectStorage(session, cloudConnectInput(address))
        }
        onward()
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not connect.')
      } finally {
        setBusy(false)
      }
    })()
  }

  const device = deviceWord({ wide, finePointer })
  const backblazeFields = (
    <OnboardingCard>
      <TextField
        label="Key ID"
        value={keyId}
        onChangeText={setKeyId}
        placeholder="004a1b2c3d4e5f0000000000f"
        autoCapitalize="none"
        disabled={busy}
        testID="storage-key-id"
      />
      <TextField
        label="Application key"
        hint="A key made for one bucket, with read and write. Backblaze shows it once."
        value={applicationKey}
        onChangeText={setApplicationKey}
        secret
        autoCapitalize="none"
        disabled={busy}
        testID="storage-application-key"
      />
    </OnboardingCard>
  )

  const addressFields = (
    <OnboardingCard>
      <BucketAddressFields
        value={address}
        onChange={setAddress}
        disabled={busy}
        keyHint="Shown once, as you make it. Sealed for the sign-in service."
        testID="storage-address"
      />
    </OnboardingCard>
  )

  const helper = (
    <OnboardingCard>
      <Press
        feedback="dim"
        onPress={() => setHelperOpen(open => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: helperOpen }}
        accessibilityLabel="Don’t have a bucket yet?"
        style={styles.helperHead}
        testID="storage-helper"
      >
        <View style={styles.helperWords}>
          <Text style={styles.helperTitle}>Don’t have a bucket yet?</Text>
          {helperOpen ? null : (
            <Text style={styles.hint}>
              {`${BUCKET_GUIDE.steps.length} steps on Backblaze, about ten minutes. Easiest on a computer.`}
            </Text>
          )}
        </View>
        {helperOpen ? (
          <ChevronUp size={iconSize.field} tone="textSecondary" />
        ) : (
          <ChevronDown size={iconSize.field} tone="textSecondary" />
        )}
      </Press>
      {helperOpen ? (
        <>
          {BUCKET_GUIDE.steps.map((step, index) => (
            <View key={step.title} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.stepWords}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDetail}>
                  {guideParts(step.detail).map((part, at) =>
                    part.label ? (
                      <Text key={at} style={styles.stepLabel}>
                        {part.text}
                      </Text>
                    ) : (
                      part.text
                    ),
                  )}
                </Text>
                {step.link ? (
                  <View style={styles.open}>
                    <Button
                      label={step.link.label}
                      size="small"
                      onPress={() => void Linking.openURL(step.link?.url ?? '')}
                      testID={`storage-helper-link-${index + 1}`}
                    />
                  </View>
                ) : null}
              </View>
            </View>
          ))}
          <View style={styles.open}>
            <Button
              label="The whole guide, step by step"
              variant="text"
              onPress={() => void Linking.openURL(BUCKET_GUIDE_URL)}
              testID="storage-helper-guide"
            />
          </View>
        </>
      ) : null}
    </OnboardingCard>
  )

  return (
    <OnboardingPage
      title="Where it lives"
      face="display"
      keyboard
      lead={
        mode === 'drive'
          ? 'Your music goes in a folder called self.mp3 in your own Google Drive. Google asks once whether self.mp3 may keep its files there.'
          : mode === 'backblaze'
            ? 'Your music goes in a bucket you own. Paste the key for it; self.mp3 asks Backblaze which bucket it opens, and where.'
            : 'Your music goes in a bucket you own. Its address, its name, and a key for it with read and write.'
      }
    >
      <View style={styles.account}>
        <Text style={styles.accountText} numberOfLines={1}>
          {email ? `Signed in as ${email}` : 'Signed in'}
        </Text>
        <Button label="Sign out" variant="text" onPress={() => setLeaving(true)} />
      </View>

      {mode === 'drive' ? null : mode === 'backblaze' ? backblazeFields : addressFields}
      {mode === 'backblaze' ? helper : null}

      {busy || waiting || finishing ? (
        <View style={styles.trying}>
          <Spinner tone="accent" />
          <Text style={styles.tryingText}>
            {finishing ? FINISHING_DRIVE : waiting ? WAITING_FOR_GOOGLE : TRYING}
          </Text>
        </View>
      ) : null}
      {error ? <StatusLine>{error}</StatusLine> : null}

      <View style={[styles.actions, wide && styles.actionsWide]}>
        {mode === 'drive' ? (
          <WhitePill
            testID="storage-drive"
            label={finishing ? 'Connecting…' : waiting ? 'Waiting for Google…' : 'Use Google Drive'}
            busy={waiting || finishing}
            width={wide ? 240 : undefined}
            onPress={connectDrive}
          />
        ) : (
          <WhitePill
            testID="storage-connect"
            label={busy ? 'Connecting…' : 'Connect'}
            busy={busy}
            width={wide ? 240 : undefined}
            onPress={connect}
          />
        )}
        {finishing ? null : waiting ? (
          <Button
            testID="storage-drive-cancel"
            label="Cancel"
            variant="text"
            onPress={stopWaiting}
          />
        ) : (
          <>
            {mode === 'drive' ? null : (
              <Button
                testID="storage-mode"
                label={
                  mode === 'backblaze'
                    ? 'Not Backblaze? Enter the address yourself'
                    : 'Back to a Backblaze key'
                }
                variant="text"
                onPress={() => {
                  setError(null)
                  setMode(mode === 'backblaze' ? 'address' : 'backblaze')
                }}
              />
            )}
            <Button
              testID="storage-kind"
              label={mode === 'drive' ? 'Use your own bucket instead' : 'Use Google Drive instead'}
              variant="text"
              onPress={() => {
                setError(null)
                setMode(mode === 'drive' ? 'backblaze' : 'drive')
              }}
            />
          </>
        )}
        <View style={styles.footnote}>
          <OnboardingFootnote>
            {mode === 'drive'
              ? 'self.mp3 can see only the files it puts there, and nothing else in your Drive.'
              : `The key goes to the sign-in service, sealed. This ${device} never keeps it.`}
          </OnboardingFootnote>
        </View>
      </View>

      <SignOutDialog open={leaving} onClose={() => setLeaving(false)} />
    </OnboardingPage>
  )
}

const styles = StyleSheet.create(theme => ({
  account: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  accountText: { flex: 1, minWidth: 0, color: theme.colors.textMuted, fontSize: type.sub },
  hint: hint(theme.colors),
  helperHead: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
  helperWords: { flex: 1, minWidth: 0, gap: 1 },
  helperTitle: rowTitle(theme.colors),
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: theme.colors.textPrimary, fontSize: type.small, fontWeight: '600' },
  stepWords: textColumn,
  stepTitle: { ...rowTitle(theme.colors), ...textStyle('body') },
  stepDetail: lineSub(theme.colors),
  stepLabel: { color: theme.colors.textPrimary, fontWeight: '600' },
  open: { alignItems: 'flex-start', paddingTop: space.xs },
  trying: { flexDirection: 'row', alignItems: 'center', gap: space.snug },
  tryingText: {
    flex: 1,
    ...lineSub(theme.colors),
  },
  actions: { marginTop: 'auto', gap: space.xs, alignItems: 'stretch' },
  actionsWide: { alignItems: 'flex-start' },
  footnote: { paddingTop: space.sm },
}))
