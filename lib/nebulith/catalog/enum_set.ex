defmodule Nebulith.Catalog.EnumSet do
  @moduledoc """
  A LIST A PERSON CAN EXTEND WITHOUT A DEPLOY.

  `docs/SPEC.md` §3.1 draws the line: *"A list the engine must switch on stays in Elixir and is SERVED
  from there. The test is not 'is this list fixed', it is does adding an entry require code."* Enemy
  types, equip slots, weapon kinds and dialog kinds are lists someone adds to. Eases, trigger events and
  directions are lists the engine branches on, and those stay in code.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "enum_sets" do
    field :key, :string
    field :name, :string

    has_many :values, Nebulith.Catalog.EnumValue, preload_order: [asc: :position]

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(set, attrs) do
    set
    |> cast(attrs, [:key, :name])
    |> validate_required([:key, :name])
    |> unique_constraint(:key, name: :enum_sets_key_index)
  end
end
