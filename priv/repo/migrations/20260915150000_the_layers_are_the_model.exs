defmodule Nebulith.Repo.Migrations.TheLayersAreTheModel do
  @moduledoc """
  A generation layer belongs to a GROUP.

  `layout` used to be served as a layer and it is not one, it is the NAME OF THE GROUP that terrain, water
  and pathways form. `buildings`, `nature` and `decor` carry the other group, `objects`, because that is
  what they are. So the grouping becomes a column on the rows rather than a row of its own.

  SCHEMA ONLY. Renaming `ways` to `pathways`, dropping the `layout` row and reseeding the layer list are
  DATA and live in `Nebulith.DataMigration.TheLayersAreTheModel`, run by `mix nebulith.data_migrate`.
  """
  use Ecto.Migration

  def change do
    alter table(:generation_layers) do
      add :group, :string
    end
  end
end
