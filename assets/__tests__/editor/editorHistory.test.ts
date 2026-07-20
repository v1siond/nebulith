/**
 * editorHistory — the PURE undo/redo stack behind Ctrl+Z / Ctrl+Y. These tests pin the behaviour the user
 * asked for: undo steps back to the exact prior state, redo re-applies, a new edit after an undo clears the
 * redo branch, and the whole thing is bounded to ~5 steps. Opaque string/number "snapshots" stand in for the
 * real MapSnapshot — the stack never inspects them, so this needs no grid.
 */
import { HISTORY_LIMIT, canRedo, canUndo, checkpoint, createHistory, redo, undo } from '@/game/editor/editorHistory'

describe('editorHistory — the pure undo/redo stack', () => {
  test('checkpoint records the pre-edit state and drops any redo branch', () => {
    let h = createHistory<string>()
    h = checkpoint(h, 'A', 5) // about to edit A → B
    expect(h.past).toEqual(['A'])
    expect(h.future).toEqual([])
    expect(canUndo(h)).toBe(true)
    expect(canRedo(h)).toBe(false)
  })

  test('undo restores the last checkpoint and stashes the present for redo', () => {
    // A --edit--> B --edit--> C.  past holds [A, B]; the live present is C.
    let h = createHistory<string>()
    h = checkpoint(h, 'A', 5)
    h = checkpoint(h, 'B', 5)
    const u = undo(h, 'C', 5)
    expect(u.restored).toBe('B') // step back to B
    expect(u.history.past).toEqual(['A'])
    expect(u.history.future).toEqual(['C']) // C is now available to redo
  })

  test('redo re-applies the last undone edit exactly', () => {
    let h = createHistory<string>()
    h = checkpoint(h, 'A', 5)
    h = checkpoint(h, 'B', 5)
    const u = undo(h, 'C', 5) // now at B, future [C]
    const r = redo(u.history, 'B', 5) // present is the restored B
    expect(r.restored).toBe('C') // forward to C
    expect(r.history.future).toEqual([])
    expect(r.history.past).toEqual(['A', 'B'])
  })

  test('a NEW edit after an undo clears the redo branch', () => {
    let h = createHistory<string>()
    h = checkpoint(h, 'A', 5)
    h = checkpoint(h, 'B', 5)
    const u = undo(h, 'C', 5) // at B, future [C]
    const h2 = checkpoint(u.history, 'B', 5) // edit B → D, a fresh branch
    expect(h2.future).toEqual([]) // the redo to C is gone
    expect(canRedo(h2)).toBe(false)
  })

  test('a full undo → redo cycle round-trips through several steps', () => {
    let h = createHistory<string>()
    for (const s of ['s0', 's1', 's2', 's3']) h = checkpoint(h, s, 5) // 4 edits
    // step all the way back
    let present = 's4'
    const back: (string | null)[] = []
    for (let i = 0; i < 4; i++) {
      const u = undo(h, present, 5)
      back.push(u.restored)
      h = u.history
      present = u.restored!
    }
    expect(back).toEqual(['s3', 's2', 's1', 's0'])
    // and all the way forward
    const fwd: (string | null)[] = []
    for (let i = 0; i < 4; i++) {
      const r = redo(h, present, 5)
      fwd.push(r.restored)
      h = r.history
      present = r.restored!
    }
    expect(fwd).toEqual(['s1', 's2', 's3', 's4'])
  })

  test('bounded: at most `limit` steps back are kept (the oldest is dropped)', () => {
    let h = createHistory<number>()
    for (let i = 0; i < 8; i++) h = checkpoint(h, i, 5) // 8 edits, limit 5
    expect(h.past.length).toBe(5)
    expect(h.past).toEqual([3, 4, 5, 6, 7]) // newest 5 kept; 0,1,2 dropped
  })

  test('undo / redo on empty stacks are no-ops (restored is null, history unchanged)', () => {
    const h = createHistory<string>()
    const u = undo(h, 'X', 5)
    expect(u.restored).toBeNull()
    expect(u.history).toEqual(h)
    const r = redo(h, 'X', 5)
    expect(r.restored).toBeNull()
    expect(r.history).toEqual(h)
  })

  test('the shipped HISTORY_LIMIT gives the 4-5 steps the user asked for', () => {
    expect(HISTORY_LIMIT).toBeGreaterThanOrEqual(4)
    expect(HISTORY_LIMIT).toBeLessThanOrEqual(6)
  })
})
