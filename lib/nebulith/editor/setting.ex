defmodule Nebulith.Editor.Setting do
  @moduledoc """
  One editor UI setting — a stable `key` (a modal id like "settings"/"animation"/"triggers")
  mapped to an opaque JSON `value` (a floating panel's `{x,y,w,h}` geometry today). The `value`
  uses `Nebulith.EctoJSON` so any already-decoded JSON term round-trips unchanged.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  schema "editor_settings" do
    field :key, :string
    field :value, Nebulith.EctoJSON

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(setting, attrs) do
    setting
    |> cast(attrs, [:key, :value])
    |> validate_required([:key, :value])
    |> unique_constraint(:key)
  end
end
