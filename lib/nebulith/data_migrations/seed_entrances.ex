defmodule Nebulith.DataMigration.SeedEntrances do
  @moduledoc """
  RETIRED. This pass seeded the first four entrances: forest, cave, town and park.

  They were built by bending single tiles into parts they were never for. A `torii-gate`, a Japanese shrine
  gate, stood in as a generic town arch because the name said "gate". A `boulder` hung in the air as the span
  of a forest one. Worst of the four, the `lamp` at each foot of the town gateway is the BULB of `lamp_post`,
  one cell of a two-cell object, so a town's way out was flanked by two bulbs lying on the paving with no post
  under them.

  `seed_approved_entrances` replaced them with objects built from real mass and proportion, and the rejected
  four were left seeded and still named by every settlement and cave template. `TheRejectedEntrancesAreGone`
  deletes them. This pass stays registered so the ledger keeps its order and a database that already ran it
  still reconciles; it does nothing, because the rows it used to write are rows we now delete.
  """
  require Logger

  def run do
    Logger.info("[data_migrate] entrances: retired, see TheRejectedEntrancesAreGone")
    :ok
  end
end
