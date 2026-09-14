defmodule Nebulith.Catalog.TemplateLoadoutPersistenceTest do
  @moduledoc """
  Proves the ELIXIR persistence layer preserves a UNIT's loadout/inventory EXACTLY — the backend side of
  "if I equip something I want to see it equipped next time … if I move things in my inventory to a specific
  order I should see the same when reloading".

  The `Template` table is a Prisma-owned shared table with no Ecto migration, so it is absent from the
  test DB — the controller round-trip can't run here. Instead we test the two layers that DO the preserving:
  `Nebulith.EctoJSON` (the jsonb pass-through the `entities` column uses) and `Template.changeset` (which
  casts `entities`). Together they are exactly what a create/update stores and a show returns, so a nested
  loadout — an ordered bag WITH an empty gap, equipped slots, an inventory — must survive unchanged.
  """
  use ExUnit.Case, async: true

  alias Nebulith.Catalog.Template
  alias Nebulith.EctoJSON

  # A player entity carrying an equipped weapon + a bag whose ORDER + gap matter, and the hero inventory.
  @player %{
    "id" => "player_1",
    "kind" => "player",
    "col" => 5,
    "row" => 5,
    "baseStats" => %{"strength" => 10, "maxHp" => 100},
    "loadout" => %{
      "equipped" => %{"weapon1" => %{"id" => "sword", "slot" => "weapon"}},
      "bag" => [%{"id" => "potion-a", "slot" => "consumable"}, nil, %{"id" => "potion-b", "slot" => "consumable"}],
      "special" => [%{"id" => "bomb", "slot" => "consumable"}, nil, nil, nil],
      "shortcuts" => ["9", "8", "7", "6"]
    },
    "inventory" => %{
      "items" => [%{"id" => "oak-staff", "slot" => "weapon"}],
      "equippedWeapon" => %{"id" => "oak-staff"},
      "equippedArmor" => nil
    }
  }

  # A NON-PLAYER unit's loadout must round-trip identically — units are the same.
  @enemy %{
    "id" => "enemy_1",
    "kind" => "enemy",
    "col" => 9,
    "row" => 9,
    "loadout" => %{"equipped" => %{"helmet" => %{"id" => "e-helm", "slot" => "armor"}}, "bag" => [%{"id" => "loot"}]}
  }

  describe "EctoJSON pass-through (the `entities` jsonb column type)" do
    test "dump then load preserves a nested loadout, including bag ORDER and the empty gap" do
      entities = [@player, @enemy]
      assert {:ok, dumped} = EctoJSON.dump(entities)
      assert {:ok, loaded} = EctoJSON.load(dumped)
      assert loaded == entities
      # spell out the load-bearing bits so a regression names itself:
      [player, _enemy] = loaded
      assert Enum.at(player["loadout"]["bag"], 1) == nil
      assert player["loadout"]["bag"] == @player["loadout"]["bag"]
    end
  end

  describe "Template.changeset casts `entities` with unit loadouts unchanged" do
    @base %{
      "id" => "tmpl_1",
      "name" => "Loadout Stage",
      "groundData" => [["grass"]],
      "heightData" => [[0]],
      "assetsData" => []
    }

    test "a valid changeset keeps every entity's loadout/inventory byte-identical" do
      changeset = Template.changeset(%Template{}, Map.put(@base, "entities", [@player, @enemy]))
      assert changeset.valid?
      entities = Ecto.Changeset.get_change(changeset, :entities)

      player = Enum.find(entities, &(&1["id"] == "player_1"))
      enemy = Enum.find(entities, &(&1["id"] == "enemy_1"))

      # equip + inventory survive (inventory is player-only)
      assert player["loadout"]["equipped"]["weapon1"]["id"] == "sword"
      assert player["inventory"]["equippedWeapon"]["id"] == "oak-staff"
      # bag ORDER + special slots + shortcuts survive EXACTLY
      assert player["loadout"]["bag"] == @player["loadout"]["bag"]
      assert player["loadout"]["special"] == @player["loadout"]["special"]
      assert player["loadout"]["shortcuts"] == ["9", "8", "7", "6"]
      # the non-player unit's loadout is identical; it carries no inventory
      assert enemy["loadout"]["equipped"]["helmet"]["id"] == "e-helm"
      refute Map.has_key?(enemy, "inventory")
    end

    test "an update-style changeset with a DROPPED bag item persists the drop" do
      dropped = put_in(@player, ["loadout", "bag"], [%{"id" => "potion-a", "slot" => "consumable"}])
      changeset = Template.changeset(%Template{}, Map.put(@base, "entities", [dropped]))
      [player] = Ecto.Changeset.get_change(changeset, :entities)
      bag_ids = player["loadout"]["bag"] |> Enum.reject(&is_nil/1) |> Enum.map(& &1["id"])
      assert "potion-a" in bag_ids
      refute "potion-b" in bag_ids
    end
  end
end
