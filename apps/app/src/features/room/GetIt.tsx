import type { ReactNode } from 'react'
import type { ImportJob } from '@selfmp3/shared'
import { iconSize, stepFraction } from '@selfmp3/client'
import { IconButton } from '../../ui/components/IconButton'
import { Download } from '../../ui/components/Icons'
import { QueueRing } from '../import/QueueRing'

/**
 * Get it on a friend's song's row (G1), in Import's own words: the download
 * Home opens Import with, and once asked, the ring an import's row has
 * (`QueueRing`) filling as it goes — dotted while it waits its turn, red with
 * a retry if it failed. Once the song is in your library the row is yours, and
 * this is not drawn.
 */
export function GetIt({
  title,
  asked,
  job,
  onGet,
  onRetry,
  testID,
}: {
  title: string
  /** Asked for here, and the queue may not have shown it yet. */
  asked: boolean
  /** Its import, newest first, while the queue is followed. */
  job: ImportJob | undefined
  onGet: () => void
  onRetry: (job: ImportJob) => void
  testID?: string
}): ReactNode {
  if (job?.status === 'error' || job?.status === 'cancelled') {
    return (
      <QueueRing
        fill={0}
        glyph="retry"
        tone="danger"
        label={`Try getting ${title} again`}
        onPress={() => onRetry(job)}
        testID={testID && `${testID}-retry`}
      />
    )
  }
  if (job || asked) {
    return (
      <QueueRing
        fill={job ? stepFraction(job) : 0}
        glyph={null}
        waiting={!job || job.status === 'queued'}
        label={`Getting ${title}`}
        testID={testID && `${testID}-getting`}
      />
    )
  }
  return (
    <IconButton label={`Get ${title}`} filled onPress={onGet} testID={testID}>
      <Download size={iconSize.item} tone="textPrimary" />
    </IconButton>
  )
}
