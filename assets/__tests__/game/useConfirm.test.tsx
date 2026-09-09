/**
 * THE APP'S CONFIRMATION (design §5.1 — "Replace window.confirm/prompt with the app's Modal").
 *
 * The value of the hook is that it keeps the call site's shape — `if (!(await confirm(…))) return` —
 * so a destructive handler still reads top-to-bottom. That only holds if the promise ALWAYS settles:
 * on confirm, on cancel, and on unmount. A confirmation that leaves its promise pending silently
 * swallows the delete instead of cancelling it, which is the bug worth testing for.
 */
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useConfirm } from '@/components/game/useConfirm'

const REQUEST = { title: 'Delete level', body: 'Delete "village"? This cannot be undone.', confirmLabel: 'Delete level' }

/** A harness that mirrors a real destructive handler: ask, then record what came back. */
function Harness({ onAnswer }: { onAnswer: (answer: boolean) => void }) {
  const { confirm, dialog } = useConfirm()
  return (
    <>
      <button onClick={() => { void confirm(REQUEST).then(onAnswer) }}>Delete</button>
      {dialog}
    </>
  )
}

const ask = () => fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

describe('useConfirm', () => {
  it('shows nothing until something asks', () => {
    render(<Harness onAnswer={jest.fn()} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('asks in the app\'s own words, not the browser\'s', () => {
    render(<Harness onAnswer={jest.fn()} />)
    ask()
    expect(screen.getByRole('dialog')).toHaveTextContent('Delete "village"? This cannot be undone.')
    expect(screen.getByRole('button', { name: 'Delete level' })).toBeInTheDocument()
  })

  it('resolves true when confirmed', async () => {
    const onAnswer = jest.fn()
    render(<Harness onAnswer={onAnswer} />)
    ask()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Delete level' })) })
    expect(onAnswer).toHaveBeenCalledWith(true)
  })

  it('resolves false when cancelled', async () => {
    const onAnswer = jest.fn()
    render(<Harness onAnswer={onAnswer} />)
    ask()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    expect(onAnswer).toHaveBeenCalledWith(false)
  })

  it('resolves false on Esc — the dialog cannot be dismissed into silence', async () => {
    const onAnswer = jest.fn()
    render(<Harness onAnswer={onAnswer} />)
    ask()
    await act(async () => { fireEvent.keyDown(window, { key: 'Escape' }) })
    expect(onAnswer).toHaveBeenCalledWith(false)
  })

  it('resolves false if the page unmounts while asking', async () => {
    const onAnswer = jest.fn()
    const view = render(<Harness onAnswer={onAnswer} />)
    ask()
    await act(async () => { view.unmount() })
    expect(onAnswer).toHaveBeenCalledWith(false)
  })

  it('closes once answered', async () => {
    render(<Harness onAnswer={jest.fn()} />)
    ask()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Cancel' })) })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
