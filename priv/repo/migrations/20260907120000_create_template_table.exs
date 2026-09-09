defmodule Nebulith.Repo.Migrations.CreateTemplateTable do
  use Ecto.Migration

  @moduledoc """
  Adopt the `"Template"` table — the last orphan of the Prisma era.

  Prisma originally created it (`prisma/migrations/20260524202028_init`), nebulith mapped it
  read/write in `Nebulith.Catalog.Template`, and then game-website deleted Prisma wholesale
  (`0e3eba9` "remove ALL prisma"). That left the table owned by NOBODY: no migration in either
  repo could recreate it, so any fresh database came up with `/api/templates` 500ing on
  `relation "Template" does not exist` — which is exactly what happened when this machine's
  postgres volume was reset.

  This migration is that missing DDL, recovered from the deleted Prisma migration and reconciled
  against the live Ecto schema (`connectors`, `entities` and `quests` never had a migration at all
  — they arrived via `prisma db push`). Identifiers stay Prisma's quoted camelCase because the Ecto
  schema maps them verbatim and existing databases already hold them that way.

  `create_if_not_exists`: on every machine that still has the Prisma-made table this is a no-op, so
  the two histories converge instead of colliding.
  """

  def change do
    create_if_not_exists table("Template", primary_key: false) do
      add :id, :text, primary_key: true
      add :name, :text, null: false
      add :description, :text
      add :category, :text, null: false, default: "custom"

      # Grid configuration
      add :cols, :integer, null: false, default: 50
      add :rows, :integer, null: false, default: 50
      add :cellSize, :integer, null: false, default: 16
      add :isoScale, :float, null: false, default: 2.5

      # Spawn point
      add :spawnCol, :integer, null: false, default: 25
      add :spawnRow, :integer, null: false, default: 25

      # Serialised grid data. jsonb holding ARRAYS (2D ground/height grids, a list of assets) —
      # `:map` is Ecto's name for the jsonb column type, not a claim about the shape inside.
      add :groundData, :map, null: false
      add :heightData, :map, null: false
      add :assetsData, :map, null: false

      # Authored contents of the room. Prisma never migrated these three — they were pushed.
      add :connectors, :map, null: false, default: fragment("'[]'::jsonb")
      add :entities, :map, null: false, default: fragment("'[]'::jsonb")
      add :quests, :map, null: false, default: fragment("'[]'::jsonb")

      # Metadata
      add :thumbnail, :text
      add :isPublic, :boolean, null: false, default: false
      add :tags, {:array, :text}, default: []

      # Ownership. Deliberately NOT a reference: the Prisma-owned "User" table went with Prisma,
      # and the schema only ever reads this as a plain string.
      add :authorId, :text

      # Prisma's millisecond timestamps, kept so a database written by either history reads the same.
      add :createdAt, :"timestamp(3)", null: false, default: fragment("CURRENT_TIMESTAMP")
      add :updatedAt, :"timestamp(3)", null: false, default: fragment("CURRENT_TIMESTAMP")
    end
  end
end
