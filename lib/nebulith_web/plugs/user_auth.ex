defmodule NebulithWeb.UserAuth do
  @moduledoc """
  WHO IS ASKING, on every request, and whether they may have what they asked for.

  Three plugs. `fetch_current_user/2` answers who; it never refuses anything, so a page that is happy to
  serve a stranger still can. `require_authenticated_user/2` refuses. `redirect_if_user_is_authenticated/2`
  keeps someone who is already signed in off the login form.

  See docs/AUTH.md.
  """
  use NebulithWeb, :verified_routes

  import Plug.Conn
  import Phoenix.Controller

  alias Nebulith.Accounts

  @session_key "user_token"

  @doc """
  Signs `user` in and sends them where they were going.

  The session id is renewed first. Without that, a session fixated before the login survives it, which
  is the whole session-fixation attack: set a known cookie on someone, wait for them to authenticate,
  then use it.
  """
  def log_in_user(conn, user) do
    token = Accounts.generate_user_session_token(user)

    # Only a path this app itself recorded, never one the form supplied: a `return_to` taken from user
    # input is an open redirect, which is how a login page ends up forwarding people to somebody else's
    # copy of it.
    return_to = get_session(conn, :user_return_to)

    conn
    |> renew_session()
    |> put_session(@session_key, token)
    |> put_session(:live_socket_id, "users_sessions:#{Base.url_encode64(token)}")
    |> redirect(to: return_to || signed_in_path())
  end

  @doc "Signs the current person out and forgets the row that vouched for them."
  def log_out_user(conn) do
    conn
    |> get_session(@session_key)
    |> Accounts.delete_user_session_token()

    conn
    |> renew_session()
    |> redirect(to: ~p"/login")
  end

  @doc "Puts the current user in the assigns, or nil. Refuses nothing."
  def fetch_current_user(conn, _opts) do
    token = get_session(conn, @session_key)
    assign(conn, :current_user, token && Accounts.get_user_by_session_token(token))
  end

  @doc """
  Refuses anyone not signed in, remembering where they were going so the login lands them there.

  Only a GET is worth remembering: replaying a POST after a login is a surprise, not a convenience.
  """
  def require_authenticated_user(%{assigns: %{current_user: nil}} = conn, _opts) do
    conn
    |> maybe_store_return_to()
    |> put_flash(:error, "You must log in to reach that page.")
    |> redirect(to: ~p"/login")
    |> halt()
  end

  def require_authenticated_user(conn, _opts), do: conn

  @doc """
  Refuses an API caller who is nobody.

  Two credentials, because two kinds of caller ask: a browser on this origin sends the session cookie
  with its fetches, and a script sends `Authorization: Bearer <token>`. Both resolve to a row in
  `users`, so what a caller may do never depends on how they arrived.

  It answers JSON and never redirects. A 302 to an HTML login form is the worst possible answer to a
  fetch: the caller gets a 200 full of markup and parses it as data.
  """
  def require_api_user(conn, _opts), do: admit_api(conn, conn.assigns[:current_user])

  defp admit_api(conn, nil), do: admit_api_token(conn, bearer_token(conn))
  defp admit_api(conn, _user), do: conn

  defp admit_api_token(conn, nil), do: refuse_api(conn)

  defp admit_api_token(conn, token) do
    case Accounts.get_user_by_api_token(token) do
      nil -> refuse_api(conn)
      user -> assign(conn, :current_user, user)
    end
  end

  defp refuse_api(conn) do
    conn
    |> put_status(:unauthorized)
    |> put_resp_header("www-authenticate", ~s(Bearer realm="Nebulith API"))
    |> json(%{errors: %{detail: "Unauthorized"}})
    |> halt()
  end

  defp bearer_token(conn) do
    with ["Bearer " <> token] <- get_req_header(conn, "authorization"),
         trimmed when trimmed != "" <- String.trim(token) do
      trimmed
    else
      _ -> nil
    end
  end

  @doc "Keeps someone who is already signed in off the login form."
  def redirect_if_user_is_authenticated(%{assigns: %{current_user: nil}} = conn, _opts), do: conn

  def redirect_if_user_is_authenticated(conn, _opts) do
    conn
    |> redirect(to: signed_in_path())
    |> halt()
  end

  # Drops everything the old session held rather than merging into it, so nothing an unauthenticated
  # visitor put there survives the login.
  defp renew_session(conn) do
    delete_csrf_token()

    conn
    |> configure_session(renew: true)
    |> clear_session()
  end

  defp maybe_store_return_to(%{method: "GET"} = conn) do
    put_session(conn, :user_return_to, current_path(conn))
  end

  defp maybe_store_return_to(conn), do: conn

  defp signed_in_path, do: ~p"/games"
end
