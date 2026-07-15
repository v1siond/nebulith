# Seed the built-in catalog: ports every tile + composition from the exported
# tileset JSON (priv/repo/tilesets/*.json) into the tiles/compositions tables.
# Idempotent: upserts by natural key. Run: mix run priv/repo/seeds.exs

# Backend admin account for the /admin area. Idempotent (upsert by email).
# Override the defaults with NEBULITH_ADMIN_EMAIL / NEBULITH_ADMIN_PASSWORD.
admin_email = System.get_env("NEBULITH_ADMIN_EMAIL") || "admin@nebulith.local"
admin_password = System.get_env("NEBULITH_ADMIN_PASSWORD") || "nebulith-admin"

{:ok, admin} =
  Nebulith.Accounts.upsert_admin_user(admin_email, %{password: admin_password, role: "admin"})

IO.puts("seeded admin user '#{admin.email}' (role: #{admin.role})")

Nebulith.Catalog.TileSource.seed()
