import { useState } from 'react'
import type { ReactNode } from 'react'
import { Linking, Text, View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import { iconSize, radius, space, type, textStyle } from '@selfmp3/client'
import { BUCKET_GUIDE, BUCKET_GUIDE_URL, guideParts } from '@selfmp3/shared'
import { Button } from '../../ui/components/Button'
import { ChevronDown, ChevronUp } from '../../ui/components/Icons'
import { Press } from '../../ui/components/Press'
import { TextField } from '../../ui/components/TextField'
import { hint, lineSub, rowTitle, textColumn } from '../../ui/surfaces'
import { BucketAddressFields } from './BucketAddressFields'
import { OnboardingCard } from './OnboardingPage'
import type { BucketEntryValue } from './storage.model'

/**
 * A bucket of the person's own, typed in: on Where it lives, to connect it,
 * and on the Move page, to move a library into it.
 *
 * Two strings for a Backblaze bucket — the key ID and the application key
 * Backblaze showed, from which the doorman asks Backblaze the rest — and
 * under them, for someone who has no bucket yet, the steps on Backblaze
 * (`BUCKET_GUIDE`), each with a way to the console page it happens on, and the
 * published guide that says the same at length. For any other provider, the
 * address: the endpoint, the region where it does not name one, the bucket
 * and the folder. Which of the two is `value.mode`; the page has the button
 * that changes it.
 */
export function BucketEntry({
  value,
  onChange,
  disabled,
  testID,
}: {
  value: BucketEntryValue
  onChange: (next: BucketEntryValue) => void
  disabled: boolean
  /** The start of each field's test id: `storage` gives `storage-key-id`. */
  testID: string
}): ReactNode {
  const [helperOpen, setHelperOpen] = useState(false)

  if (value.mode === 'address') {
    return (
      <OnboardingCard>
        <BucketAddressFields
          value={value.address}
          onChange={address => onChange({ ...value, address })}
          disabled={disabled}
          keyHint="Shown once, as you make it. Sealed for the sign-in service."
          testID={`${testID}-address`}
        />
      </OnboardingCard>
    )
  }

  return (
    <>
      <OnboardingCard>
        <TextField
          label="Key ID"
          value={value.keyId}
          onChangeText={keyId => onChange({ ...value, keyId })}
          placeholder="004a1b2c3d4e5f0000000000f"
          autoCapitalize="none"
          disabled={disabled}
          testID={`${testID}-key-id`}
        />
        <TextField
          label="Application key"
          hint="A key made for one bucket, with read and write. Backblaze shows it once."
          value={value.applicationKey}
          onChangeText={applicationKey => onChange({ ...value, applicationKey })}
          secret
          autoCapitalize="none"
          disabled={disabled}
          testID={`${testID}-application-key`}
        />
      </OnboardingCard>
      <OnboardingCard>
        <Press
          feedback="dim"
          onPress={() => setHelperOpen(open => !open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: helperOpen }}
          accessibilityLabel="Don’t have a bucket yet?"
          style={styles.helperHead}
          testID={`${testID}-helper`}
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
                        testID={`${testID}-helper-link-${index + 1}`}
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
                testID={`${testID}-helper-guide`}
              />
            </View>
          </>
        ) : null}
      </OnboardingCard>
    </>
  )
}

const styles = StyleSheet.create(theme => ({
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
}))
