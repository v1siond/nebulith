import Head from '@/lib/router'
import { Link } from '@/lib/router'
import { ROUTES, cvUrl, csrfToken, userEmail } from '@/lib/routes'
import type { ReactNode } from 'react'

/**
 * Shared shell for the game-engine pages, the nebulith layout + nav. Everything is scoped to GAMES now
 * (templates are a reusable resource reached only inside a game), so the nav is just Games + Back to CV.
 * The `active` prop is kept for forward-compat but currently only 'games' exists.
 */
export function GameEngineLayout({
  active = 'games',
  title = 'Nebulith',
  children,
}: {
  active?: 'games'
  title?: string
  children: ReactNode
}) {
  const cv = cvUrl()
  const email = userEmail()
  const csrf = csrfToken()

  const tab = (href: string, label: string, key: 'games') => (
    <Link
      href={href}
      className={`px-4 py-2 rounded text-sm font-bold ${
        active === key ? 'bg-yellow-500 text-gray-900' : 'bg-gray-700 text-white hover:bg-gray-600'
      }`}
    >
      {label}
    </Link>
  )

  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <main className="min-h-screen bg-gray-900 text-white font-mono p-8 w-screen max-w-full">
        <div className="max-w-6xl mx-auto">
          {/* Header + nav (identical across Templates / Games) */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-yellow-400 mb-2">Nebulith</h1>
              <p className="text-gray-400">ASCII tile-based game engine</p>
            </div>
            <div className="flex items-center gap-2">
              {tab(ROUTES.games, '🎮 Games', 'games')}
              {/* The CV is a different origin, and this may be running inside its iframe, so the
                  link leaves the frame rather than loading the CV inside itself. An environment with
                  no CV configured has nowhere to go back to, so it draws no button. */}
              {cv && (
                <a
                  href={cv}
                  target="_top"
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                >
                  Back to CV
                </a>
              )}
              {/* Who is signed in, and the way out. A POST rather than a link: a plain GET means any
                  other page can sign you out just by linking to it. */}
              {email && (
                <form method="post" action="/logout" className="flex items-center gap-2">
                  <input type="hidden" name="_csrf_token" value={csrf ?? ''} />
                  <span className="text-xs text-gray-400" title={email}>
                    {email}
                  </span>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
                  >
                    Log out
                  </button>
                </form>
              )}
            </div>
          </div>

          {children}

          {/* Footer */}
          <div className="mt-12 text-center text-gray-500 text-sm">
            <p>Built with ASCII tiles • Elixir + PostgreSQL</p>
            <p className="mt-1">
              <a
                href="https://github.com/v1siond/nebulith"
                className="text-blue-400 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open source engine coming soon
              </a>
            </p>
          </div>
        </div>
      </main>
    </>
  )
}
