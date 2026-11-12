# Documentation

| Document | What it covers |
|---|---|
| [INSTALL.md](INSTALL.md) | Running the server in Docker on a Raspberry Pi or another always-on computer, Tailscale, every setting, the AI helper, the desktop app, the CLI, backups and updating |
| [SYNC.md](SYNC.md) | The library in a bucket: the layout, signing in, how edits combine, setting it up |
| [MOBILE.md](MOBILE.md) | Building and running the iPhone and Android app, sharing it with friends, and Android Auto |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Working on the code: every root script, the habits, the GitHub workflows |
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the code is laid out, and why |
| [PREPROD.md](PREPROD.md) | Checking a build against the real thing before calling it good: what to test on each platform, and how not to damage the library doing it |
| [UI-MIGRATION.md](UI-MIGRATION.md) | How the app was moved to the redesigned interface, phase by phase |
| [FEATURE_TODO.md](FEATURE_TODO.md) | What was planned or researched and is not built yet |
| [CODE_TODO.md](CODE_TODO.md) | What is left from the code audits, and what was kept on purpose so it is not reported again |
| [ui-mock/README.md](ui-mock/README.md) | The UI mock the interface is built to |
| [apps/doorman/README.md](../apps/doorman/README.md) | Deploying the doorman, and what each setting means |
| [scripts/sound-models/README.md](../scripts/sound-models/README.md) | Exporting the listening model's files |
| [verify/README.md](../verify/README.md) | The Playwright flows and what they need |
| [apps/app/.maestro/README.md](../apps/app/.maestro/README.md) | The phone flows, run with Maestro on a simulator |

## Features

Each page says what the feature does, how it works and where the code is.

| Feature | |
|---|---|
| [admin.md](features/admin.md) | The owner's admin page: Data, People and iPhones, opened through Tailscale |
| [ai.md](features/ai.md) | The smart features: Ask, Describe it, tidying names and tags, and the model behind them |
| [audio-intelligence.md](features/audio-intelligence.md) | Tempo, key, energy and loudness; the listening model; similar songs; auto-mix |
| [browser-extension.md](features/browser-extension.md) | The Chrome extension: the button, the popup, and what it asks Chrome for |
| [client-download.md](features/client-download.md) | Downloading YouTube songs in the browser, with the extension, or on the phone instead of on the server |
| [design-system.md](features/design-system.md) | Dropdowns, popovers, hover captions, tokens and focus |
| [desktop-app.md](features/desktop-app.md) | The desktop app: why it exists and how the shell is built |
| [devices-and-handoff.md](features/devices-and-handoff.md) | Presence, handoff, continue where you left off |
| [guides.md](features/guides.md) | One-time guides for gestures nothing on screen shows |
| [import-sources.md](features/import-sources.md) | Importing from 网易云音乐, Spotify, or a list of song names |
| [install-and-ops.md](features/install-and-ops.md) | The setup script, `doctor`, the CLI and the Docker image |
| [listen-together.md](features/listen-together.md) | Rooms and shared playlists |
| [lists.md](features/lists.md) | Tags, playlists and Up next: what each is, Save, Recently played |
| [lyrics-plus.md](features/lyrics-plus.md) | Romanization, search by lyric, songs with no words |
| [metadata-polish.md](features/metadata-polish.md) | iTunes and MusicBrainz lookups, finding missing covers |
| [multi-select.md](features/multi-select.md) | Selecting songs and acting on them together |
| [native-app.md](features/native-app.md) | The app on a phone, in brief |
| [now-playing.md](features/now-playing.md) | The now-playing page, Focus, lyrics and the visual for songs with no lyrics |
| [now-playing-colour.md](features/now-playing-colour.md) | The playing song marked in its cover's colour |
| [offline-sync.md](features/offline-sync.md) | Automatic downloads and plays made offline |
| [share-links.md](features/share-links.md) | Sending a song or a few as a link that ends by itself, and Links you shared |
| [share-to-import.md](features/share-to-import.md) | Importing from the share sheet on Android and iOS |
| [shared-server.md](features/shared-server.md) | One server for every account: workspaces, grants, plays in the bucket, who may sign in |
| [sound-map.md](features/sound-map.md) | The library placed by how it sounds: press to play a place, drag to drift between two |
| [tagging.md](features/tagging.md) | Picking, editing and colouring tags, tagging what plays, songs with no tag |
| [watched-library-folder.md](features/watched-library-folder.md) | The inbox folder, and sweeping it when it changes |
| [widget.md](features/widget.md) | The iOS home-screen widgets |
| [wrapped-and-gems.md](features/wrapped-and-gems.md) | The Report and forgotten gems |
| [youtube-music-library.md](features/youtube-music-library.md) | Liked Music, private playlists and artist pages |
