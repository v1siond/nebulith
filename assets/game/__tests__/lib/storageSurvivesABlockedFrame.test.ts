import { clearStored, readStored, writeStored } from '@/lib/storage'

/**
 * The engine is embedded through an iframe on the CV site. A cross-origin frame gets partitioned
 * storage in Chrome and NONE in Safari's default third-party configuration, where touching
 * `window.localStorage` throws a SecurityError on the property access itself.
 *
 * This is not hypothetical: booting the engine with storage blocked used to throw during mount and
 * leave a blank page, because the editor read four view toggles unguarded. A read must come back
 * empty and a write must do nothing, so the map still draws.
 */
const blockStorage = () => {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new DOMException('Access is denied for this document.', 'SecurityError')
    },
  })
}

const workingStorage = () => {
  const store = new Map<string, string>()
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  })
}

describe('storage survives a frame that has none', () => {
  afterEach(() => workingStorage())

  test('a read comes back empty instead of throwing', () => {
    blockStorage()
    expect(() => readStored('village-topview')).not.toThrow()
    expect(readStored('village-topview')).toBeNull()
  })

  test('a write does nothing instead of throwing', () => {
    blockStorage()
    expect(() => writeStored('village-topview', 'true')).not.toThrow()
  })

  test('a clear does nothing instead of throwing', () => {
    blockStorage()
    expect(() => clearStored('nebulith_games_v1')).not.toThrow()
  })

  test('and when storage DOES work it is a real round trip, not a no-op that always passes', () => {
    workingStorage()
    writeStored('village-topview-zoom', '2.5')
    expect(readStored('village-topview-zoom')).toBe('2.5')
    clearStored('village-topview-zoom')
    expect(readStored('village-topview-zoom')).toBeNull()
  })
})
