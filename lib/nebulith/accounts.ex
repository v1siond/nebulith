defmodule Nebulith.Accounts do
  @moduledoc """
  PEOPLE. One table, `users`, and `is_admin` is the difference between a player and an admin.

  There used to be a separate `admin_users` table for the `/admin` area. Two tables answering "who is this
  person" is the one-fact-two-owners problem, so it was folded into this one, hashes and all, and dropped.

  The admin-shaped function names are kept because the `/admin` plug calls them and an admin is still a real
  thing; they now read and write `users` with `is_admin` set.
  """

  import Ecto.Query, warn: false
  alias Nebulith.Repo
  alias Nebulith.Accounts.{Password, User, UserToken}

  # A valid-looking but unmatchable hash, used to keep authenticate/2 timing
  # roughly constant whether or not the email exists.
  @absent_hash "pbkdf2$sha256$100000$#{Base.encode64(:binary.copy(<<0>>, 16))}$#{Base.encode64(:binary.copy(<<0>>, 32))}"

  @doc "Every user."
  def list_users, do: Repo.all(User)

  @doc "Every user who can reach the admin."
  def list_admin_users, do: Repo.all(from u in User, where: u.is_admin)

  @doc "Fetches a user by email, case-insensitively, or nil."
  def get_user_by_email(email) when is_binary(email) do
    wanted = String.downcase(String.trim(email))
    Repo.one(from u in User, where: fragment("lower(?)", u.email) == ^wanted)
  end

  @doc "Fetches an admin by email, or nil. A user without `is_admin` does not count."
  def get_admin_user_by_email(email) when is_binary(email) do
    case get_user_by_email(email) do
      %User{is_admin: true} = user -> user
      _ -> nil
    end
  end

  @doc "Creates a user from the given attrs."
  def create_user(attrs) do
    %User{}
    |> User.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  Registers a person from a signup form.

  Goes through `registration_changeset/2` rather than `changeset/2` on purpose: the public door does
  not cast `is_admin`, so no amount of crafted form data makes an administrator.
  """
  def register_user(attrs) do
    %User{}
    |> User.registration_changeset(attrs)
    |> Repo.insert()
  end

  @doc "Creates an admin user from the given attrs."
  def create_admin_user(attrs),
    do: attrs |> Map.new() |> Map.put(:is_admin, true) |> create_user()

  @doc "Creates the admin identified by `email`, or updates it if it already exists (for seeding)."
  def upsert_admin_user(email, attrs) do
    attrs = attrs |> Map.new() |> Map.merge(%{email: email, is_admin: true})

    case get_user_by_email(email) do
      nil -> create_user(attrs)
      user -> user |> User.changeset(attrs) |> Repo.update()
    end
  end

  @doc """
  Authenticates by email + password.

  Returns `{:ok, user}` on success and `:error` otherwise. Runs a hash verification even when the email is
  unknown, so a wrong email and a wrong password take the same time and neither leaks which it was.
  """
  def authenticate(email, password) when is_binary(email) and is_binary(password) do
    admit(get_user_by_email(email), password)
  end

  def authenticate(_email, _password), do: :error

  defp admit(%User{} = user, password) do
    case Password.valid?(password, user.hashed_password) do
      true -> {:ok, user}
      false -> :error
    end
  end

  # NOBODY BY THAT NAME, and it costs the same as somebody. Hashing the given password against a fixed
  # absent hash keeps a wrong email and a wrong password taking the same time, so a caller cannot tell
  # the two apart by watching the clock and read the user list out of the difference.
  defp admit(nil, password) do
    Password.valid?(password, @absent_hash)
    :error
  end

  ## SESSIONS
  ##
  ## A session is a row in `users_tokens`, not a user id in a cookie. See docs/AUTH.md §1 for why:
  ## a row can be deleted, which is what makes signing out and revocation possible at all.

  @doc "Opens a session for `user` and returns the token the cookie will carry."
  def generate_user_session_token(user) do
    {token, user_token} = UserToken.build_session_token(user)
    Repo.insert!(user_token)
    token
  end

  @doc "The person holding this session token, or nil if it is unknown, expired or signed out."
  def get_user_by_session_token(token) when is_binary(token) do
    Repo.one(UserToken.verify_session_token_query(token))
  end

  def get_user_by_session_token(_token), do: nil

  @doc "Ends one session. The token stops meaning anything the moment the row is gone."
  def delete_user_session_token(token) when is_binary(token) do
    Repo.delete_all(UserToken.by_token_and_context_query(token, "session"))
    :ok
  end

  def delete_user_session_token(_token), do: :ok

  @doc "Ends every session `user` has open, anywhere. API tokens are a different context and survive."
  def delete_all_user_session_tokens(%User{} = user) do
    Repo.delete_all(UserToken.by_user_and_contexts_query(user, ["session"]))
    :ok
  end

  ## API TOKENS
  ##
  ## What a script carries instead of a cookie. The raw bytes never leave this module as bytes: callers
  ## get the base64url spelling, which is what goes in an Authorization header.

  @doc "Mints an API token for `user` and returns it in the spelling a caller puts in a header."
  def create_user_api_token(%User{} = user) do
    {token, user_token} = UserToken.build_api_token(user)
    Repo.insert!(user_token)
    Base.url_encode64(token, padding: false)
  end

  @doc "The person holding this API token, or nil. Takes the encoded spelling, not the raw bytes."
  def get_user_by_api_token(encoded) when is_binary(encoded) do
    case Base.url_decode64(encoded, padding: false) do
      {:ok, token} -> Repo.one(UserToken.verify_api_token_query(token))
      :error -> nil
    end
  end

  def get_user_by_api_token(_encoded), do: nil

  @doc "Revokes one API token."
  def delete_user_api_token(encoded) when is_binary(encoded) do
    case Base.url_decode64(encoded, padding: false) do
      {:ok, token} -> Repo.delete_all(UserToken.by_token_and_context_query(token, "api"))
      :error -> {0, nil}
    end

    :ok
  end

  @doc "Revokes every API token `user` holds."
  def delete_all_user_api_tokens(%User{} = user) do
    Repo.delete_all(UserToken.by_user_and_contexts_query(user, ["api"]))
    :ok
  end
end
