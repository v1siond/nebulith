defmodule Nebulith.Repo.Migrations.ATownGatewayIsNotABlackHole do
  @moduledoc """
  The dark mouth under an entrance arch becomes opt-in, and a town's gateway no longer has one.

  *"WHAT IS THIS SHIT EXIT?"*, with a picture of a black diamond lying on a town square, and before that
  *"still not good, remove the black entrance"*. Twice.

  It was a `path_stone` cell coloured `#0d0d12` at `scaleY: 0.06`, a near-black stain on the paving under
  every arch, defended by an early quote asking for *"a whuite or dark light right in the exit cells"*. A CAVE
  mouth is dark because a cave is dark; a built town gateway is not, and painting one black is a hole in the
  square.

  The `light` that rode with it is dropped too. `drawNightLighting` is the only thing that draws a light
  setting, so on a day map all it ever contributed was the black.

  The cave keeps its mouth, by asking for it.
  """
  use Ecto.Migration

  def up do
    Nebulith.Catalog.TileSource.seed_entrances()
    Nebulith.Catalog.TileSource.seed_approved_entrances()
  end

  def down, do: :ok
end
