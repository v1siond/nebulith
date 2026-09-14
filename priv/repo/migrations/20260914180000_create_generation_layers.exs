defmodule Nebulith.Repo.Migrations.CreateGenerationLayers do
  @moduledoc """
  The generation layers, as rows.

  They were a hardcoded list in the engine AND a second hardcoded list in the editor panel, which had to be
  kept in step by hand. His instruction: *"I think these layers should be backend based … I just don't want
  anything hardcoded on the frontend … we're also hardcoding on the actual engine, that's where we need to
  update it"*.

  `position` is the ORDER generation runs in, and it is the whole point of the table: a layer is not a name in
  a set, it is a step at a place in a sequence.
  """
  use Ecto.Migration

  def change do
    create table(:generation_layers, primary_key: false) do
      add :id, :binary_id, primary_key: true
      add :key, :string, null: false
      add :label, :string, null: false
      add :hint, :text
      add :position, :integer, null: false, default: 0
      add :seedable, :boolean, null: false, default: true

      timestamps(type: :utc_datetime)
    end

    create unique_index(:generation_layers, [:key])
    create index(:generation_layers, [:position])
  end
end
