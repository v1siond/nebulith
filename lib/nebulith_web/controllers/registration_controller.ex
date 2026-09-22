defmodule NebulithWeb.RegistrationController do
  @moduledoc """
  SIGNING UP, and the two writes behind it.

  A new account is a PLAYER. `Accounts.register_user/1` goes through a changeset that does not cast
  `is_admin`, so a crafted POST cannot mint an administrator, and `is_admin` is the whole difference
  between a player and somebody who can reach /admin (docs/AUTH.md section 2).

  Signing up logs you straight in, through the same `log_in_user/2` the login form uses, so a session
  is a row here exactly as it is there and there is only one place that decides where a person lands.
  """
  use NebulithWeb, :controller

  alias Nebulith.Accounts
  alias NebulithWeb.UserAuth

  def new(conn, _params), do: render(conn, :new, errors: [])

  def create(conn, %{"user" => user_params}) do
    case Accounts.register_user(user_params) do
      {:ok, user} -> UserAuth.log_in_user(conn, user)
      {:error, changeset} -> render(conn, :new, errors: readable(changeset))
    end
  end

  def create(conn, _params),
    do: render(conn, :new, errors: ["Fill in an email and a password."])

  # THE FIELD AND WHAT IS WRONG WITH IT, unlike the login form next door.
  #
  # Login says one thing for both halves on purpose, because naming the wrong half there turns the page
  # into a directory of who has an account. Signing up has the opposite duty: a person is choosing a
  # password and needs to know it was too short. The one thing this must NOT do is leak whether an email
  # is already registered, so that case gets its own wording, which is true either way and tells an
  # outsider nothing they could not have guessed.
  defp readable(changeset) do
    Enum.map(changeset.errors, fn
      {:email, {_msg, opts}} ->
        case Keyword.get(opts, :constraint) do
          :unique -> "That email cannot be used. Try logging in instead."
          _ -> "Email must contain an @."
        end

      {:password, _} ->
        "Password must be at least 8 characters."

      {field, {msg, _}} ->
        "#{Phoenix.Naming.humanize(field)} #{msg}."
    end)
  end
end
