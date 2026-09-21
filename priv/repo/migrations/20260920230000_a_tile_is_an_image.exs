defmodule Nebulith.Repo.Migrations.ATileIsAnImage do
  @moduledoc """
  DROPS `tiles.glyph` AND `tiles.emoji`.

  *"a tile is a fucking image.... how many times have I told you we don't want to use any fuckiong
  gklhyps nor emojis and that tiles are just images?"*

  Both columns were a second way of saying what a tile looks like, kept as a last resort for a tile whose
  png was missing. Measured before dropping them: 881 rows stated a glyph and 880 an emoji, every one of
  the 1276 rows has an `image_url`, and on a generated 40x40 map 1200 tile images load with none failing.
  So the character was never reached, and the only thing the columns did was keep the second vocabulary
  alive for something to start reading again.

  `color_role` stays: that is which part of a palette a tile takes, not a picture.
  """
  use Ecto.Migration

  def up do
    alter table(:tiles) do
      remove :glyph
      remove :emoji
    end
  end

  def down do
    alter table(:tiles) do
      add :glyph, :string
      add :emoji, :string
    end
  end
end
