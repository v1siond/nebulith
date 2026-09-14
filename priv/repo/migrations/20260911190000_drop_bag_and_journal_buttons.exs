defmodule Nebulith.Repo.Migrations.DropBagAndJournalButtons do
  @moduledoc """
  Nuke the floating Bag and Journal buttons out of the HUD.

  Nothing is lost with them. `open_bag` (I) and `open_journal` (Q) are ACTIONS, so the keys still work and
  either can be dropped on an action bar slot. The panels they used to open (`bag_panel`, `journal_panel`)
  are separate elements and stay exactly as they are.

  `seed_elements/1` wipes and rewrites the default profile, so dropping the rows from the source handles
  that one. This is for every profile a game already FORKED — those carry their own copy and would keep
  drawing a button the app no longer renders.
  """
  use Ecto.Migration

  def up do
    execute("DELETE FROM ui_elements WHERE element_key IN ('bag_btn', 'journal_btn')")
  end

  def down do
    # The buttons are gone from the source, so there is nothing faithful to restore them to.
    :ok
  end
end
