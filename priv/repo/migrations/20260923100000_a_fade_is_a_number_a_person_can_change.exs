defmodule Nebulith.Repo.Migrations.AFadeIsANumberAPersonCanChange do
  @moduledoc """
  THE FOUR NUMBERS THE RANGE TRANSPARENCY IS MADE OF, moved out of React and onto the row.

  They were `export const` in `engine/render/roofReveal.ts`, which is why the report was *"I don't see any
  place to manage or edit it"*: a value invented in the frontend has no control, because there is no row a
  control could write to. Law 7 and law 12 both say so, and this is the shape of the fix they imply.

  The defaults are exactly what the engine held, so nothing about the picture changes on the day this runs.
  That is deliberate: a migration that moves a fact should not also change it.
  """
  use Ecto.Migration

  def change do
    alter table(:game_settings) do
      # Beyond this many cells the thing is fully solid. A building you are nowhere near is a building.
      add :fade_radius, :integer, null: false, default: 12

      # Within this many it holds FLAT at its most transparent, so walking up to a door is a change you
      # cannot miss rather than a few percent.
      add :fade_full_radius, :integer, null: false, default: 5

      # How opaque the close band draws, so a door on the far face still reads.
      add :fade_alpha, :decimal, null: false, default: 0.35

      # How opaque the shell draws while you are standing INSIDE it.
      add :interior_alpha, :decimal, null: false, default: 0.15
    end

    # A fade that can reach zero is a tile that disappears, and a radius that ends before it starts has no
    # band at all. The panel does not get to produce either, and neither does the API.
    create constraint(:game_settings, :fade_alpha_is_visible,
             check: "fade_alpha > 0 AND fade_alpha <= 1"
           )

    create constraint(:game_settings, :interior_alpha_is_visible,
             check: "interior_alpha > 0 AND interior_alpha <= 1"
           )

    create constraint(:game_settings, :fade_band_has_width,
             check: "fade_radius > fade_full_radius AND fade_full_radius >= 0"
           )
  end
end
