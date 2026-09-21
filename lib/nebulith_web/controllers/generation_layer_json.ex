defmodule NebulithWeb.GenerationLayerJSON do
  alias Nebulith.Catalog.GenerationLayer

  @doc "Every layer, in run order, under `generationLayers`."
  def index(%{layers: layers}), do: %{generationLayers: Enum.map(layers, &data/1)}

  @doc "One layer."
  def show(%{layer: %GenerationLayer{} = layer}), do: %{generationLayer: data(layer)}

  defp data(%GenerationLayer{} = l) do
    %{
      key: l.key,
      label: l.label,
      hint: l.hint,
      position: l.position,
      seedable: l.seedable,
      group: l.group
    }
  end
end
