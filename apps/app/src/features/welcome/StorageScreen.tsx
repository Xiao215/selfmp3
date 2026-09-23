import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { StyleSheet, useUnistyles } from 'react-native-unistyles'
import { useRouter } from 'expo-router'
import type { CloudConnect } from '@selfmp3/shared'
import { fonts, radius, space, type } from '@selfmp3/client'
import { library as cloudLibrary, session as cloud } from '../../replica'
import { deviceWord } from '../../ports/device'
import { installedApp } from '../../ports/install'
import { keyboardAvoidBehavior } from '../../ports/keyboard'
import { titleBarInset } from '../../ports/titleBarInset'
import { useConnection } from '../../connection/ConnectionProvider'
import { useLayout } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { ConfirmDialog } from '../../ui/components/ConfirmDialog'
import { SafeAreaView } from '../../ui/components/SafeAreaView'
import { card, serif } from '../../ui/surfaces'
import { signOutWarning } from '../settings/signOut'
import { useSignOut } from '../settings/useSignOut'
import { afterWelcome } from './firstSync.model'
import { storedFirstSync } from './firstSyncMemory'
import {
  addressReady,
  BACKBLAZE_URL,
  backblazeReady,
  HELPER_STEPS,
  needsRegion,
  TRYING,
  type AddressFields,
  type StorageMode,
} from './storage.model'
import { WhitePill } from './WhitePill'

/**
 * Where it lives: the page between the first Google sign-in on an account and
 * First sync, asking for the bucket the account has none of yet
 * (`storage.model.ts` has the rules; the canvas "Your bucket, after sign-in",
 * option B, the picture).
 *
 * Two strings and a button. The key ID and the application key Backblaze
 * showed go to the doorman, which asks Backblaze which bucket the key opens
 * and where, tries the key against it, and keeps it sealed. Under them, for
 * someone who has no bucket yet, the three steps and a way to Backblaze. For
 * any other provider, the server's form: the address, the region where it
 * does not name one, the bucket and the folder.
 *
 * The account is named at the top with a way out: this is the one page a
 * person may reach with the wrong Google account and nothing else to go by.
 */
