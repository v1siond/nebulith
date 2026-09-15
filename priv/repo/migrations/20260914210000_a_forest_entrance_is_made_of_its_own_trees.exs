defmodule Nebulith.Repo.Migrations.AForestEntranceIsMadeOfItsOwnTrees do
  @moduledoc """
  WITHDRAWN. This migration does nothing, and is kept only because it has already run.

  It seeded `woodland_entrance`, `jungle_entrance`, `meadow_entrance` and `swamp_entrance`, one tree-guided
  entrance per kind of forest. All of it was thrown out on his instruction: *"still not good, remove the black
  entrance... NONE of the entrances is adapted to the suptypes, like this is actually outrageous, throw away
  whatever framework you built"*. The compositions and the code that built them went with the revert, and this
  file was the piece left behind: it still called `TileSource.seed_forest_entrances/0`, which no longer exists,
  so every fresh database (the test one included) crashed here instead of migrating.

  The body is empty rather than the file deleted, because the version is recorded as run in environments that
  migrated before the revert. A forest entrance will come back as its own migration, built the way the cave
  mouths and the temple were.
  """
  use Ecto.Migration

  def up, do: :ok

  def down, do: :ok
end
