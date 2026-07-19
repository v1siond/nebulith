/**
 * Editor-settings API client — the backend-owned store for floating-panel geometry.
 * We drive the REAL client against a mocked fetch and assert the wire contract the nebulith
 * `/api/editor_settings` resource speaks: GET returns a `{editorSettings: {key→geo}}` map,
 * PUT `/editor_settings/:key` sends `{value}` and echoes the stored geometry.
 */
import { getEditorSettings, saveEditorSetting } from '@/lib/editorSettings'

describe('editorSettings API client', () => {
  const origFetch = global.fetch
  afterEach(() => { global.fetch = origFetch; jest.restoreAllMocks() })

  it('getEditorSettings unwraps the {editorSettings} map into key→geometry', async () => {
    const geo = { settings: { x: 10, y: 20, w: 300, h: 400 }, animation: { x: 5, y: 6, w: 380, h: 520 } }
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ editorSettings: geo }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await getEditorSettings()
    expect(out).toEqual(geo)
    expect(fetchMock.mock.calls[0][0]).toContain('/editor_settings')
  })

  it('getEditorSettings defaults to {} when no settings key is present', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as unknown as typeof fetch
    expect(await getEditorSettings()).toEqual({})
  })

  it('saveEditorSetting PUTs {value} to /editor_settings/:key and returns the stored geometry', async () => {
    const value = { x: 111, y: 222, w: 333, h: 444 }
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ key: 'animation', value }) })
    global.fetch = fetchMock as unknown as typeof fetch

    const out = await saveEditorSetting('animation', value)
    expect(out).toEqual(value)

    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/editor_settings/animation')
    expect(opts.method).toBe('PUT')
    expect(opts.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(opts.body)).toEqual({ value })
  })

  it('throws a clear error on a non-ok GET', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, statusText: 'Bad Gateway' }) as unknown as typeof fetch
    await expect(getEditorSettings()).rejects.toThrow(/Failed to load editor settings/)
  })

  it('throws a clear error on a non-ok PUT', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, statusText: 'Boom' }) as unknown as typeof fetch
    await expect(saveEditorSetting('settings', { x: 0, y: 0, w: 0, h: 0 })).rejects.toThrow(/Failed to save editor setting "settings"/)
  })
})
