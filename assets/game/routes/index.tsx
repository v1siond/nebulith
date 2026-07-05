/**
 * GAME ENGINE - Template Gallery
 * Lists saved templates and allows creating new ones
 */
import { useEffect, useState } from 'react'
import Head from 'next/head'
import Link from 'next/link'
import { useRouter } from 'next/router'
import { listTemplates, deleteTemplate, TemplateListItem } from '@/lib/api'
import { useToast } from '@/components/Toast'

const MAX_TEMPLATES_PROD = 1

export default function GameEngineIndex() {
  const router = useRouter()
  const { toast } = useToast()
  const [templates, setTemplates] = useState<TemplateListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const isProd = process.env.NODE_ENV === 'production'
  const maxTemplates = isProd ? MAX_TEMPLATES_PROD : Infinity

  const loadTemplates = async () => {
    try {
      setLoading(true)
      const { templates } = await listTemplates({ limit: 50 })
      setTemplates(templates)
      setError(null)
    } catch (err) {
      setError('Failed to load templates')
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTemplates()
  }, [])

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return

    try {
      await deleteTemplate(id)
      await loadTemplates()
    } catch (err) {
      toast('Failed to delete template', 'error')
      console.error(err)
    }
  }

  const handleNew = () => {
    if (templates.length >= maxTemplates) {
      toast(`Template limit reached (${maxTemplates}). Delete one first.`, 'warning')
      return
    }
    router.push('/personal-projects/game-engine/templates?new=1')
  }

  const canCreateNew = templates.length < maxTemplates

  return (
    <>
      <Head>
        <title>Nebulith</title>
      </Head>
      <main className="min-h-screen bg-gray-900 text-white font-mono p-8 w-screen max-w-full">
        {/* Header */}
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-3xl font-bold text-yellow-400 mb-2">Nebulith</h1>
              <p className="text-gray-400">ASCII tile-based game engine</p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href="/personal-projects/game-engine/games"
                className="px-4 py-2 bg-indigo-700 hover:bg-indigo-600 rounded text-sm font-bold"
              >
                🎮 Games
              </Link>
              <Link
                href="/"
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                Back to CV
              </Link>
            </div>
          </div>

          {/* Stats Bar */}
          <div className="bg-gray-800 rounded-lg p-4 mb-6 flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div>
                <span className="text-gray-400 text-sm">Templates:</span>
                <span className="ml-2 text-xl font-bold">{templates.length}</span>
                {isProd && (
                  <span className="text-gray-500 text-sm ml-1">/ {maxTemplates}</span>
                )}
              </div>
              {isProd && (
                <div className="text-yellow-500 text-sm">
                  Demo mode - limited to {maxTemplates} template
                </div>
              )}
            </div>
            <button
              onClick={handleNew}
              disabled={!canCreateNew}
              className={`px-6 py-3 rounded-lg font-bold text-lg transition-all ${
                canCreateNew
                  ? 'bg-green-600 hover:bg-green-500 hover:scale-105'
                  : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }`}
            >
              + New Template
            </button>
          </div>

          {/* Error State */}
          {error && (
            <div className="bg-red-900/50 border border-red-500 rounded-lg p-4 mb-6">
              <p className="text-red-300">{error}</p>
              <button
                onClick={loadTemplates}
                className="mt-2 text-sm text-red-400 hover:text-red-300 underline"
              >
                Try again
              </button>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="text-center py-12">
              <div className="text-4xl mb-4 animate-pulse">...</div>
              <p className="text-gray-400">Loading templates...</p>
            </div>
          )}

          {/* Empty State */}
          {!loading && templates.length === 0 && (
            <div className="text-center py-16 bg-gray-800/50 rounded-lg border-2 border-dashed border-gray-700">
              <div className="text-6xl mb-4">🗺️</div>
              <h2 className="text-xl font-bold mb-2">No templates yet</h2>
              <p className="text-gray-400 mb-6">Create your first isometric level!</p>
              <button
                onClick={handleNew}
                className="px-8 py-4 bg-green-600 hover:bg-green-500 rounded-lg font-bold text-lg"
              >
                Create Template
              </button>
            </div>
          )}

          {/* Template Grid */}
          {!loading && templates.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className="bg-gray-800 rounded-lg overflow-hidden hover:ring-2 hover:ring-yellow-400/50 transition-all group"
                >
                  {/* Thumbnail placeholder */}
                  <div className="h-32 bg-gray-700 flex items-center justify-center">
                    {template.thumbnail ? (
                      <img
                        src={template.thumbnail}
                        alt={template.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="text-4xl opacity-30">🏘️</div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-4">
                    <h3 className="font-bold text-lg mb-1 truncate">{template.name}</h3>
                    <p className="text-gray-400 text-sm mb-3">
                      {template.cols}×{template.rows} grid
                      {template.description && ` • ${template.description}`}
                    </p>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Link
                        href={`/personal-projects/game-engine/templates?id=${template.id}`}
                        className="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-500 rounded text-center text-sm font-bold"
                      >
                        Open
                      </Link>
                      <button
                        onClick={() => handleDelete(template.id, template.name)}
                        className="px-3 py-2 bg-red-800 hover:bg-red-700 rounded text-sm"
                        title="Delete"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* Date */}
                  <div className="px-4 pb-3 text-xs text-gray-500">
                    Updated {new Date(template.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="mt-12 text-center text-gray-500 text-sm">
            <p>Built with ASCII tiles • Prisma + PostgreSQL</p>
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
