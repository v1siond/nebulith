# Seed the built-in tilesets from the JSON exported out of the game-website frontend
# (priv/repo/tilesets/*.json). Idempotent: upserts by `key`. Run: mix run priv/repo/seeds.exs
alias Nebulith.Repo
alias Nebulith.Catalog.Tileset

# Backend admin account for the /admin area. Idempotent (upsert by email).
# Override the defaults with NEBULITH_ADMIN_EMAIL / NEBULITH_ADMIN_PASSWORD.
admin_email = System.get_env("NEBULITH_ADMIN_EMAIL") || "admin@nebulith.local"
admin_password = System.get_env("NEBULITH_ADMIN_PASSWORD") || "nebulith-admin"

{:ok, admin} =
  Nebulith.Accounts.upsert_admin_user(admin_email, %{password: admin_password, role: "admin"})

IO.puts("seeded admin user '#{admin.email}' (role: #{admin.role})")

dir = Path.join(["priv", "repo", "tilesets"])

for {key, name, file} <- [{"ascii", "ASCII", "ascii.json"}, {"emoji", "Emoji", "emoji.json"}] do
  data = dir |> Path.join(file) |> File.read!() |> Jason.decode!()

  case Repo.get_by(Tileset, key: key) do
    nil -> Repo.insert!(%Tileset{key: key, name: name, data: data})
    existing -> existing |> Ecto.Changeset.change(%{name: name, data: data}) |> Repo.update!()
  end

  IO.puts("seeded tileset '#{key}' (#{map_size(data)} top-level keys)")
end
