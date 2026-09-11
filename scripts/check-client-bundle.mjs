import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
// ponytail: literal requires cover generated CJS; browser E2E covers dynamic resolution.
const imports = [...source.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map(match => match[1])
for (const id of imports) {
  assert(['@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/cordis', 'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'].includes(id), `Non-platform client dependency must be bundled: ${id}`)
}
console.log('Client bundle contains only browser platform external requires')
