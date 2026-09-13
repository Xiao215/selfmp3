import type { ReactNode } from 'react'

import { CloudImportScreen } from '../../src/features/import/CloudImportScreen'
import { ImportScreen } from '../../src/features/import/ImportScreen'
import { useConnection } from '../../src/server/ConnectionProvider'

/**
 * The import route. A Mac imports itself; a cloud library asks one to, as the
 * web's cloud build did with `CloudImportView`.
 */
export default function ImportRoute(): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <CloudImportScreen /> : <ImportScreen />
}
