defmodule NebulithWeb.ConnCase do
  @moduledoc """
  This module defines the test case to be used by
  tests that require setting up a connection.

  Such tests rely on `Phoenix.ConnTest` and also
  import other functionality to make it easier
  to build common data structures and query the data layer.

  Finally, if the test case interacts with the database,
  we enable the SQL sandbox, so changes done to the database
  are reverted at the end of every test. If you are using
  PostgreSQL, you can even run database tests asynchronously
  by setting `use NebulithWeb.ConnCase, async: true`, although
  this option is not recommended for other databases.
  """

  use ExUnit.CaseTemplate

  using do
    quote do
      # The default endpoint for testing
      @endpoint NebulithWeb.Endpoint

      use NebulithWeb, :verified_routes

      # Import conveniences for testing with connections
      import Plug.Conn
      import Phoenix.ConnTest
      import NebulithWeb.ConnCase
    end
  end

  setup tags do
    Nebulith.DataCase.setup_sandbox(tags)
    {:ok, conn: Phoenix.ConnTest.build_conn()}
  end

  @doc """
  Gives the test conn an API credential, for the suites that exercise what `/api` SERVES.

  `/api` is closed (docs/AUTH.md §5), so a test that drives an endpoint has to be somebody first. It
  uses a bearer token rather than a session on purpose: the token is one header and carries across
  `recycle/1`, so these suites stay about the endpoint rather than about logging in. Whether the door
  itself works is `NebulithWeb.ApiAuthTest`, and that suite builds its own conn.
  """
  def log_in_api_user(%{conn: conn}) do
    {:ok, user} =
      Nebulith.Accounts.create_user(%{
        email: "api-#{System.unique_integer([:positive])}@nebulith.test",
        password: "12345678"
      })

    token = Nebulith.Accounts.create_user_api_token(user)

    %{
      conn: Plug.Conn.put_req_header(conn, "authorization", "Bearer " <> token),
      user: user,
      api_token: token
    }
  end
end
