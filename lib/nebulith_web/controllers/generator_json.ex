defmodule NebulithWeb.GeneratorJSON do
  alias Nebulith.Catalog.{Generator, GeneratorCategory}

  @doc "The whole catalog: categories in menu order, each carrying its generators."
  def index(%{categories: categories}), do: %{data: for(c <- categories, do: category(c))}

  defp category(%GeneratorCategory{} = c) do
    %{
      key: c.key,
      name: c.name,
      description: c.description,
      position: c.position,
      generators: for(g <- c.generators, do: generator(g))
    }
  end

  defp generator(%Generator{} = g) do
    %{
      key: g.key,
      name: g.name,
      description: g.description,
      layout: g.layout,
      zones: g.zones,
      position: g.position,
      config: g.config
    }
  end
end
