defmodule Nebulith.Repo.Migrations.APathwayIsAMaterialNotATint do
  @moduledoc """
  Every template says what its pathway is made of, how wide it runs, how ragged its edge is, what lies on it
  and what stands beside it.

  *"we need better pathways definitions on all templates too, here's what I expect"*, with nine isometric
  references, and *"we need the same variance for towns, we need towns with rustic pathways, street pathways,
  etc based of their specific characteristics"*.

  Measured on a 40x40 before this. A woodland trail swapped the ground to the flat floor tile and tinted it.
  A meadow and a jungle did not even do that: their pathways were the SAME `meadow` ground as the field
  beside them, wearing a different colour. And every template was 3 cells across, because the width was a
  constant in the ENGINE, so a beach lane, a rainforest machete trail and a city street were one rectangle in
  three colours.

  Ten kinds of way now, each built from labels the tilesets already serve: a forest track of pale dirt, a
  gravel track for rocky ground, a park path, a cut trail two cells wide through undergrowth, a winding coast
  path, a plank boardwalk, a village lane of stone, cobbles, a four lane seafront street and a sandy town
  track. A town's `settlement.streets` is now read off the same block rather than repeated beside it, so the
  two cannot drift.
  """
  use Ecto.Migration

  import Ecto.Query

  alias Nebulith.Catalog.GeneratorSource

  def up, do: if(generators_present?(), do: GeneratorSource.seed())

  def down, do: :ok

  defp generators_present?, do: repo().aggregate(from(g in "generators"), :count) > 0
end
