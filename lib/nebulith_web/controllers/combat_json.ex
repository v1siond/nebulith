defmodule NebulithWeb.CombatJSON do
  alias Nebulith.Catalog.EnemyArchetype

  @doc """
  The whole combat catalog: every archetype in menu order, plus the rule bundles keyed by name.

  camelCase on the way out, matching every other endpoint here, so the frontend reads one shape.
  """
  def index(%{archetypes: archetypes, rules: rules}) do
    %{data: %{archetypes: Enum.map(archetypes, &archetype/1), rules: rules}}
  end

  defp archetype(%EnemyArchetype{} = a) do
    %{
      key: a.key,
      name: a.name,
      stats: a.stats,
      moveDelayMs: a.move_delay_ms,
      reachCells: a.reach_cells,
      attack: a.attack,
      position: a.position
    }
  end
end
