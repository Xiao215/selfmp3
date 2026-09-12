import * as SecureStore from 'expo-secure-store'

/**
 * A few small strings that have to survive the app being closed.
 *
 * The server's address and its token: two values, both of which want to be
 * private — the token is a real credential, and the hostname is a Tailscale
 * name that is nobody else's business either.
 *
 * This is a port, in the sense `docs/UNIVERSAL.md` foundation 2 means: an
 * interface with an implementation per platform, resolved by Metro's platform
 * extensions, so that no screen ever asks which platform it is on. This file is
 * the native one and `secrets.web.ts` is the web one; an import of
 * `../ports/secrets` gets whichever fits the bundle being built.
 *
 * It exists because the phone's answer does not build for the browser at all.
 * `expo-secure-store` resolves on web and then throws
 * `setValueWithKeyAsync is not a function` the moment it is used, which is
 * worse than not resolving: the app boots, accepts a server address, says it
 * found the library, and forgets it on reload.
 */
export interface SecretStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}

/** The keychain on iOS, the keystore on Android. */
export const secrets: SecretStore = {
  get: key => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  remove: key => SecureStore.deleteItemAsync(key),
}
