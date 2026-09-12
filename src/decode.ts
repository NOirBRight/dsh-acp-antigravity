/** Return whether a wire value is a plain JSON object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Return a non-empty wire string. */
export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Return a redaction-ready provider diagnostic. */
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : 'Antigravity provider error' }
