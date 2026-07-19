defmodule NebulithWeb.EditorSettingController do
  @moduledoc """
  Editor UI settings — GET the whole key→value store, PUT one key. The backend owns the
  editor's chrome state (a floating panel's position + size), so geometry is never hardcoded
  in the frontend. Returns camelCase JSON (`editorSettings`) the editor expects.
  """
  use NebulithWeb, :controller

  alias Nebulith.Editor
  alias Nebulith.Editor.Setting

  action_fallback NebulithWeb.FallbackController

  def index(conn, _params), do: render(conn, :index, settings: Editor.all_settings())

  def update(conn, %{"key" => key, "value" => value}) do
    with {:ok, %Setting{} = setting} <- Editor.put_setting(key, value) do
      render(conn, :show, setting: setting)
    end
  end
end
