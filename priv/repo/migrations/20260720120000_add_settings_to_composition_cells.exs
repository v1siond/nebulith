defmodule Nebulith.Repo.Migrations.AddSettingsToCompositionCells do
  use Ecto.Migration

  # A composition cell's TUNED per-cell tile settings — the display overrides that shape a cell's tile into a
  # realistic form (beyond its Zoom `scale` + draw-priority `z_index` columns). A jsonb bag, mirroring the way a
  # TILE already carries `settings.display`/`settings.pose`, so a cell can override them per placement: the lamp
  # POST is ONE cell stretched tall+thin (`scaleY`), and the lamp BULB is a SINGLE-display billboard lifted onto
  # the post's top (`display` + `pose`). A structured/nested bag can't ride the scalar scale/z_index columns, so
  # it gets its own jsonb column (like `animations`). Nullable + no default: every existing cell stays NULL, so
  # the API omits the key and every untuned cell serves EXACTLY as before. nebulith only ADDs to its own table
  # here; it never touches the Prisma-owned tables.
  def change do
    alter table(:composition_cells) do
      add :settings, :map
    end
  end
end
