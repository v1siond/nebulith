defmodule NebulithWeb.ZoneJSON do
  alias Nebulith.Catalog.Zone

  @doc "Every season in menu order, each carrying its whole look."
  def index(%{zones: zones}), do: %{data: Enum.map(zones, &zone/1)}

  defp zone(%Zone{} = z) do
    %{
      key: z.key,
      name: z.name,
      position: z.position,
      palette: z.palette,
      tiles: z.tiles,
      flowers: z.flowers,
      temple: z.temple,
      cave: z.cave
    }
  end
end
