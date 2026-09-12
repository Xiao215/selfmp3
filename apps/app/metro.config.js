// Metro, told about the monorepo.
//
// Two things are needed for a workspace package to work: Metro has to *watch*
// the repository root (otherwise edits to packages/shared never trigger a
// reload), and it has to know both node_modules folders, because npm hoists
// most dependencies to the root while some may stay nested under apps/mobile.
//
// `disableHierarchicalLookup` is deliberately NOT set. It is the usual way to
// stop a monorepo bundling two copies of react, but it also stops Metro
// finding genuinely nested dependencies — this tree has ~50 packages with
// their own node_modules because of version conflicts, and each one would
// silently resolve to the wrong version. Single copies of react, react-dom,
// reanimated and worklets are guaranteed by `overrides` in the root
// package.json instead, which fixes the cause rather than the symptom.

const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [workspaceRoot]

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
]

// Spike only: the two native modules the phone app reaches for directly, which
// have no place in a web bundle.
//
// track-player's web implementation pulls in `shaka-player`, which is not a
// dependency of this repository and is not wanted — docs/UNIVERSAL.md gives the
// web side of the PlaybackEngine port to the existing two-`<audio>` engine.
// expo-file-system simply has no web implementation.
//
// Phase 3 deletes this block by moving both behind
// `src/ports/{engine,offline}.{web,native}.ts`, which is where the difference
// belongs. That these two stubs are the *whole* list is itself the finding:
// nothing else in the phone app blocks a web build.
const webStubs = {
  'react-native-track-player': path.resolve(
    projectRoot,
    'verify/stubs/track-player.web.js',
  ),
  // expo-file-system has no web implementation at all — its `File` throws on
  // construction — and six files build one at module scope, so the app cannot
  // boot on web without this. Phase 3's OfflineStore port is the real answer.
  'expo-file-system': path.resolve(
    projectRoot,
    'verify/stubs/expo-file-system.web.js',
  ),
}

// TypeScript's ESM style writes a relative import of `api.ts` as `'./api.js'`,
// and tsc rewrites it on the way out. Metro does not: it looks for a real
// `api.js` and fails. apps/web uses that style in 377 places across 85 files,
// so any of its source that Metro bundles directly hits this immediately.
//
// It costs nothing for code that does not use the style, so the rule is
// general: if a relative `.js` specifier does not resolve, try `.ts`/`.tsx`.
// Phase 3 can keep this or rewrite the specifiers as it moves each file; the
// spike keeps it, because check 4 asks whether the engine runs *unchanged*.
const retryAsTypeScript = (context, moduleName, platform) => {
  for (const ext of ['.ts', '.tsx']) {
    try {
      return context.resolveRequest(
        context,
        moduleName.replace(/\.js$/, ext),
        platform,
      )
    } catch {
      // Try the next extension, then let the original error stand.
    }
  }
  return null
}

// apps/web/src/lib/platform.ts is the one module over there that reads Vite's
// `import.meta.env`, which Metro does not provide — evaluating it throws and no
// screen renders. It is reached by relative path from many files, so it is
// swapped on the resolved path rather than on the specifier.
const webPlatformSource = path.resolve(
  workspaceRoot,
  'apps/web/src/lib/platform.ts',
)
const webPlatformStub = path.resolve(projectRoot, 'verify/stubs/web-platform.web.js')

/** Applied to whichever branch resolved it, including the `.js` retry. */
const swapWebPlatform = (resolved, platform) =>
  platform === 'web' && resolved?.filePath === webPlatformSource
    ? { type: 'sourceFile', filePath: webPlatformStub }
    : resolved

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName in webStubs) {
    return { type: 'sourceFile', filePath: webStubs[moduleName] }
  }

  try {
    return swapWebPlatform(
      context.resolveRequest(context, moduleName, platform),
      platform,
    )
  } catch (error) {
    if (moduleName.startsWith('.') && moduleName.endsWith('.js')) {
      const resolved = retryAsTypeScript(context, moduleName, platform)
      if (resolved) return swapWebPlatform(resolved, platform)
    }
    throw error
  }
}

module.exports = config
