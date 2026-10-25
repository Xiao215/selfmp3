import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { StyleSheet } from 'react-native-unistyles'
import type { Tag } from '@selfmp3/shared'
import { ApiError, TIMED_OUT, space, type ServerConnection } from '@selfmp3/client'
import { useFloatingChrome, useFootInset } from '../../shell/bottomInset'
import { setPageFoot } from '../../shell/pageFoot'
import { useLayoutFlags } from '../../shell/useLayout'
import { Button } from '../../ui/components/Button'
import { NoticeCard } from '../../ui/components/NoticeCard'
import { useBackTo } from '../../ui/useBackTo'
import { useListen } from './ImportListen'
import { TagThem } from './ImportTags'
import { useImportDraft } from './importDraft'
import { draftSourceFor } from './importDraft.model'
import { useImportSource } from './importSource'
import { importErrorText, importLabel } from './review.model'
import { TapAway } from '../../ui/components/TapAway'

/** What Import's pages say when the server they were pointed at stops answering. */
const STOPPED_ANSWERING = 'Your library’s computer stopped answering. Looking for it again…'

/**
 * What went wrong on an Import page, and the one way of saying it.
 *
 * A request that never reached the server is not an import that failed. The
 * browser's words for it are "Failed to fetch", which tell a person nothing;
 * for a page pointed at a server (`via`) it says the server stopped answering
 * and asks whoever found it to look again (`onUnreachable`).
 */
export function useImportFailure(
  via: ServerConnection | undefined,
  onUnreachable: (() => void) | undefined,
): {
  error: string | null
  setError: (error: string | null) => void
  failed: (err: Error) => void
} {
  const [error, setError] = useState<string | null>(null)
  const failed = (err: Error): void => {
    // A look-up given up on for taking too long is not a server gone.
    if (via && err instanceof ApiError && err.isOffline && err.message !== TIMED_OUT) {
      setError(STOPPED_ANSWERING)
      onUnreachable?.()
      return
    }
    setError(importErrorText(err))
  }
  return { error, setError, failed }
}

/**
 * Everything a page that imports songs from a list starts with — a link's
 * review and a search: where it imports to, its draft, the preview player,
 * the way back to Import, and how a failure is said.
 */
export function useImportPage(
  via: ServerConnection | undefined,
  onUnreachable: (() => void) | undefined,
): ReturnType<typeof useImportFailure> & {
  source: ReturnType<typeof useImportSource>
  draftKey: ReturnType<typeof draftSourceFor>
  draft: ReturnType<typeof useImportDraft>[0]
  patchDraft: ReturnType<typeof useImportDraft>[1]
  listen: ReturnType<typeof useListen>
  backTo: ReturnType<typeof useBackTo>
} {
  const source = useImportSource(via)
  const draftKey = draftSourceFor(via)
  const [draft, patchDraft] = useImportDraft(draftKey)
  const listen = useListen(via, source.api)
  const backTo = useBackTo()
  return {
    source,
    draftKey,
    draft,
    patchDraft,
    listen,
    backTo,
    ...useImportFailure(via, onUnreachable),
  }
}

/**
 * The foot of a page that imports a list's songs: what went wrong (with
 * Dismiss), songs that could not be found (with Try again), the tags the
 * songs arrive with, Cancel where the page has it, and Import. It stays put
 * under the list, in reach however long the list; on a phone it stands clear
 * of the floating chrome, or of the home indicator on a page with none.
 *
 * On a phone it is also a press that closes the open row (`onGround`).
 */
export function ImportFoot({
  error,
  onDismissError,
  finder,
  tags,
  createTag,
  tagIds,
  onTags,
  onCancel,
  count,
  finding,
  busy,
  onImport,
  onGround,
  testID,
}: {
  error: string | null
  onDismissError: () => void
  finder: { readonly error: string | null; readonly retry: () => void }
  tags: readonly Tag[]
  createTag: (name: string) => Promise<Tag>
  tagIds: ReadonlySet<number>
  onTags: (next: ReadonlySet<number>) => void
  onCancel?: () => void
  /** Songs coming in, and songs still being found: the button's words and whether it can go. */
  count: number
  finding: number
  busy: boolean
  onImport: () => void
  onGround?: () => void
  /** The Import button's. */
  testID: string
}): ReactNode {
  const { wide } = useLayoutFlags()
  const footInset = useFootInset()
  const chrome = useFloatingChrome()
  useEffect(() => () => setPageFoot(0), [])
  return (
    <TapAway
      onPress={wide ? undefined : onGround}
      style={[wide ? styles.footWide : styles.footPhone, { paddingBottom: footInset + 12 }]}
      // The toasts rise above the Import button rather than cover it (a
      // "Continue from…" took its taps); the chrome under it they clear already.
      onLayout={event => setPageFoot(Math.max(0, event.nativeEvent.layout.height - chrome))}
    >
      {error ? (
        <NoticeCard tone="error" onDismiss={onDismissError}>
          {error}
        </NoticeCard>
      ) : null}
      {finder.error ? (
        <NoticeCard
          tone="error"
          actions={<Button label="Try again" variant="text" onPress={finder.retry} />}
        >
          {finder.error}
        </NoticeCard>
      ) : null}
      <View style={wide ? styles.footRow : styles.footColumn}>
        <View style={wide ? styles.tagsWide : null}>
          <TagThem tags={tags} createTag={createTag} selected={tagIds} onChange={onTags} />
        </View>
        {wide && onCancel ? <Button label="Cancel" variant="text" onPress={onCancel} /> : null}
        <Button
          label={importLabel(count, finding)}
          variant="primary"
          grow={!wide}
          disabled={count === 0 || finding > 0}
          busy={busy}
          onPress={onImport}
          testID={testID}
        />
      </View>
    </TapAway>
  )
}

const styles = StyleSheet.create({
  footPhone: { gap: space.snug, paddingTop: space.sm, paddingHorizontal: space.gutter },
  footWide: { gap: space.snug, paddingTop: space.md, paddingHorizontal: space.gutterWide },
  footColumn: { gap: space.snug },
  footRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  tagsWide: { flex: 1, minWidth: 0 },
})
