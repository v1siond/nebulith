defmodule Nebulith.DataMigration.DropBagAndJournalButtons do
  @moduledoc """
  Takes the floating Bag and Journal buttons out of the HUD.

  Nothing is lost with them. `open_bag` (I) and `open_journal` (Q) are ACTIONS, so the keys still work and
  either can be dropped on an action bar slot. The panels they used to open (`bag_panel`, `journal_panel`)
  are separate elements and stay exactly as they are.

  `seed_elements/1` wipes and rewrites the default profile, so dropping the rows from the source handles that
  one. This is for every profile a game already FORKED: those carry their own copy and would keep drawing a
  button the app no longer renders.

  Idempotent: a profile with no such element matches nothing.
  """
  import Ecto.Query

  require Logger

  alias Nebulith.Repo

  @gone ~w(bag_btn journal_btn)

  def run do
    {count, _} =
      from(e in "ui_elements", where: e.element_key in ^@gone)
      |> Repo.delete_all()

    Logger.info("[data_migrate] bag and journal HUD buttons removed (#{count} rows)")
    :ok
  end
end
