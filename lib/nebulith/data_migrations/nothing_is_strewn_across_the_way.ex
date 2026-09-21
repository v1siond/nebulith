defmodule Nebulith.DataMigration.NothingIsStrewnAcrossTheWay do
  @moduledoc """
  No pathway strews `decor_pebbles` over its own surface any more.

  ## What landed on the path

  A pathway kind carries a `scatter` list of things that LIE ON the way, and eight of the ten kinds named
  `decor_pebbles` at rates from 0.05 to 0.16. The idea comes straight off the references (a track with
  pebbles across it is what makes it read as worn rather than painted), but the tile has no picture of its
  own in either style:

      emoji  decor_pebbles -> /tiles/emoji/sq_brown.png  #b0894e
      ascii  decor_pebbles -> a flat pebble field

  So what actually got strewn across every track, gravel road, park path and town street was a scatter of
  brown rectangles lying on the surface. Counted on a 60x40 map: 35 on a meadow, 25 on a town, 22 on a
  woodland.

  ## Why this is data and not a placer change

  `scatter` is the generator catalogue stating what a kind of way looks like, and the placer just does what it
  is told. Nothing about the mechanism is wrong. The list is emptied here and in `GeneratorSource`, so a fresh
  seed and a live database agree, and re-arming one kind is a single entry once a pebble tile exists that
  draws pebbles.

  `lining` is untouched. That is what stands BESIDE a way rather than on it, which is where an ornament
  belongs.

  Idempotent: matches only rows whose `scatter` still holds an entry.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{num_rows: rows} =
      Repo.query!("""
      UPDATE generators
      SET config = jsonb_set(config, '{pathway,scatter}', '[]'::jsonb)
      WHERE config->'pathway'->'scatter' IS NOT NULL
        AND jsonb_array_length(config->'pathway'->'scatter') > 0
      """)

    Logger.info("[data_migrate] nothing strewn across the way: #{rows} generators cleared")
    :ok
  end
end
