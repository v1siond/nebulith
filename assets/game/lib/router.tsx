import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react'
import { matchRoute } from './routes'

/**
 * The three things this engine used Next for: a router, a link and a document title. None of them
 * needed a framework, so they live here and the engine ships as a plain React app that Phoenix
 * bundles and serves.
 *
 * The shape deliberately matches what the call sites already pass, including the object form of
 * `push`/`replace` and the ignored third argument, so swapping the import was the whole change.
 */

/** pushState and replaceState fire no event. popstate only covers back and forward, so we raise our own. */
const NAVIGATED = 'nebulith:navigated'

const readLocation = () => `${window.location.pathname}${window.location.search}`

const subscribe = (onChange: () => void) => {
  window.addEventListener('popstate', onChange)
  window.addEventListener(NAVIGATED, onChange)
  return () => {
    window.removeEventListener('popstate', onChange)
    window.removeEventListener(NAVIGATED, onChange)
  }
}

type QueryValue = string | number | boolean | undefined
type Target = string | { pathname: string; query?: Record<string, QueryValue> }

const hrefOf = (target: Target): string => {
  if (typeof target === 'string') return target
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(target.query ?? {})) {
    if (value === undefined) continue
    params.set(key, String(value))
  }
  const search = params.toString()
  if (search.length === 0) return target.pathname
  return `${target.pathname}?${search}`
}

/** Navigate without a reload, and tell the subscribers, since history does not. */
export const navigate = (target: Target, mode: 'push' | 'replace' = 'push') => {
  const url = hrefOf(target)
  if (mode === 'replace') window.history.replaceState(null, '', url)
  if (mode !== 'replace') window.history.pushState(null, '', url)
  window.dispatchEvent(new Event(NAVIGATED))
}

export type Router = {
  pathname: string
  query: Record<string, string>
  /**
   * Always true. Next held this false until a statically optimised page hydrated its query; this
   * reads `location` synchronously, so the query is present on the first render. Kept so the guards
   * that wait on it stay where they are instead of being deleted one by one.
   */
  isReady: boolean
  push: (target: Target, as?: undefined, options?: { shallow?: boolean }) => void
  replace: (target: Target, as?: undefined, options?: { shallow?: boolean }) => void
}

export function useRouter(): Router {
  const location = useSyncExternalStore(subscribe, readLocation, readLocation)
  const [pathname, search = ''] = location.split('?')

  // Both memos are load-bearing, not tidiness. `router.query` and `router` itself sit in effect
  // dependency arrays in the editor; rebuilding either every render re-runs those effects every
  // render, which reads as a reload loop rather than as a router problem.
  // The path's own params come first so a real query string can never shadow the route segment.
  const query = useMemo(
    () => ({ ...matchRoute(pathname).params, ...Object.fromEntries(new URLSearchParams(search)) }),
    [pathname, search],
  )
  const push = useCallback((target: Target) => navigate(target, 'push'), [])
  const replace = useCallback((target: Target) => navigate(target, 'replace'), [])

  return useMemo(
    () => ({ pathname, query, isReady: true, push, replace }),
    [pathname, query, push, replace],
  )
}

type LinkProps = { href: string; children: ReactNode } & AnchorHTMLAttributes<HTMLAnchorElement>

/** A real anchor that stays in the app for same-origin paths, and gets out of the way for everything else. */
export function Link({ href, children, ...rest }: LinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented) return
    if (event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return
    if (rest.target !== undefined) return
    event.preventDefault()
    navigate(href)
  }
  return (
    <a {...rest} href={href} onClick={onClick}>
      {children}
    </a>
  )
}

const textOf = (node: ReactNode): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

/** Stands in for next/head. The engine only ever put a <title> in it, so that is what this reads. */
export default function Head({ children }: { children: ReactNode }) {
  const title = useMemo(() => {
    const node = Children.toArray(children).find(child => isValidElement(child) && child.type === 'title')
    if (!isValidElement(node)) return undefined
    return textOf((node.props as { children?: ReactNode }).children)
  }, [children])

  useEffect(() => {
    if (title === undefined) return
    document.title = title
  }, [title])

  return null
}
