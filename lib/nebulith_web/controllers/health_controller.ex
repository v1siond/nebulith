defmodule NebulithWeb.HealthController do
  @moduledoc """
  The platform's liveness check.

  Deliberately the smallest thing that can answer: is this process up and serving HTTP. It does NOT
  touch the database, because a health check that fails on a database blip makes the platform restart
  a container that was fine, which turns a brief outage into a longer one. Migrations run as a
  pre-deploy command, so a booted release has already proved it can reach Postgres.

  It is excluded from `force_ssl` in config/prod.exs: Railway checks it over plain HTTP from inside
  the network, and a 301 to https reads as a failed deploy.
  """
  use NebulithWeb, :controller

  def show(conn, _params) do
    json(conn, %{status: "ok", app: "nebulith"})
  end
end
