import { useState } from 'react'
import type { ReactNode } from 'react'
import { plural, type SameArtistAsk } from '@selfmp3/shared'
import { useSetArtistNames } from '@selfmp3/client'
import { Button } from '../../ui/components/Button'
import { NoticeCard } from '../../ui/components/NoticeCard'
import { showToast } from '../../ui/toast'

/**
 * "Same artist as Yorushika?" on a smaller artist's page (pick E1,
 * 2026-10-25): when its other names hold a bigger artist's name, or the names
 * MusicBrainz found for a bigger artist hold its own, and nothing joins them
 * yet (shared artistJoins.ts).
 *
 * Join them saves this name among the bigger artist's, which joins the two
 * everywhere, and the page becomes theirs. Not the same takes out the names
 * that linked them, so the question does not come back. Undoing a join is
 * taking the name out again, in the bigger artist's Other names….
 */
export function SameArtistCard({ ask }: { ask: SameArtistAsk }): ReactNode {
  const save = useSetArtistNames()
  const [busy, setBusy] = useState(false)

  const run = async (lists: readonly { artist: string; names: string[] }[]): Promise<boolean> => {
    setBusy(true)
    try {
      for (const list of lists) await save.mutateAsync(list)
      return true
    } catch {
      // The mutation says what failed itself.
      return false
    } finally {
      setBusy(false)
    }
  }
  const join = async (): Promise<void> => {
    if (await run([ask.join])) {
      showToast({ over: 'Now one artist', say: ask.other.name }, 'good')
    }
  }

  return (
    <NoticeCard
      title={`Same artist as ${ask.other.name}?`}
      testID="same-artist"
      actions={
        <>
          <Button
            label="Join them"
            variant="primary"
            disabled={busy}
            onPress={() => void join()}
            testID="same-artist-join"
          />
          <Button
            label="Not the same"
            disabled={busy}
            onPress={() => void run(ask.apart)}
            testID="same-artist-apart"
          />
        </>
      }
    >
      {`${plural(ask.artist.songIds.length, 'song', 'songs')} here, ${ask.other.songIds.length} under ${ask.other.name}.`}
    </NoticeCard>
  )
}
