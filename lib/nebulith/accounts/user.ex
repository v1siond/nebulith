defmodule Nebulith.Accounts.User do
  @moduledoc """
  A PERSON. One table answers who someone is.

  There used to be an `admin_users` table alongside this for the `/admin` area, which meant two tables
  answering the same question and two places for an account to exist. `is_admin` is the whole difference
  between the two roles, and it gates generator authoring: *"Since it's admin only functionality, it should
  be fine on security side, we'll have two factor or something to ensure it's hard to reach."*

  Email is compared case-insensitively. There is no citext column, so the uniqueness lives in an index on
  `lower(email)` and the value is downcased on the way in, which keeps the two from disagreeing.
  """
  use Ecto.Schema
  import Ecto.Changeset

  alias Nebulith.Accounts.Password

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "users" do
    field :email, :string
    field :display_name, :string
    field :is_admin, :boolean, default: false
    field :password, :string, virtual: true, redact: true
    field :hashed_password, :string, redact: true

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(user, attrs) do
    user
    |> cast(attrs, [:email, :password, :display_name, :is_admin])
    |> validate_required([:email, :password])
    |> validate_format(:email, ~r/@/, message: "must contain an @")
    |> validate_length(:password, min: 8)
    |> update_change(:email, &String.downcase(String.trim(&1)))
    |> unique_constraint(:email, name: :users_email_lower_index)
    |> put_hashed_password()
  end

  defp put_hashed_password(changeset) do
    case get_change(changeset, :password) do
      nil -> changeset
      password -> put_change(changeset, :hashed_password, Password.hash(password))
    end
  end
end
