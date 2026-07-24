defmodule Nebulith.TilesetParityTest do
  @moduledoc """
  PERMANENT cross-style guard (the test that stops the ascii/emoji drift recurring).

  The user's non-negotiable rule: a tile must behave IDENTICALLY in ascii and emoji — the SAME label
  carries the SAME height, category and collision, only the ART differs (MAP-MODEL §4, "all tiles behave
  the same regardless of style"). And EVERY tile, EVERY style, is a baked IMAGE resolved by LABEL — a tile
  is NEVER `image_url: nil` + a raw glyph (that is exactly what renders `?` on a font-less machine).

  This asserts both, on the REAL seeded rows:
    * no tile in EITHER style lacks a baked image (image_url present AND the PNG exists on disk), and
    * every SHARED label (present in both styles) agrees on height / category / blocking.
  """
  use Nebulith.DataCase

  alias Nebulith.Catalog
  alias Nebulith.Catalog.TileSource
  alias Nebulith.DataMigration.AsciiEmojiBehaviorParity

  # Labels that are DELIBERATELY a different concept per style, so parity does NOT apply:
  # `rock`/`crystal`/`coral` are ascii GROUND-terrain tiles (category terrain, with char/fg/bg variants —
  # they feed `buildAsciiTerrain`, e.g. the lava biome's `rock` ground), while in emoji the same labels are
  # STANDING nature objects (a boulder / a gem). Forcing them to agree would drop the ascii tile out of the
  # ground map (buildAsciiTerrain only keeps terrain/roads/floors WITH variants) and the lava ground would
  # fall back to grass. Documented divergence, not a bug.
  @intentional_divergence ~w(rock crystal coral)

  # PENDING ALEXANDER'S ART DIRECTION — the emoji-only labels that have NO ascii pattern to follow, so a
  # faithful twin can't be authored without INVENTING art (the one thing Alexander forbade — "the RICH style
  # I created … don't invent"): per-creature UNITS (a cat/dragon/wizard — and in ascii an entity already
  # resolves generically to enemy/npc/player, so these never render as their own ascii tile anyway), the
  # single-tile emoji BUILDINGS/props (a whole house/castle/church in ONE glyph — the building VOCABULARY is
  # already covered by the shared multi-cell building compositions), a few atomic nature props (cactus/
  # potted-plant/wood-log) and the runtime combat/locomotion VFX (fist/run/walk). The vocabulary pass
  # (`TileSource.seed_parity`) authored every gap label that DID follow an existing pattern (grounds, decor,
  # tree/nature reuses, wall/window/door); these remain the honest, DOCUMENTED gap until Alexander directs
  # their ascii art. Remove a label from here the moment its ascii twin ships.
  @pending_alexander ~w(
    adult alien arrow bank bat bear bird boar bolt boss boy bullet butterfly cactus castle cat chicken
    child church classical-building cleave connector construction-worker convenience-store cow dart deer
    department-store derelict-house dog dove dragon duck elder elf factory fire-slash fist fountain fox
    frog ghost girl goat goblin grey-alien grey-wolf guard guard-flash guardian heal-glow hedgehog
    honeybee horse hospital hotel house house-garden houses ice-slash japanese-castle ladybug lightning
    mage man mosque ninja nova office-building ogre old-man old-woman owl person piercing-shot pig
    police-officer potted-plant prince princess pumpkin rabbit robot run school sheep skeleton skull
    snail spider squirrel stadium tent torii-gate tower troll turtle vampire walk well witch wizard wolf
    woman wood-log zombie
  )

  setup do
    :ok = TileSource.seed()

    ascii = Map.new(Catalog.list_tiles_for("ascii"), &{&1.label, &1})
    emoji = Map.new(Catalog.list_tiles_for("emoji"), &{&1.label, &1})
    %{ascii: ascii, emoji: emoji}
  end

  test "no tile in EITHER style lacks a baked image (image_url present AND the PNG exists)", ctx do
    static_dir = Application.app_dir(:nebulith, "priv/static")

    offenders =
      for {style, tiles} <- [{"ascii", ctx.ascii}, {"emoji", ctx.emoji}],
          {label, tile} <- tiles,
          reason = image_problem(tile, static_dir),
          reason != nil,
          do: "#{style}/#{label}: #{reason}"

    assert offenders == [],
           "tiles with no baked image (would render `?`):\n" <> Enum.join(offenders, "\n")
  end

  test "every label in one style exists in the other (except the documented divergence + pending-Alexander art)",
       ctx do
    excused = MapSet.new(@intentional_divergence ++ @pending_alexander)
    ascii = MapSet.new(Map.keys(ctx.ascii))
    emoji = MapSet.new(Map.keys(ctx.emoji))

    ascii_only = ascii |> MapSet.difference(emoji) |> MapSet.difference(excused) |> Enum.sort()
    emoji_only = emoji |> MapSet.difference(ascii) |> MapSet.difference(excused) |> Enum.sort()

    assert ascii_only == [],
           "ascii labels with NO emoji twin (would render `?` in emoji):\n" <> Enum.join(ascii_only, ", ")

    assert emoji_only == [],
           "emoji labels with NO ascii twin (would render `?` in ascii) and not documented pending:\n" <>
             Enum.join(emoji_only, ", ")
  end

  test "the pending-Alexander labels are all still genuinely emoji-only (list stays honest as twins ship)",
       ctx do
    ascii = MapSet.new(Map.keys(ctx.ascii))

    already_shipped = Enum.filter(@pending_alexander, &MapSet.member?(ascii, &1))

    assert already_shipped == [],
           "these labels now HAVE an ascii twin — remove them from @pending_alexander:\n" <>
             Enum.join(already_shipped, ", ")
  end

  test "every SHARED label agrees across styles on height, category and blocking", ctx do
    shared =
      MapSet.intersection(MapSet.new(Map.keys(ctx.ascii)), MapSet.new(Map.keys(ctx.emoji)))
      |> MapSet.to_list()
      |> Enum.reject(&(&1 in @intentional_divergence))
      |> Enum.sort()

    mismatches =
      for label <- shared, diff = parity_diff(ctx.ascii[label], ctx.emoji[label]), diff != nil do
        "#{label}: #{diff}"
      end

    assert mismatches == [],
           "shared labels that DON'T behave the same across ascii/emoji:\n" <> Enum.join(mismatches, "\n")
  end

  test "AsciiEmojiBehaviorParity fixes a DRIFTED live ascii row (height/blocking/category), settings untouched, idempotent", ctx do
    door = ctx.ascii["door"]
    settings_before = door.settings

    # simulate the pre-fix live row: a blocking 1-block door (the old ascii glyph-seed default).
    {1, _} =
      from(t in Nebulith.Catalog.Tile, where: t.id == ^door.id)
      |> Repo.update_all(set: [height: 1.0, blocking: true])

    :ok = AsciiEmojiBehaviorParity.run()

    fixed = Enum.find(Catalog.list_tiles_for("ascii"), &(&1.label == "door"))
    emoji_door = ctx.emoji["door"]
    assert fixed.height == emoji_door.height, "door height snaps to the emoji twin"
    assert fixed.blocking == emoji_door.blocking, "door collision snaps to the emoji twin (walkable)"
    assert fixed.category == emoji_door.category
    assert fixed.settings == settings_before, "settings (colour/pose) survive the behavior-only fix"

    # idempotent: a row already in parity changes nothing on a re-run.
    :ok = AsciiEmojiBehaviorParity.run()
    again = Enum.find(Catalog.list_tiles_for("ascii"), &(&1.label == "door"))
    assert again.height == emoji_door.height
  end

  test "AsciiEmojiBehaviorParity leaves the intentionally-divergent ascii ground tiles (rock/crystal/coral) alone", ctx do
    before = Map.new(@intentional_divergence, fn l -> {l, ctx.ascii[l]} end)
    :ok = AsciiEmojiBehaviorParity.run()
    after_run = Map.new(Catalog.list_tiles_for("ascii"), &{&1.label, &1})

    for label <- @intentional_divergence do
      assert after_run[label].height == before[label].height, "#{label} ground height must not be touched"
      assert after_run[label].category == before[label].category, "#{label} stays a ground-terrain tile"
    end
  end

  # nil when the tile has a real baked image; a reason string otherwise.
  defp image_problem(%{image_url: url}, _dir) when url in [nil, ""], do: "image_url is nil/empty"

  defp image_problem(%{image_url: url}, dir) do
    path = Path.join(dir, String.trim_leading(url, "/"))
    if File.exists?(path), do: nil, else: "PNG missing: #{url}"
  end

  # nil when ascii + emoji agree on the three behavioral fields; a description of the diffs otherwise.
  defp parity_diff(a, e) do
    diffs =
      []
      |> field_diff("height", a.height, e.height)
      |> field_diff("category", a.category, e.category)
      |> field_diff("blocking", a.blocking, e.blocking)

    if diffs == [], do: nil, else: Enum.join(diffs, ", ")
  end

  defp field_diff(acc, _name, same, same), do: acc
  defp field_diff(acc, name, a, e), do: acc ++ ["#{name} ascii=#{inspect(a)} emoji=#{inspect(e)}"]
end
