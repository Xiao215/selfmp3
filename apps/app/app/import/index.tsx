import type { ReactNode } from 'react'

import { ImportScreen } from '../../src/features/import/ImportScreen'
import { ImportViaMac } from '../../src/features/import/ImportViaMac'
import { useConnection } from '../../src/server/ConnectionProvider'

/**
 * The import route. A Mac imports itself; a cloud library imports through the
 * Mac behind it, when this device can reach it.
 */
export default function ImportRoute(): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <ImportViaMac /> : <ImportScreen />
}
