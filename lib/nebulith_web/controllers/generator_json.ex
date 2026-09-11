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
      # WHICH ARCHETYPE to run. The editor used to send the category key; a category holds two kinds now.
      variant: g.variant,
      zones: g.zones,
      position: g.position,
      config: g.config,
      # What a person may switch on for this generator — a variation is an option, not another row.
      options: g.options,
      # Its SUBTYPES, same shape, any depth — *"forest > type of forest > sub type of type of forest"*. Each
      # already carries its parent's config merged under its own.
      children: for(c <- g.children, do: generator(c))
    }
  end
end
