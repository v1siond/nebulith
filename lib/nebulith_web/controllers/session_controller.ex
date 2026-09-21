defmodule NebulithWeb.SessionController do
  @moduledoc """
  THE LOGIN FORM, and the two writes behind it.

  A failed login says one thing regardless of which half was wrong. Telling someone the email was not
  found turns this page into a list of who has an account.
  """
  use NebulithWeb, :controller

  alias Nebulith.Accounts
  alias NebulithWeb.UserAuth

  def new(conn, _params) do
    render(conn, :new, error_message: nil)
  end

  def create(conn, %{"user" => %{"email" => email, "password" => password}}) do
    case Accounts.authenticate(email, password) do
      {:ok, user} -> UserAuth.log_in_user(conn, user)
      :error -> render(conn, :new, error_message: "Wrong email or password")
    end
  end

  def create(conn, _params), do: render(conn, :new, error_message: "Wrong email or password")

  def delete(conn, _params), do: UserAuth.log_out_user(conn)
end
