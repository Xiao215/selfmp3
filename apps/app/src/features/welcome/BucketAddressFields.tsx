import type { ReactNode } from 'react'
import { TextField } from '../../ui/components/TextField'
import { BUCKET_FIELDS, needsRegion, type AddressFields } from './storage.model'

type FieldName = keyof AddressFields

/**
 * A bucket's address, typed in on Where it lives: the endpoint, the region
 * where the address does not name one, the bucket, the folder and the key,
 * each with its name over it and its hint under it, judged by the rules in
 * `storage.model.ts`. `keyHint` says where the key is kept; `disabled` while
 * the answer to the last try is on its way.
 */
export function BucketAddressFields({
  value,
  onChange,
  disabled,
  keyHint,
  testID,
}: {
  value: AddressFields
  onChange: (next: AddressFields) => void
  disabled: boolean
  keyHint?: string
  testID: string
}): ReactNode {
  const field = (name: FieldName, hint?: string): ReactNode => {
    const copy = BUCKET_FIELDS[name]
    return (
      <TextField
        key={name}
        label={copy.label}
        accessibilityLabel={copy.label}
        hint={hint ?? copy.hint}
        value={value[name]}
        onChangeText={text => onChange({ ...value, [name]: text })}
        placeholder={copy.placeholder}
        secret={name === 'applicationKey'}
        disabled={disabled}
        autoCapitalize="none"
        testID={`${testID}-${copy.id}`}
      />
    )
  }
  return (
    <>
      {field('endpoint')}
      {needsRegion(value.endpoint) ? field('region') : null}
      {field('bucket')}
      {field('prefix')}
      {field('keyId')}
      {field('applicationKey', keyHint)}
    </>
  )
}
