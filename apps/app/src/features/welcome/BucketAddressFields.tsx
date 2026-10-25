import type { ReactNode } from 'react'
import { StyleSheet } from 'react-native-unistyles'
import { TextField } from '../../ui/components/TextField'
import { Row } from '../settings/SettingsParts'
import { BUCKET_FIELDS, needsRegion, type AddressFields } from './storage.model'

type FieldName = keyof AddressFields

/**
 * A bucket's address, typed in: the endpoint, the region where the address
 * does not name one, the bucket, the folder and the key. Where it lives asks
 * for it on the way in; Settings → Cloud asks for it again to change bucket.
 *
 * One form, so the two say the same things in the same order and are judged
 * by the same rules (`storage.model.ts`). They had drifted: different hints
 * for the region and the folder, the key ID explained in one only, and the
 * Settings fields still taking typing while the key was being tried.
 *
 * `rows` lays each field out as a Settings row — the name and its hint on the
 * left, the field on the right — for a form inside a Settings panel; without
 * it each field has its name over it and its hint under it, on a card.
 * `keyIdHint` and `keyHint` say what is true of this key where it is typed:
 * the key it replaces, and where it is kept. `disabled` while the answer to
 * the last try is on its way.
 */
export function BucketAddressFields({
  value,
  onChange,
  disabled,
  rows = false,
  keyIdHint,
  keyHint,
  testID,
}: {
  value: AddressFields
  onChange: (next: AddressFields) => void
  disabled: boolean
  rows?: boolean
  keyIdHint?: string
  keyHint?: string
  testID: string
}): ReactNode {
  const field = (name: FieldName, hint?: string): ReactNode => {
    const copy = BUCKET_FIELDS[name]
    const said = hint ?? copy.hint
    const input = (
      <TextField
        key={name}
        label={rows ? undefined : copy.label}
        accessibilityLabel={copy.label}
        hint={rows ? undefined : said}
        size={rows ? 'small' : 'regular'}
        style={rows ? styles.rowField : undefined}
        value={value[name]}
        onChangeText={text => onChange({ ...value, [name]: text })}
        placeholder={copy.placeholder}
        secret={name === 'applicationKey'}
        disabled={disabled}
        autoCapitalize="none"
        testID={`${testID}-${copy.id}`}
      />
    )
    return rows ? (
      <Row key={name} label={copy.label} hint={said}>
        {input}
      </Row>
    ) : (
      input
    )
  }
  return (
    <>
      {field('endpoint')}
      {needsRegion(value.endpoint) ? field('region') : null}
      {field('bucket')}
      {field('prefix')}
      {field('keyId', keyIdHint)}
      {field('applicationKey', keyHint)}
    </>
  )
}

const styles = StyleSheet.create(() => ({
  rowField: { minWidth: 280 },
}))
