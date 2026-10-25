import { useState } from 'react'
import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
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
import { BUCKET_GUIDE, BUCKET_GUIDE_URL, guideParts } from '@selfmp3/shared'
import {
  addressReady,
  cloudConnectInput,
  backblazeReady,
  TRYING,
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
 * First sync, asking for the bucket the account has none of yet
 * (`storage.model.ts` has the rules; the canvas "Your bucket, after sign-in",
 * option B, the picture).
 *
 * Two strings and a button. The key ID and the application key Backblaze
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

  const [mode, setMode] = useState<StorageMode>('backblaze')
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
        // The bucket is there: the library comes down from it now, and the
        // usual way on from Welcome takes over.
        storageConnected()
        router.replace(afterWelcome(true, storedFirstSync(), installedApp, false))
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
      keyboard
      lead={
        mode === 'backblaze'
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

      {mode === 'backblaze' ? backblazeFields : addressFields}
      {mode === 'backblaze' ? helper : null}

      {busy ? (
        <View style={styles.trying}>
          <Spinner tone="accent" />
          <Text style={styles.tryingText}>{TRYING}</Text>
        </View>
      ) : null}
      {error ? <StatusLine>{error}</StatusLine> : null}

      <View style={[styles.actions, wide && styles.actionsWide]}>
        <WhitePill
          testID="storage-connect"
          label={busy ? 'Connecting…' : 'Connect'}
          busy={busy}
          width={wide ? 240 : undefined}
          onPress={connect}
        />
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
        <View style={styles.footnote}>
          <OnboardingFootnote>
            The key goes to the sign-in service, sealed. This {device} never keeps it.
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
