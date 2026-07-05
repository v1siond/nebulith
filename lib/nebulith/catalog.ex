defmodule Nebulith.Catalog do
  @moduledoc """
  The Catalog context.
  """

  import Ecto.Query, warn: false
  alias Nebulith.Repo

  alias Nebulith.Catalog.Tileset
  alias Nebulith.Catalog.Template

  @doc """
  Returns the list of tilesets.

  ## Examples

      iex> list_tilesets()
      [%Tileset{}, ...]

  """
  def list_tilesets do
    Repo.all(Tileset)
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
end
