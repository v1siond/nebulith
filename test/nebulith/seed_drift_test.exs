defmodule Nebulith.SeedDriftTest do
  @moduledoc """
  SEED ↔ SERVED DRIFT CHECK (ticket 9).

  Catches the class of bug where a FRESH SEED's output diverges from what is stored / served to the
  frontend — a real gap once hid the `squirrel` tile from a live-DB diff (defined in the source, never
  reached the served catalog, so the editor rendered nothing for it). The frontend renders ONLY the
  served `/api/tilesets` (MAP-MODEL §8), so anything the seed defines but the served catalog drops is
  invisible — silent drift.

  ## What it compares — and what it deliberately does NOT

  It compares **geometry / anchors / structural settings**, NEVER the salted appearance. Per
  GENERATION-SPEC §5.4 a building's APPEARANCE (materials / roof / wall colour) is legitimately
  re-rolled AT LOAD via a salt, so a colour comparison would false-positive on every fountain and
  house. Composition cells carry no colour at all (colour is a per-TILE setting); the `@anchor_keys`
  list below is the contract — dx/dy/level/label/walkable + the structural settings that shape the
  block (scaleY / depth / scale / z_index / animations), and nothing that a load-time salt can move.

  ## CI / fixture note

  This seeds a FRESH catalog into the sandboxed test DB (the CI fixture) and diffs the source against
  that served snapshot — no external service, so it runs in plain CI. Pointed at a LIVE production Repo
  the SAME diff would additionally surface editor/live drift; the invariant is directional — seed ⊆
  live (a live DB may legitimately carry MORE: editor-tuned poses per the "DB drifts from seed" memory).
  When no DB is reachable at all, `priv/repo/tilesets/*.json` is the committed offline snapshot.
  """
  use Nebulith.DataCase, async: false

  alias Nebulith.Catalog
  alias Nebulith.Catalog.BuildingCompositions

  # The stable identity of a composition cell — geometry + anchor. NOT colour/material (salted at load).
  @anchor_keys [:dx, :dy, :level, :label, :walkable]

  setup do
    # FRESH SEED = the served catalog under test. (Prints a summary line; harmless in tests.)
    :ok = Nebulith.Catalog.TileSource.seed()
    :ok
  end

  # ── helpers ────────────────────────────────────────────────────────────────

  # Every served composition, name => %{footprint: {w,h}, cells: [normalised cell maps]}.
  defp served_compositions do
    for comp <- Catalog.list_compositions(), into: %{} do
      {comp.name,
       %{
         footprint: {comp.footprint_w, comp.footprint_h},
         cells: Enum.map(comp.cells, &served_cell/1)
       }}
    end
  end

  # A served CompositionCell → the same shape a source cell uses, keys we compare only.
  defp served_cell(c) do
    %{
      dx: c.dx,
      dy: c.dy,
      level: c.level,
      label: c.label,
      walkable: c.walkable,
      scale: c.scale,
      z_index: c.z_index,
      settings: c.settings,
      animated: is_list(c.animations) and c.animations != []
    }
  end

  defp anchor(cell), do: Map.take(cell, @anchor_keys)

  # A source cell (BuildingCompositions) → the comparable shape. Source cells omit defaulted columns,
  # so a missing scale = the DB default 1.0, a missing z_index = 0, missing walkable = false.
  defp source_cell(c) do
    %{
      dx: c.dx,
      dy: c.dy,
      level: c.level,
      label: c.label,
      walkable: Map.get(c, :walkable, false),
      scale: Map.get(c, :scale, 1.0),
      z_index: Map.get(c, :z_index, 0),
      settings: Map.get(c, :settings),
      animated: is_list(Map.get(c, :animations)) and Map.get(c, :animations) != []
    }
  end

  # ── the checks ───────────────────────────────────────────────────────────────

  describe "compositions: fresh seed geometry survives into the served catalog (no dropped/moved cell)" do
    test "every BuildingCompositions.all() building is served with matching footprint + cell ANCHORS" do
      served = served_compositions()

      drift =
        for {name, comp} <- BuildingCompositions.all(), reduce: [] do
          acc ->
            case Map.get(served, name) do
              nil ->
                ["#{name}: MISSING from served catalog" | acc]

              got ->
                want_fp = {comp.footprint_w, comp.footprint_h}
                fp_msg = if got.footprint != want_fp, do: ["#{name}: footprint #{inspect(got.footprint)} != #{inspect(want_fp)}"], else: []

                want = comp.cells |> Enum.map(&(&1 |> source_cell() |> anchor())) |> MapSet.new()
                have = got.cells |> Enum.map(&anchor/1) |> MapSet.new()
                missing = MapSet.difference(want, have)
                cell_msg = if MapSet.size(missing) > 0, do: ["#{name}: #{MapSet.size(missing)} source cell anchor(s) NOT served, e.g. #{inspect(Enum.take(missing, 3))}"], else: []

                fp_msg ++ cell_msg ++ acc
            end
        end

      assert drift == [], "SEED→SERVED composition geometry drift:\n" <> Enum.join(drift, "\n")
    end

    test "STRUCTURAL settings (scaleY/depth/scale/z_index/animations) are not dropped by the seed pipeline" do
      # The squirrel-class gap for SETTINGS: the JSON cell_attrs path drops scale/settings/z_index/
      # animations. Any source cell that carries them must arrive with them (matched by anchor). Compares
      # PRESENCE + value, never a colour.
      served = served_compositions()

      drift =
        for {name, comp} <- BuildingCompositions.all(),
            got = Map.get(served, name),
            got != nil,
            src <- Enum.map(comp.cells, &source_cell/1),
            carries_structure?(src),
            reduce: [] do
          acc ->
            match = Enum.find(got.cells, fn s -> anchor(s) == anchor(src) end)

            cond do
              match == nil -> ["#{name} #{inspect(anchor(src))}: no served cell at this anchor" | acc]
              match.settings != src.settings -> ["#{name} #{inspect(anchor(src))}: settings #{inspect(match.settings)} != #{inspect(src.settings)}" | acc]
              match.scale != src.scale -> ["#{name} #{inspect(anchor(src))}: scale #{match.scale} != #{src.scale}" | acc]
              match.z_index != src.z_index -> ["#{name} #{inspect(anchor(src))}: z_index #{match.z_index} != #{src.z_index}" | acc]
              match.animated != src.animated -> ["#{name} #{inspect(anchor(src))}: animations presence #{match.animated} != #{src.animated}" | acc]
              true -> acc
            end
        end

      assert drift == [], "SEED→SERVED composition settings drift:\n" <> Enum.join(drift, "\n")
    end
  end

  defp carries_structure?(c),
    do: c.settings != nil or c.scale != 1.0 or c.z_index != 0 or c.animated

  describe "tiles: every referenced label is actually served (the squirrel-class gap)" do
    test "every tile a served composition references EXISTS in BOTH the ascii and emoji tilesets" do
      ascii = MapSet.new(Catalog.list_tiles_for("ascii"), & &1.label)
      emoji = MapSet.new(Catalog.list_tiles_for("emoji"), & &1.label)

      referenced =
        served_compositions()
        |> Map.values()
        |> Enum.flat_map(& &1.cells)
        |> Enum.map(& &1.label)
        |> MapSet.new()

      missing_ascii = MapSet.difference(referenced, ascii)
      missing_emoji = MapSet.difference(referenced, emoji)

      assert MapSet.size(missing_ascii) == 0,
             "composition tiles referenced but NOT served in ASCII: #{inspect(MapSet.to_list(missing_ascii))}"

      assert MapSet.size(missing_emoji) == 0,
             "composition tiles referenced but NOT served in EMOJI: #{inspect(MapSet.to_list(missing_emoji))}"
    end

    test "the squirrel regression tile is served in both styles (named guard)" do
      ascii = MapSet.new(Catalog.list_tiles_for("ascii"), & &1.label)
      emoji = MapSet.new(Catalog.list_tiles_for("emoji"), & &1.label)
      assert MapSet.member?(ascii, "squirrel"), "squirrel dropped from the served ASCII catalog"
      assert MapSet.member?(emoji, "squirrel"), "squirrel dropped from the served EMOJI catalog"
    end
  end

  describe "the drift comparison is colour-free by construction (no false-positive on the load-time salt)" do
    test "no served composition cell carries a colour/material/appearance field" do
      # Cells hold geometry + structural settings ONLY; colour is a per-TILE setting and building
      # roof/wall colour is re-rolled at load via a salt (§5.4). If a colour key ever leaks onto a cell
      # a drift check would start false-positiving — this pins the contract.
      appearance = ~w(color colour bg bgColor material roofColor wallColor tint)

      leaked =
        for %{cells: cells} <- Map.values(served_compositions()),
            %{settings: s} when is_map(s) <- cells,
            key <- Map.keys(s),
            key in appearance,
            do: key

      assert leaked == [], "appearance keys leaked onto composition cells (would false-positive the drift check): #{inspect(Enum.uniq(leaked))}"
    end
  end
end
