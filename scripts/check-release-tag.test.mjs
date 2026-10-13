import { describe, expect, it } from 'vitest'
import { releaseTagProblem } from './check-release-tag.mjs'

describe('releaseTagProblem', () => {
  it('lets a tag through that names the package version', () => {
    expect(releaseTagProblem('1.2.0', 'desktop-v', 'desktop-v1.2.0')).toBeNull()
  })

  it('stops a tag pushed without the bump', () => {
    expect(releaseTagProblem('1.1.0', 'desktop-v', 'desktop-v1.2.0')).toMatch(
      /names 1\.2\.0, but the package's version is 1\.1\.0/,
    )
  })

  it("stops another workspace's tag", () => {
    expect(releaseTagProblem('0.1.0', 'extension-v', 'desktop-v0.1.0')).toMatch(/not a extension-v/)
  })
})
