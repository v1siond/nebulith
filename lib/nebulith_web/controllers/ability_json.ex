defmodule NebulithWeb.AbilityJSON do
  alias Nebulith.Catalog.Ability

  def index(%{abilities: abilities}), do: %{data: Enum.map(abilities, &data/1)}

  # camelCase out, matching the other catalogs. No colour: the ability's tint is its FX TILE's, resolved by
  # `animation` label, one fact, one owner.
  defp data(%Ability{} = a) do
    %{
      slug: a.slug,
      name: a.name,
      description: a.description,
      category: a.category,
      animation: a.animation,
      cooldownMs: a.cooldown_ms,
      effect: a.effect
    }
  end
end
