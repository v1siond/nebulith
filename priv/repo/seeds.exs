# Seed the built-in tilesets from the JSON exported out of the game-website frontend
# (priv/repo/tilesets/*.json). Idempotent: upserts by `key`. Run: mix run priv/repo/seeds.exs
alias Nebulith.Repo
alias Nebulith.Catalog.Tileset

dir = Path.join(["priv", "repo", "tilesets"])

for {key, name, file} <- [{"ascii", "ASCII", "ascii.json"}, {"emoji", "Emoji", "emoji.json"}] do
  data = dir |> Path.join(file) |> File.read!() |> Jason.decode!()

  case Repo.get_by(Tileset, key: key) do
    nil -> Repo.insert!(%Tileset{key: key, name: name, data: data})
    existing -> existing |> Ecto.Changeset.change(%{name: name, data: data}) |> Repo.update!()
  end

  IO.puts("seeded tileset '#{key}' (#{map_size(data)} top-level keys)")
end
