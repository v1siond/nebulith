defmodule Nebulith.EctoJSON do
  @moduledoc """
  Ecto type for opaque JSON(B) blobs that may be a MAP or a LIST.

  The Template table (owned originally by the frontend, shared DB) stores several `jsonb` columns whose
  top-level value is an ARRAY — `groundData` (`string[][]`), `heightData` (`number[][]`), `assetsData`
  (`object[]`), `connectors`/`entities`/`quests` (`object[]`). Ecto's built-in `:map` type rejects lists,
  so we use this pass-through type: it declares the column as `jsonb` (`type/0 == :map`) but casts / loads /
  dumps ANY already-decoded JSON term unchanged. Postgrex's jsonb codec handles both maps and lists.
  """
  use Ecto.Type

  def type, do: :map
  def cast(value), do: {:ok, value}
  def load(value), do: {:ok, value}
  def dump(value), do: {:ok, value}
  def embed_as(_format), do: :self
  def equal?(a, b), do: a == b
end
