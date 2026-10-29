import { describe, expect, it } from 'vitest'
import { importFailure, lookUpFailure } from './importFailure.js'

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
        'YouTube refused the download (HTTP 403). This almost always means yt-dlp on your library’s computer is out of date — update it (docker compose pull && docker compose up -d), then try again.',
      ),
    ).toBe('YouTube refused it. Try again later.')
    expect(
      importFailure(
        'YouTube only shows that to a signed-in account, and your library’s computer isn’t signed in to YouTube. If it’s yours, make it public or unlisted on YouTube, then try again.',
      ),
    ).toBe('Needs a signed-in YouTube account.')
    expect(
      importFailure(
        'YouTube didn’t accept the cookies as a signed-in session. Make sure Chrome is logged in to YouTube Music, then try again.',
      ),
    ).toBe('Your YouTube sign-in isn’t working.')
    expect(
      importFailure(
        'YouTube is rate-limiting this network, which it reports as a bot check. Downloads pause by themselves and pick up once it lifts.',
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

describe('lookUpFailure', () => {
  it('says why a link could not be read, never in yt-dlp’s words', () => {
    expect(lookUpFailure('[youtube] zzzzzzzzzzz: This video is unavailable')).toBe(
      'This video isn’t on YouTube any more.',
    )
    expect(
      lookUpFailure(
        '[generic] foo: Unable to download webpage: HTTP Error 404: Not Found (caused by <HTTPError 404: Not Found>)',
      ),
    ).toBe('There’s nothing to import at that link.')
    expect(
      lookUpFailure('[youtube] abc: Private video. Sign in if you’ve been granted access'),
    ).toBe('This video is private.')
    expect(lookUpFailure('ERROR: something nobody has seen before')).toBe(
      'Couldn’t read that link.',
    )
  })
})
