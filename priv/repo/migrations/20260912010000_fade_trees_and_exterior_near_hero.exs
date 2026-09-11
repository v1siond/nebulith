defmodule Nebulith.Repo.Migrations.FadeTreesAndExteriorNearHero do
  @moduledoc """
  Trees and the other standing exterior tiles ease see-through as the hero comes close.

  Alexander, 2026-09-11: *"we must add transparency/opacity on all static elements, when user is close, they get
  more transparent. Specially on trees and buildings, and any exterior element that can block us from seeing the
  player character"*. The renderer already fades any tile carrying `fadeNear`; a building's walls, windows and
  doors did, the trees and everything else outside did not.

  Runs `TileSource.ensure_fade_near/0`, which writes only the `fadeNear` key, so editor-tuned poses survive. Only
  on a DB that already has both tilesets: a fresh one gets it from `seed/0`. `down` drops the key from those tiles.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.TileSource

  def up do
    if tilesets_present?(), do: TileSource.ensure_fade_near()
  end

  def down do
    repo().all(from(t in "tiles", select: {t.id, t.label, t.settings}))
    |> Enum.filter(fn {_id, label, settings} -> TileSource.fades_near?(label) and is_map(settings) end)
    |> Enum.each(fn {id, _label, settings} ->
      repo().update_all(from(t in "tiles", where: t.id == ^id), set: [settings: Map.delete(settings, "fadeNear")])
    end)
  end

  defp tilesets_present? do
    repo().aggregate(from(t in "tilesets", where: t.key in ["ascii", "emoji"]), :count) == 2
  end
end
