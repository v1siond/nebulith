defmodule NebulithWeb.EngineController do
  @moduledoc """
  Serves the engine, which is a React application this app bundles and ships.

  Every engine path renders the SAME shell. The client router reads `location.pathname` and decides
  which page that is, so a direct load of `/games/42` renders what a click on that game renders. Each
  path still has a route here, so an unknown path is a 404 from Phoenix rather than a blank gallery.
  """
  use NebulithWeb, :controller

  @doc "The shell. `cv_url` is handed to the bundle as runtime configuration, not baked at build time."
  def app(conn, _params) do
    conn
    |> assign(:cv_url, Application.get_env(:nebulith, :cv_url))
    |> render(:app)
  end

  @doc """
  The paths the engine answered while it lived inside the CV site. Kept as redirects so existing
  links and the probe harness resolve instead of 404ing. The query string comes along, because
  `?play=1` is how the gallery deep-links into play mode.
  """
  def legacy(conn, params) do
    redirect(conn, to: legacy_target(params["rest"] || [], conn.query_string))
  end

  defp legacy_target(segments, ""), do: "/" <> Enum.join(short(segments), "/")
  defp legacy_target(segments, query), do: "/" <> Enum.join(short(segments), "/") <> "?" <> query

  defp short([]), do: ["games"]
  defp short(segments), do: segments
end
