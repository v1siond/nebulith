defmodule Nebulith.Catalog.Template do
  @moduledoc """
  A saved game stage/template. Maps the EXISTING shared-DB `"Template"` table (originally created by the
  frontend's Prisma migrations) — so this is a schema-only mapping, NOT a create-table. The table name and
  columns are Prisma's exact camelCase identifiers (Postgres-quoted), the primary key is a text id, and the
  timestamps are the camelCase `createdAt`/`updatedAt` naive-datetime columns.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :string, autogenerate: false}
  schema "Template" do
    field :name, :string
    field :description, :string
    field :category, :string, default: "custom"
    field :cols, :integer, default: 50
    field :rows, :integer, default: 50
    field :cellSize, :integer, default: 16
    field :isoScale, :float, default: 2.5
    field :spawnCol, :integer, default: 25
    field :spawnRow, :integer, default: 25
    field :groundData, Nebulith.EctoJSON
    field :heightData, Nebulith.EctoJSON
    field :assetsData, Nebulith.EctoJSON
    field :thumbnail, :string
    field :isPublic, :boolean, default: false
    field :tags, {:array, :string}, default: []
    field :authorId, :string
    field :connectors, Nebulith.EctoJSON, default: []
    field :entities, Nebulith.EctoJSON, default: []
    field :quests, Nebulith.EctoJSON, default: []

    timestamps(inserted_at: :createdAt, updated_at: :updatedAt, type: :naive_datetime)
  end

  @castable ~w(id name description category cols rows cellSize isoScale spawnCol spawnRow
               groundData heightData assetsData thumbnail isPublic tags authorId
               connectors entities quests)a

  @doc false
  def changeset(template, attrs) do
    template
    |> cast(attrs, @castable)
    |> validate_required([:id, :name, :groundData, :heightData, :assetsData])
  end
end
