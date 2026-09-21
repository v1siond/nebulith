defmodule NebulithWeb.EngineControllerTest do
  @moduledoc """
  THE SHELL, AND WHAT IT TELLS THE BUNDLE ABOUT THIS ENVIRONMENT.

  Everything environment-specific reaches the engine as a data attribute. The rule for all of them is
  the same: the server says what is true here, and says nothing when nothing is configured. It must
  never hand the page a value that was only ever right on a developer's machine.

  Measured before this was pinned: the deployed staging site served `data-cv-url="http://localhost:3000"`
  to every visitor, because the default sat in `config/config.exs` and a release inherits it.
  """
  use NebulithWeb.ConnCase

  alias Nebulith.Accounts

  setup %{conn: conn} do
    {:ok, user} =
      Accounts.create_user(%{
        email: "shell-#{System.unique_integer([:positive])}@nebulith.test",
        password: "12345678"
      })

    original = Application.get_env(:nebulith, :cv_url)
    on_exit(fn -> Application.put_env(:nebulith, :cv_url, original) end)

    conn =
      post(conn, ~p"/login", %{"user" => %{"email" => user.email, "password" => "12345678"}})

    %{conn: recycle(conn), user: user}
  end

  describe "the CV link" do
    test "carries the configured origin when there is one", %{conn: conn} do
      Application.put_env(:nebulith, :cv_url, "https://cv.example.test")

      assert conn |> get(~p"/games") |> html_response(200) =~
               ~s(data-cv-url="https://cv.example.test")
    end

    test "is absent entirely when nothing is configured", %{conn: conn} do
      Application.delete_env(:nebulith, :cv_url)

      html = conn |> get(~p"/games") |> html_response(200)

      assert html =~ ~s(id="game")
      refute html =~ "data-cv-url"
      refute html =~ "localhost:3000"
    end

    test "treats a blank setting as no setting, not as an empty link", %{conn: conn} do
      Application.put_env(:nebulith, :cv_url, "")

      html = conn |> get(~p"/games") |> html_response(200)

      refute html =~ "data-cv-url"
    end
  end

  describe "the signed-in person" do
    test "is named on the mount node so the header can show them", %{conn: conn, user: user} do
      assert conn |> get(~p"/games") |> html_response(200) =~
               ~s(data-user-email="#{user.email}")
    end

    test "gets a CSRF token, which is what the log out button posts with", %{conn: conn} do
      assert conn |> get(~p"/games") |> html_response(200) =~ "data-csrf-token="
    end
  end
end
