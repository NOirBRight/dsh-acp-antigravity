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
    return { status: 'ready', fetchedAt: quota.observedAt, windows: quota.groups.flatMap((group, gi) => group.buckets.map((bucket, bi) => {
      const remaining = bucket.disabled || bucket.remainingFraction === undefined ? undefined : bucket.remainingFraction * 100
      const label = [group.displayName, bucket.displayName ?? bucket.window].filter(Boolean).join(' · ') || 'Antigravity'
      return { id: String(gi) + ':' + (bucket.bucketId ?? String(bi)), label, shortLabel: bucket.window ?? label,
        valueText: remaining === undefined ? '—' : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(remaining) + '%',
        ...(remaining === undefined ? {} : { remainingPercent: remaining }), ...(bucket.resetTime === undefined ? {} : { resetsAt: bucket.resetTime }) }
    })) }
  } }
}
