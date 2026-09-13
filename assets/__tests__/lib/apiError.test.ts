import { ApiError, apiFailure, isApiError } from '@/lib/apiError'

/** A Response stand-in — only the four fields `apiFailure` reads, so no network is involved. */
function responseWith(status: number, statusText: string, body?: unknown): Response {
  return {
    status,
    statusText,
    json: async () => {
      if (body === undefined) throw new SyntaxError('Unexpected token < in JSON')
      return body
    },
  } as unknown as Response
}

describe('ApiError', () => {
  it('keeps the status on the error so a caller can branch on it', () => {
    const error = new ApiError('This map could not be loaded', 404, 'Not Found')
    expect(error.status).toBe(404)
    expect(error.statusText).toBe('Not Found')
    expect(error.message).toBe('This map could not be loaded')
    expect(error).toBeInstanceOf(Error)
  })

  it('separates a missing record from a broken server', () => {
    expect(new ApiError('gone', 404, 'Not Found').isNotFound).toBe(true)
    expect(new ApiError('gone', 404, 'Not Found').isServerFault).toBe(false)

    expect(new ApiError('boom', 500, 'Internal Server Error').isServerFault).toBe(true)
    expect(new ApiError('boom', 502, 'Bad Gateway').isServerFault).toBe(true)
    expect(new ApiError('boom', 500, 'Internal Server Error').isNotFound).toBe(false)
  })

  it('does not treat a 4xx that is not a 404 as either case', () => {
    const forbidden = new ApiError('no', 403, 'Forbidden')
    expect(forbidden.isNotFound).toBe(false)
    expect(forbidden.isServerFault).toBe(false)
  })

  it('narrows through isApiError, and rejects a plain Error', () => {
    expect(isApiError(new ApiError('x', 404, 'Not Found'))).toBe(true)
    expect(isApiError(new Error('x'))).toBe(false)
    expect(isApiError('not even an error')).toBe(false)
    expect(isApiError(null)).toBe(false)
  })
})

describe('apiFailure', () => {
  it("prefers the API's own message when it sends one", async () => {
    const error = await apiFailure(responseWith(422, 'Unprocessable', { error: 'name is already taken' }), 'fallback')
    expect(error.message).toBe('name is already taken')
    expect(error.status).toBe(422)
  })

  it('falls back to the plain-language sentence when the body carries no error field', async () => {
    const error = await apiFailure(responseWith(404, 'Not Found', { detail: 'nope' }), 'This map could not be loaded')
    expect(error.message).toBe('This map could not be loaded')
    expect(error.isNotFound).toBe(true)
  })

  it('survives a body that is not JSON at all (a proxy answering HTML)', async () => {
    const error = await apiFailure(responseWith(502, 'Bad Gateway'), 'The map library could not be loaded')
    expect(error.message).toBe('The map library could not be loaded')
    expect(error.status).toBe(502)
    expect(error.isServerFault).toBe(true)
  })

  it('ignores an error field that is empty or not a string', async () => {
    const empty = await apiFailure(responseWith(500, 'Internal Server Error', { error: '' }), 'fallback text')
    expect(empty.message).toBe('fallback text')

    const wrongType = await apiFailure(responseWith(500, 'Internal Server Error', { error: { nested: true } }), 'fallback text')
    expect(wrongType.message).toBe('fallback text')
  })
})

/**
 * THE SHAPE THE BACKEND ACTUALLY SENDS.
 *
 * Ticket 93. Phoenix renders every failure through `ChangesetJSON` / `ErrorJSON`, which write `errors`,
 * PLURAL, an object. `serverMessage` only ever read `error`, singular, a string, so it returned null for every
 * real backend failure and the caller's generic sentence was all anyone saw: a blank name, a bad size, a
 * conflict and a dead database all read "This map could not be saved".
 *
 * The two bodies below are CAPTURED, not invented. Curled against nebulith on :6328, 2026-09-13:
 *
 *     POST /api/templates {"template":{"name":""}}  -> 422 {"errors":{"name":["can't be blank"], ...}}
 *     GET  /api/templates/does-not-exist            -> 404 {"errors":{"detail":"Not Found"}}
 */
describe('apiFailure, the errors object Phoenix actually sends', () => {
  it('reads a changeset failure, naming the field that is wrong', async () => {
    const live = { errors: { name: ["can't be blank"], assetsData: ["can't be blank"] } }
    const error = await apiFailure(responseWith(422, 'Unprocessable Entity', live), 'This map could not be saved')
    expect(error.message).toBe("name: can't be blank; assetsData: can't be blank")
    expect(error.status).toBe(422)
  })

  it("passes a bare detail through as the server's own sentence, with no field prefix", async () => {
    const live = { errors: { detail: 'Not Found' } }
    const error = await apiFailure(responseWith(404, 'Not Found', live), 'This map could not be loaded')
    expect(error.message).toBe('Not Found')
    expect(error.isNotFound).toBe(true)
  })

  it('joins several complaints about the same field', async () => {
    const body = { errors: { name: ['should be at least 3 character(s)', 'has already been taken'] } }
    const error = await apiFailure(responseWith(422, 'Unprocessable Entity', body), 'fallback')
    expect(error.message).toBe('name: should be at least 3 character(s), has already been taken')
  })

  it('falls back rather than showing an empty errors object', async () => {
    const error = await apiFailure(responseWith(422, 'Unprocessable Entity', { errors: {} }), 'This map could not be saved')
    expect(error.message).toBe('This map could not be saved')
  })

  it('drops values that are not strings instead of printing [object Object]', async () => {
    const body = { errors: { name: [{ nested: true }], size: 42 } }
    const error = await apiFailure(responseWith(422, 'Unprocessable Entity', body), 'This map could not be saved')
    expect(error.message).toBe('This map could not be saved')
  })

  it('still prefers a singular error when a server sends both', async () => {
    const body = { error: 'the singular one', errors: { name: ['the plural one'] } }
    const error = await apiFailure(responseWith(422, 'Unprocessable Entity', body), 'fallback')
    expect(error.message).toBe('the singular one')
  })
})
