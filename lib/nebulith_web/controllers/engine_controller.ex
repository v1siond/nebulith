defmodule NebulithWeb.EngineController do
  @moduledoc """
  Serves the engine, which is a React application this app bundles and ships.

  Every engine path renders the SAME shell. The client router reads `location.pathname` and decides
  which page that is, so a direct load of `/games/42` renders what a click on that game renders. Each
  path still has a route here, so an unknown path is a 404 from Phoenix rather than a blank gallery.
  """
  use NebulithWeb, :controller

  @doc """
  The shell. Everything environment-specific is handed to the bundle as runtime configuration rather
  than baked in at build time: the CV origin and the signed-in person.
  """
  def app(conn, _params) do
    conn
    |> assign(:cv_url, cv_url())
    |> render(:app)
  end

  # An environment with no CV deployed has no link to render, so the attribute is left off the mount node
  # entirely and the engine draws no button. A blank string is the same as nothing: an empty env var is
  # how a platform spells "unset", and rendering it would put an empty href on the page.
  defp cv_url, do: present(Application.get_env(:nebulith, :cv_url))

  defp present(nil), do: nil
  defp present(""), do: nil
  defp present(url), do: url

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
