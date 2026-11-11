/** Where an update check has got to, as the About card says it. */
export interface UpdateStatus {
  readonly tone: 'good' | 'ready' | 'quiet' | 'error'
  readonly line: string
  readonly action?: UpdateAction
}

/** The one thing to do about it. */
export interface UpdateAction {
  readonly label: string
  readonly onPress: () => void
  readonly primary?: boolean
  readonly busy?: boolean
  readonly testID?: string
}

/** The check button's words: what it is doing, or whether it has been asked before. */
export function checkLabel(checking: boolean, checkedBefore: boolean): string {
  return checking ? 'Checking…' : checkedBefore ? 'Check again' : 'Check'
}

/**
 * A check that found nothing to install, the same on a phone and on the
 * desktop app: it failed, it found this is the newest, or it has not run.
 */
export function checkedStatus(
  outcome: 'failed' | 'upToDate' | 'notYet',
  check: UpdateAction,
): UpdateStatus {
  switch (outcome) {
    case 'failed':
      return { tone: 'error', line: 'Couldn’t check', action: check }
    case 'upToDate':
      return { tone: 'good', line: 'Up to date', action: check }
    case 'notYet':
      return { tone: 'quiet', line: 'Not checked yet', action: check }
  }
}
