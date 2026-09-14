defmodule Nebulith.Catalog do
  @moduledoc """
  The Catalog context.
  """

  import Ecto.Query, warn: false
  alias Nebulith.Repo

  alias Nebulith.Catalog.Tileset
  alias Nebulith.Catalog.Template
  alias Nebulith.Catalog.{Tile, Composition, CompositionCell}
  alias Nebulith.Catalog.{Generator, GeneratorCategory}
  alias Nebulith.Catalog.GenerationLayer

  @doc """
  Returns the list of tilesets.

  ## Examples

      iex> list_tilesets()
      [%Tileset{}, ...]

  """
  def list_tilesets do
    # In PICKER order: a tileset row is an art style, and `position` is the order the style picker shows
    # them in (ascii first — the editor's default). Key breaks ties so the order is stable.
    Repo.all(from(t in Tileset, order_by: [asc: t.position, asc: t.key]))
  end

  @doc """
  Gets a single tileset.

  Raises `Ecto.NoResultsError` if the Tileset does not exist.

  ## Examples

      iex> get_tileset!(123)
      %Tileset{}

      iex> get_tileset!(456)
      ** (Ecto.NoResultsError)

  """
  def get_tileset!(id), do: Repo.get!(Tileset, id)

  @doc """
  Creates a tileset.

  ## Examples

      iex> create_tileset(%{field: value})
      {:ok, %Tileset{}}

      iex> create_tileset(%{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def create_tileset(attrs) do
    %Tileset{}
    |> Tileset.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Updates a tileset.

  ## Examples

      iex> update_tileset(tileset, %{field: new_value})
      {:ok, %Tileset{}}

      iex> update_tileset(tileset, %{field: bad_value})
      {:error, %Ecto.Changeset{}}

  """
  def update_tileset(%Tileset{} = tileset, attrs) do
    tileset
    |> Tileset.changeset(attrs)
    |> Repo.update()
  end

  @doc """
  Deletes a tileset.

  ## Examples

      iex> delete_tileset(tileset)
      {:ok, %Tileset{}}

      iex> delete_tileset(tileset)
      {:error, %Ecto.Changeset{}}

  """
  def delete_tileset(%Tileset{} = tileset) do
    Repo.delete(tileset)
  end

  @doc """
  Returns an `%Ecto.Changeset{}` for tracking tileset changes.

  ## Examples

      iex> change_tileset(tileset)
      %Ecto.Changeset{data: %Tileset{}}

  """
  def change_tileset(%Tileset{} = tileset, attrs \\ %{}) do
    Tileset.changeset(tileset, attrs)
  end

  # ── Templates (saved game stages) ─────────────────────────────────────────
  # Mirrors the tileset CRUD. Maps the existing shared-DB "Template" table.

  @doc """
  Lists templates newest-first, optionally filtered by `category`, with `limit`/`offset` paging.
  Returns `{templates, total}` where `total` is the unpaged count (for the gallery pager).
  """
  def list_templates(category \\ nil, limit \\ 50, offset \\ 0) do
    query = from(t in Template, order_by: [desc: t.updatedAt])
    query = if category, do: where(query, [t], t.category == ^category), else: query
    total = Repo.aggregate(query, :count, :id)
    templates = query |> limit(^limit) |> offset(^offset) |> Repo.all()
    {templates, total}
  end

  @doc "Gets a single template. Raises `Ecto.NoResultsError` if it does not exist."
  def get_template!(id), do: Repo.get!(Template, id)

  @doc """
  A saved map by id, or `{:error, :not_found}`.

  The bang version RAISES, which reached the client as an `Ecto.NoResultsError` debug page — HTML, to a
  caller that asked for JSON. `FallbackController` has had a `{:error, :not_found}` clause all along; this
  is what lets a controller reach it. A missing map is an ordinary answer to an ordinary question, not an
  exception.
  """
  def get_template(id) do
    case Repo.get(Template, id) do
      nil -> {:error, :not_found}
      %Template{} = template -> {:ok, template}
    end
  end

  @doc "Creates a template. Generates a text id when the caller does not supply one."
  def create_template(attrs) do
    attrs = Map.put_new(attrs, "id", Ecto.UUID.generate())

    %Template{}
    |> Template.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Updates a template from a partial attrs map (only supplied keys change)."
  def update_template(%Template{} = template, attrs) do
    template
    |> Template.changeset(attrs)
    |> Repo.update()
  end

  @doc "Deletes a template."
  def delete_template(%Template{} = template), do: Repo.delete(template)

  # ── Tiles + Compositions (backend-owned tile catalog) ─────────────────────

  @doc "Lists tiles belonging to the tileset identified by its `key`."
  def list_tiles_for(tileset_key) do
    from(t in Tile, join: ts in Tileset, on: ts.id == t.tileset_id, where: ts.key == ^tileset_key)
    |> Repo.all()
  end

  @doc """
  Sets ONLY the `height` column of the (tileset_id, label) tile, leaving settings/pose untouched.

  Used to reconcile drifted block heights without a full upsert (which would `replace_all` the
  settings and clobber editor-tuned poses). Returns `{updated_count, nil}`.
  """
  def set_tile_height(tileset_id, label, height) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(set: [height: height, updated_at: DateTime.truncate(DateTime.utc_now(), :second)])
  end

  @doc """
  Merges ONE key into a tile's `settings` blob, leaving every other key alone.

  The settings map carries editor-tuned poses and per-view sizes; a full upsert would `replace_all` them, so
  adding a fact about a tile (its `unitRole`, say) reads-modifies-writes just that key.
  """
  def put_tile_setting(tileset_id, label, key, value) do
    case Repo.get_by(Tile, tileset_id: tileset_id, label: label) do
      nil ->
        {0, nil}

      tile ->
        settings = Map.put(tile.settings || %{}, key, value)

        from(t in Tile, where: t.id == ^tile.id)
        |> Repo.update_all(set: [settings: settings, updated_at: DateTime.truncate(DateTime.utc_now(), :second)])
    end
  end

  @doc """
  Deletes the (tileset_id, label) tiles by label. Returns `{deleted_count, nil}`.

  A label that no longer exists in the vocabulary has to LEAVE the catalog, or the 1:1 style-parity tests and
  the editor's tile library keep serving art nothing draws.
  """
  def delete_tiles_by_label(tileset_id, labels) when is_list(labels) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label in ^labels)
    |> Repo.delete_all()
  end

  @doc """
  Sets ONLY the `blocking` column of the (tileset_id, label) tile. Pose-safe, like `set_tile_height`.

  Whether you can walk through a tile is a fact about the LABEL, not about a pose or a size, so it is
  reconciled the same surgical way: a full upsert would `replace_all` the settings and clobber every
  editor-tuned pose on the row. Returns `{updated_count, nil}`.
  """
  def set_tile_blocking(tileset_id, label, blocking) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(set: [blocking: blocking, updated_at: DateTime.truncate(DateTime.utc_now(), :second)])
  end

  @doc """
  Sets ONLY the `image_url` column. Pose-safe, like `set_tile_height`.
  """
  def set_tile_image(tileset_id, label, image_url) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(set: [image_url: image_url, updated_at: DateTime.truncate(DateTime.utc_now(), :second)])
  end

  @doc """
  Sets the PER-LABEL facts (title + category) of one tile, leaving glyph/height/settings untouched.

  Same pose-safe path as `set_tile_height`: a label owns its name and bucket in every style, and a full
  upsert would `replace_all` the editor-tuned settings alongside them.
  """
  def set_tile_label_facts(tileset_id, label, title, category) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(
      set: [title: title, category: category, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
    )
  end

  @doc """
  Every ABILITY in the registry, in its declared order (§3.14b #2).
  """
  def list_abilities do
    Repo.all(from(a in Nebulith.Catalog.Ability, order_by: [asc: a.position, asc: a.slug]))
  end

  @doc """
  Every ITEM in the catalog, in its declared order (§3.14b #1 — the item catalog moved out of the frontend).
  """
  def list_items do
    Repo.all(from(i in Nebulith.Catalog.Item, order_by: [asc: i.position, asc: i.slug]))
  end

  @doc """
  Sets ONLY the `glyph` column of the (tileset_id, label) tile.

  Same pose-safe path as `set_tile_height`: the glyph is the one thing an ascii tile's baked picture is
  rasterised from, and a full upsert would `replace_all` the editor-tuned `settings` alongside it.
  Returns `{updated_count, nil}`.
  """
  def set_tile_glyph(tileset_id, label, glyph) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(set: [glyph: glyph, updated_at: DateTime.truncate(DateTime.utc_now(), :second)])
  end

  @doc """
  Sets ONLY the `category` column of the (tileset_id, label) tile, leaving settings/pose/height untouched.

  Same pose-safe path as `set_tile_height`: a full upsert would `replace_all` and clobber editor-tuned poses,
  so recategorizing a tile (e.g. an animal that belongs in `units`, not `nature`) walks the category column
  alone. Returns `{updated_count, nil}`.
  """
  def set_tile_category(tileset_id, label, category) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(set: [category: category, updated_at: DateTime.truncate(DateTime.utc_now(), :second)])
  end

  @doc "Inserts or updates a tile, keyed on (tileset_id, label)."
  def upsert_tile(attrs) do
    %Tile{}
    |> Tile.changeset(attrs)
    |> Repo.insert(
      on_conflict: {:replace_all_except, [:id, :inserted_at]},
      conflict_target: [:tileset_id, :label]
    )
  end

  @doc "Lists all compositions with their cells preloaded."
  def list_compositions do
    Composition |> Repo.all() |> Repo.preload(:cells)
  end

  @doc "Upserts a composition and replaces its cells with the given list."
  def upsert_composition_with_cells(comp_attrs, cell_attrs_list) do
    Repo.transaction(fn ->
      {:ok, comp} =
        %Composition{}
        |> Composition.changeset(comp_attrs)
        |> Repo.insert(
          on_conflict: {:replace_all_except, [:id, :inserted_at]},
          conflict_target: [:name]
        )

      Repo.delete_all(from c in CompositionCell, where: c.composition_id == ^comp.id)

      for attrs <- cell_attrs_list do
        {:ok, _} =
          %CompositionCell{}
          |> CompositionCell.changeset(Map.put(attrs, :composition_id, comp.id))
          |> Repo.insert()
      end

      Repo.preload(comp, :cells)
    end)
  end
  @doc """
  Every generator CATEGORY in menu order, each with its generators (also ordered) preloaded — the
  one read `/api/generators` serves. Ordering is data (`position`), never the insertion order or an
  alphabetical accident, so the editor's map-type menu is authored here.
  """
  def list_generator_categories do
    generators = from(g in Generator, order_by: [asc: g.position, asc: g.key])

    Repo.all(
      from(c in GeneratorCategory,
        order_by: [asc: c.position, asc: c.key],
        preload: [generators: ^generators]
      )
    )
    |> Enum.map(fn category -> %{category | generators: generator_tree(category.generators)} end)
  end

  # The generators as a TREE, top-level types first with their subtypes nested under them, any depth.
  #
  # Each subtype serves its parent's config merged UNDER its own, so every level arrives ready to run and the
  # frontend never reconstructs one. A subtype states only what makes it different (a beech stand is a
  # woodland with a different formation and species); everything else is inherited. Options inherit the same
  # way unless a subtype states its own.
  defp generator_tree(flat) do
    by_parent = Enum.group_by(flat, & &1.parent_id)

    grow = fn grow, parent_id, inherited ->
      for g <- Map.get(by_parent, parent_id, []) do
        node = %{
          g
          | config: deep_merge(inherited.config, g.config || %{}),
            options: if(g.options in [nil, []], do: inherited.options, else: g.options),
            # A subtype of a town is still a town: the archetype inherits like everything else, so a
            # variation states only what makes it look different.
            variant: g.variant || inherited.variant
        }

        %{node | children: grow.(grow, g.id, node)}
      end
    end

    grow.(grow, nil, %{config: %{}, options: [], variant: nil})
  end

  # Maps merge key by key, recursively; anything else (a list, a number) is REPLACED by the subtype's value.
  # A subtype's tree mix replaces its parent's rather than being appended to it, which is the point of it.
  defp deep_merge(base, over) when is_map(base) and is_map(over),
    do: Map.merge(base, over, fn _k, a, b -> deep_merge(a, b) end)

  defp deep_merge(_base, over), do: over
  # ── GENERATION LAYERS ──────────────────────────────────────────────────────────────────────────────────
  # The stack generation runs in, as data. The engine binds a pass to each `key`; the editor builds its
  # re-roll panel from the same list, so adding a layer is a row rather than an edit in two repos.

  @doc "Every generation layer, in the order generation runs them."
  def list_generation_layers do
    Repo.all(from l in GenerationLayer, order_by: [asc: l.position, asc: l.key])
  end

  @doc "One layer by its key, or nil."
  def get_generation_layer(key) when is_binary(key), do: Repo.get_by(GenerationLayer, key: key)

  @doc "Create a layer."
  def create_generation_layer(attrs) do
    %GenerationLayer{} |> GenerationLayer.changeset(attrs) |> Repo.insert()
  end

  @doc "Update a layer."
  def update_generation_layer(%GenerationLayer{} = layer, attrs) do
    layer |> GenerationLayer.changeset(attrs) |> Repo.update()
  end

  @doc "Delete a layer."
  def delete_generation_layer(%GenerationLayer{} = layer), do: Repo.delete(layer)

  @doc """
  Upsert by key — the seed path, so re-seeding never duplicates a layer and never clobbers an edit to a key
  that is already there with something the code happens to say today.
  """
  def upsert_generation_layer(attrs) do
    attrs = Map.new(attrs, fn {k, v} -> {to_string(k), v} end)

    case get_generation_layer(attrs["key"]) do
      nil -> create_generation_layer(attrs)
      layer -> update_generation_layer(layer, attrs)
    end
  end

end
