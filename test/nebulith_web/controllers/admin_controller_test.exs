defmodule NebulithWeb.AdminControllerTest do
  use NebulithWeb.ConnCase

  alias Nebulith.Accounts

  @email "admin@test.local"
  @password "supersecret"

  setup do
    {:ok, _} = Accounts.create_admin_user(%{email: @email, password: @password})
    :ok
  end

  test "requires basic auth", %{conn: conn} do
    conn = get(conn, ~p"/admin")

    assert response(conn, 401)
    assert get_resp_header(conn, "www-authenticate") != []
  end

  test "rejects wrong credentials", %{conn: conn} do
    conn =
      conn
      |> put_req_header(
        "authorization",
        Plug.BasicAuth.encode_basic_auth(@email, "wrongpassword")
      )
      |> get(~p"/admin")

    assert response(conn, 401)
  end

  test "lists all tables when authenticated", %{conn: conn} do
    conn =
      conn
      |> put_req_header("authorization", Plug.BasicAuth.encode_basic_auth(@email, @password))
      |> get(~p"/admin")

    html = html_response(conn, 200)
    assert html =~ "all data"
    assert html =~ "admin_users"
    assert html =~ "tilesets"
  end
end