export function StorageScreen(): ReactNode {
  const { theme } = useUnistyles()
  const router = useRouter()
  const { wide, finePointer } = useLayout()
  const { storageConnected } = useConnection()
  const signOut = useSignOut()

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
  const [email, setEmail] = useState<string | null>(null)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void cloud
      .loadSession()
      .then(session => {
        if (!cancelled) setEmail(session?.me.email ?? null)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

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
          const input: CloudConnect = {
            endpoint: address.endpoint,
            bucket: address.bucket,
            prefix: address.prefix,
            keyId: address.keyId,
            applicationKey: address.applicationKey,
            ...(needsRegion(address.endpoint) ? { region: address.region } : {}),
          }
          await cloud.connectStorage(session, input)
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
  const field = (
    label: string,
    value: string,
    onChange: (text: string) => void,
    options: { placeholder?: string; hint?: string; secret?: boolean; testID?: string } = {},
  ): ReactNode => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        testID={options.testID}
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={options.placeholder}
        placeholderTextColor={theme.colors.textMuted}
        secureTextEntry={options.secret}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        accessibilityLabel={label}
        editable={!busy}
      />
      {options.hint ? <Text style={styles.hint}>{options.hint}</Text> : null}
    </View>
  )

  const backblazeFields = (
    <View style={styles.card}>
      {field('Key ID', keyId, setKeyId, {
        placeholder: '004a1b2c3d4e5f0000000000f',
        testID: 'storage-key-id',
      })}
      {field('Application key', applicationKey, setApplicationKey, {
        hint: 'A key made for one bucket, with read and write. Backblaze shows it once.',
        secret: true,
        testID: 'storage-application-key',
      })}
    </View>
  )

  const addressFields = (
    <View style={styles.card}>
      {field('Endpoint', address.endpoint, endpoint => setAddress({ ...address, endpoint }), {
        placeholder: 's3.us-west-004.backblazeb2.com',
        hint: 'On the bucket’s own page.',
        testID: 'storage-endpoint',
      })}
      {needsRegion(address.endpoint)
        ? field('Region', address.region, region => setAddress({ ...address, region }), {
            hint: 'As your provider names it. For Cloudflare R2 it is auto.',
          })
        : null}
      {field('Bucket', address.bucket, bucket => setAddress({ ...address, bucket }), {
        placeholder: 'selfmp3-yourname',
        hint: 'Its name, not its ID.',
        testID: 'storage-bucket',
      })}
      {field('Folder', address.prefix, prefix => setAddress({ ...address, prefix }), {
        hint: 'Everything goes under this folder in the bucket.',
      })}
      {field('Key ID', address.keyId, keyId => setAddress({ ...address, keyId }), {
        testID: 'storage-address-key-id',
      })}
      {field(
        'Application key',
        address.applicationKey,
        applicationKey => setAddress({ ...address, applicationKey }),
        { secret: true, testID: 'storage-address-application-key' },
      )}
    </View>
  )

  const helper = (
    <View style={styles.card}>
      <Pressable
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
            <Text style={styles.hint}>Three steps on Backblaze, about five minutes.</Text>
          )}
        </View>
        <Text style={styles.caret}>{helperOpen ? '▴' : '▾'}</Text>
      </Pressable>
      {helperOpen ? (
        <>
          {HELPER_STEPS.map((step, index) => (
            <View key={step.title} style={styles.step}>
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.stepWords}>
                <Text style={styles.stepTitle}>{step.title}</Text>
                <Text style={styles.stepDetail}>{step.detail}</Text>
              </View>
            </View>
          ))}
          <View style={styles.open}>
            <Button label="Open Backblaze" onPress={() => void Linking.openURL(BACKBLAZE_URL)} />
          </View>
        </>
      ) : null}
    </View>
  )

  const column = (
    <View style={[styles.column, wide && styles.columnWide]}>
      <View style={styles.head}>
        <Text style={[styles.title, wide && styles.titleWide]} accessibilityRole="header">
          Where it lives
          <Text style={styles.titleMark}>.</Text>
        </Text>
        <Text style={[styles.lead, wide && styles.leadWide]}>
          {mode === 'backblaze'
            ? 'Your music goes in a bucket you own. Paste the key for it; self.mp3 asks Backblaze which bucket it opens, and where.'
            : 'Your music goes in a bucket you own. Its address, its name, and a key for it with read and write.'}
        </Text>
      </View>

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
          <ActivityIndicator color={theme.colors.accent} />
          <Text style={styles.tryingText}>{TRYING}</Text>
        </View>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={[styles.actions, wide && styles.actionsWide]}>
        <WhitePill
          testID="storage-connect"
          label={busy ? 'Connecting…' : 'Connect'}
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
        <Text style={[styles.footnote, wide && styles.footnoteWide]}>
          The key goes to the sign-in service, sealed. This {device} never keeps it.
        </Text>
      </View>

      <ConfirmDialog
        open={leaving}
        title="Sign out?"
        body={signOutWarning(cloudLibrary.pendingCloudChanges())}
        confirmLabel="Sign out"
        danger
        onConfirm={() => {
          setLeaving(false)
          void signOut()
        }}
        onCancel={() => setLeaving(false)}
      />
    </View>
  )

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.screen} behavior={keyboardAvoidBehavior}>
        <ScrollView
          contentContainerStyle={[styles.page, wide && styles.pageWide]}
          keyboardShouldPersistTaps="handled"
        >
          {column}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create(theme => ({
  screen: { flex: 1, backgroundColor: theme.colors.surface0 },
  page: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 44 + titleBarInset, paddingBottom: 40 },
  // On a computer the page is one column in the middle of the window, as First sync is (`C02`).
  pageWide: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  column: { flexGrow: 1, gap: 22 },
  columnWide: { flexGrow: 0, width: 560, maxWidth: '100%' },
  head: { gap: space.sm },
  // A page on the way in, so the serif: one weight, never bolded.
  title: { ...serif(theme.colors, 40), lineHeight: 42, letterSpacing: -0.5 },
  titleWide: { fontSize: 52, lineHeight: 54, letterSpacing: -0.8 },
  titleMark: { fontFamily: fonts.serifItalic, color: theme.colors.accent },
  lead: { color: theme.colors.textSecondary, fontSize: 15, lineHeight: 22 },
  leadWide: { fontSize: 16, lineHeight: 24 },
  account: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  accountText: { flex: 1, minWidth: 0, color: theme.colors.textMuted, fontSize: 13 },
  card: { ...card(theme.colors, radius.cardLg), padding: 18, gap: 14 },
  field: { gap: 6 },
  fieldLabel: { color: theme.colors.textSecondary, fontSize: 13, fontWeight: '600' },
  // A control on the card: a control's fill, a pill, no edge (as Welcome's address form).
  input: {
    backgroundColor: theme.colors.surface2,
    borderRadius: radius.pill,
    color: theme.colors.textPrimary,
    fontSize: type.body,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  hint: { color: theme.colors.textMuted, fontSize: 12, lineHeight: 17 },
  helperHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  helperWords: { flex: 1, minWidth: 0, gap: 1 },
  helperTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600' },
  caret: { color: theme.colors.textSecondary, fontSize: 14 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNumber: {
    width: 24,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: theme.colors.surface3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: theme.colors.textPrimary, fontSize: 12, fontWeight: '600' },
  stepWords: { flex: 1, minWidth: 0, gap: 2 },
  stepTitle: { color: theme.colors.textPrimary, fontSize: 15, fontWeight: '600', lineHeight: 20 },
  stepDetail: { color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
  open: { alignItems: 'flex-start' },
  trying: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  tryingText: { flex: 1, color: theme.colors.textSecondary, fontSize: 13, lineHeight: 18 },
  error: { color: theme.colors.danger, fontSize: type.body, lineHeight: 20 },
  actions: { marginTop: 'auto', gap: 4, alignItems: 'stretch' },
  actionsWide: { alignItems: 'flex-start' },
  footnote: {
    color: theme.colors.textMuted,
    fontSize: type.small,
    lineHeight: 17,
    textAlign: 'center',
    paddingTop: space.sm,
  },
  footnoteWide: { textAlign: 'left', maxWidth: 420 },
}))
