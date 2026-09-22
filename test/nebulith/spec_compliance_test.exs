defmodule Nebulith.SpecComplianceTest do
  @moduledoc """
  THE LAWS, AS A GATE.

  Compliance with `docs/SPEC.md` is mandatory, expected and implied, and that is exactly why it cannot
  live in somebody's memory. This checks the laws that can be checked mechanically, against the schema
  the backend actually serves, so a drift fails here instead of being noticed months later.

  It runs in `mix test` rather than in the browser layer, because none of it is a user action: it
  reads source files and two payloads. That means it gates every commit rather than only the runs that
  have a browser, which is where it used to sit and where it was skipped.

  LAW 1  A second vocabulary whose whole job is to be translated back is not a concept. Every field
         the engine carries on a placed tile is either a COLUMN, spelled the way the column is
         spelled, or is on the list below with a reason. `scaleX` and `scaleY` were exactly this:
         Width and Height under other names, translated at every boundary.

  LAW 7  The backend decides values, the frontend renders them. A hardcoded fallback for served data
         is a defect, not a safety net. Every column has a DEFAULT and /api/maps/schema serves it, so
         a literal standing in for one is the engine holding a second opinion about a value the
         database already states, and it is the opinion that reaches the screen.

  LAW 12 The frontend sets no limits. No minimum, no maximum, no step invented in React.

  PHASE 3'S DELETE LIST is the other half of law 1. `walkable`, `blocking`, `blocked`,
         `blocks_movement`, `is_solid` and `occupies` are gone as STORED and SERVED words: what a tile
         occupies is the only statement about walking through it. The words survive as local names
         inside a planner and inside movement, which is what a variable is for. What may not survive
         is a column, a served field, or a type the engine carries between them.
  """
  use NebulithWeb.ConnCase, async: true

  setup :log_in_api_user

  @assets Path.expand("../../assets", __DIR__)

  # Fields the ENGINE carries that are deliberately not columns, each with the reason. A name may only
  # sit here because it is not a setting at all, or because the spec puts it in another table in a
  # later phase. "It is convenient" is not a reason, and neither is "it already existed".
  @engine_only %{
    "art" => "the glyph rows a tile draws with, resolved from the tileset, never authored",
    "col" => "where the tile is. The cell owns it, and a cell_tile hangs off the cell",
    "row" => "where the tile is. The cell owns it",
    "type" => "the discriminator the stack helpers read. tiles.category in the schema",
    "label" => "what the tile draws as. The engine resolves BY label; the column is tile_id",
    "tileKey" => "the same question as label, kept while both spellings are still read",
    "tileOverride" => "a per-cell art pin. tiles.autotile_slot territory, phase 7",
    "heightLevel" => "which level the tile sits on. cell_tiles.stack_level",
    "zIndex" => "cell_tiles.draw_order",
    "zOffset" => "cell_tiles.slide_amount",
    "zDir" => "cell_tiles.slide_direction",
    "spanForward" => "cell_tiles.span_forward",
    "spanBack" => "cell_tiles.span_back",
    "spanPerp" => "cell_tiles.span_perp",
    "spanPerpBack" => "cell_tiles.span_perp_back",
    "spanAxis" => "cell_tiles.span_axis",
    "sideColor" => "cell_tiles.side_color",
    "bgColor" => "cell_tiles.bg_color",
    "pose" => "nudge_x, nudge_y, rotation, mirror, art_scale and muzzle, as one object",
    "thickness" => "the four thickness_* reaches, as one object in the engine",
    "flow" => "cell_tiles.water_heading, as a quarter turn rather than a compass point",
    "settings" =>
      "display, transparent, fade_near, cutaway_near, min_alpha, act_as_tile, the badge",
    "animations" => "phase 6, the animation tables",
    "cycles" => "phase 6, the animation tables",
    "cellAnim" => "phase 6, the animation tables",
    "placedAt" => "phase 6: when a tile was placed, which is what a delay is measured from",
    "light" => "phase 6, the lights table",
    "baseShadow" => "DELETED by section 9. Shadows come from the sun. Still read while it goes",
    "buildingType" => "building_templates.key, phase 8",
    "edge" => "tiles.autotile_slot, phase 7",
    "cellPart" => "tiles.autotile_slot, phase 7. Debug labels only, it touches no renderer",
    "footprint" => "compositions, phase 7"
  }

  @deleted ~w(walkable blocking blocked blocks_movement is_solid occupies)

  # The files that WRITE a placement or carry one across the wire. A renderer reading `asset.x ?? 1`
  # is the same defect, but these are where a value is DECIDED, and a literal here is the one that
  # persists: it is written to the row and read back as if somebody meant it.
  @writers [
    "game/engine/IsometricGrid.ts",
    "game/lib/mapPayload.ts",
    "game/game/runtime/composition.ts",
    "game/engine/tileset/placementSettings.ts"
  ]

  # The readers that ask the database instead of inventing an answer.
  @served ~r/numericDefault\(|booleanDefault\(|stringDefault\(|defaultOf\(|columnNumber\(|beyondAnchor\(/

  describe "law 1: the engine's vocabulary is the schema's vocabulary" do
    test "every field the engine carries is a column, or is listed with a reason" do
      fields = grid_asset_fields()
      assert length(fields) > 20, "the GridAsset interface did not parse"

      unexplained = Enum.reject(fields, &explained?/1)

      assert unexplained == [],
             "these are on a placed tile and are neither a column nor listed: #{inspect(unexplained)}"
    end

    test "no size axis comes back under another name" do
      fields = grid_asset_fields()

      for gone <- ~w(scale scaleX scaleY scaleZ) do
        refute gone in fields, "#{gone} is a field on a placed tile again"
      end
    end
  end

  describe "law 7: a served value is never stated as a literal" do
    test "the writers state no column's value as an invented number" do
      for file <- @writers do
        hits = file |> read_asset() |> literal_fallbacks()

        assert hits == [],
               "#{file} invents values the database already states:\n  " <>
                 Enum.join(hits, "\n  ")
      end
    end
  end

  describe "law 12: the frontend sets no limits" do
    test "every slider takes its bounds from dragRange, which grows rather than caps" do
      inspector = read_asset("game/components/editorInspector.tsx")

      ranges =
        ~r/<input type="range"[^>]*>/
        |> Regex.scan(inspector)
        |> Enum.map(&hd/1)

      assert ranges != [], "the inspector did not parse, so this proves nothing"

      capped =
        Enum.reject(ranges, fn tag ->
          String.contains?(tag, "dragRange") or Regex.match?(~r/\bmin=\{drag\.min\}/, tag)
        end)

      assert capped == [],
             "these sliders cap a value instead of following it: " <>
               Enum.map_join(capped, " | ", &String.slice(&1, 0, 70))

      # And dragRange itself has to be the thing that grows, or the check above proves nothing.
      assert inspector =~ ~r/Math\.min\(min, value\)/ and inspector =~ ~r/Math\.max\(max, value\)/,
             "dragRange clamps rather than growing to hold the value"
    end
  end

  describe "phase 3's delete list" do
    test "the tileset payload serves none of the deleted words", %{conn: conn} do
      served = conn |> get(~p"/api/tilesets") |> response(200)

      for word <- @deleted do
        refute served =~ ~r/"#{word}"\s*:/, "the tileset payload serves #{word}"
      end
    end

    test "the engine's own types carry none of them between the wire and a draw" do
      for {file, type} <- [
            {"game/engine/tileset/styleTiles.ts", "StyleTile"},
            {"game/engine/tileset/tileset.ts", "CompositionCell"},
            {"game/engine/tileset/tileset.ts", "ResolvedTile"}
          ] do
        body = file |> read_asset() |> interface_body(type)
        carried = Enum.filter(@deleted, &Regex.match?(~r/^\s{2}#{&1}\??:/m, body))

        assert carried == [], "#{type} still carries #{inspect(carried)}"
      end
    end

    test "no schema carries one as a column" do
      fields =
        :nebulith
        |> Application.spec(:modules)
        |> Enum.filter(&ecto_schema?/1)
        |> Enum.flat_map(fn mod -> Enum.map(mod.__schema__(:fields), &{mod, &1}) end)
        |> Enum.filter(fn {_mod, field} -> Atom.to_string(field) in @deleted end)

      assert fields == [],
             "a schema still declares a deleted word as a column: #{inspect(fields)}"
    end
  end

  # ── reading the source ────────────────────────────────────────────────────────────────────────

  defp read_asset(path), do: @assets |> Path.join(path) |> File.read!()

  defp grid_asset_fields do
    "game/engine/IsometricGrid.ts"
    |> read_asset()
    |> interface_body("GridAsset")
    |> then(&Regex.scan(~r/^\s{2}(\w+)\??:/m, &1))
    |> Enum.map(&Enum.at(&1, 1))
  end

  defp interface_body(source, type) do
    case String.split(source, "export interface #{type} {", parts: 2) do
      [_, rest] -> rest |> String.split("\n}", parts: 2) |> hd()
      _ -> ""
    end
  end

  defp explained?(field),
    do: Map.has_key?(@engine_only, field) or field in columns() or snake(field) in columns()

  defp columns, do: Enum.map(Nebulith.World.CellTile.settable_fields(), &Atom.to_string/1)

  defp snake(name), do: Regex.replace(~r/[A-Z]/, name, fn c -> "_" <> String.downcase(c) end)

  # WHAT IS BEING WRITTEN, not what is being read.
  #
  # An earlier shape of this flagged any `x ?? 1` whose left side shared a name with a column, and it
  # was noisy in a way that would have got it switched off: `(f.spanForward ?? 1) > 1` is a question
  # about whether a tile spans, and `cell.level ?? 0` is a composition cell's own authored level,
  # which merely shares a word with a column.
  #
  # The defect is a literal being STORED as a setting's value, so what is matched is the assignment: a
  # column's name, a colon, and a made-up value on the other side of a `??`.
  defp literal_fallbacks(source) do
    source
    |> String.split("\n")
    |> Enum.with_index(1)
    |> Enum.map(fn {line, n} -> {strip_comments(line), n} end)
    |> Enum.filter(fn {code, _n} -> String.contains?(code, "??") end)
    |> Enum.reject(fn {code, _n} -> Regex.match?(@served, code) end)
    |> Enum.flat_map(&invented_value/1)
  end

  defp strip_comments(line) do
    line |> String.replace(~r{//.*$}, "") |> String.replace(~r{/\*.*?\*/}, "")
  end

  defp invented_value({code, n}) do
    case Regex.run(~r/^\s*(\w+):\s*[^?]*\?\?\s*(-?\d+(?:\.\d+)?|'[^']*'|"[^"]*")/, code) do
      [_, field, _value] -> stored_column(field, code, n)
      _ -> []
    end
  end

  defp stored_column(field, code, n) do
    case field in columns() or snake(field) in columns() do
      true -> ["#{n}: #{String.trim(code)}"]
      false -> []
    end
  end

  defp ecto_schema?(mod) do
    Code.ensure_loaded?(mod) and function_exported?(mod, :__schema__, 1)
  end
end
