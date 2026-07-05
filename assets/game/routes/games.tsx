import Head from 'next/head'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { GamesViewOverlay } from '@/components/game/games'
import { listTemplates, type TemplateListItem } from '@/lib/api'

/**
 * GAMES route (docs/games-flows.md). A standalone page listing the user's games — ordered flows of
 * templates (level 1, 2, 3 …). Create/rename/reorder games and ▶ Play a game to drop straight into its
 * first level in the play view (`?id=<templateId>&play=1`). Reuses the same `GamesViewOverlay` the editor
 * renders in-place; the template list comes from the Elixir backend via `listTemplates`.
 */
export default function GamesPage() {
  const router = useRouter()
  const [templates, setTemplates] = useState<TemplateListItem[]>([])

  useEffect(() => {
    let live = true
    listTemplates({ limit: 100 })
      .then((r) => { if (live) setTemplates(r.templates) })
      .catch(() => { if (live) setTemplates([]) })
    return () => { live = false }
  }, [])

  return (
    <>
      <Head>
        <title>Games — Nebulith</title>
      </Head>
      <GamesViewOverlay
        savedTemplates={templates}
        onPlayLevel={(templateId) => router.push(`/personal-projects/game-engine/templates?id=${templateId}&play=1`)}
        onClose={() => router.push('/personal-projects/game-engine')}
      />
    </>
  )
}
