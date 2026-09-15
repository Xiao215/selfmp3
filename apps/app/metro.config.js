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

// Two native modules that code in the web bundle still imports directly,
// resolved to stand-ins there. Each file in webStubs/ says who reaches it.
//
// track-player's web implementation pulls in `shaka-player`, which is not a
// dependency of this repository and is not wanted: on web, playback is the
// two-`<audio>` engine behind ports/engine.web.ts. expo-file-system has no web
// implementation at all, and its `File` throws on construction.
//
// A stub can go once nothing the web bundle includes imports its module, which
// means giving those files a `.web` sibling or moving the call behind a port.
const webStubs = {
  'react-native-track-player': path.resolve(projectRoot, 'webStubs/track-player.js'),
  'expo-file-system': path.resolve(projectRoot, 'webStubs/expo-file-system.js'),
}

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName in webStubs) {
    return { type: 'sourceFile', filePath: webStubs[moduleName] }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
