/**
 * An HTTP failure from one of the app's own APIs, with the STATUS kept on it.
 *
 * Every `fetch` wrapper in `api.ts` used to throw a bare `Error` with the reason baked into a
 * sentence (`'Template not found'`, `` `Failed to get template: ${statusText}` ``). A caller could
 * then only re-print that sentence: it had no way to tell "this map was deleted" (404, the user's
 * problem, and fixable by picking another map) from "the backend is down" (5xx, not the user's
 * problem, and fixable by retrying). Both degraded to the same dead end.
 *
 * Handling them differently starts with being able to tell them
 * apart, so the status travels with the error and the UI decides what to show.
 */
export class ApiError extends Error {
  /** The HTTP status the server answered with. */
  readonly status: number
  /** The server's own reason phrase, kept for the technical detail line. */
  readonly statusText: string

  constructor(message: string, status: number, statusText: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.statusText = statusText
  }

  /** The thing asked for is not there. The user picks something else. */
  get isNotFound(): boolean {
    return this.status === 404
  }

  /** The server broke. Retrying is the right advice. */
  get isServerFault(): boolean {
    return this.status >= 500
  }
}

/** True when `error` came from one of our API wrappers, narrowed so `.status` is readable. */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/**
 * Turn a failed `Response` into an `ApiError`.
 *
 * The API's own `{ error }` body is the best message when it sends one, so it wins; `fallback` is the
 * caller's plain-language sentence for when it does not. Reading the body is guarded because a 502
 * from a proxy answers HTML, and a parse crash inside the error path would hide the real failure.
 */
export async function apiFailure(response: Response, fallback: string): Promise<ApiError> {
  const served = await serverMessage(response)
  return new ApiError(served ?? fallback, response.status, response.statusText)
}

/**
 * The server's own message, or null when the body carries none.
 *
 * TWO SHAPES, because the backend only ever sends one of them and this only ever read the other. Phoenix
 * renders every failure through `ChangesetJSON`/`ErrorJSON` as `errors` (PLURAL, an object), measured live:
 *
 *     POST /api/templates (blank name)   422  {"errors":{"name":["can't be blank"]}}
 *     GET  /api/templates/does-not-exist 404  {"errors":{"detail":"Not Found"}}
 *
 * A grep for a singular `"error"` key across `lib/nebulith_web/` finds none. So this returned null for
 * EVERY real backend failure and the caller's generic sentence was all anyone ever saw: a blank name, a bad
 * size, a conflict and a dead database all read "This map could not be saved". The `error` branch stays,
 * harmlessly, for anything that does speak it.
 */
async function serverMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    if (!body || typeof body !== 'object') return null

    const single = (body as { error?: unknown }).error
    if (typeof single === 'string' && single.length > 0) return single

    return flattenErrors((body as { errors?: unknown }).errors)
  } catch {
    return null
  }
}

/** `{name: ["can't be blank"]}` becomes `name: can't be blank`; `{detail: "Not Found"}` becomes `Not Found`.
 *  A bare `detail` is the server's own sentence, so it is passed through without a field prefix. */
function flattenErrors(errors: unknown): string | null {
  if (!errors || typeof errors !== 'object') return null
  const parts: string[] = []
  for (const [field, value] of Object.entries(errors as Record<string, unknown>)) {
    const messages = Array.isArray(value) ? value : [value]
    const text = messages.filter((m): m is string => typeof m === 'string' && m.length > 0).join(', ')
    if (!text) continue
    parts.push(field === 'detail' ? text : `${field}: ${text}`)
  }
  return parts.length > 0 ? parts.join('; ') : null
}
