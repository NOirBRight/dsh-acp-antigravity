/** Normalize the provider-owned account quota RPC for the shared usage directory. */
import type { ProviderUsageReader } from 'dsh-llm-providers-ui/usage-readers'
import { ACP_SETTINGS_RPC_CHANNEL, QUOTA_ENDPOINT, decodeQuotaSnapshot } from '../client-contract.js'

export function createAntigravityUsageReader(): ProviderUsageReader {
  return { providerKey: 'antigravity', name: 'Antigravity', async read(rpc, _refresh, signal) {
    const result = await rpc.call(ACP_SETTINGS_RPC_CHANNEL, QUOTA_ENDPOINT, {}, signal)
    if (!result.ok) return { status: 'error', message: result.error.message }
    const quota = decodeQuotaSnapshot(result.value)
    if (quota === undefined) return { status: 'error', message: 'Invalid Antigravity quota response' }
    if (quota.status === 'authentication-required' || quota.status === 'account-changed') return { status: 'logged-out' }
    if (quota.status === 'not-entitled') return { status: 'unsupported' }
    if (quota.status !== 'ready') return { status: 'error', ...(quota.message === undefined ? {} : { message: quota.message }) }
    // One headline window only, from the same first-ready bucket the card header
    // uses: two writers (this reader and the card headline) share one cache key,
    // so any shape or bucket mismatch shows up as a jump on every open.
    const hit = quota.groups.flatMap(group => group.buckets.map(bucket => ({ group: group.displayName, bucket })))
      .find(item => !item.bucket.disabled && item.bucket.remainingFraction !== undefined)
    if (hit === undefined) return { status: 'ready', fetchedAt: quota.observedAt, windows: [] }
    const remaining = hit.bucket.remainingFraction! >= 1 ? 100 : Math.min(99, Math.round(hit.bucket.remainingFraction! * 100))
    const label = [hit.group, hit.bucket.displayName ?? hit.bucket.window].filter(Boolean).join(' · ') || 'Antigravity'
    const resetsPrefix = typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('zh') ? '重置时间 ' : 'Resets '
    const resetsAt = hit.bucket.resetTime === undefined ? undefined : resetsPrefix + new Date(hit.bucket.resetTime).toLocaleString()
    return {
      status: 'ready', fetchedAt: quota.observedAt,
      windows: [{
        id: 'headline', label, shortLabel: label, valueText: String(remaining) + '%', remainingPercent: remaining,
        ...(resetsAt === undefined ? {} : { resetsAt }),
      }],
    }
  } }
}
