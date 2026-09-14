defmodule Nebulith.Repo.Migrations.AddStylePresentationToTilesets do
  @moduledoc """
  A TILESET row is an ART STYLE, so it should carry what the style picker needs to show one.

  The `tilesets` table already IS the list
  of styles — `ascii` and `emoji` are rows in it — but the frontend still declared the list, its order, and
  each style's icon in `game/artStyle.ts` (`BUILT_IN_STYLES`, §3.14a). Adding a style therefore meant a
  frontend edit, which is the thing the whole tile pipeline exists to avoid.

  `icon` is the picker's affordance and `position` its order. With these, the style list is entirely a
  backend read: the picker shows exactly the styles the catalog serves, named and ordered by the catalog.
  """
  use Ecto.Migration

  import Ecto.Query

  def up do
    alter table(:tilesets) do
      add :icon, :string
      add :position, :integer, default: 0, null: false
    end

    flush()

    # ASCII first — it is the default the editor opens on, and the engine's own baseline.
    for {key, icon, position} <- [{"ascii", "⌨", 1}, {"emoji", "😀", 2}] do
      repo().update_all(from(t in "tilesets", where: t.key == ^key),
        set: [icon: icon, position: position]
      )
    end
  end

  def down do
    alter table(:tilesets) do
      remove :icon
      remove :position
    end
  end
end
