import { renameSync, writeFileSync } from 'node:fs'

/**
 * A whole small file, written through a temporary one and a rename, readable
 * by its owner alone.
 *
 * A rename is atomic on the same filesystem, so a crash halfway leaves either
 * the old file or the new one — never a truncated one, which the next launch
 * would read back as nothing at all.
 */
export function writeFileAtomicSync(path: string, text: string): void {
  const temporary = `${path}.tmp`
  writeFileSync(temporary, text, { mode: 0o600 })
  renameSync(temporary, path)
}
