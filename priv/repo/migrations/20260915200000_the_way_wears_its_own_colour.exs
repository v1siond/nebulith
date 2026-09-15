defmodule Nebulith.Repo.Migrations.TheWayWearsItsOwnColour do
  @moduledoc """
  THE COLOUR A WAY WEARS BELONGS TO THE PATHWAY, NOT TO THE TEMPLATE'S PALETTE.

  It was in both, and the palette won. So a mountain forest that asks for `rocky_track` had its gravel
  painted the woodland's dirt, a swamp that asks for `boardwalk` had its planks painted the jungle's dirt,
  and a meadow, whose palette states no trail at all, had its park path fall through to the raw tile and come
  out 45 points DARKER than the lawn it crosses. Every one of those is a template stating what its way is
  made of and being overruled by something it inherited.

  Every kind in `@pathways` now carries a `tone`, measured off that kind's own stored reference, and the
  three palettes that carried a `trail` no longer do. The city street also carries its `marking`, which is
  the white centre line: *"ALL WE NEEDED WAS TO ADD THE WHITE RECTANGULAR LINES IN MIDDLE AS ORNAMENT"*.
  """
  use Ecto.Migration

  alias Nebulith.Catalog.GeneratorSource

  def up, do: if(generators_present?(), do: GeneratorSource.seed())

  def down, do: :ok

  defp generators_present? do
    %{rows: [[count]]} = repo().query!("SELECT count(*) FROM generators")
    count > 0
  end
end
