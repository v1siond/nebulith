defmodule Nebulith.Repo.Migrations.AddStylePresentationToTilesets do
  @moduledoc """
  A TILESET row is an ART STYLE, so it should carry what the style picker needs to show one.

  The `tilesets` table already IS the list of styles, `ascii` and `emoji` are rows in it, but the frontend
  still declared the list, its order, and each style's icon in `game/artStyle.ts` (`BUILT_IN_STYLES`,
  section 3.14a). Adding a style therefore meant a frontend edit, which is the thing the whole tile pipeline
  exists to avoid.

  `icon` is the picker's affordance and `position` its order. With these, the style list is entirely a
  backend read: the picker shows exactly the styles the catalog serves, named and ordered by the catalog.

  SCHEMA ONLY. The two rows' icon and position are DATA and live in
  `Nebulith.DataMigration.StylePresentationForTilesets`, run by `mix nebulith.data_migrate`.
  """
  use Ecto.Migration

  def change do
    alter table(:tilesets) do
      add :icon, :string
      add :position, :integer, default: 0, null: false
    end
  end
end
