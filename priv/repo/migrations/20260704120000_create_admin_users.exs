defmodule Nebulith.Repo.Migrations.CreateAdminUsers do
  use Ecto.Migration

  # nebulith-owned table for the backend admin area. The Prisma `User` table in
  # the shared db is a profile record (no password) and is owned by the frontend,
  # so we keep our own credentials table rather than write into it.
  def change do
    create table(:admin_users) do
      add :email, :string, null: false
      add :hashed_password, :string, null: false
      add :role, :string, null: false, default: "admin"

      timestamps(type: :utc_datetime)
    end

    create unique_index(:admin_users, [:email])
  end
end
