/** Open a URL in the user default browser, not the DSH desktop webview. */
import { spawn } from 'node:child_process'

/** Launch the desktop default handler for https URLs. */
export function openDefaultBrowser(url: string): void {
  if (!url.startsWith('https://')) throw new TypeError('default browser URL must be https')
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const child = spawn(command, args, { shell: false, detached: true, stdio: 'ignore', env: process.env })
  child.unref()
}
