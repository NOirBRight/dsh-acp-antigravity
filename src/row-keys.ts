/**
 * Stable per-row keys across id edits, reorders, and removals. The shared
 * sortable list keys rows by this id, so the key must survive the very edit
 * it identifies; matching prefers id, then position, then mints fresh.
 * A simultaneous reorder plus replacement can inherit a retired key, which only
 * affects expansion state, never saved data.
 * @param previous - keys aligned with the previous rows.
 * @param ids - current row ids in order.
 * @param mint - fresh key factory for unseen rows.
 * @returns keys aligned with the current rows.
 */
export function syncRowKeys(previous: readonly { key: string; id: string }[], ids: readonly string[], mint: () => string): string[] {
  const free = previous.map(entry => ({ ...entry, used: false }))
  const byId = new Map<string, number[]>()
  free.forEach((entry, index) => {
    const list = byId.get(entry.id) ?? []
    list.push(index)
    byId.set(entry.id, list)
  })
  const keys = new Array<string>(ids.length)
  const take = (index: number): string => {
    free[index]!.used = true
    return free[index]!.key
  }
  ids.forEach((id, at) => {
    if (at < free.length && !free[at]!.used && free[at]!.id === id) {
      keys[at] = take(at)
      return
    }
    const list = byId.get(id)
    const found = list?.find(index => !free[index]!.used)
    if (found !== undefined) {
      keys[at] = take(found)
      return
    }
    if (at < free.length && !free[at]!.used) {
      keys[at] = take(at)
      return
    }
    keys[at] = mint()
  })
  return keys
}
