/**
 * An HTTP failure from one of the app's own APIs, with the STATUS kept on it.
 *
 * Every `fetch` wrapper in `api.ts` used to throw a bare `Error` with the reason baked into a
 * sentence (`'Template not found'`, `` `Failed to get template: ${statusText}` ``). A caller could
 * then only re-print that sentence: it had no way to tell "this map was deleted" (404, the user's
 * problem, and fixable by picking another map) from "the backend is down" (5xx, not the user's
 * problem, and fixable by retrying). Both degraded to the same dead end.
 *
 * Alexander, 2026-09-10: *"let's correctly handle errors in frontend, like 404, 500, etc. We need an
 * actual real page and good UX"*. Handling them differently starts with being able to tell them
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

/** The API's own `error` string, or null when the body is empty, not JSON, or shaped differently. */
async function serverMessage(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && 'error' in body) {
      const served = (body as { error: unknown }).error
      if (typeof served === 'string' && served.length > 0) return served
    }
    return null
  } catch {
    return null
  }
}
