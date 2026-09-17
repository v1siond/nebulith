defmodule Nebulith.DataMigration.ARegionFloorComesFromItsBiome do
  @moduledoc """
  A region's floor is its biome's floor in that region's light, not a colour of its own.

  *"I don't see any of this when generating templates, town, village, city and reglar forest desert all show
  the same colors as before, no varuiations"*.

  He was right and the previous migration was real but INVISIBLE. `TheGroundBelongsToItsBiome` set
  `palette.floor` correctly (the API served Desert `#9e765f`), and then `paintSubZoneFloors` painted each
  region's OWN `floor` straight over the top of it.

  ## Measured

  Desert and Beach carried byte-identical region floors, the old green-olive set:

      edge #8c9a5b   deep #6b7a45   glade #9aa768   thicket #7c8a4e   lakeside #b8a978

  `#8c9a5b` is Desert's `edge`, and it was the single most common floor colour on a generated desert, 594
  cells. The same shared-pairs defect as the canopy, the undergrowth and the biome floor, one level deeper
  again, and it was the level that actually won.

  ## The fix, and why it is derivation rather than another table

  Writing a fourth hand-made table would have been a fourth thing to keep in sync. Each region's floor is
  DERIVED from its own biome's `palette.floor`, shifted by how much light that region gets, which is exactly
  the rule the foliage already uses for `leafHue` and `leafValue`. One idea in the engine, not two.

      glade     +0.10 value   the ABSENCE of canopy, the most light
      edge      +0.05         the open margin
      thicket   -0.04         low dense growth
      deep      -0.08         closed over, the darkest
      lakeside  +0.02, cooler damp ground at the water's edge

  A biome that serves no `palette.floor` is skipped rather than given an invented one (Meadow paints a
  season gradient on purpose, Cave and Temple have no floor palette at all).

  Idempotent: recomputed from the biome each run, so a change to a biome floor reaches its regions for free.
  """
  require Logger

  alias Nebulith.Repo

  # {value offset, hue offset in degrees}
  @light %{
    "glade" => {0.10, 4},
    "edge" => {0.05, 2},
    "thicket" => {-0.04, -2},
    "deep" => {-0.08, -4},
    "lakeside" => {0.02, -6}
  }

  def run do
    rows =
      for %{name: name, floor: floor, zones: zones} <- generators_with_floor(), reduce: 0 do
        acc -> acc + repaint(name, floor, zones)
      end

    Logger.info("[data_migrate] #{rows} generators derive their region floors from their biome")

    :ok
  end

  defp generators_with_floor do
    %{rows: rows} =
      Repo.query!("""
      SELECT name, config->'palette'->>'floor', config->'subZones'
      FROM generators
      WHERE config->'palette'->>'floor' IS NOT NULL AND config->'subZones' IS NOT NULL
      """)

    for [name, floor, zones] <- rows, do: %{name: name, floor: floor, zones: zones}
  end

  defp repaint(name, floor, zones) do
    painted =
      for zone <- zones, into: %{} do
        key = zone["key"]
        {dv, dh} = Map.get(@light, key, {0.0, 0})
        {key, shift(floor, dv, dh)}
      end

    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{subZones}', (
          SELECT jsonb_agg(
            CASE WHEN $2::text::jsonb ? (z->>'key') THEN jsonb_set(z, '{floor}', $2::text::jsonb -> (z->>'key')) ELSE z END
            ORDER BY ord
          )
          FROM jsonb_array_elements(config->'subZones') WITH ORDINALITY AS t(z, ord)
        ))
        WHERE name = $1
        """,
        [name, Jason.encode!(painted)]
      )

    rows
  end

  # Hue rotates, value shifts, saturation is left alone: the tint moves the HUE and the art carries the tone
  # (`colour-tints-luminance-stays`), and a region is the same ground in different light.
  defp shift("#" <> hex, dv, dh) when byte_size(hex) == 6 do
    {r, g, b} = {slice(hex, 0), slice(hex, 2), slice(hex, 4)}
    {h, s, v} = to_hsv(r / 255, g / 255, b / 255)
    to_hex(:math.fmod(h + dh + 360, 360), s, clamp(v + dv))
  end

  defp shift(other, _dv, _dh), do: other

  defp slice(hex, at), do: hex |> binary_part(at, 2) |> String.to_integer(16)
  defp clamp(v), do: v |> max(0.0) |> min(1.0)

  defp to_hsv(r, g, b) do
    max_c = Enum.max([r, g, b])
    min_c = Enum.min([r, g, b])
    d = max_c - min_c
    s = if max_c == 0.0, do: 0.0, else: d / max_c
    {hue(r, g, b, max_c, d), s, max_c}
  end

  defp hue(_r, _g, _b, _max, +0.0), do: 0.0
  defp hue(r, g, b, max, d) when max == r, do: :math.fmod(60 * ((g - b) / d) + 360, 360)
  defp hue(r, g, b, max, d) when max == g, do: 60 * ((b - r) / d) + 120
  defp hue(r, g, _b, _max, d), do: 60 * ((r - g) / d) + 240

  defp to_hex(h, s, v) do
    c = v * s
    hp = h / 60
    x = c * (1 - abs(:math.fmod(hp, 2) - 1))
    m = v - c
    {r, g, b} = rgb(trunc(hp), c, x)

    [r, g, b]
    |> Enum.map_join(fn n -> n |> Kernel.+(m) |> Kernel.*(255) |> round() |> Integer.to_string(16) |> String.pad_leading(2, "0") end)
    |> then(&("#" <> String.downcase(&1)))
  end

  defp rgb(0, c, x), do: {c, x, 0.0}
  defp rgb(1, c, x), do: {x, c, 0.0}
  defp rgb(2, c, x), do: {0.0, c, x}
  defp rgb(3, c, x), do: {0.0, x, c}
  defp rgb(4, c, x), do: {x, 0.0, c}
  defp rgb(_, c, x), do: {c, 0.0, x}
end
