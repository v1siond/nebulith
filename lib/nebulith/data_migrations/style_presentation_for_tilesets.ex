defmodule Nebulith.DataMigration.StylePresentationForTilesets do
  @moduledoc """
  Fills in the style picker's affordance and order on the two tileset rows.

  A TILESET row is an ART STYLE, so it carries what the picker needs to show one. The `tilesets` table
  already IS the list of styles, `ascii` and `emoji` are rows in it, but the frontend used to declare the
  list, its order and each style's icon in `game/artStyle.ts` (`BUILT_IN_STYLES`, section 3.14a). Adding a
  style therefore meant a frontend edit, which is the thing the whole tile pipeline exists to avoid.

  `icon` is the picker's affordance and `position` its order. With these the style list is entirely a backend
  read: the picker shows exactly the styles the catalog serves, named and ordered by the catalog. The COLUMNS
  are schema and stay in the migration that adds them; the two values are data and live here.

  Idempotent: fixed values per key, so a re-run writes the same thing.
  """
  import Ecto.Query

  require Logger

  alias Nebulith.Repo

  # ASCII first. It is the default the editor opens on, and the engine's own baseline.
  @presentation [{"ascii", "⌨", 1}, {"emoji", "😀", 2}]

  def run do
    updated = Enum.reduce(@presentation, 0, fn style, acc -> acc + present(style) end)

    Logger.info("[data_migrate] tileset style presentation (#{updated} rows set)")
    :ok
  end

  defp present({key, icon, position}) do
    {count, _} =
      from(t in "tilesets",
        where: t.key == ^key and (t.icon != ^icon or t.position != ^position or is_nil(t.icon))
      )
      |> Repo.update_all(set: [icon: icon, position: position])

    count
  end
end
