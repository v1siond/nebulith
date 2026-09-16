defmodule Nebulith.DataMigration.FlatDecorStacksAtTheBottomFace do
  @moduledoc """
  The flat `decor_*` ornaments stack at the BOTTOM face of their cell, like every other low growing tile.

  `stackAt` is the y stack position, running from the top face of a cell to the bottom face: it says where
  the NEXT thing in the cell starts. Left unsaid it is 1, the top face, so anything placed in the same cell
  begins a whole block up. That is correct for a wall and wrong for a bloom lying on the ground: a tree
  sharing a cell with one was lifted clear of the floor and drew above it.

  Every other low growing tile already says 0: flower, rose, blossom, clover, shrub, bush, tall_grass and
  water_still. The eleven flat ornaments the ground cover pass places are the ones that never did.

  With them at 0 a tree in a flowered cell stands on the floor and draws over the bloom, which keeps the
  flower visible underneath it rather than carrying it.

  Idempotent: matches only the flat decor tiles that do not already carry a stackAt.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{num_rows: count} =
      Repo.query!(
        """
        UPDATE tiles
        SET settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{stackAt}', '0'::jsonb)
        WHERE label LIKE 'decor\\_%'
          AND height = 0
          AND NOT (coalesce(settings, '{}'::jsonb) ? 'stackAt')
        """
      )

    Logger.info("[data_migrate] flat decor stacks at the bottom face (#{count} tiles)")
    :ok
  end
end
