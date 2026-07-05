defmodule NebulithWeb.TemplateController do
  @moduledoc """
  CRUD for saved game stages/templates. Reads FLAT JSON bodies and returns the exact shapes the game
  editor's client (`lib/api.ts`) already expects — a `{templates, total, limit, offset}` list, a bare
  object for show/create/update, and `{success, id}` for delete — so the frontend only changes its base URL.
  """
  use NebulithWeb, :controller

  alias Nebulith.Catalog
  alias Nebulith.Catalog.Template

  action_fallback NebulithWeb.FallbackController

  def index(conn, params) do
    category = blank_to_nil(params["category"])
    limit = to_int(params["limit"], 50)
    offset = to_int(params["offset"], 0)
    {templates, total} = Catalog.list_templates(category, limit, offset)
    render(conn, :index, templates: templates, total: total, limit: limit, offset: offset)
  end

  def create(conn, params) do
    with {:ok, %Template{} = template} <- Catalog.create_template(params) do
      conn
      |> put_status(:created)
      |> render(:show, template: template)
    end
  end

  def show(conn, %{"id" => id}) do
    render(conn, :show, template: Catalog.get_template!(id))
  end

  def update(conn, %{"id" => id} = params) do
    template = Catalog.get_template!(id)

    with {:ok, %Template{} = template} <- Catalog.update_template(template, params) do
      render(conn, :show, template: template)
    end
  end

  def delete(conn, %{"id" => id}) do
    template = Catalog.get_template!(id)

    with {:ok, %Template{}} <- Catalog.delete_template(template) do
      json(conn, %{success: true, id: id})
    end
  end

  defp blank_to_nil(nil), do: nil
  defp blank_to_nil(""), do: nil
  defp blank_to_nil(v), do: v

  defp to_int(nil, default), do: default
  defp to_int(v, _default) when is_integer(v), do: v

  defp to_int(v, default) when is_binary(v) do
    case Integer.parse(v) do
      {n, _} -> n
      :error -> default
    end
  end

  defp to_int(_, default), do: default
end
