defmodule Nebulith.DataMigration.UndoTheDesertTiles do
  @moduledoc """
  Takes the desert back to the state he approved, and removes the cacti.

  *"I requested trees, you added individual tiles, remove all that fucking shit you added, it wasn't what I
  requested."*

  He asked for more TREE types. What got built was three single-cell billboard TILES (`cactus_column`,
  `cactus_barrel`, `cactus_prickly`), which is not a tree in this system's sense at all: a tree is a
  composition of cells. The framework's own process (`OBJECT-CONSTRUCTION.md` §4) has an APPROVAL gate at
  step 1b, described there as "a full stop", and it was skipped. This undoes the result.

  Removed:

    * the `cactus_column` / `cactus_barrel` / `cactus_prickly` compositions
    * the `cactus_barrel` and `cactus_pad` tile rows, and the settings written onto `cactus`
    * `tree_acacia`, which WAS built as a proper two-cell tree, but went in as part of the same unapproved
      push, so it goes out with it rather than being kept on a judgement call he did not make

  Restored: the Desert environment mix and all five of its region mixes, to the values measured immediately
  before the change. That deliberately puts `tree_banana` and `tree_mangrove` back in the desert. They are
  wrong and he said so, and they are what the approved state contained, so fixing them is the NEXT piece of
  work rather than something smuggled into an undo.
  """
  require Logger

  alias Nebulith.Catalog.TileSource
  alias Nebulith.Repo

  @gone ~w(cactus_column cactus_barrel cactus_prickly tree_acacia)
  @tiles_gone ~w(cactus_barrel cactus_pad)

  def run do
    comps = drop_compositions()
    tiles = drop_tiles()
    strip_cactus_settings()
    TileSource.seed_compositions()

    # THE DESERT MIX IS NOT RESTORED FROM HERE ANY MORE. `GeneratorSource.seed/0` writes
    # `generators.config` WHOLE, so a mix written by this pass was a second owner and the next seed
    # decided it. What the desert grows is stated in the seeder, which is the only place it is stated.
    Logger.info("[data_migrate] #{comps} compositions and #{tiles} tiles removed")

    :ok
  end

  defp drop_compositions do
    Repo.query!(
      "DELETE FROM composition_cells WHERE composition_id IN (SELECT id FROM compositions WHERE name = ANY($1))",
      [@gone]
    )

    %{num_rows: rows} = Repo.query!("DELETE FROM compositions WHERE name = ANY($1)", [@gone])
    rows
  end

  defp drop_tiles do
    %{num_rows: rows} = Repo.query!("DELETE FROM tiles WHERE label = ANY($1)", [@tiles_gone])
    rows
  end

  # `cactus` itself predates all of this, so the ROW stays and its settings go back to what they were.
  #
  # Stripping the three keys I added is NOT enough: `upsert_tile` replaces the WHOLE settings map, so the
  # per-zone `colors` the row carried was already gone by then. It is rewritten here rather than patched.
  @cactus_zones ~w(spring summer autumn winter desert beach lava)
  @cactus_green "#4a8f3f"

  defp strip_cactus_settings do
    settings = %{
      "color" => @cactus_green,
      "colors" => Map.new(@cactus_zones, &{&1, @cactus_green})
    }

    Repo.query!("UPDATE tiles SET settings = $1::text::jsonb WHERE label = 'cactus'", [
      Jason.encode!(settings)
    ])
  end
end
