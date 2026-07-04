defmodule Nebulith.Accounts do
  @moduledoc """
  Backend admin accounts.

  These are nebulith-owned credentials for the `/admin` area and are kept
  separate from the Prisma-owned `User` table in the shared database.
  """

  import Ecto.Query, warn: false
  alias Nebulith.Repo
  alias Nebulith.Accounts.{AdminUser, Password}

  # A valid-looking but unmatchable hash, used to keep authenticate/2 timing
  # roughly constant whether or not the email exists.
  @absent_hash "pbkdf2$sha256$100000$#{Base.encode64(:binary.copy(<<0>>, 16))}$#{Base.encode64(:binary.copy(<<0>>, 32))}"

  @doc "Returns every admin user."
  def list_admin_users, do: Repo.all(AdminUser)

  @doc "Fetches an admin user by email, or nil."
  def get_admin_user_by_email(email) when is_binary(email) do
    Repo.get_by(AdminUser, email: email)
  end

  @doc "Creates an admin user from the given attrs."
  def create_admin_user(attrs) do
    %AdminUser{}
    |> AdminUser.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Creates the admin identified by `email`, or updates it if it already exists (for seeding)."
  def upsert_admin_user(email, attrs) do
    attrs = Map.put(attrs, :email, email)

    case get_admin_user_by_email(email) do
      nil -> create_admin_user(attrs)
      admin_user -> admin_user |> AdminUser.changeset(attrs) |> Repo.update()
    end
  end

  @doc """
  Authenticates an admin by email + password.

  Returns `{:ok, admin_user}` on success and `:error` otherwise. Runs a hash
  verification even when the email is unknown to avoid leaking existence by timing.
  """
  def authenticate(email, password) when is_binary(email) and is_binary(password) do
    admin_user = get_admin_user_by_email(email)

    cond do
      admin_user && Password.valid?(password, admin_user.hashed_password) ->
        {:ok, admin_user}

      true ->
        # Keep timing roughly constant when the email is unknown.
        unless admin_user, do: Password.valid?(password, @absent_hash)
        :error
    end
  end

  def authenticate(_email, _password), do: :error
end
