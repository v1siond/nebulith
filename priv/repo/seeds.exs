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

# The ZONE catalog: the seven seasons/biomes, plus the season-independent rule bundles (trees, props) that the
# generators read. Its own seed writes those bundles through CombatSource.put_rules/1.
%{zones: zones, rules: zone_rules} = Nebulith.Catalog.ZoneSource.seed()
IO.puts("seeded #{zones} zones and #{zone_rules} zone rule bundles")

# The COMBAT rules: damage formulas, special-resource costs, per-kind base stats. These land under different
# `game_rules` keys than the zone bundles above ("combat"/"stats" against "trees"/"props"), so the two cannot
# clobber each other and the order between them does not matter.
%{rules: combat_rules} = Nebulith.Catalog.CombatSource.seed()
IO.puts("seeded #{combat_rules} combat rule bundles")

# The player UI: the action registry plus the default profile's bars, bindings and elements. Without this the
# Player UI panel and every key binding serve empty on a fresh database.
%{actions: ui_actions, elements: ui_elements, profile: ui_profile} = Nebulith.Catalog.UiSource.seed()
IO.puts("seeded #{ui_actions} ui actions and #{ui_elements} elements into profile '#{ui_profile}'")
