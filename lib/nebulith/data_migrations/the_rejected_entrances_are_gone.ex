defmodule Nebulith.DataMigration.TheRejectedEntrancesAreGone do
  @moduledoc """
  Delete the four entrances that were made by bending tiles into parts they are not for, and stop every
  template naming one.

  ## What was wrong with them

  `town_entrance` and `park_entrance` sat a `lamp` at each foot. `lamp` is not a lamp: it is the BULB cell of
  the two-cell `lamp_post`, which is a `post` scaled to 7 high with the bulb posed on top of it. Placed on its
  own it is a yellow blob lying on the paving, which is exactly what a town's way out was flanked by. Their
  span was a `torii-gate`, a Shinto shrine gate, chosen because the label said "gate". `forest_entrance` hung
  a `boulder` in the air as its arch.

  The question none of them was asked is what the tile is FOR. A label that matches the word in your head is
  not the same as an object that means the thing.

  ## What replaces them

  Nothing, on a generated map. `temple_entrance`, `cave_entrance_cube` and `cave_entrance_rounded` remain in
  the objects palette to place by hand: they are built from real mass and proportion, and they were approved.
  The generator no longer stamps an entrance at all, so a way out is a paved way running off the map between
  whatever the place grows, and it is exactly as wide as the served pathway (`PATHWAYS.md` §3), which a
  fixed 3-cell composition never was.

  Composition-only plus the `entrance` key on generator configs. No tile row is touched.
  """
  require Logger

  import Ecto.Query

  alias Nebulith.Catalog.Composition
  alias Nebulith.Repo

  @rejected ~w(forest_entrance cave_entrance town_entrance park_entrance)

  def run do
    ids = Repo.all(from(c in Composition, where: c.name in ^@rejected, select: c.id))
    {cells, _} = Repo.delete_all(from(c in "composition_cells", where: c.composition_id in ^ids))
    {comps, _} = Repo.delete_all(from(c in Composition, where: c.id in ^ids))
    generators = clear_entrance_key()

    Logger.info(
      "[data_migrate] rejected entrances gone: #{comps} composition(s), #{cells} cell(s), " <>
        "#{generators} generator config(s) no longer name one"
    )

    :ok
  end

  # The config is a jsonb map on the generator row. `jsonb_exists` rather than the `?` operator: `?` is also
  # Postgrex's parameter placeholder, so the operator form never reaches the database as an operator.
  defp clear_entrance_key do
    %Postgrex.Result{num_rows: rows} =
      Repo.query!("""
      UPDATE generators
         SET config = config - 'entrance'
       WHERE jsonb_exists(config, 'entrance')
      """)

    rows
  end
end
