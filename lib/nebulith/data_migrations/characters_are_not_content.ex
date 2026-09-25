defmodule Nebulith.DataMigration.CharactersAreNotContent do
  @moduledoc """
  STRIPS `char` OUT OF EVERY GROUND TILE'S `settings.variants`.

  `docs/SPEC.md` §9.2, on terrain characters: **"DELETED. Characters are not content."** Phase 2's DELETE
  half is *"every glyph, emoji and character column"*, and this is the last of the characters: not a
  column, a key inside the settings blob, which is exactly how the schema went invisible in the first
  place.

  A ground tile draws its baked picture like every other tile. The character was reached only when a tile
  had no picture, which the catalog forbids, so it was a fallback for a state that cannot happen. A
  fallback for loaded data is what the compliance rule bans, and this one had drifted from what was drawn.

  `fg` and `bg` STAY. They are the two ground tones, not characters: `fg` is the tile's own colour and
  `bg` is the fill a floor cell is born with. `docs/SPEC.md` §9.2 gives the background colour a column of
  its own on `cell_tiles` in phase 3, and it moves there then.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{num_rows: count} =
      Repo.query!("""
      UPDATE tiles
      SET settings = jsonb_set(settings, '{variants}', (settings->'variants') - 'char')
      WHERE settings->'variants' ? 'char'
      """)

    Logger.info("[data_migrate] characters are not content (#{count} ground tiles)")
    :ok
  end
end
