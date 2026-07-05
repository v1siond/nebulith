import Head from 'next/head'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Shared shell for the game-engine gallery pages — the SAME nebulith layout + nav for Templates and Games,
 * so `/personal-projects/game-engine` (templates) and `/personal-projects/game-engine/games` (games/flows)
 * look and navigate identically, only the content differs. The `active` tab is highlighted.
 */
export function GameEngineLayout({
  active,
  title = 'Nebulith',
  children,
}: {
  active: 'templates' | 'games'
  title?: string
  children: ReactNode
}) {
  const tab = (href: string, label: string, key: 'templates' | 'games') => (
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
              {tab('/personal-projects/game-engine', '🗺️ Templates', 'templates')}
              {tab('/personal-projects/game-engine/games', '🎮 Games', 'games')}
              <Link href="/" className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm">
                Back to CV
              </Link>
            </div>
          </div>

          {children}

          {/* Footer */}
          <div className="mt-12 text-center text-gray-500 text-sm">
            <p>Built with ASCII tiles • Elixir + PostgreSQL</p>
            <p className="mt-1">
              <a
                href="https://github.com/yourusername/game-engine"
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
