defmodule NebulithWeb.EditorSettingJSON do
  alias Nebulith.Editor.Setting

  @doc "The whole store as a `key => value` map under `editorSettings` (loaded once on mount)."
  def index(%{settings: settings}), do: %{editorSettings: settings}

  @doc "One upserted setting — its key + stored value."
  def show(%{setting: %Setting{} = setting}), do: %{key: setting.key, value: setting.value}
end
