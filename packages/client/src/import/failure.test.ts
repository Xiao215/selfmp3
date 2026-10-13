import { describe, expect, it } from 'vitest'
import { importFailure } from './failure.js'

describe('importFailure', () => {
  it('says the reasons yt-dlp gives in plain words', () => {
    expect(
      importFailure('[youtube] FDXohHp9Jso: This video is only available to Music Premium members'),
    ).toBe('Needs YouTube Premium.')
    expect(
      importFailure('[youtube] abc: Private video. Sign in if you’ve been granted access'),
    ).toBe('This video is private.')
    expect(
      importFailure(
        '[youtube] abc: Video unavailable. The uploader has not made this video available in your country',
      ),
    ).toBe('Not available in this country.')
    expect(importFailure('[youtube] abc: Video unavailable. This video has been removed')).toBe(
      'This video isn’t on YouTube any more.',
    )
    expect(
      importFailure('[youtube] abc: Join this channel to get access to members-only content'),
    ).toBe('Only for the channel’s members.')
    expect(importFailure('[youtube] abc: Sign in to confirm your age')).toBe(
      'Age-restricted on YouTube.',
    )
    expect(importFailure('download timed out')).toBe('Couldn’t connect. Try again later.')
    expect(importFailure('could not work out a title for this track')).toBe(
      'Couldn’t find this song.',
    )
  })

  it('says the server’s own advice in plain words, leaving the advice to the server', () => {
    expect(
      importFailure(
        'YouTube refused the download (HTTP 403). This almost always means yt-dlp is out of date — run: brew upgrade yt-dlp, then retry.',
      ),
    ).toBe('YouTube refused it. Try again later.')
    expect(
      importFailure(
        'YouTube says that needs a signed-in account. Set up YouTube cookies in Settings → Importing first.',
      ),
    ).toBe('Needs a signed-in YouTube account.')
    expect(
      importFailure(
        'YouTube didn’t accept the cookies as a signed-in session. Make sure Chrome is logged in to YouTube Music, then try again.',
      ),
    ).toBe('Your YouTube sign-in isn’t working.')
    expect(
      importFailure(
        'YouTube is rate-limiting this network, which it reports as a bot check — your cookies are not the problem.',
      ),
    ).toBe('YouTube asked us to slow down. Try again later.')
    expect(
      importFailure(
        '网易云 gave only a 45-second preview of this song, so it was not imported. Look it up again to get it from YouTube.',
      ),
    ).toBe('网易云 only gave a preview. Look it up again.')
    expect(importFailure('yt-dlp is not installed — run: brew install yt-dlp ffmpeg')).toBe(
      'yt-dlp isn’t installed.',
    )
  })

  it('falls back to a line that still says what to do', () => {
    expect(importFailure('the download finished but no file appeared')).toBe(
      'Couldn’t download it. Try again later.',
    )
    expect(importFailure(null)).toBe('Couldn’t download it. Try again later.')
  })
})
