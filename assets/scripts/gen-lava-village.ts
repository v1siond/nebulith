/**
 * Dev helper: generate a lava/village stage and save it into a template so it
 * can be viewed in the editor. Run with the dev server up:
 *   npx ts-node --transpile-only --compiler-options '{"module":"commonjs"}' scripts/gen-lava-village.ts
 */
import { generateStage, stageToTemplate, VariantId } from '../game/engine/stageGenerator'
import { ZoneId } from '../game/engine/zones'

const TEMPLATE_ID = 'cmpk84cd50000fqut3tz57bc6'
const BASE = process.env.BASE_URL ?? 'http://localhost:3001'
const ZONE = (process.env.ZONE as ZoneId) ?? 'spring'
const VARIANT = (process.env.VARIANT as VariantId) ?? 'village'

async function main() {
  const stage = generateStage({ zone: ZONE, variant: VARIANT, cols: 36, rows: 31 })
  const payload = stageToTemplate(stage, `${ZONE} ${VARIANT}`)
  const res = await fetch(`${BASE}/api/templates/${TEMPLATE_ID}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  console.log(
    `buildings: ${stage.buildings.length} | assets: ${payload.assetsData.length} | spawn: ${stage.spawn.col},${stage.spawn.row} | PUT ${res.status}`,
  )
  if (!res.ok) console.log((await res.text()).slice(0, 300))
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
