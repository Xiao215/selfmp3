// Metro, told about the monorepo.
//
// Two things are needed for a workspace package to work: Metro has to *watch*
// the repository root (otherwise edits to packages/shared never trigger a
// reload), and it has to know both node_modules folders, because npm hoists
// most dependencies to the root while some may stay nested under apps/app.
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

// The two native modules the phone app reaches for directly, which have no
// place in a web bundle.
//
// track-player's web implementation pulls in `shaka-player`, which is not a
// dependency of this repository and is not wanted — docs/UNIVERSAL.md gives the
// web side of the PlaybackEngine port to the existing two-`<audio>` engine.
// expo-file-system has no web implementation at all: its `File` throws on
// construction, and six files build one at module scope, so the app cannot boot
// on web without this.
//
// Phase 3 deletes this block by moving both behind
// `src/ports/{engine,offline}.{web,native}.ts`, which is where the difference
// belongs. That these two are the *whole* list is itself the finding: nothing
// else in the phone app blocks a web build.
const webStubs = {
  'react-native-track-player': path.resolve(projectRoot, 'verify/stubs/track-player.web.js'),
  'expo-file-system': path.resolve(projectRoot, 'verify/stubs/expo-file-system.web.js'),
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName in webStubs) {
    return { type: 'sourceFile', filePath: webStubs[moduleName] }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
