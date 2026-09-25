defmodule Nebulith.DataMigration.ATempleHasItsOwnMouth do
  @moduledoc """
  Two pieces of tidying in the entrance data, both open on ticket 1 and both one query.

  ## 1. The temple stops wearing the cave's mouth

  `temple_default` serves `entrance: "cave_entrance"` while `temple_entrance` is seeded and used by nothing.
  Against his rule that a thing is *"always named in relation to the object itself"*, and it also means a
  temple and a cave open the same way, which is not what either looks like.

  ## 2. The fourteen rejected entrances leave the catalog

  A set of entrance compositions was built and rejected on sight. The seeder stopped writing them, so a fresh
  database is clean, but `upsert` never deletes and they were still in HIS database, still listed in the
  object library he picks from. Counted on the live catalog: **15** of them, the fourteen plus `forest_entrance`.

  They go here. `cave_entrance` and `temple_entrance` stay, those are the two that are used, along with the
  cave's `_cube` and `_rounded` variants and `town_entrance`.

  Idempotent: both queries match only what is still there.
  """
  require Logger

  alias Nebulith.Repo

  # Everything named `*_entrance` that nothing serves. Listed by name rather than matched by a pattern, so
  # adding a real entrance later cannot silently delete it.
  @rejected ~w(
    woodland_entrance jungle_entrance meadow_entrance swamp_entrance island_entrance beech_entrance
    dense_jungle_entrance dense_woodland_entrance glades_entrance jungle_ruins_entrance
    mountain_forest_entrance open_meadow_entrance park_entrance wood_pasture_entrance forest_entrance
  )

  def run do
    %{num_rows: cells} =
      Repo.query!(
        """
        DELETE FROM composition_cells
        WHERE composition_id IN (SELECT id FROM compositions WHERE name = ANY($1))
        """,
        [@rejected]
      )

    %{num_rows: comps} = Repo.query!("DELETE FROM compositions WHERE name = ANY($1)", [@rejected])

    # NO LONGER TOUCHES `generators`. A temple naming its own entrance is stated by `GeneratorSource`,
    # which writes `config` WHOLE, so setting it from here made the fact a second owner and the next seed
    # decided it. What is left is the half the seeder does not own: the rejected compositions.
    Logger.info("[data_migrate] #{comps} rejected entrance compositions deleted (#{cells} cells)")

    :ok
  end
end
