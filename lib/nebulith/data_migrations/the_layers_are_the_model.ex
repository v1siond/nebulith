defmodule Nebulith.DataMigration.TheLayersAreTheModel do
  @moduledoc """
  The served layers become the model's layers.

  What was served: `ways`, `layout`, `buildings`, `nature`, `decor`, `units`. Three things were wrong with it.

  `ways` sat at position 10, a sibling AHEAD of `layout`, when pathways belong INSIDE it and run after the
  water they are supposed to adapt to: water blocks pathways, pathways adapt to the space water leaves on the
  grid. It is `pathways` now, at position 30, behind terrain and water.

  `layout` was served as a layer and it is not one, it is the NAME OF THE GROUP that terrain, water and
  pathways form. In the UI it is also a filter, a way to run the system only up to a chosen layer. So it
  becomes a `group` on the rows rather than a row of its own, and `buildings` / `nature` / `decor` carry the
  other group, `objects`, because that is what they are.

  And four layers were missing entirely, named more than once and never built: fog, lightning, shadow and post
  processing. They are rows now, not seedable, so the editor shows them without offering a button that does
  nothing. Nothing binds a pass to them yet, and a served layer the engine has no pass for simply does not run.

  The `group` COLUMN is schema and stays in the migration. The rename, the dropped row and the reseed are data
  and live here. Idempotent: once `ways` is `pathways` and `layout` is gone, neither statement matches again.
  """
  import Ecto.Query

  require Logger

  alias Nebulith.Catalog.GeneratorSource
  alias Nebulith.Repo

  def run do
    # Renamed rather than dropped and re-added, so any seed saved against it survives.
    {renamed, _} =
      from(l in "generation_layers", where: l.key == "ways")
      |> Repo.update_all(set: [key: "pathways"])

    {dropped, _} = Repo.delete_all(from(l in "generation_layers", where: l.key == "layout"))

    GeneratorSource.seed_generation_layers()

    Logger.info("[data_migrate] layers are the model (#{renamed} renamed, #{dropped} dropped)")
    :ok
  end
end
