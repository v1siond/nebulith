defmodule Nebulith.Catalog.ItemSource do
  @moduledoc """
  Seeds the ITEM CATALOG, the 21 weapons / armour pieces / consumables and the two starter kits that used
  to live in the frontend's `game/gear.ts` (§3.14b #1).

  Every number here is a VERBATIM move of what that file declared on 2026-09-08: this migration changes
  where the catalog lives, not what it says. The frontend now reads it from `GET /api/items` and no longer
  declares a single stat.

  Item art is NOT here: a weapon's picture is its TILE (`priv/repo/tilesets/emoji.json`, baked PNGs +
  poses), resolved by label like every other tile. An item row is its numbers.
  """
  alias Nebulith.Catalog
  alias Nebulith.Catalog.Item
  alias Nebulith.Repo

  # ── weapons ───────────────────────────────────────────────────────────────
  # `reachCells` is the weapon's reach in CELLS; melee 1-2, ranged 6-12.
  @weapons [
    {"wpn_sword", "Iron Sword", "sword", ["warrior"],
     %{
       "baseDamage" => 12,
       "baseMagic" => 0,
       "baseDefense" => 2,
       "strengthBonus" => 3,
       "intBonus" => 0,
       "school" => "physical",
       "range" => "melee",
       "hands" => 1,
       "reachCells" => 1
     }},
    {"wpn_axe", "Battle Axe", "axe", [],
     %{
       "baseDamage" => 18,
       "baseMagic" => 0,
       "baseDefense" => 0,
       "strengthBonus" => 4,
       "intBonus" => 0,
       "school" => "physical",
       "range" => "melee",
       "hands" => 2,
       "reachCells" => 2
     }},
    {"wpn_bow", "Hunter Bow", "bow", ["warrior"],
     %{
       "baseDamage" => 10,
       "baseMagic" => 0,
       "baseDefense" => 0,
       "strengthBonus" => 2,
       "intBonus" => 0,
       "school" => "physical",
       "range" => "ranged",
       "hands" => 2,
       "reachCells" => 8
     }},
    {"wpn_gun", "Flintlock Pistol", "gun", ["warrior"],
     %{
       "baseDamage" => 16,
       "baseMagic" => 0,
       "baseDefense" => 0,
       "strengthBonus" => 0,
       "intBonus" => 0,
       "school" => "physical",
       "range" => "ranged",
       "hands" => 1,
       "reachCells" => 7
     }},
    {"wpn_staff", "Oak Staff", "staff", ["magician"],
     %{
       "baseDamage" => 2,
       "baseMagic" => 14,
       "baseDefense" => 1,
       "strengthBonus" => 0,
       "intBonus" => 4,
       "school" => "magical",
       "range" => "melee",
       "hands" => 2,
       "reachCells" => 2
     }},
    {"wpn_shield", "Round Shield", "shield", ["warrior"],
     %{
       "baseDamage" => 0,
       "baseMagic" => 0,
       "baseDefense" => 6,
       "strengthBonus" => 0,
       "intBonus" => 0,
       "school" => "physical",
       "range" => "melee",
       "hands" => 1,
       "reachCells" => 1,
       "blockChance" => 35
     }}
  ]

  # ── armour / clothes (covers every gear slot) ──────────────────────────────
  @armor [
    {"arm_helmet_iron", "Iron Helmet", "iron", ["warrior"],
     %{"defenseBonus" => 3, "strengthBonus" => 1, "intBonus" => 0, "slot" => "helmet"}},
    {"arm_chest_iron", "Iron Cuirass", "iron", ["warrior"],
     %{"defenseBonus" => 6, "strengthBonus" => 2, "intBonus" => 0, "slot" => "chest"}},
    {"arm_chest_leather", "Leather Jerkin", "leather", ["magician"],
     %{
       "defenseBonus" => 3,
       "strengthBonus" => 0,
       "intBonus" => 2,
       "slot" => "chest",
       "dodgeBonus" => 4
     }},
    {"arm_gloves_iron", "Iron Gauntlets", "iron", ["warrior"],
     %{"defenseBonus" => 2, "strengthBonus" => 1, "intBonus" => 0, "slot" => "gloves"}},
    {"arm_gloves_leather", "Leather Gloves", "leather", ["magician"],
     %{
       "defenseBonus" => 1,
       "strengthBonus" => 0,
       "intBonus" => 1,
       "slot" => "gloves",
       "dodgeBonus" => 3
     }},
    {"arm_boots_iron", "Iron Greaves", "iron", ["warrior"],
     %{"defenseBonus" => 2, "strengthBonus" => 1, "intBonus" => 0, "slot" => "boots"}},
    {"arm_boots_leather", "Leather Boots", "leather", ["magician"],
     %{
       "defenseBonus" => 1,
       "strengthBonus" => 0,
       "intBonus" => 0,
       "slot" => "boots",
       "dodgeBonus" => 5
     }},
    {"arm_ring_dodge", "Ring of Evasion", "leather", [],
     %{
       "defenseBonus" => 0,
       "strengthBonus" => 0,
       "intBonus" => 0,
       "slot" => "ring",
       "dodgeBonus" => 5
     }},
    {"arm_ring_focus", "Ring of Focus", "leather", ["magician"],
     %{"defenseBonus" => 0, "strengthBonus" => 0, "intBonus" => 3, "slot" => "ring"}},
    {"arm_neck_amulet", "Warding Amulet", "leather", ["magician"],
     %{"defenseBonus" => 2, "strengthBonus" => 0, "intBonus" => 2, "slot" => "neck"}}
  ]

  # ── consumables / special items ────────────────────────────────────────────
  # `bomb` and `teleport_scroll` carry an EMPTY effect on purpose: the play loop wires their behaviour
  # (throw / teleport), the catalog only has to make them exist so they can sit in a special slot.
  @consumables [
    {"itm_potion_hp", "Health Potion", ["warrior"], %{"hp" => 30}},
    {"itm_potion_mana", "Mana Potion", ["magician"], %{"mana" => 20}},
    {"itm_tonic_rage", "Rage Tonic", [], %{"rage" => 20}},
    {"itm_bomb", "Bomb", [], %{}},
    {"itm_scroll_teleport", "Teleport Scroll", [], %{}}
  ]

  @doc """
  Upserts the whole catalog. Idempotent, keyed by slug, so re-running only rewrites changed numbers.
  Returns the number of rows.
  """
  def seed do
    rows = weapon_rows() ++ armor_rows() ++ consumable_rows()

    for {attrs, position} <- Enum.with_index(rows, 1) do
      upsert(Map.put(attrs, :position, position))
    end

    length(rows)
  end

  defp weapon_rows do
    for {slug, name, kind, kits, stats} <- @weapons do
      %{slug: slug, name: name, slot: "weapon", kind: kind, starter_kits: kits, stats: stats}
    end
  end

  defp armor_rows do
    for {slug, name, kind, kits, stats} <- @armor do
      %{slug: slug, name: name, slot: "armor", kind: kind, starter_kits: kits, stats: stats}
    end
  end

  defp consumable_rows do
    for {slug, name, kits, effect} <- @consumables do
      %{slug: slug, name: name, slot: "consumable", kind: nil, starter_kits: kits, stats: effect}
    end
  end

  defp upsert(attrs) do
    case Repo.get_by(Item, slug: attrs.slug) do
      nil -> %Item{} |> Item.changeset(attrs) |> Repo.insert!()
      item -> item |> Item.changeset(attrs) |> Repo.update!()
    end
  end

  @doc "Every item, in catalog order."
  def list_items, do: Catalog.list_items()
end
