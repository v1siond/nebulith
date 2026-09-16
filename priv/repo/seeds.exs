# A fresh database gets its rows from ONE path: the data-migration ledger.
#
# The catalog seed itself is the first entry in that ledger (`Nebulith.DataMigration.BuiltInCatalog`), and
# every pass that has shaped the data since is an entry after it, in order. Running them here means a fresh
# database ends up holding exactly what a live one holds, and the `data_migrations` table records what ran.
#
#     mix run priv/repo/seeds.exs      # or `mix ecto.setup`, which calls this
#     mix nebulith.data_migrate        # the same thing, by hand, once the server is already up
#
# Nothing here runs on boot: migrations are schema only, so `mix ecto.migrate` stays fast and cannot time out.

# Backend admin account for the /admin area. Idempotent (upsert by email). This is an ACCOUNT, not catalog
# data, and it reads its credentials from the environment, so it stays here rather than in the ledger.
admin_email = System.get_env("NEBULITH_ADMIN_EMAIL") || "admin@nebulith.local"
admin_password = System.get_env("NEBULITH_ADMIN_PASSWORD") || "nebulith-admin"

{:ok, admin} =
  Nebulith.Accounts.upsert_admin_user(admin_email, %{password: admin_password, role: "admin"})

IO.puts("seeded admin user '#{admin.email}' (role: #{admin.role})")

case Nebulith.DataMigrations.run_pending() do
  [] -> IO.puts("no data migration was pending, the catalog is already seeded")
  names -> IO.puts("ran #{length(names)} data migrations: #{Enum.join(names, ", ")}")
end
