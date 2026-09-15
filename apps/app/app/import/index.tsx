import type { ReactNode } from 'react'

import { ImportScreen } from '../../src/features/import/ImportScreen'
import { ImportViaServer } from '../../src/features/import/ImportViaServer'
import { useConnection } from '../../src/connection/ConnectionProvider'

/**
 * The import route. A server imports itself; a cloud library imports through the
 * server behind it, when this device can reach it.
 */
export default function ImportRoute(): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <ImportViaServer /> : <ImportScreen />
}
