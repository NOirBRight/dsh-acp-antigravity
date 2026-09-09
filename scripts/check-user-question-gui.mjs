/** Keyless assembled-GUI snapshot; requires the configured fixture peer and an existing local GUI. `--article` checks ordinary headings; `--plan` checks explicit review and refusal; `--runtime-lock` checks native picker lock before first token. */
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const env = process.env
assert(env.DSH_GUI_URL && env.DSH_WEB_PACKAGE_JSON && env.DSH_AGY_SETTINGS && env.DSH_QUESTION_WORKSPACE, 'Set DSH_GUI_URL, DSH_WEB_PACKAGE_JSON, DSH_AGY_SETTINGS, DSH_QUESTION_WORKSPACE')
const url = new URL(env.DSH_GUI_URL)
assert(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && ['http:', 'https:'].includes(url.protocol), 'Use an existing local test GUI')
const settings = JSON.parse(await readFile(env.DSH_AGY_SETTINGS, 'utf8'))
assert.equal(typeof settings.executablePath, 'string')
const fixture = await readFile(new URL('../tests/fixtures/acp-freeform-peer.mjs', import.meta.url))
assert.equal((await stat(settings.executablePath)).size, fixture.length, 'Configure the keyless peer and restart the GUI before this check')
assert.deepEqual(await readFile(settings.executablePath), fixture)
const { chromium } = createRequire(resolve(env.DSH_WEB_PACKAGE_JSON))('playwright')
const browser = await chromium.launch({ headless: true, executablePath: env.DSH_CHROME_PATH })
let page
try {
  page = await browser.newPage({ viewport: { width: 1680, height: 1000 }, locale: 'en-US' })
  const submitted = [], errors = []
  function collect(value) {
    if (value === null || typeof value !== 'object') return
    if (value.custom === '1' && Array.isArray(value.selected)) submitted.push({ selected: value.selected, custom: value.custom })
    for (const child of Object.values(value)) collect(child)
  }
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => {
    if (request.method() !== 'POST' || new URL(request.url()).pathname !== '/api/$events/result') return
    try { collect(request.postDataJSON()) } catch (error) { errors.push(String(error)) }
  })
  await page.goto(url.href)
  const workspace = env.DSH_QUESTION_WORKSPACE
  const row = page.getByText(workspace, { exact: true }).first().locator('xpath=ancestor::*[@role="treeitem"][1]')
  await row.waitFor()
  if (await row.getAttribute('aria-expanded') !== 'true') await row.click()
  await row.hover()
  await page.getByRole('button', { name: 'New session in ' + workspace, exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('Gemini 3.8 Flash'))
  const runtimeLock = process.argv.includes('--runtime-lock')
  const plan = !runtimeLock && process.argv.includes('--plan')
  const article = plan || (!runtimeLock && process.argv.includes('--article'))
  const prompt = runtimeLock ? 'LAB runtime lock pretoken' : article ? 'LAB heading regression' : 'LAB keyless Other question.'
  const input = page.locator('[data-composer-input][contenteditable=true]')
  const stop = page.getByRole('button', { name: 'Stop generating', exact: true })
  function kind(row) {
    if (/antigravity/i.test(row.group)) return 'agy'
    if (/codex|deepseek|grok|cursor|ollama|opencode|command/i.test(row.group)) return 'dsh'
    return 'other'
  }
  async function openModelRows() {
    await page.getByRole('button', { name: /^Select model/ }).click()
    await page.getByRole('menu').waitFor()
    if (await page.getByRole('menuitemradio').count() === 0) {
      await page.getByRole('menuitem').filter({ hasText: /^Model/ }).first().click()
    }
    await page.getByRole('menuitemradio').first().waitFor()
    await page.waitForFunction(() => document.querySelector('[role="menu"]')?.getAttribute('aria-busy') !== 'true')
    return page.evaluate(() => [...document.querySelectorAll('section[role="group"]')].flatMap(section => {
      const group = (document.getElementById(section.getAttribute('aria-labelledby'))?.textContent ?? '').trim()
      return [...section.querySelectorAll('button[role="menuitemradio"]')].map(button => ({
        group,
        name: (button.textContent ?? '').trim(),
        disabled: button.disabled,
      }))
    }))
  }
  async function closeModelRows() {
    if (await page.getByRole('menuitemradio').count() > 0) {
      await page.getByRole('button', { name: /^Select model/ }).click()
    }
  }
  if (runtimeLock) {
    const before = await openModelRows()
    const beforeDsh = before.filter(row => kind(row) === 'dsh')
    const beforeAgy = before.filter(row => kind(row) === 'agy')
    assert.ok(beforeDsh.length > 0 && beforeDsh.some(row => !row.disabled), 'Cross-runtime Codex or other DSH choices must be allowed before submit')
    assert.ok(beforeAgy.length === 0 || beforeAgy.some(row => !row.disabled), 'AGY choices must stay selectable on a blank session')
    await closeModelRows()
    await input.fill(prompt)
    await input.press('Enter')
    await stop.waitFor({ timeout: 15000 })
    await page.getByText(prompt, { exact: true }).last().waitFor()
    assert.equal(await page.getByPlaceholder('Type your answer', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Pick one', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('heading', { name: '计算的演化史与智能基础设施的未来构建', exact: true }).count(), 0)
    const chunks = await page.locator('[data-chat-flow-kind="assistant-step"]').count()
    assert.equal(chunks, 0, 'Pending native prompt must have zero assistant chunks')
    const after = await openModelRows()
    const afterDsh = after.filter(row => kind(row) === 'dsh')
    const afterAgy = after.filter(row => kind(row) === 'agy')
    assert.ok(afterDsh.length > 0 && afterDsh.every(row => row.disabled), 'Codex or other DSH model entries must be disabled before first token')
    assert.ok(afterAgy.length === 0 || afterAgy.every(row => !row.disabled), 'Current AGY models must remain enabled if available')
    await closeModelRows()
    assert.equal(await stop.isVisible(), true)
    await stop.click()
    await stop.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    const transcript = 'locked-before-first-token\nchunks: 0\ndsh: disabled\nagy: ' + (afterAgy.length > 0 ? 'enabled' : 'absent') + '\ncancelled: true\n'
    assert.equal(transcript, await readFile(new URL('../tests/fixtures/acp-runtime-lock.expected.md', import.meta.url), 'utf8'))
    console.log(transcript)
  } else {
  await input.fill(plan ? '/plan ' + prompt : prompt)
  await input.press('Enter')
  if (article) {
    const heading = page.getByRole('heading', { name: '计算的演化史与智能基础设施的未来构建', exact: true }).last()
    await heading.waitFor({ timeout: 15000 })
    if (plan) {
      await page.getByText('Plan review', { exact: true }).last().waitFor()
      await page.getByRole('button', { name: 'Keep planning', exact: true }).click()
    }
    await page.getByRole('button', { name: 'Stop generating', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await page.getByPlaceholder('Type your answer', { exact: true }).count(), 0)
    assert.equal(await page.getByText('Plan review', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'Discuss', exact: true }).count(), 0)
    assert.equal((await input.innerText()).trim(), '')
    assert.deepEqual(submitted, [])
    assert.deepEqual(errors, [])
    const body = await heading.innerText() + '\n' + await heading.locator('xpath=following-sibling::p[1]').innerText() + '\n'
    assert.equal(body, await readFile(new URL('../tests/fixtures/acp-article.expected.md', import.meta.url), 'utf8'))
    if (plan) await page.getByRole('button', { name: 'Plan mode on, press to turn off', exact: true }).click()
    console.log(plan ? 'Explicit Plan review shown and refused\n' + body : body)
  } else {
    const custom = page.getByPlaceholder('Type your answer', { exact: true })
    await custom.waitFor({ timeout: 15000 })
    const question = await page.getByText('Pick one', { exact: true }).last().innerText()
    await custom.fill('1')
    await custom.press('Enter')
    await custom.waitFor({ state: 'hidden' })
    await page.getByRole('button', { name: 'Stop generating', exact: true }).waitFor({ state: 'hidden' })
    const reply = await page.getByText('Received Other: 1', { exact: true }).last().innerText()
    assert.deepEqual(submitted, [{ selected: [], custom: '1' }])
    assert.deepEqual(errors, [])
    const transcript = '# Other answer\n\nUser: ' + prompt + '\nQuestion: ' + question + '\nSubmitted: ' + JSON.stringify(submitted[0]) + '\nAgent: ' + reply + '\n'
    assert.equal(transcript, await readFile(new URL('../tests/fixtures/acp-freeform.expected.md', import.meta.url), 'utf8'))
    console.log(transcript)
  }
  }
} catch (error) {
  if (page) console.error('GUI check failed:', (await page.locator('body').innerText()).slice(-1800))
  throw error
} finally {
  try {
    if (page) {
      const stop = page.getByRole('button', { name: 'Stop generating', exact: true })
      if (await stop.isVisible() && await stop.isEnabled()) await stop.click()
    }
  } finally { await browser.close() }
}
