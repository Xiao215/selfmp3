import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { StorageDriver } from './driver.js'
import { LocalStorageDriver } from './local.js'

export type { StorageDriver, StorageStat } from './driver.js'
export { normalizeKey } from './driver.js'

/** The library folder on this disk: where an import lands until it is in the bucket. */
export function createStorage(config: Config, logger: Logger): StorageDriver {
  logger.info('storage: local disk', { path: config.libraryDir })
  return new LocalStorageDriver(config.libraryDir)
}
