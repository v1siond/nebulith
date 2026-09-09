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

# Height normalisation across styles is part of seed/0 now — a fresh seed is correct on its own.
Nebulith.Catalog.TileSource.seed()

# The item catalog: weapons / armour / consumables + the starter kits (§3.14b #1 — moved out of gear.ts).
items = Nebulith.Catalog.ItemSource.seed()
IO.puts("seeded #{items} items")

# The ability registry (§3.14b #2 — moved out of abilities.ts).
abilities = Nebulith.Catalog.AbilitySource.seed()
IO.puts("seeded #{abilities} abilities")

# The map-generator catalog: categories (forest/town/city/cave/temple) + their generators.
{cats, gens} = Nebulith.Catalog.GeneratorSource.seed()
IO.puts("seeded #{cats} generator categories and #{gens} generators")
