import { createExternalAgentFilesystemHandler } from '@deepseek-ai/dsh-acp-provider/filesystem'
import type { ExternalAgentFilesystem } from '@deepseek-ai/dsh-acp-provider'
import type { AcpRequestHandler } from './protocol.js'
import type { AntigravityClientFilesystem } from './types.js'

export { ExternalAgentFilesystemPolicyError } from '@deepseek-ai/dsh-acp-provider/filesystem'

/** Adapt the host-owned filesystem policy to ACP client requests.
 * @param filesystem - host-owned filesystem operations and roots.
 * @param signal - turn lifetime forwarded to each filesystem operation.
 * @returns an ACP request handler with path mediation.
 */
export function createAntigravityFilesystemHandler(filesystem: AntigravityClientFilesystem, signal?: AbortSignal): AcpRequestHandler {
  if (filesystem.resolvePath === undefined) throw new Error('Antigravity filesystem requires a host path resolver')
  const policy: ExternalAgentFilesystem = {
    workspaceRoots: filesystem.workspaceRoots ?? [filesystem.workspaceRoot],
    attachmentRoots: filesystem.attachmentRoots,
    readTextFile: (path, signal) => filesystem.readTextFile(path, signal),
    writeTextFile: (path, content, signal) => filesystem.writeTextFile(path, content, signal),
  }
  const handler = createExternalAgentFilesystemHandler(policy, {
    realpath: (path, operation = 'read') => Promise.resolve(filesystem.resolvePath!(path, operation)),
  })
  return async (method, params, _id) => {
    const result = await handler(method, params, signal)
    return method === 'fs/read_text_file' ? { content: result } : result
  }
}
