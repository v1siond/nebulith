defmodule Nebulith.Repo.Migrations.ThePictureLivesInOnePlace do
  @moduledoc """
  `tiles.image_url` goes. The picture is in `tile_images`, and two owners of one fact is law 2.

  The column and the table both held the picture between the phase 2 table migration and this one, which
  is exactly the state a rewire must pass through and must not stay in: a second copy does not remain a
  copy, it drifts. Measured on the seeder's own data, two glyphs had already drifted from the manifest
  that bakes them while nothing read the copy.

  `image_url` remains the word a reader uses. It is a virtual field now, filled from `tile_images` by the
  join in `Catalog.list_tiles_for/1`, so the wire format and every caller are unchanged.
  """
  use Ecto.Migration

  def up do
    # Nothing should be left behind, but a picture that never made it across would vanish silently, and
    # silence is the failure mode this whole phase is about.
    execute """
    INSERT INTO tile_images (tileset_id, tile_id, image_path, inserted_at, updated_at)
    SELECT t.tileset_id, t.id, t.image_url, now() AT TIME ZONE 'utc', now() AT TIME ZONE 'utc'
    FROM tiles t
    WHERE t.image_url IS NOT NULL AND t.image_url <> ''
      AND NOT EXISTS (
        SELECT 1 FROM tile_images i WHERE i.tile_id = t.id AND i.tileset_id = t.tileset_id
      )
    """

    alter table(:tiles) do
      remove :image_url
    end
  end

  def down do
    alter table(:tiles) do
      add :image_url, :string
    end

    execute """
    UPDATE tiles t SET image_url = i.image_path
    FROM tile_images i WHERE i.tile_id = t.id AND i.tileset_id = t.tileset_id
    """
  end
end
