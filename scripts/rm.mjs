import { rmSync } from 'node:fs'

/**
 * `rm -rf`, for the `clean` scripts: each path given, a file or a folder, gone
 * if it is there. npm runs scripts with cmd.exe on Windows, which has no `rm`.
 */
for (const path of process.argv.slice(2)) rmSync(path, { recursive: true, force: true })
