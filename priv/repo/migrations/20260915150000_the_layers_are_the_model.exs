defmodule Nebulith.Repo.Migrations.TheLayersAreTheModel do
  @moduledoc """
  The served layers become the model's layers.

  What was served: `ways`, `layout`, `buildings`, `nature`, `decor`, `units`. Three things were wrong with it.

  `ways` sat at position 10, a sibling AHEAD of `layout`, when pathways belong INSIDE it and run after the
  water they are supposed to adapt to: *"water (which blocks pathways) > pathways (which adapts to available
  space left by water on grid)"*. It is `pathways` now, at position 30, behind terrain and water.

  `layout` was served as a layer and it is not one, it is the NAME OF THE GROUP that terrain, water and
  pathways form: *"layout refers to the underlying subsystem already mentioned (grid, terrain, water,
  pathways), it groups them under it, we can name it differently, but basically those are the 'main' layers"*.
  In the UI it is also a filter, *"I WANT TO ONLY EXECUTE THE SYSTEM UP TO THIS SPECIFIC LAYER"*. So it becomes
  a `group` on the rows rather than a row of its own, and `buildings` / `nature` / `decor` carry the other
  group, `objects`, because that is what they are: *"then we have 'buildins/nature/decor' which are the objects
  layer"*.

  And four layers were missing entirely, named more than once and never built: fog, lightning, shadow and post
  processing. They are rows now, not seedable, so the editor shows them without offering a button that does
  nothing. Nothing binds a pass to them yet, and a served layer the engine has no pass for simply does not run.
  """
  use Ecto.Migration

  def up do
    alter table(:generation_layers) do
      add :group, :string
    end

    flush()

    # `ways` is renamed rather than dropped and re-added, so any seed someone has saved against it survives.
    execute "UPDATE generation_layers SET key = 'pathways' WHERE key = 'ways'"
    execute "DELETE FROM generation_layers WHERE key = 'layout'"

    # FLUSH BEFORE SEEDING. `execute` is QUEUED and runs at the end of the migration, so without this the
    # seeder ran first, inserted `pathways`, and the queued rename then collided with the row it had just
    # created. The unique index caught it, which is the index doing its job.
    flush()

    Nebulith.Catalog.GeneratorSource.seed_generation_layers()
  end

  def down do
    alter table(:generation_layers) do
      remove :group
    end
  end
end
