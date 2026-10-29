/**
 * Keeps autofill out of a field: none of the app's fields is a form a browser
 * or password manager knows. Without it a song's "Title" reads as a job title
 * and Dashlane offers a company. React Native for web would otherwise write
 * `autocomplete="on"`, and password managers skip `off` unless told in their
 * own words: Dashlane's `data-form-type`, 1Password's, LastPass's and
 * Bitwarden's ignore marks, which `dataSet` writes as `data-*`. A phone reads
 * only `autoComplete`.
 *
 * Spread onto a `TextInput` before its own props, so a field can still choose.
 */
export const NO_AUTOFILL = {
  autoComplete: 'off',
  dataSet: { formType: 'other', '1pIgnore': 'true', lpignore: 'true', bwignore: 'true' },
} as const
