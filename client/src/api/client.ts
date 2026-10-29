/** An error response from our API, carrying the HTTP status so screens can react to 401 / 409. */
export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** fetch() for our same-origin JSON API: sends the session cookie and turns error responses into ApiError. */
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })
  } catch {
    throw new ApiError(0, "Can't reach the server. Check your connection.")
  }

  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const message =
      res.status === 400 && data?.issues?.[0]?.message
        ? data.issues[0].message
        : (data?.error ?? `Request failed (${res.status})`)
    throw new ApiError(res.status, message)
  }
  return data as T
}
