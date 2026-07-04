defmodule Nebulith.Accounts.AdminUser do
  use Ecto.Schema
  import Ecto.Changeset

  alias Nebulith.Accounts.Password

  schema "admin_users" do
    field :email, :string
    field :role, :string, default: "admin"
    field :password, :string, virtual: true, redact: true
    field :hashed_password, :string, redact: true

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(admin_user, attrs) do
    admin_user
    |> cast(attrs, [:email, :password, :role])
    |> validate_required([:email, :password])
    |> validate_format(:email, ~r/@/, message: "must contain an @")
    |> validate_length(:password, min: 8)
    |> unique_constraint(:email)
    |> put_hashed_password()
  end

  defp put_hashed_password(changeset) do
    case get_change(changeset, :password) do
      nil -> changeset
      password -> put_change(changeset, :hashed_password, Password.hash(password))
    end
  end
end
