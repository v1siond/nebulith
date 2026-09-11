defmodule Nebulith.Catalog.CombatSource do
  @moduledoc """
  The SEED for the fight's own RULES — the coefficients the damage maths multiplies by, and the stat lines
  a fresh player / enemy / npc starts from.

  A CREATURE's numbers are not here: an enemy is a unit tile marked hostile, so its stat block lives on its
  own tile row (`TileSource.seed_unit_combat/0`). Alexander, 2026-09-10: *"an enemy is just a regular unit,
  but marked as hostile towards player"*.

  Every number here is the value the game uses TODAY, so seeding changes no behaviour — it only moves
  where the number lives. Provenance, so the port can be re-checked:

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
  alias Nebulith.Catalog.GameRule

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

  @doc "Upsert every rule bundle. Returns what it wrote."
  def seed do
    %{rules: length(Enum.map(rules(), fn {key, value} -> upsert_rule(key, value) end))}
  end

  defp upsert_rule(key, value) do
    case Repo.get_by(GameRule, key: key) do
      nil -> %GameRule{}
      found -> found
    end
    |> GameRule.changeset(%{key: key, value: value})
    |> Repo.insert_or_update!()
  end

  @doc "Every rule bundle, as a key → value map."
  def rule_map do
    from(r in GameRule, select: {r.key, r.value}) |> Repo.all() |> Map.new()
  end
end
