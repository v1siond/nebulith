defmodule Nebulith.Repo.Migrations.ATilesetIsANameAndASetOfPictures do
  @moduledoc """
  `tilesets.data` goes. It is the last of the blob a tileset used to be.

  `docs/SPEC.md` §3.1 declares a tileset as `id`, `key`, `name`, `icon`, `position`, `owner_id`, and
  nothing else: *"A new art style is one `tilesets` row plus N `tile_images` rows, and no fact is
  copied."* `data` held `palettes` and `terrain` for ascii, which is how ground colour and the season
  palettes used to travel.

  Both moved out. The ground tones are each tile's own `settings.variants`, read per LABEL. The zone
  palettes are `zones.palette`, which is where the generator reads them. Measured before dropping: a seed
  leaves the column NULL on both styles, nothing in the backend writes it, and nothing in the engine reads
  `data.palettes` or `data.terrain`.

  Invariant 3 of the spec is *"No new jsonb. The 19 jsonb columns today are how the schema became
  invisible."* This is one of them leaving.
  """
  use Ecto.Migration

  def up do
    alter table(:tilesets) do
      remove :data
    end
  end

  def down do
    alter table(:tilesets) do
      add :data, :map
    end
  end
end
