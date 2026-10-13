import type { ReactNode } from 'react'

import { ImportSearch } from '../../src/features/import/ImportSearch'
import { ImportViaServer } from '../../src/features/import/ImportViaServer'
import { useConnection } from '../../src/connection/ConnectionProvider'

/**
 * Searching for songs to import. Like `/import`, a cloud library searches
 * through the server behind it, since only that server can look a song up,
 * play it before it is imported, or download it.
 */
export default function ImportSearchRoute(): ReactNode {
  const { fromCloud } = useConnection()
  return fromCloud ? <ImportViaServer page="search" /> : <ImportSearch />
}
