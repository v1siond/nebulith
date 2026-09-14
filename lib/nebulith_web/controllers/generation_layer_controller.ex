defmodule NebulithWeb.GenerationLayerController do
  @moduledoc """
  The generation layers: the stack map generation runs, in order.

  Full CRUD, because the list is meant to be edited rather than deployed: *"at least we can seed the layers we
  have, add the crud, and leave the editor and AI integration for later"*. The editor reads `index` and builds
  its re-roll panel from it, so a layer added here shows up there without a frontend release.
  """
  use NebulithWeb, :controller

  alias Nebulith.Catalog
  alias Nebulith.Catalog.GenerationLayer

  action_fallback NebulithWeb.FallbackController

  def index(conn, _params), do: render(conn, :index, layers: Catalog.list_generation_layers())

  def show(conn, %{"key" => key}) do
    with %GenerationLayer{} = layer <- Catalog.get_generation_layer(key) do
      render(conn, :show, layer: layer)
    end
  end

  def create(conn, %{"layer" => attrs}) do
    with {:ok, %GenerationLayer{} = layer} <- Catalog.create_generation_layer(attrs) do
      conn |> put_status(:created) |> render(:show, layer: layer)
    end
  end

  def update(conn, %{"key" => key, "layer" => attrs}) do
    with %GenerationLayer{} = layer <- Catalog.get_generation_layer(key),
         {:ok, %GenerationLayer{} = updated} <- Catalog.update_generation_layer(layer, attrs) do
      render(conn, :show, layer: updated)
    end
  end

  def delete(conn, %{"key" => key}) do
    with %GenerationLayer{} = layer <- Catalog.get_generation_layer(key),
         {:ok, %GenerationLayer{}} <- Catalog.delete_generation_layer(layer) do
      send_resp(conn, :no_content, "")
    end
  end
end
