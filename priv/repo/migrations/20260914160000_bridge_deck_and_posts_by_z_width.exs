defmodule Nebulith.Repo.Migrations.BridgeDeckAndPostsByZWidth do
  @moduledoc """
  Rebuilds the 15 bridge compositions on a DB that already has them.

  Two changes, both his, both about the same thing: the structure of a bridge is stated with Z-WIDTH and with
  world-axis THICKNESS, never with screen-axis scale.

    * the WALKWAY was `span` separate planks per row, 2×span tiles for a surface that is one flat run. It is
      now one z-width tile per row, so a span-7 bridge is 10 tiles instead of 18 and the deck draws as one
      solid top with no column seams down the middle of it.
    * the POSTS were thinned with `scaleX`/`scaleZ`, which squash the drawn diamond on the SCREEN axes. A post
      held its shape only at the default camera corner and sheared at the other three. They now state the four
      REACHES that centre a thin block on both GROUND axes, which is what a door states, so a post is a post
      at every facing.

  Runs the composition-only `seed_compositions/0`, the path that exists precisely so a composition change does
  not rewrite tile rows and clobber the poses tuned by hand in the editor. Guarded on compositions existing, so
  a fresh or test DB is left alone instead of being handed rows it never asked for.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  def up do
    if compositions_present?(), do: TileSource.seed_compositions()
  end

  def down do
    # IRREVERSIBLE, and nothing is lost: a composition is composed from code, so a rollback would mean pasting
    # the old cell list into a migration. Checking out the previous `bridge_cells/4` and re-running
    # `seed_compositions/0` restores it exactly.
    :ok
  end

  defp compositions_present? do
    repo().aggregate(from(c in "compositions"), :count) > 0
  end
end
