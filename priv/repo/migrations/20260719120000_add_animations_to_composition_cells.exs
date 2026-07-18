defmodule Nebulith.Repo.Migrations.AddAnimationsToCompositionCells do
  use Ecto.Migration

  # A composition cell's DEFAULT tile ANIMATIONS — a LIST of settings/sprite tween envelopes (the same
  # `Animation` shape the frontend engine reads: id/kind/durationMs/tracks/…). Stored as jsonb so a cell can
  # ship animated BY DEFAULT: the town-square fountain's WATER cells (water_c + water_jet) carry the two
  # chained rise/fade animations, copied onto the placed asset at stamp time so a generated town's fountain
  # is animated without any per-instance authoring. A nested array can't ride the scalar scale/z_index
  # columns, so it needs its own jsonb column (unlike scale/z_index). Nullable + no default: every existing
  # cell stays NULL, so the API omits the key and every non-fountain cell serves EXACTLY as before. nebulith
  # only ADDs to its own table here; it never touches the Prisma-owned tables.
  def change do
    alter table(:composition_cells) do
      add :animations, {:array, :map}
    end
  end
end
