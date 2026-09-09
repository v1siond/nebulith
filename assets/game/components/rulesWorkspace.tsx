/**
 * `⚑ RULES` — the three-tab Logic workspace (§4.8), opened from the rail's Rules entry.
 *
 * Everything that makes a map DO something lived in three unrelated places: triggers only per-selection,
 * connectors behind a hidden canvas mode whose instruction was stale (§3.9), and quests behind clicking an
 * NPC — so a level with no NPC offered no way in and no explanation (§3.8's "silent dead end"). This lists
 * what a level ALREADY has, and states each add-action's prerequisite instead of hiding the button.
 *
 * Presentational: every row comes from `game/editor/rulesWorkspace` and every action is a prop, so the
 * phrasing is unit-tested there and this file stays a map over the rows.
 */
import {
  RULES_TABS,
  type ConnectionRow,
  type QuestRow,
  type RulesTabId,
  type TriggerRow,
} from '@/game/editor/rulesWorkspace'

/** A row that reads as a sentence, with an optional right-hand note. */
function Row({ children, onClick, label }: { children: React.ReactNode; onClick?: () => void; label: string }) {
  const body = <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[11px]">{children}</span>
  if (!onClick) return <li className="frow" style={{ cursor: 'default' }}>{body}</li>
  return (
    <li>
      <button
        onClick={onClick}
        aria-label={label}
        className="frow"
      >
        <span aria-hidden className="shrink-0 text-[9px] text-gray-600">▸</span>
        {body}
      </button>
    </li>
  )
}

/** The one place an empty list is explained rather than left blank. */
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="hint">{children}</div>
}

/** An action plus, when it is unavailable, the REASON — §4.8 draws the prerequisite, not a dead button. */
function AddAction({ label, blockedReason, onAdd }: { label: string; blockedReason: string | null; onAdd: () => void }) {
  return (
    <div className="mt-2 space-y-1">
      <button
        onClick={onAdd}
        disabled={blockedReason !== null}
        className="b pri"
        style={{ width: '100%', justifyContent: 'center' }}
      >
        {label}
      </button>
      {blockedReason && (
        <p className="hint" style={{ display: 'flex', gap: 6 }}>
          <span aria-hidden>ⓘ</span>
          <span>{blockedReason}</span>
        </p>
      )}
    </div>
  )
}

export interface RulesWorkspaceProps {
  tab: RulesTabId
  onTab: (tab: RulesTabId) => void

  triggers: readonly TriggerRow[]
  /** Why a trigger cannot be added right now, or null. */
  triggerBlockedReason: string | null
  onAddTrigger: () => void
  onOpenTrigger: (id: string) => void

  connections: readonly ConnectionRow[]
  /** Is the editor currently waiting for a click to place a connection? §4.8 wants this STATED. */
  placingConnection: boolean
  onStopPlacing: () => void
  onNewConnection: () => void
  onOpenConnection: (id: string) => void

  quests: readonly QuestRow[]
  /** Why a quest cannot be added right now, or null (§3.8). */
  questBlockedReason: string | null
  onNewQuest: () => void
  onOpenQuest: (id: string) => void
}

export function RulesWorkspace(p: RulesWorkspaceProps) {
  const heading = RULES_TABS.find(t => t.id === p.tab)?.heading ?? ''

  return (
    <div className="pfix" style={{ overflowY: 'auto' }}>
      {/* The tabs, from the model — adding one is a row there, never a branch here. */}
      <div role="tablist" aria-label="Rules" className="tabs">
        {RULES_TABS.map(t => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={p.tab === t.id}
            onClick={() => p.onTab(t.id)}
            className={p.tab === t.id ? 'on' : ''}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="sub">{heading}</div>

      {p.tab === 'triggers' && (
        <div>
          {p.triggers.length === 0
            ? <Empty>Nothing happens on this level yet. Select a cell or a character, then add a rule.</Empty>
            : (
              <ul className="space-y-0.5">
                {p.triggers.map(t => (
                  <Row key={t.id} label={`${t.subject} ${t.where} ${t.when}`} onClick={() => p.onOpenTrigger(t.id)}>
                    <span className="shrink-0 font-bold text-gray-200">{t.subject}</span>
                    <span className="shrink-0 text-gray-500">{t.where}</span>
                    <span className="truncate text-gray-400">{t.when}</span>
                    <span aria-hidden className="text-gray-600">→</span>
                    <span className="truncate text-cyan-300">{t.does}</span>
                  </Row>
                ))}
              </ul>
            )}
          <AddAction
            label="＋ Add a trigger to the selection"
            blockedReason={p.triggerBlockedReason}
            onAdd={p.onAddTrigger}
          />
        </div>
      )}

      {p.tab === 'connections' && (
        <div>
          {/* §3.9: the placing mode used to be invisible, and its on-screen instruction told you to switch
              to Top view — which had stopped being true. State the mode, and give it a way out. */}
          {p.placingConnection && (
            <div className="mb-2 flex items-start gap-2 rounded border border-purple-400/40 bg-purple-500/10 px-2 py-1.5">
              <p className="flex-1 text-[10px] leading-snug text-purple-200">
                <span aria-hidden>●</span> Placing mode ON — click a cell on the map to place a door.
              </p>
              <button
                onClick={p.onStopPlacing}
                className="shrink-0 rounded bg-purple-700 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-purple-600"
              >
                Stop
              </button>
            </div>
          )}
          {p.connections.length === 0
            ? <Empty>No doors out of this level yet.</Empty>
            : (
              <ul className="space-y-0.5">
                {p.connections.map(c => (
                  <Row key={c.id} label={`Connection at ${c.where} to ${c.target}`} onClick={() => p.onOpenConnection(c.id)}>
                    <span className="shrink-0 text-gray-500">{c.where}</span>
                    <span aria-hidden className="text-gray-600">→</span>
                    <span className="truncate font-bold text-cyan-300">{c.target}</span>
                    <span className="ml-auto shrink-0 text-gray-500">{c.how}</span>
                  </Row>
                ))}
              </ul>
            )}
          <div className="mt-2">
            <button
              onClick={p.onNewConnection}
              className="w-full rounded bg-purple-700 px-2 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-purple-600"
            >
              ＋ New connection
            </button>
          </div>
        </div>
      )}

      {p.tab === 'quests' && (
        <div>
          {p.quests.length === 0
            ? <Empty>Nothing to do on this level yet.</Empty>
            : (
              <ul className="space-y-0.5">
                {p.quests.map(q => (
                  <Row key={q.id} label={`Quest ${q.title}`} onClick={() => p.onOpenQuest(q.id)}>
                    <span className="truncate font-bold text-gray-200">{q.title}</span>
                    {q.giver
                      ? <span className="shrink-0 text-gray-500">giver: {q.giver}</span>
                      : <span className="shrink-0 text-amber-300">⚠ no giver assigned</span>}
                    <span className="ml-auto shrink-0 text-gray-400">{q.state}</span>
                    {q.progress && <span className="shrink-0 tabular-nums text-cyan-300">{q.progress}</span>}
                  </Row>
                ))}
              </ul>
            )}
          <AddAction label="＋ New quest" blockedReason={p.questBlockedReason} onAdd={p.onNewQuest} />
        </div>
      )}
    </div>
  )
}
