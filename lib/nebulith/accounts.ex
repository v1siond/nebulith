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
  alias Nebulith.Accounts.{Password, User}

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
    user = get_user_by_email(email)

    cond do
      user && Password.valid?(password, user.hashed_password) ->
        {:ok, user}

      true ->
        unless user, do: Password.valid?(password, @absent_hash)
        :error
    end
  end

  def authenticate(_email, _password), do: :error
end
