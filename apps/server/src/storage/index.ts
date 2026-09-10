import type { Config } from '../config.js'
import type { Logger } from '../logger.js'
import type { StorageDriver } from './driver.js'
import { LocalStorageDriver } from './local.js'
import { S3StorageDriver } from './s3.js'

export type { StorageDriver, StorageStat } from './driver.js'
export { normalizeKey } from './driver.js'

export function createStorage(config: Config, logger: Logger): StorageDriver {
  switch (config.storageDriver) {
    case 'local': {
      logger.info('storage: local disk', { path: config.libraryDir })
      return new LocalStorageDriver(config.libraryDir)
    }
    case 's3': {
      logger.info('storage: s3-compatible', {
        bucket: config.s3.bucket,
        endpoint: config.s3.endpoint || 'aws',
      })
      return new S3StorageDriver(config.s3)
    }
  }
}
