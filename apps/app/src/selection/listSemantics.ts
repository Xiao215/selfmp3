/**
 * What a song list's own box is (`SongList`), to a screen reader and to Tab.
 * On a phone, a table of rows to read: there is no keyboard moving in it. A
 * computer's half is `listSemantics.web.ts`.
 */
export const LIST_SEMANTICS: { readonly role: 'table' | 'grid'; readonly tabIndex?: -1 } = {
  role: 'table',
}
