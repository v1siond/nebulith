defmodule Nebulith.DataMigration.AsciiEmojiBehaviorParity do
  @moduledoc """
  Brings the LIVE ascii rows into behavioral parity with their emoji twin: the SAME label carries the SAME
  height, category and collision, only the ART differs (MAP-MODEL §4, the user's "all tiles behave the same
  regardless of style" rule).

  The ascii glyph seed defaulted an ABSENT height to 1 and derived `blocking` from `walkable: false`, so a
  legacy standalone label (`door`, `window`, `roof`, `trunk`, a `leaf_*` canopy piece, `snag`, `moss`,
  `cavefloor`, `mountain`, a weapon, a unit …) was born a BLOCKING 1-block in ascii while the same label is a
  walkable floor slab in emoji. `ascii.json` now AUTHORS the right values so a fresh DB is born matching; this
  fixes the rows already in a live DB WITHOUT a full reseed (which would `replace_all` and clobber
  editor-tuned poses).

  For each parity label we COPY the emoji tile's height / blocking / category onto the ascii tile — whatever
  the live emoji value is (already floor-slabbed by `FlatTilesMinimalHeight`), ascii matches it. Only those
  three columns are touched, so ascii `settings` (colours / pose / behavior) survive. Idempotent: a row
  already in parity matches nothing.

  EXCLUDES `rock` / `crystal` / `coral` — those are ascii GROUND-terrain tiles (category terrain, with
  char/fg/bg variants feeding the lava biome's ground), a deliberate boulder-vs-ground concept split from
  emoji; forcing them to agree would drop them out of the ascii ground map. Documented in
  `Nebulith.TilesetParityTest`.
  """
  import Ecto.Query
  require Logger

  alias Nebulith.Catalog.Tile
  alias Nebulith.Catalog.Tileset
  alias Nebulith.Repo

  # The SHARED labels whose ascii row drifted from its emoji twin's behavior (height/category/blocking).
  # Kept explicit (not "every divergent row") so the pass is auditable and the rock/crystal/coral divergence
  # stays intentional.
  @parity_labels ~w(
    axe bow cavefloor door enemy flower gun hazard key
    leaf_center leaf_left leaf_right leaf_top moss mountain npc player
    roof shield snag spill staff sword trunk trunk_base wall window
  )

  def run do
    ascii_id = tileset_id!("ascii")
    emoji_id = tileset_id!("emoji")
    emoji = emoji_targets(emoji_id)

    updated =
      for label <- @parity_labels, target = emoji[label], reduce: 0 do
        acc -> acc + align_ascii(ascii_id, label, target)
      end

    Logger.info("[data_migrate] ascii→emoji behavior parity (#{updated} rows aligned)")
    :ok
  end

  # emoji's authoritative {height, blocking, category} per parity label.
  defp emoji_targets(emoji_id) do
    from(t in Tile,
      where: t.tileset_id == ^emoji_id and t.label in ^@parity_labels,
      select: {t.label, %{height: t.height, blocking: t.blocking, category: t.category}}
    )
    |> Repo.all()
    |> Map.new()
  end

  # Copy the emoji target onto the ascii row, ONLY when it differs (idempotent) — height/blocking/category
  # columns alone, so ascii `settings` (poses/colours) are untouched. Returns 1 when a row changed, else 0.
  defp align_ascii(ascii_id, label, %{height: h, blocking: b, category: c}) do
    {count, _} =
      from(t in Tile,
        where:
          t.tileset_id == ^ascii_id and t.label == ^label and
            (t.height != ^h or t.blocking != ^b or fragment("? IS DISTINCT FROM ?", t.category, ^c))
      )
      |> Repo.update_all(
        set: [height: h, blocking: b, category: c, updated_at: DateTime.truncate(DateTime.utc_now(), :second)]
      )

    count
  end

  defp tileset_id!(key), do: Repo.one!(from ts in Tileset, where: ts.key == ^key, select: ts.id)
end
