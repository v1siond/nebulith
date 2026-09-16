defmodule Nebulith.Repo.Migrations.CreateDataMigrations do
  @moduledoc """
  The ledger for DATA migrations: one row per data pass that has run, and when it ran.

  Migrations are for SCHEMA. Data belongs in `lib/nebulith/data_migrations/`, run by hand with
  `mix nebulith.data_migrate` once the app is up, so a heavy pass over the catalog can never slow down or
  time out a boot or a deploy. This table is the one piece of that system that IS schema, which is why it is
  the only migration the split adds.

  Keyed by the module's short name (`SeedEntrances`), not by a timestamp: a data migration is named for what
  it does, and the registry in `Nebulith.DataMigrations` owns the order.
  """
  use Ecto.Migration

  def change do
    create table(:data_migrations, primary_key: false) do
      add :name, :string, primary_key: true
      add :run_at, :utc_datetime, null: false
    end
  end
end
