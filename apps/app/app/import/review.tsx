import type { ReactNode } from 'react'

import { ImportReview } from '../../src/features/import/ImportReview'
import { ImportViaServer } from '../../src/features/import/ImportViaServer'
import { useConnection } from '../../src/connection/ConnectionProvider'

/**
 * Reviewing a looked-up link before importing it. Like `/import`, a cloud
 * library reviews through the server behind it, since only that server can
 * play a song that is not imported yet or download it.
 */
export default function ImportReviewRoute(): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <ImportViaServer page="review" /> : <ImportReview />
}
