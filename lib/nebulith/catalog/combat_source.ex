defmodule Nebulith.Catalog.CombatSource do
  @moduledoc """
  The SEED for the creature + combat catalog, ported verbatim from the frontend constants it replaces.

  Every number here is the value the game uses TODAY, so seeding changes no behaviour — it only moves
  where the number lives. Provenance, so the port can be re-checked:

    * archetypes — `src/game/archetypes.ts` `ENEMY_ARCHETYPES` (9 rows, in that file's order)
    * reach — the same file's `MELEE_REACH` 1 / `ARCHER_REACH` 6 / `MAGE_REACH` 7
    * combat coefficients — `src/game/combat.ts` (`REGULAR_MULTIPLIER`, `SPECIAL_MULTIPLIER`,
      `RAGE_PER_STRENGTH`, `MANA_PER_INTELLIGENCE`, `SPECIAL_RESOURCE_COST`, `MIN_DAMAGE`) and its
      `SPECIAL_RESOURCE` map of school → resource
    * default stat lines — `src/game/entities.ts` (`DEFAULT_PLAYER_STATS` / `_ENEMY_` / `_NPC_`) plus
      `DEFAULT_RESPAWN_MS`

  Idempotent: `seed/0` upserts by `key`, the same contract `TileSource.seed/0` and
  `GeneratorSource.seed/0` have, so re-running never duplicates and never clobbers a row's id.
  """
  import Ecto.Query, warn: false

  alias Nebulith.Repo
  alias Nebulith.Catalog.{EnemyArchetype, GameRule}

  @melee_reach 1
  @archer_reach 6
  @mage_reach 7

  defp hit(mode, damage, cooldown, animation, name, reach \\ nil) do
    Map.merge(
      %{"mode" => mode, "damage" => damage, "cooldownMs" => cooldown, "animation" => animation, "name" => name},
      if(reach, do: %{"reachCells" => reach}, else: %{})
    )
  end

  defp sequential(attacks), do: %{"mode" => "sequential", "attacks" => attacks}

  @doc "Every archetype, in menu order."
  def archetypes do
    [
      %{key: "grunt", name: "Grunt", move_delay_ms: 1000, reach_cells: @melee_reach,
        stats: %{"strength" => 6, "intelligence" => 0, "defense" => 3, "maxHp" => 34, "dodge" => 5},
        attack: sequential([hit("melee", 4, 1000, "cleave", "Strike")])},
      %{key: "brute", name: "Brute", move_delay_ms: 1700, reach_cells: @melee_reach,
        stats: %{"strength" => 12, "intelligence" => 0, "defense" => 6, "maxHp" => 72, "dodge" => 0},
        attack: sequential([hit("melee", 18, 6000, "fire-slash", "Fire Slash")])},
      %{key: "skirmisher", name: "Skirmisher", move_delay_ms: 550, reach_cells: @melee_reach,
        stats: %{"strength" => 5, "intelligence" => 0, "defense" => 1, "maxHp" => 20, "dodge" => 18},
        attack: sequential([hit("melee", 2, 450, "cleave", "Quick Slash")])},
      %{key: "archer", name: "Archer", move_delay_ms: 900, reach_cells: @archer_reach,
        stats: %{"strength" => 4, "intelligence" => 0, "defense" => 1, "maxHp" => 22, "dodge" => 10},
        attack: sequential([hit("ranged", 6, 1500, "bolt", "Bolt", @archer_reach)])},
      %{key: "mage", name: "Mage", move_delay_ms: 950, reach_cells: @mage_reach,
        stats: %{"strength" => 3, "intelligence" => 10, "defense" => 1, "maxHp" => 18, "dodge" => 6},
        attack: sequential([hit("ranged", 12, 1900, "nova", "Arcane Bolt", @mage_reach)])},
      %{key: "raider", name: "Raider", move_delay_ms: 850, reach_cells: @archer_reach,
        stats: %{"strength" => 7, "intelligence" => 0, "defense" => 3, "maxHp" => 40, "dodge" => 8},
        attack: sequential([
          hit("melee", 6, 800, "fire-slash", "Hack"),
          hit("ranged", 9, 1400, "bolt", "Snipe", @archer_reach)
        ])},
      %{key: "flyer", name: "Bat", move_delay_ms: 560, reach_cells: @melee_reach,
        stats: %{"strength" => 4, "intelligence" => 0, "defense" => 0, "maxHp" => 16, "dodge" => 24},
        attack: sequential([hit("melee", 2, 500, "cleave", "Bite")])},
      %{key: "crawler", name: "Spider", move_delay_ms: 720, reach_cells: @melee_reach,
        stats: %{"strength" => 6, "intelligence" => 0, "defense" => 2, "maxHp" => 30, "dodge" => 12},
        attack: sequential([hit("melee", 4, 900, "cleave", "Venom Bite")])},
      %{key: "sentinel", name: "Guardian", move_delay_ms: 1700, reach_cells: @melee_reach,
        stats: %{"strength" => 14, "intelligence" => 0, "defense" => 9, "maxHp" => 96, "dodge" => 0},
        attack: sequential([hit("melee", 20, 2200, "cleave", "Crush")])}
    ]
  end

  @doc "The tunable rule bundles, by key."
  def rules do
    %{
      "combat" => %{
        "regularMultiplier" => 1,
        "specialMultiplier" => 1.75,
        "ragePerStrength" => 5,
        "manaPerIntelligence" => 5,
        "specialResourceCost" => 20,
        # The floor a mitigated melee physical hit can never fall below.
        "minDamage" => 1,
        # Which resource a SPECIAL of each school spends, and how it fails when short.
        "specialResource" => %{
          "physical" => %{"key" => "rage", "failure" => "insufficient-rage"},
          "magical" => %{"key" => "mana", "failure" => "insufficient-mana"}
        }
      },
      "stats" => %{
        "player" => %{"strength" => 10, "intelligence" => 10, "defense" => 5, "maxHp" => 100},
        "enemy" => %{"strength" => 5, "intelligence" => 0, "defense" => 2, "maxHp" => 30},
        "npc" => %{"strength" => 1, "intelligence" => 1, "defense" => 0, "maxHp" => 10},
        "respawnMs" => 5000
      }
    }
  end

  @doc "Upsert every archetype and rule bundle. Returns what it wrote."
  def seed do
    archetypes =
      archetypes()
      |> Enum.with_index()
      |> Enum.map(fn {row, index} -> upsert_archetype(Map.put(row, :position, index)) end)

    rules = Enum.map(rules(), fn {key, value} -> upsert_rule(key, value) end)

    %{archetypes: length(archetypes), rules: length(rules)}
  end

  defp upsert_archetype(attrs) do
    case Repo.get_by(EnemyArchetype, key: attrs.key) do
      nil -> %EnemyArchetype{}
      found -> found
    end
    |> EnemyArchetype.changeset(attrs)
    |> Repo.insert_or_update!()
  end

  defp upsert_rule(key, value) do
    case Repo.get_by(GameRule, key: key) do
      nil -> %GameRule{}
      found -> found
    end
    |> GameRule.changeset(%{key: key, value: value})
    |> Repo.insert_or_update!()
  end

  @doc "Every archetype in menu order."
  def list_archetypes, do: Repo.all(from a in EnemyArchetype, order_by: [asc: a.position, asc: a.key])

  @doc "Every rule bundle, as a key → value map."
  def rule_map do
    from(r in GameRule, select: {r.key, r.value}) |> Repo.all() |> Map.new()
  end
end
