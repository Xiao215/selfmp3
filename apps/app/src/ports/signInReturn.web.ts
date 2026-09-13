/**
 * Coming back from Google to Settings → Cloud, in a browser: the web app's
 * `SignInReturn`. Google's sign-in sends the tab back to this page with the
 * code that claims the session in the fragment; it is read once and cleared
 * from the address so a reload cannot spend it twice.
 */
export function signInReturnUrl(): string | null {
  return `${window.location.origin}/settings`
}

export function takeSignInCode(): string | null {
  const raw = /(?:^|[#&])signin-code=([0-9A-Za-z-]{1,32})/.exec(window.location.hash)?.[1]
  if (raw === undefined) return null
  window.history.replaceState(null, '', window.location.pathname + window.location.search)
  return raw
}
