defmodule NebulithWeb.AdminAuth do
  @moduledoc """
  THE ADMIN DOOR. Two credentials, one identity, and `is_admin` required either way.

  A person arrives with a browser session, which is what a person has. A script arrives with HTTP Basic,
  which is what the end-to-end gate has. Both resolve to the same row in `users`.

  This used to call `Accounts.authenticate/2`, which answers "is this a real person with this password"
  and NOT "may this person reach the admin", so every account got in. It asks
  `get_admin_user_by_email/1` now, which was already written for this and simply was not called.

  See docs/AUTH.md §2.
  """

  import Plug.Conn
  alias Nebulith.Accounts
  alias Nebulith.Accounts.User

  @realm "Nebulith Admin"

  def init(opts), do: opts

  def call(conn, _opts), do: admit(conn, conn.assigns[:current_user])

  # Already signed in as an admin, so there is nothing to ask for.
  defp admit(conn, %User{is_admin: true} = admin), do: assign(conn, :current_admin, admin)

  # Anyone else, signed in or not, has to present credentials that carry `is_admin`. The match on the
  # struct is the whole check: a user who authenticates but is not an admin falls to the else and is
  # asked for credentials again, which is the same answer a wrong password gets.
  defp admit(conn, _user) do
    with {email, password} <- Plug.BasicAuth.parse_basic_auth(conn),
         {:ok, %User{is_admin: true} = admin} <- Accounts.authenticate(email, password) do
      assign(conn, :current_admin, admin)
    else
      _ ->
        conn
        |> Plug.BasicAuth.request_basic_auth(realm: @realm)
        |> halt()
    end
  end
end
