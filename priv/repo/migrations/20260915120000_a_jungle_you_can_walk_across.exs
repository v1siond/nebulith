defmodule Nebulith.Repo.Migrations.AJungleYouCanWalkAcross do
  @moduledoc """
  The jungle opens up: canopy 0.369 -> 0.31 and groundCover 0.3 -> 0.2, dense 0.428 -> 0.36.

  *"except for jungle, let's reduce trees 10-15% more, the thing is, the density of trees is conflicting with
  the functionality of the map, user can't move, we can't put any treasures nor units around"*.

  Three canopy cuts before this one read as no change, and the reason is in the generator: a jungle's thicket
  density is the served `groundCover` times the walkable floor over what is left to plant on. Thinning the
  trees makes that floor bigger, so the undergrowth grows back exactly what the canopy gave up. Measured at a
  fixed groundCover of 0.3, dropping canopy from 0.369 to 0.24 cut trees 31% and the map got no more
  walkable, because thicket went from 159 cells to 183.

  So both numbers move together here. Result across four seeds on a 40x40: 143 trees (down 15%), 119 thicket
  (down 25%), 76% of the interior walkable and 42% of it with room on all four sides for a unit or a chest.

  Every jungle variant inherits it, and the super-dense one is thinned by the same ratio so it stays the
  densest of them. The `dense` REGION comes down with them: it was raising canopy 1.3x, undergrowth 1.45x and
  understory another 1.3x, and the last two compound, so the variants that lean on it (super dense, island,
  ruins) never felt the base cut at all.

  AND THE DENSE WOODLAND, which measuring the jungles turned up. Its rule was already written down, that a
  dense wood must not out-thicket a rainforest, but it was written as "under the jungle's 0.62" and the jungle
  has moved three times since. At 46% of its interior walkable it had quietly become the most impassable
  template in the game, worse than any jungle. It sits at 69% now, between a plain wood and a rainforest,
  which is where the description puts it.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.GeneratorSource

  def up, do: if(generators_present?(), do: GeneratorSource.seed())

  def down do
    # IRREVERSIBLE, and harmless: the previous densities are a re-seed away, from the source at that commit.
    :ok
  end

  defp generators_present?, do: repo().aggregate(from(g in "generators"), :count) > 0
end
