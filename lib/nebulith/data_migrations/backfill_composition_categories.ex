defmodule Nebulith.DataMigration.BackfillCompositionCategories do
  @moduledoc """
  Backfills the `category` COLUMN on every composition row that predates the column (D1: "categorize
  compositions like tiles"). A composition's category, the SAME sidebar bucket a tile carries (MAP-MODEL
  §8), is authored in the seed going forward (BuildingCompositions = `buildings`, TileSource = `nature` /
  `props`), but rows already in the shared DB were seeded WITHOUT it. This walks the category COLUMN alone
  (the cells are untouched), so it never disturbs editor-tuned composition cells the way a full reseed would.

  The bucket is derived from the composition's OWN CELLS, DATA, not a name regex (the very heuristic D1
  removes from the frontend):

    * a `door` cell → `buildings` (a house/store/… is a walled box with a doorway);
    * a `trunk*` / `leaf*` / `snag` cell → `nature` (a tree/bush is trunk + canopy);
    * anything else → `props` (a fountain / well / lamp post, a standalone ornament).

  This is the SAME classification the seed authors reach (by construction), so a later reseed and this
  backfill always agree on a row's category.

  Idempotent: a row already carrying its derived category matches nothing on a re-run.
  """
  import Ecto.Query
  require Logger

  alias Nebulith.Catalog.Composition
  alias Nebulith.Repo

  def run do
    updated =
      Composition
      |> Repo.all()
      |> Repo.preload(:cells)
      |> Enum.reduce(0, fn comp, acc -> acc + backfill(comp) end)

    Logger.info("[data_migrate] composition categories backfilled (#{updated} rows set)")
    :ok
  end

  # Set the derived category ONLY when it differs (idempotent), the category column alone, so the cells survive.
  defp backfill(comp) do
    category = classify(comp.cells)
    if comp.category == category, do: 0, else: update_category(comp, category)
  end

  defp update_category(comp, category) do
    {count, _} =
      from(c in Composition, where: c.id == ^comp.id)
      |> Repo.update_all(
        set: [category: category, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
      )

    count
  end

  # Bucket a composition by what its CELLS are (MAP-MODEL §8): a doorway → a building, a trunk/canopy → nature,
  # otherwise a standalone prop. No name matching, the composition's own tile labels decide.
  defp classify(cells) do
    cond do
      Enum.any?(cells, &door?/1) -> "buildings"
      Enum.any?(cells, &tree?/1) -> "nature"
      true -> "props"
    end
  end

  defp door?(%{label: label}), do: label == "door"

  defp tree?(%{label: label}),
    do: String.starts_with?(label, "trunk") or String.starts_with?(label, "leaf") or label == "snag"
end
