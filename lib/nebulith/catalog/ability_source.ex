defmodule Nebulith.Catalog.AbilitySource do
  @moduledoc """
  Seeds the ABILITY REGISTRY, the 13 abilities that used to live in `game/abilities.ts` (§3.14b #2).

  Every value is a VERBATIM move of what that file declared on 2026-09-08: this changes where the registry
  lives, not what it says.

  No colour here on purpose. Each ability names the FX TILE it plays (`animation`), and that tile row
  already carries the tint in its own settings, the old frontend `ABILITY_TINT` map duplicated nine hexes
  the API was serving. One fact, one owner.
  """
  alias Nebulith.Catalog
  alias Nebulith.Catalog.Ability
  alias Nebulith.Repo

  @abilities [
    %{
      slug: "fire-slash",
      name: "Fire Slash",
      category: "offensive",
      animation: "fire-slash",
      cooldown_ms: 6000,
      position: 1,
      description:
        "A blazing melee slash \u2014 the blade burns red-orange and bites for fire damage.",
      effect: %{"damage" => 18}
    },
    %{
      slug: "power-shot",
      name: "Power Shot",
      category: "offensive",
      animation: "piercing-shot",
      cooldown_ms: 8000,
      position: 2,
      description:
        "A drawn-back piercing bolt \u2014 slower to ready, but it punches through for big damage.",
      effect: %{"damage" => 26}
    },
    %{
      slug: "guard",
      name: "Guard",
      category: "defensive",
      animation: "guard-flash",
      cooldown_ms: 12000,
      position: 3,
      description: "Raise a flash-guard for a few seconds, cutting the damage you take.",
      effect: %{"shieldMs" => 4000}
    },
    %{
      slug: "frost",
      name: "Frost",
      category: "debuff",
      animation: "ice-slash",
      cooldown_ms: 9000,
      position: 4,
      description:
        "An icy slash that chills the target \u2014 it crawls (slowed) for a few seconds.",
      effect: %{
        "damage" => 8,
        "debuff" => %{"kind" => "slow", "durationMs" => 3000, "magnitude" => 0.4}
      }
    },
    %{
      slug: "cleave",
      name: "Cleave",
      category: "offensive",
      animation: "cleave",
      cooldown_ms: 7000,
      position: 5,
      description: "A wide, two-handed swing that cleaves through for heavy physical damage.",
      effect: %{"damage" => 22}
    },
    %{
      slug: "arcane-bolt",
      name: "Arcane Bolt",
      category: "offensive",
      animation: "bolt",
      cooldown_ms: 5000,
      position: 6,
      description:
        "A quick bolt of raw arcane force \u2014 short cooldown, reliable ranged damage.",
      effect: %{"damage" => 20}
    },
    %{
      slug: "nova-burst",
      name: "Nova Burst",
      category: "offensive",
      animation: "nova",
      cooldown_ms: 14000,
      position: 7,
      description: "A violet nova that detonates around you \u2014 slow to charge, hits hard.",
      effect: %{"damage" => 30}
    },
    %{
      slug: "chain-lightning",
      name: "Chain Lightning",
      category: "offensive",
      animation: "lightning",
      cooldown_ms: 11000,
      position: 8,
      description:
        "A forked bolt of lightning that arcs into the target for strong shock damage.",
      effect: %{"damage" => 24}
    },
    %{
      slug: "bulwark",
      name: "Bulwark",
      category: "protection",
      animation: "guard-flash",
      cooldown_ms: 16000,
      position: 9,
      description:
        "Brace behind a heavy bulwark \u2014 a long window that soaks most incoming damage.",
      effect: %{"shieldMs" => 6000}
    },
    %{
      slug: "poison-dart",
      name: "Poison Dart",
      category: "debuff",
      animation: "piercing-shot",
      cooldown_ms: 8000,
      position: 10,
      description:
        "A venom-tipped shot \u2014 light hit up front, then poison eats away at the target.",
      effect: %{
        "damage" => 6,
        "debuff" => %{"kind" => "poison", "durationMs" => 5000, "magnitude" => 4}
      }
    },
    %{
      slug: "enfeeble",
      name: "Enfeeble",
      category: "debuff",
      animation: "nova",
      cooldown_ms: 10000,
      position: 11,
      description:
        "A draining pulse that weakens the target \u2014 its blows land softer for a while.",
      effect: %{"debuff" => %{"kind" => "weaken", "durationMs" => 6000, "magnitude" => 0.3}}
    },
    %{
      slug: "mend",
      name: "Mend",
      category: "healing",
      animation: "heal-glow",
      cooldown_ms: 10000,
      position: 12,
      description: "A burst of restorative light \u2014 mends a solid chunk of your health.",
      effect: %{"healing" => 25}
    },
    %{
      slug: "renew",
      name: "Renew",
      category: "healing",
      animation: "heal-glow",
      cooldown_ms: 7000,
      position: 13,
      description: "A quick top-up of health on a short cooldown \u2014 small, but always ready.",
      effect: %{"healing" => 14}
    }
  ]

  @doc "Upserts the registry. Idempotent, keyed by slug."
  def seed do
    for attrs <- @abilities, do: upsert(attrs)
    length(@abilities)
  end

  defp upsert(attrs) do
    case Repo.get_by(Ability, slug: attrs.slug) do
      nil -> %Ability{} |> Ability.changeset(attrs) |> Repo.insert!()
      row -> row |> Ability.changeset(attrs) |> Repo.update!()
    end
  end

  @doc "Every ability, in registry order."
  def list_abilities, do: Catalog.list_abilities()
end
