defmodule NebulithWeb.EntityJSON do
  @doc """
  Renders the entity resolution map.

  The keys are emitted in the camelCase the frontend reads directly
  (`enemyTypeSlug`/`variantSlug`) — the same pass-through convention
  `TilesetJSON` uses for `zIndex` — so the loader installs the payload verbatim.
  """
  def index(%{resolution: resolution}) do
    %{
      data: %{
        dir: resolution.dir,
        tiles: resolution.tiles,
        enemyTypeSlug: resolution.enemy_type_slug,
        variantSlug: resolution.variant_slug
      }
    }
  end
end
