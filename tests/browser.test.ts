import { describe, expect, it } from 'vitest'
import { openDefaultBrowser } from '../src/browser.js'

describe('default browser opener', () => {
  it('rejects non-https URLs', () => {
    expect(() => openDefaultBrowser('http://accounts.google.com/o/oauth2/v2/auth')).toThrow(/https/)
  })
})
