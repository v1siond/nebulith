defmodule Nebulith.Repo.Migrations.AForestEntranceIsMadeOfItsOwnTrees do
  @moduledoc """
  One tree-guided entrance per kind of forest, and each generator names its own.

  *"forest entrance depends on type of firest, is not the same entering ajungle than entering a meadow or a
  woodland or a swamp, each one must have their own tree guided entry"* (2026-09-14).

  `forest_entrance` was one object for every wood, named after a place rather than a thing, which is how it
  ended up holding a cave mouth and every forest gate wore one. It is replaced by `woodland_entrance`,
  `jungle_entrance`, `meadow_entrance` and `swamp_entrance`, which differ by PROPORTION: a jungle's trunks are
  tall and its crowns wide, a meadow's short and sparse, a swamp's squat and close.

  None of them has a beam across the top. That is what makes `temple_entrance` a built gateway, and a wood does
  not build one.
  """
  use Ecto.Migration

  def up do
    Nebulith.Catalog.TileSource.seed_forest_entrances()
    Nebulith.Catalog.GeneratorSource.seed()
  end

  def down, do: :ok
end
