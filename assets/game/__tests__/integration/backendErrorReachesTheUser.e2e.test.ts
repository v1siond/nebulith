/**
 * END TO END: a failure the BACKEND actually produces comes out as the sentence the BACKEND actually wrote.
 *
 * *"you can validate this yourself with end to end test"* (2026-09-14, ticket 93).
 *
 * This runs the whole path the app runs, from `api.ts`'s own `fetch` call down to the message a caller shows:
 * `getTemplate` / `createTemplate` -> `apiFailure` -> `serverMessage` -> the sentence.
 *
 * WHAT IS REAL AND WHAT IS NOT, stated plainly so nobody reads more into this than it proves. The BYTES are
 * real, captured off the live backend (below), and the PARSE is real: the response object's `json()` runs
 * `JSON.parse` over those exact bytes and genuinely throws on the HTML one, which is how the 502 case gets
 * exercised. What is local is the response OBJECT itself, because the jsdom environment this suite runs in
 * carries no `Response`, no `fetch` and no undici. So this is not proof that the socket works; it is proof
 * that what nebulith puts on the wire becomes what the user reads.
 *
 * The existing `apiError` suite is the unit half, over a stand-in whose `json()` is a hardcoded throw.
 *
 * ## The bodies are real, and here is how they were taken
 *
 * Curled against nebulith on :6328, 2026-09-14, and pasted back unedited:
 *
 *     curl -s -w '\nHTTP %{http_code}\n' http://localhost:6328/api/templates/999999
 *     {"errors":{"detail":"Not Found"}}
 *     HTTP 404
 *
 *     curl -s -X POST -H 'content-type: application/json' -d '{"template":{}}' \
 *          -w '\nHTTP %{http_code}\n' http://localhost:6328/api/templates
 *     {"errors":{"name":["can't be blank"],"assetsData":["can't be blank"],
 *      "groundData":["can't be blank"],"heightData":["can't be blank"]}}
 *     HTTP 422
 *
 * Both are `errors` PLURAL, an object. That is the whole of the defect this ticket was raised for: the
 * frontend read `error` singular, so it never found a message and every failure degraded to the wrapper's own
 * fallback sentence. A 422 naming four blank fields and a 500 from a dead database read identically.
 *
 * If nebulith's error rendering ever changes shape, this file goes red and the curl above says what to paste.
 */
import { getTemplate, createTemplate } from '@/lib/api'
import { isApiError } from '@/lib/apiError'

/** The live payloads, byte for byte. */
const NOT_FOUND = { status: 404, statusText: 'Not Found', body: { errors: { detail: 'Not Found' } } }
const CHANGESET = {
  status: 422,
  statusText: 'Unprocessable Entity',
  body: {
    errors: {
      name: ["can't be blank"],
      assetsData: ["can't be blank"],
      groundData: ["can't be blank"],
      heightData: ["can't be blank"],
    },
  },
}
/** A proxy in front of a dead backend answers HTML, not JSON. The error path must survive reading it. */
const DEAD_PROXY = { status: 502, statusText: 'Bad Gateway', body: '<html><body>502 Bad Gateway</body></html>' }

/** Serve one response whose `json()` genuinely `JSON.parse`s the captured bytes, so the HTML body really
 *  throws, exactly as a browser's Response does, instead of a hardcoded rejection standing in for it. */
function serving({ status, statusText, body }: { status: number; statusText: string; body: unknown }): jest.Mock {
  const payload = typeof body === 'string' ? body : JSON.stringify(body)
  const response = {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    text: async () => payload,
    json: async () => JSON.parse(payload), // real parse, real SyntaxError on the proxy's HTML
  } as unknown as Response
  const mock = jest.fn(async () => response)
  ;(globalThis as unknown as { fetch: unknown }).fetch = mock
  return mock
}

const realFetch = globalThis.fetch
afterEach(() => { (globalThis as unknown as { fetch: unknown }).fetch = realFetch })

/** Run `call` and hand back the ApiError it threw, failing loudly if it resolved or threw something else. */
async function failureFrom(call: () => Promise<unknown>) {
  await expect(call()).rejects.toThrow()
  try {
    await call()
  } catch (error) {
    if (!isApiError(error)) throw new Error(`expected an ApiError, got ${String(error)}`)
    return error
  }
  throw new Error('unreachable')
}

describe('a backend failure reaches the user in the backend’s own words', () => {
  it('a map that is not there says Not Found, with the status kept for the caller to branch on', async () => {
    serving(NOT_FOUND)
    const error = await failureFrom(() => getTemplate('999999'))

    expect(error.message).toBe('Not Found')
    expect(error.status).toBe(404)
    expect(error.isNotFound).toBe(true)
    expect(error.isServerFault).toBe(false)
    // …and NOT the wrapper's fallback, which is what the user used to get for every failure alike.
    expect(error.message).not.toBe('This map could not be loaded')
  })

  it('a rejected save names the field that is wrong, not a generic sentence', async () => {
    serving(CHANGESET)
    const error = await failureFrom(() => createTemplate({ name: '' } as never))

    // The user has to be able to see WHICH field the server refused.
    expect(error.message).toContain('name')
    expect(error.message).toContain("can't be blank")
    expect(error.status).toBe(422)
    expect(error.message).not.toBe('This map could not be saved')
  })

  it('a dead backend behind a proxy degrades to the plain sentence instead of crashing on HTML', async () => {
    serving(DEAD_PROXY)
    const error = await failureFrom(() => getTemplate('7'))

    // No JSON to read, so the wrapper's own sentence is the honest answer, and the status still separates
    // "the server broke, retry" from "your map is gone, pick another".
    expect(error.message).toBe('This map could not be loaded')
    expect(error.status).toBe(502)
    expect(error.isServerFault).toBe(true)
    expect(error.isNotFound).toBe(false)
  })

  it('really goes through api.ts’s own fetch call, at the url the app builds', async () => {
    const mock = serving(NOT_FOUND)
    await failureFrom(() => getTemplate('999999'))

    expect(mock).toHaveBeenCalled()
    expect(String(mock.mock.calls[0][0])).toContain('999999')
  })
})
