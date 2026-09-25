defmodule Nebulith.Catalog.EnumValue do
  @moduledoc "One entry in an `Nebulith.Catalog.EnumSet`, in the order the panel shows it."
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "enum_values" do
    field :key, :string
    field :name, :string
    field :position, :integer, default: 0

    belongs_to :enum_set, Nebulith.Catalog.EnumSet

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(value, attrs) do
    value
    |> cast(attrs, [:enum_set_id, :key, :name, :position])
    |> validate_required([:enum_set_id, :key, :name])
    |> unique_constraint([:enum_set_id, :key], name: :enum_values_key_index)
  end
end
