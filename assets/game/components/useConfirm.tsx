/**
 * ASK BEFORE DESTROYING — the app's own confirmation, replacing `window.confirm` (design §5.1).
 *
 * A native `confirm()` is a browser chrome box: unstyled, unreadable next to the dark editor, and
 * impossible to phrase properly ("Delete this template?" with an OK button that says OK). This hook
 * keeps the call site's shape — `if (!(await confirm({…}))) return` — while rendering the app's
 * Modal, so the dialogue reads like the rest of the editor and the destructive button says what it
 * destroys.
 *
 * Only for DESTRUCTIVE actions. Creating things must not ask at all: Alexander, on the new-game
 * prompt — "that's the worst UX ever … just assign a random name … and redirect user to the editor
 * right away." See `game/autoNaming.ts`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './modals'

export interface ConfirmRequest {
  title: string
  /** What is about to happen, in one plain sentence. */
  body: string
  /** The destructive button's label — name the thing, never "OK". */
  confirmLabel: string
}

export interface UseConfirm {
  /** Ask. Resolves true when the user confirms, false on cancel, Esc, backdrop or unmount. */
  confirm: (request: ConfirmRequest) => Promise<boolean>
  /** Render this in the page. Null while nothing is being asked. */
  dialog: React.ReactNode
}

export function useConfirm(): UseConfirm {
  const [request, setRequest] = useState<ConfirmRequest | null>(null)
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null)

  // A caller is `await`ing us. If the page unmounts mid-question, resolve false rather than leaving
  // that promise (and whatever it guards) pending forever.
  useEffect(() => () => {
    resolveRef.current?.(false)
    resolveRef.current = null
  }, [])

  const confirm = useCallback((next: ConfirmRequest) => new Promise<boolean>(resolve => {
    resolveRef.current?.(false) // a second question supersedes an unanswered one
    resolveRef.current = resolve
    setRequest(next)
  }), [])

  const settle = useCallback((confirmed: boolean) => {
    setRequest(null)
    resolveRef.current?.(confirmed)
    resolveRef.current = null
  }, [])

  const dialog = request ? (
    <Modal title={request.title} accent="red" onClose={() => settle(false)}>
      <p className="text-sm text-gray-300">{request.body}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          onClick={() => settle(false)}
          className="rounded bg-gray-700 px-3 py-1.5 text-xs font-bold text-gray-100 hover:bg-gray-600"
        >
          Cancel
        </button>
        <button
          onClick={() => settle(true)}
          autoFocus
          className="rounded bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  ) : null

  return { confirm, dialog }
}


export interface PromptRequest {
  title: string
  /** What is being named, in one plain sentence. */
  body: string
  /** The field's label — say what the value IS, not "value". */
  label: string
  /** What the field starts with (the current name, for a rename). */
  initial?: string
  confirmLabel: string
}

export interface UsePrompt {
  /** Ask for a value. Resolves the trimmed text, or null on cancel / Esc / backdrop / unmount. */
  prompt: (request: PromptRequest) => Promise<string | null>
  dialog: React.ReactNode
}

/**
 * ASK FOR A VALUE — the app's own text prompt, replacing `window.prompt` (§5.1).
 *
 * The sibling of `useConfirm`, and the same contract: the call site keeps its shape
 * (`const name = await prompt({…}); if (!name) return`) while the dialogue is the app's Modal, and the
 * promise ALWAYS settles so a cancelled prompt can never leave its caller hanging.
 *
 * Only for a value the user must genuinely supply — RENAMING something that already exists. Creating things
 * must not ask at all: Alexander, on the new-game prompt, *"that's the worst UX ever … just assign a random
 * name … and redirect user to the editor right away"* (see `game/autoNaming.ts`).
 */
export function usePrompt(): UsePrompt {
  const [request, setRequest] = useState<PromptRequest | null>(null)
  const [value, setValue] = useState('')
  const resolveRef = useRef<((value: string | null) => void) | null>(null)

  useEffect(() => () => {
    resolveRef.current?.(null)
    resolveRef.current = null
  }, [])

  const prompt = useCallback((next: PromptRequest) => new Promise<string | null>(resolve => {
    resolveRef.current?.(null) // a second question supersedes an unanswered one
    resolveRef.current = resolve
    setValue(next.initial ?? '')
    setRequest(next)
  }), [])

  const settle = useCallback((answer: string | null) => {
    setRequest(null)
    resolveRef.current?.(answer)
    resolveRef.current = null
  }, [])

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed) settle(trimmed) // an empty name is a cancel, not a rename to ""
  }

  const dialog = request ? (
    <Modal title={request.title} accent="cyan" onClose={() => settle(null)}>
      <p className="text-sm text-gray-300">{request.body}</p>
      <label className="mt-3 block">
        <span className="text-[10px] uppercase tracking-wide text-gray-400">{request.label}</span>
        <input
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit() }}
          aria-label={request.label}
          autoFocus
          className="mt-1 w-full rounded bg-gray-800 px-2 py-1.5 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-cyan-500"
        />
      </label>
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={() => settle(null)} className="rounded bg-gray-700 px-3 py-1.5 text-xs font-bold text-gray-100 hover:bg-gray-600">Cancel</button>
        <button
          onClick={submit}
          disabled={!value.trim()}
          className="rounded bg-cyan-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500"
        >
          {request.confirmLabel}
        </button>
      </div>
    </Modal>
  ) : null

  return { prompt, dialog }
}
