defmodule Nebulith.CatalogTest do
  use Nebulith.DataCase

  alias Nebulith.Catalog

  describe "tilesets" do
    alias Nebulith.Catalog.Tileset

    import Nebulith.CatalogFixtures

    @invalid_attrs %{data: nil, name: nil, key: nil}

    test "list_tilesets/0 returns all tilesets" do
      tileset = tileset_fixture()
      assert Catalog.list_tilesets() == [tileset]
    end

    test "get_tileset!/1 returns the tileset with given id" do
      tileset = tileset_fixture()
      assert Catalog.get_tileset!(tileset.id) == tileset
    end

    test "create_tileset/1 with valid data creates a tileset" do
      valid_attrs = %{data: %{}, name: "some name", key: "some key"}

      assert {:ok, %Tileset{} = tileset} = Catalog.create_tileset(valid_attrs)
      assert tileset.data == %{}
      assert tileset.name == "some name"
      assert tileset.key == "some key"
    end

    test "create_tileset/1 with invalid data returns error changeset" do
      assert {:error, %Ecto.Changeset{}} = Catalog.create_tileset(@invalid_attrs)
    end

    test "update_tileset/2 with valid data updates the tileset" do
      tileset = tileset_fixture()
      update_attrs = %{data: %{}, name: "some updated name", key: "some updated key"}

      assert {:ok, %Tileset{} = tileset} = Catalog.update_tileset(tileset, update_attrs)
      assert tileset.data == %{}
      assert tileset.name == "some updated name"
      assert tileset.key == "some updated key"
    end

    test "update_tileset/2 with invalid data returns error changeset" do
      tileset = tileset_fixture()
      assert {:error, %Ecto.Changeset{}} = Catalog.update_tileset(tileset, @invalid_attrs)
      assert tileset == Catalog.get_tileset!(tileset.id)
    end

    test "delete_tileset/1 deletes the tileset" do
      tileset = tileset_fixture()
      assert {:ok, %Tileset{}} = Catalog.delete_tileset(tileset)
      assert_raise Ecto.NoResultsError, fn -> Catalog.get_tileset!(tileset.id) end
    end

    test "change_tileset/1 returns a tileset changeset" do
      tileset = tileset_fixture()
      assert %Ecto.Changeset{} = Catalog.change_tileset(tileset)
    end
  end
end
