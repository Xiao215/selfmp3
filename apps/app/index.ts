/**
 * The app's entry.
 *
 * The themes first: Unistyles must be configured before any screen's stylesheet
 * is made, and imports run in order. Then this device's API client, which
 * hands the shared query hooks and the listen outbox their client as it loads
 * (`configureClient`), so nothing that asks the server runs before it is set.
 * Then expo-router, which loads the routes.
 */
import './src/ui/theme/unistyles'
import './src/api/client'
import 'expo-router/entry'
