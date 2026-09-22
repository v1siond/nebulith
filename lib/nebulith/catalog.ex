defmodule Nebulith.Catalog do
  @moduledoc """
  The Catalog context.
  """

  import Ecto.Query, warn: false
  alias Nebulith.Repo

  # THE BOX A SOLID TILE OCCUPIES. One shape in the catalog today, the whole cell; a tile gets a real one the
  # day hitboxes are authored (`docs/HITBOXES-AND-ELEVATION.md`).
  @whole_cell [%{"x" => 0, "y" => 0, "w" => 1, "h" => 1}]

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
    # them in (ascii first, the editor's default). Key breaks ties so the order is stable.
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

  The bang version RAISES, which reached the client as an `Ecto.NoResultsError` debug page, HTML, to a
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
    |> Repo.update_all(
      set: [height: height, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
    )
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
        |> Repo.update_all(
          set: [settings: settings, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
        )
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
  Says whether the (tileset_id, label) tile OCCUPIES its cell, by writing its collision box. Pose-safe:
  it touches that one key and nothing else in the map.

  Whether you can walk through a tile is a fact about the LABEL, not about a pose or a size, so it is
  reconciled the same surgical way: a full upsert would `replace_all` the settings and clobber every
  editor-tuned pose on the row. Returns `{updated_count, nil}`.
  """
  def set_tile_solid(tileset_id, label, solid) do
    put_tile_setting(tileset_id, label, "collision", if(solid, do: @whole_cell, else: []))
  end

  @doc """
  Sets ONLY the `image_url` column. Pose-safe, like `set_tile_height`.
  """
  def set_tile_image(tileset_id, label, image_url) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(
      set: [image_url: image_url, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
    )
  end

  @doc """
  Sets the PER-LABEL facts (title + category) of one tile, leaving glyph/height/settings untouched.

  Same pose-safe path as `set_tile_height`: a label owns its name and bucket in every style, and a full
  upsert would `replace_all` the editor-tuned settings alongside them.
  """
  def set_tile_label_facts(tileset_id, label, title, category) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(
      set: [
        title: title,
        category: category,
        updated_at: DateTime.truncate(DateTime.utc_now(), :second)
      ]
    )
  end

  @doc """
  Every ABILITY in the registry, in its declared order (§3.14b #2).
  """
  def list_abilities do
    Repo.all(from(a in Nebulith.Catalog.Ability, order_by: [asc: a.position, asc: a.slug]))
  end

  @doc """
  Every ITEM in the catalog, in its declared order (§3.14b #1, the item catalog moved out of the frontend).
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
    |> Repo.update_all(
      set: [glyph: glyph, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
    )
  end

  @doc """
  Sets ONLY the `category` column of the (tileset_id, label) tile, leaving settings/pose/height untouched.

  Same pose-safe path as `set_tile_height`: a full upsert would `replace_all` and clobber editor-tuned poses,
  so recategorizing a tile (e.g. an animal that belongs in `units`, not `nature`) walks the category column
  alone. Returns `{updated_count, nil}`.
  """
  def set_tile_category(tileset_id, label, category) do
    from(t in Tile, where: t.tileset_id == ^tileset_id and t.label == ^label)
    |> Repo.update_all(
      set: [category: category, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
    )
  end

  @doc """
  Inserts or updates a tile, keyed on (tileset_id, label).

  A SEED ADDS, IT DOES NOT ERASE. The settings a row already carries are kept, and only the keys this call
  actually states are written over. Without that, re-seeding replaced the whole settings map, so every fact
  written after the seed disappeared the next time anything called `seed/0`: a tile-fact rule's, a data
  migration's, and a pose tuned in the editor. It is the same regression over and over, in a different tile
  each time, with nothing in the code having changed.

  A seeder that has to REMOVE a setting removes it, with `delete_tile_setting/3`. Silently dropping every key
  it did not mention is not removal, it is data loss that looks like a render bug.
  """
  def upsert_tile(attrs) do
    %Tile{}
    |> Tile.changeset(attrs |> solidity_as_boxes() |> keep_stored_settings())
    |> Repo.insert(
      on_conflict: {:replace_all_except, [:id, :inserted_at]},
      conflict_target: [:tileset_id, :label]
    )
  end

  # WHAT A TILE OCCUPIES, said once, in the place the fact lives.
  #
  # A seeder row still says whether the thing is solid in the plain word a person would use, and it lands in
  # `settings.collision`: the list of boxes, where an empty list SAYS "nothing solid here" and a missing key
  # only says nobody got round to it. `blocking` was a second switch for the same fact, the docs have had it
  # marked for deletion since the box system landed (`docs/HITBOXES-AND-ELEVATION.md` §3.1), and the column
  # is gone. Translated here rather than left to the changeset, which would drop the unknown field in silence
  # and quietly make every wall walk-through.
  defp solidity_as_boxes(attrs) do
    case {Map.has_key?(attrs, :occupies), Map.has_key?(attrs, "occupies")} do
      {false, false} -> attrs
      _ -> put_boxes(attrs, get_attr(attrs, :occupies))
    end
  end

  defp put_boxes(attrs, solid) do
    boxes = if solid, do: @whole_cell, else: []
    settings = Map.put(get_attr(attrs, :settings) || %{}, "collision", boxes)

    attrs
    |> Map.drop([:occupies, "occupies"])
    |> put_settings_key(settings)
  end

  defp put_settings_key(attrs, settings) when is_map_key(attrs, "label"),
    do: Map.put(attrs, "settings", settings)

  defp put_settings_key(attrs, settings), do: Map.put(attrs, :settings, settings)

  # The stored settings under the incoming ones, so a key nobody mentioned this time survives. A row that does
  # not exist yet has nothing to keep.
  defp keep_stored_settings(attrs) do
    tileset_id = get_attr(attrs, :tileset_id)
    label = get_attr(attrs, :label)
    incoming = get_attr(attrs, :settings) || %{}

    stored =
      Repo.one(
        from(t in Tile,
          where: t.tileset_id == ^tileset_id and t.label == ^label,
          select: t.settings
        )
      )

    put_settings(attrs, stored, incoming)
  end

  defp put_settings(attrs, nil, _incoming), do: attrs

  defp put_settings(attrs, stored, incoming) when is_map_key(attrs, "label"),
    do: Map.put(attrs, "settings", Map.merge(stored, incoming))

  defp put_settings(attrs, stored, incoming),
    do: Map.put(attrs, :settings, Map.merge(stored, incoming))

  defp get_attr(attrs, key), do: Map.get(attrs, key) || Map.get(attrs, to_string(key))

  @doc """
  Removes ONE setting from a tile. Returns `{updated_count, nil}`, like its `put` twin.

  The only way a fact leaves a row, now that a seed keeps what it finds. Same shape as
  `put_tile_setting/4`: read the map, change the one key, write it back, so nothing else in it is touched and
  a tile that does not exist is a no-op rather than an error.
  """
  def delete_tile_setting(tileset_id, label, key) do
    case Repo.get_by(Tile, tileset_id: tileset_id, label: label) do
      nil ->
        {0, nil}

      tile ->
        settings = Map.delete(tile.settings || %{}, key)

        from(t in Tile, where: t.id == ^tile.id)
        |> Repo.update_all(
          set: [settings: settings, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
        )
    end
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
          |> CompositionCell.changeset(
            attrs
            |> occupied_instead_of_walkable()
            |> Map.put(:composition_id, comp.id)
          )
          |> Repo.insert()
      end

      Repo.preload(comp, :cells)
    end)
  end

  @full_cell [%{"x" => 0, "y" => 0, "w" => 1, "h" => 1}]

  @doc false
  # WHAT A CELL OCCUPIES IS THE ONLY STATEMENT about walking through it.
  #
  # `walkable` is authoring sugar and it stops here. The compositions are written by hand and "this
  # doorway is walkable" reads better at the author's end than a box list, but a flag that is STORED and
  # then turned into a box at read time is a second vocabulary whose whole job is to be translated back.
  # The stamp used to do exactly that, a few lines after reading it.
  #
  # So the word is allowed in the authoring map and nowhere else: it is converted at the one door into
  # storage, the way `trunk_settings` converts a species' authoring words into the ones a cell speaks.
  # A cell that states its own collision keeps it, because an authored box list is finer than the flag.
  defp occupied_instead_of_walkable(attrs) do
    {walkable, rest} = Map.pop(attrs, :walkable)
    settings = rest[:settings] || rest["settings"] || %{}

    case {walkable, Map.has_key?(settings, "collision")} do
      {nil, _} -> rest
      {_, true} -> rest
      {true, false} -> Map.put(rest, :settings, Map.put(settings, "collision", []))
      {false, false} -> Map.put(rest, :settings, Map.put(settings, "collision", @full_cell))
    end
  end

  @doc """
  Every generator CATEGORY in menu order, each with its generators (also ordered) preloaded, the
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
    do: Map.merge(base, over, &merge_key/3)

  defp deep_merge(_base, over), do: over

  # A PATHWAY IS SERVED WHOLE, so a subtype that names a different kind gets that kind and nothing of the one
  # it replaced. `city_medieval` says `cobbled_lane` where its parent city says `city_street`, and merged key
  # by key the cobbles inherited the asphalt's white centre line. Every pathway comes out of the one table
  # complete, so there is nothing in it a subtype could have meant to keep.
  defp merge_key("pathway", _base, over), do: over
  defp merge_key(_key, base, over), do: deep_merge(base, over)

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
  Upsert by key, the seed path, so re-seeding never duplicates a layer and never clobbers an edit to a key
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
