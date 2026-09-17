defmodule NebulithWeb.ItemJSON do
  alias Nebulith.Catalog.Item

  @doc "Every item, in catalog order."
  def index(%{items: items}), do: %{data: Enum.map(items, &data/1)}

  # camelCase on the way out, matching the tileset payload, the frontend's `Item` shape reads
  # `baseDamage` / `defenseBonus`, and `stats` is passed through verbatim because it IS that block.
  defp data(%Item{} = item) do
    %{
      slug: item.slug,
      name: item.name,
      slot: item.slot,
      kind: item.kind,
      stats: item.stats,
      starterKits: item.starter_kits
    }
  end
end
