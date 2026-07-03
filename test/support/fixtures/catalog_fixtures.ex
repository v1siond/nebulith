defmodule Nebulith.CatalogFixtures do
  @moduledoc """
  This module defines test helpers for creating
  entities via the `Nebulith.Catalog` context.
  """

  @doc """
  Generate a unique tileset key.
  """
  def unique_tileset_key, do: "some key#{System.unique_integer([:positive])}"

  @doc """
  Generate a tileset.
  """
  def tileset_fixture(attrs \\ %{}) do
    {:ok, tileset} =
      attrs
      |> Enum.into(%{
        data: %{},
        key: unique_tileset_key(),
        name: "some name"
      })
      |> Nebulith.Catalog.create_tileset()

    tileset
  end
end
