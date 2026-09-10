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

module.exports = config
