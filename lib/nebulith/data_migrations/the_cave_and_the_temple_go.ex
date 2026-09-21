defmodule Nebulith.DataMigration.TheCaveAndTheTempleGo do
  @moduledoc """
  Delete the cave and the temple, generators and categories both.

  *"I REALLY DIDN'T CARE AT ALL ABOUT TEMPLE AND CAVE, IN FACT, WE CAN REMOVE BOTH BECAUSE THEY SUCK AND WE
  HAVE TO REDO THE DESIGN FROM SCRATCH LIKE WE DID WITH TOWNS AND FORESTS"*, and then *"remove temple and
  cave"*.

  They are not being tidied away, they are being cleared for a redesign. The wilderness, village, town and
  city categories are untouched, and so is every saved template: this removes the RECIPES, not any map
  somebody built.
  """
  require Logger

  import Ecto.Query

  alias Nebulith.Repo

  @gone ~w(cave temple)

  def run do
    # A generator hangs off its category by id, so the categories are found first and the generators by that.
    ids = Repo.all(from(c in "generator_categories", where: c.key in ^@gone, select: c.id))
    {generators, _} = Repo.delete_all(from(g in "generators", where: g.category_id in ^ids))
    {categories, _} = Repo.delete_all(from(c in "generator_categories", where: c.id in ^ids))

    Logger.info(
      "[data_migrate] cave and temple gone: #{generators} generator(s), #{categories} category(ies)"
    )

    :ok
  end
end
