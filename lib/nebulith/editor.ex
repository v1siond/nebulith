defmodule Nebulith.Editor do
  @moduledoc """
  The Editor context — backend-owned editor UI settings as a small key→value store.

  A `key` is a stable modal id ("settings"/"animation"/"triggers"); the `value` is an opaque
  JSON blob (a floating panel's `{x,y,w,h}` geometry today). There's no per-user auth in the
  editor, so one global record per key IS the whole store: `all_settings/0` loads it on mount,
  `put_setting/2` upserts one key as the user moves/resizes a panel.
  """
  import Ecto.Query, warn: false
  alias Nebulith.Repo
  alias Nebulith.Editor.Setting

  @doc "Every setting as a `key => value` map — what the editor loads once on mount."
  def all_settings do
    Repo.all(Setting) |> Map.new(fn s -> {s.key, s.value} end)
  end

  @doc "Upsert one setting by key — insert on first write, replace the value on later writes."
  def put_setting(key, value) when is_binary(key) do
    (Repo.get_by(Setting, key: key) || %Setting{})
    |> Setting.changeset(%{key: key, value: value})
    |> Repo.insert_or_update()
  end
end
