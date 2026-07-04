defmodule NebulithWeb.AdminAuth do
  @moduledoc """
  HTTP Basic Auth gate for the `/admin` area.

  Credentials are checked against the nebulith-owned `admin_users` table via
  `Nebulith.Accounts`. Basic Auth over plain HTTP is fine for local development;
  put this behind TLS before exposing it anywhere real.
  """

  import Plug.Conn
  alias Nebulith.Accounts

  @realm "Nebulith Admin"

  def init(opts), do: opts

  def call(conn, _opts) do
    with {email, password} <- Plug.BasicAuth.parse_basic_auth(conn),
         {:ok, admin} <- Accounts.authenticate(email, password) do
      assign(conn, :current_admin, admin)
    else
      _ ->
        conn
        |> Plug.BasicAuth.request_basic_auth(realm: @realm)
        |> halt()
    end
  end
end
