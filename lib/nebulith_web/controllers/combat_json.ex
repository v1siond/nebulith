defmodule NebulithWeb.CombatJSON do
  @doc """
  The fight's rule bundles, keyed by name.

  No creature roster: a creature's stat block lives on its own tile row and is served with the tileset.
  """
  def index(%{rules: rules}), do: %{data: %{rules: rules}}
end
