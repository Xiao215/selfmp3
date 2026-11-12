import { describe, expect, it } from 'vitest'
import { checkedStatus, checkLabel } from './updateStatus.model'

/** The About card's update line, worded the same for a phone's build and the desktop app. */

describe('an update check that found nothing to install', () => {
  const check = { label: 'Check again', onPress: () => undefined }

  it('says what came of it, with the check to run again', () => {
    expect(checkedStatus('failed', check)).toEqual({
      tone: 'error',
      line: 'Couldn’t check',
      action: check,
    })
    expect(checkedStatus('upToDate', check)).toEqual({
      tone: 'good',
      line: 'Up to date',
      action: check,
    })
    expect(checkedStatus('notYet', check)).toEqual({
      tone: 'quiet',
      line: 'Not checked yet',
      action: check,
    })
  })

  it('names the button for what it is doing, or has done', () => {
    expect(checkLabel(true, true)).toBe('Checking…')
    expect(checkLabel(false, true)).toBe('Check again')
    expect(checkLabel(false, false)).toBe('Check')
  })
})
