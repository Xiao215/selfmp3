// Unistyles has no native side in a test: its own mocks stand in, and the app's
// themes are configured the way the entry file configures them.
require('react-native-unistyles/mocks')
require('./src/ui/theme/unistyles')

// What a component test needs that a simulator would otherwise provide.
//
// Only the native modules a primitive reaches on its way to the screen. This
// is not a place to stub the app's own code: a test that renders a component
// against fakes of its own dependencies proves the fakes work.

// The player's native side, which the engine port speaks to. The web build
// stubs the same module out of its bundle (metro.config.js).
jest.mock('react-native-track-player', () => ({
  __esModule: true,
  default: { registerPlaybackService: jest.fn(), addEventListener: jest.fn() },
  Event: {},
  State: {},
}))

// Files, which no component touches directly but providers pull in.
jest.mock('expo-file-system', () => ({
  File: class {
    exists = false
    textSync() {
      return ''
    }
    write() {}
  },
  Directory: class {
    exists = false
    create() {}
  },
  Paths: { document: '/tmp', cache: '/tmp' },
}))
