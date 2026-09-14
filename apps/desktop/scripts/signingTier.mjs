/**
 * Which signing tier a build gets, from the environment alone.
 *
 *   signed        CSC_LINK + CSC_KEY_PASSWORD: a Developer ID certificate from a
 *                 .p12. Notarised as well when the three APPLE_API_* are set.
 *                 The only tier whose builds may replace themselves.
 *   development   CSC_NAME: a certificate already in this Mac's keychain — the
 *                 free "Apple Development" one Xcode makes. Not notarised, and
 *                 not for anyone else's Mac, but a stable identity: the keychain
 *                 recognises every build signed with it as the same app, so the
 *                 "self.mp3 Safe Storage" prompt stops coming back after a
 *                 reinstall.
 *   ad-hoc        neither. Every build is a stranger to the keychain.
 *
 * Pure, so the choice can be tested without a Mac or a certificate.
 */
export function signingTier(env) {
  const has = name => typeof env[name] === 'string' && env[name].trim() !== ''

  if (has('CSC_LINK') && has('CSC_KEY_PASSWORD')) {
    return {
      tier: 'signed',
      identity: null,
      notarising: has('APPLE_API_KEY') && has('APPLE_API_KEY_ID') && has('APPLE_API_ISSUER'),
      // electron-updater applies an update only over a signature it can verify.
      canInstallUpdates: true,
    }
  }
  if (has('CSC_NAME')) {
    return {
      tier: 'development',
      identity: env['CSC_NAME'].trim(),
      notarising: false,
      // An update built on CI carries a Developer ID signature, which this build's
      // signature does not match, so replacing itself would fail.
      canInstallUpdates: false,
    }
  }
  return { tier: 'ad-hoc', identity: '-', notarising: false, canInstallUpdates: false }
}
