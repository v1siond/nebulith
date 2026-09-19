import { Component, type ReactNode } from 'react'

/**
 * A React error boundary, the safety net for render-time crashes. React has no hook equivalent for
 * `componentDidCatch`, so this is (necessarily) a class component. When a child throws while rendering,
 * we swallow the crash and show `fallback` instead of letting the whole tree unmount to a blank white
 * screen. `onError` lets the caller react (log, fire a toast) with the thrown error.
 *
 * Used to wrap the game-engine editor so a bad/missing tileset (or any unexpected render error) degrades
 * to a friendly fallback + notification instead of an uncaught JS error.
 */
interface Props {
  children: ReactNode
  fallback: ReactNode
  onError?: (error: Error) => void
}

interface State {
  hasError: boolean
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  componentDidCatch(error: Error): void {
    console.error('[ErrorBoundary] caught a render error:', error)
    // …AND LEFT WHERE A TEST CAN READ IT. A boundary turns a crash into a tidy "reload to try again", which
    // from the outside is indistinguishable from a page that simply has no buttons on it: an end-to-end run
    // reports a missing selector and says nothing about the actual fault. This is the one seam that names it.
    ;(globalThis as { __editorError?: { message: string; stack: string } }).__editorError = {
      message: String(error?.message ?? error),
      stack: String(error?.stack ?? ''),
    }
    this.props.onError?.(error)
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback
    return this.props.children
  }
}
