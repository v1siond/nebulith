defmodule Nebulith.E2E.ACactusDrawsAsWideAsItIsBuiltTest do
  @moduledoc """
  A CACTUS DRAWS AS BROAD AS IT WAS BUILT.

  *"cactus look horrible, we used width instead of thickness to make it, and looks too skynny"*.

  `ACactusIsNotAStickTest` measures the CATALOG. It went green while the picture was still a stick, because
  a number in a column is not a shape on a screen: `docs/renders/family-cactus_saguaro.png` measured 2 pixels
  across and 85 tall with the catalog numbers already corrected. A bare `scaleZ` was thinning every face at
  once, so the widened width never reached the draw.

  So this is the other half, and it is the half that answers the complaint: stamp the object the way a click
  stamps it, then read THE DRAW'S OWN GEOMETRY and measure what came out.

  ## Why the PAINT and not the recorded geometry

  The first version of this measured `__nebulithDrawn`, the polygons the renderer records as it draws, and it
  reported the saguaro's trunk at 44px while the render sheet measured the same trunk at 2px. `blockGeom`
  records the block's UNTHINNED hull: a thickness pulls the faces in inside the shape drawer, and the hull
  the picker hit-tests against keeps the cell. So the seam that cannot drift from the draw cannot see a
  thinning either, and a gate built on it is green while the object is a line.

  So this reads the CANVAS. Pixel-reading is normally the thing to avoid here, because telling a cactus from
  the lawn by hue is how a crown's "lowest pixel" came back as the grass underneath it. Two things remove
  that risk: the region is CLEARED before one single object is stamped into it, and the hue being matched is
  the tile's OWN served colour, read off the placement, never a colour written down here.

  ## Why a sibling rather than a formula

  Re-deriving the isometric projection here would put a second copy of the renderer's arithmetic in a test,
  which goes stale the day the first copy moves. The barrel cactus is the member of this family that always
  drew correctly, and the catalog builds it NARROWER than a saguaro's trunk, so comparing the two needs no
  maths and cannot be satisfied by a stick.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e

  # Big enough that the object stands alone in frame and nothing leans into it.
  @size %{cols: 40, rows: 40}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "every cactus paints at least the width it was built with", %{session: session} do
    # WHAT IT WAS BUILT WITH, asked of the placement, not a number written here. An isometric silhouette is
    # (width + depth) half-cells across, so a bar `w` wide cannot honestly paint narrower than `w` half-cells
    # whatever its thinning does: the floor is the authored width, and it is derived per bar per run.
    #
    # NO SIBLING COMPARISON, and that is a finding rather than a shortcut. The obvious ones do not compare:
    # `ISO_SHAPE_DRAWERS.circle` never passes `assetThickness` to its drawer, so a barrel and a prickly pear
    # are ROUND and ignore thinning entirely, while a saguaro's bars are square and obey it. That is exactly
    # why those two always drew fine while the saguaro was a line, and it makes them the wrong yardstick.
    for family <- ~w(cactus_saguaro cactus_saguaro_old cactus_prickly cactus_barrel) do
      for bar <- place(session, family), is_number(bar["width"]) do
        floor_px = bar["width"] * bar["tileW"]

        assert bar["paintedWidth"] >= floor_px,
               """
               #{family}'s #{bar["label"]} is built #{bar["width"]} across, which is #{round(floor_px)}px at
               this tile size, and it PAINTED #{bar["paintedWidth"]}px. A bar that paints a fraction of the
               width it was built with is the stick that was reported.
               """
      end
    end
  end

  test "a saguaro is broader on screen than a line", %{session: session} do
    bars = place(session, "cactus_saguaro")
    trunk = widest(bars)
    share = trunk["paintedWidth"] / trunk["tileW"]

    # HALF THE CELL'S HALF-WIDTH is the floor, and it is what "not a stick" means in pixels: a bar built to
    # fill its cell across cannot come out narrower than half of one. It drew 0.07 of it.
    assert share >= 0.5,
           """
           the widest bar painted #{trunk["paintedWidth"]}px across a #{trunk["tileW"]}px half-cell, which is
           #{Float.round(share, 3)} of it and reads as a line rather than a plant.

           every bar in the cell, as the draw saw it:
             #{Enum.map_join(bars, "\n  ", &bar_line/1)}
           """
  end

  test "every bar the catalog authors actually reaches the cell", %{session: session} do
    # ASKED OF THE CATALOG, never written down here: a bar added to the object tomorrow is covered the day it
    # is added, which is the moment this gate is most needed.
    authored =
      Browser.js(session, """
      (async () => {
        const body = await (await fetch('/api/tilesets')).json()
        const comps = ((body.data || [])[0] || {}).compositions || {}
        return ((comps['cactus_saguaro'] || {}).cells || []).length
      })()
      """)

    bars = place(session, "cactus_saguaro")
    stems = Enum.filter(bars, &(&1["label"] == "cactus_stem"))

    assert length(stems) == authored,
           """
           the catalog authors #{authored} bars and #{length(stems)} reached the cell. A bar that is authored
           and never placed is the run-collapse swallowing it: these bars share a footprint cell AND a label,
           so two at consecutive levels look like a wall column of two to a pass that exists for wall columns.

           what did arrive:
             #{Enum.map_join(bars, "\n  ", &bar_line/1)}
           """
  end

  defp widest_bar(session, composition), do: session |> place(composition) |> widest()

  defp widest(bars) do
    assert bars != [], "nothing was placed, so there is nothing to measure"
    Enum.max_by(bars, & &1["paintedWidth"])
  end

  defp bar_line(b) do
    "#{b["label"]}: built #{b["width"]} across, #{b["height"]} tall, hull #{b["hullWidth"]}px, " <>
      "painted #{b["paintedWidth"]}px"
  end

  # CLEAR THE MIDDLE, STAMP ONE OBJECT INTO IT, LOOK AT IT. `__placeComposition` is the seam a click goes
  # through, so what this measures is what a person placing one gets.
  defp place(session, composition) do
    mid_col = div(@size.cols, 2)
    mid_row = div(@size.rows, 2)

    Browser.js(session, "window.__clearRegion(#{mid_col - 3}, #{mid_row - 3}, #{mid_col + 3}, #{mid_row + 3})")
    Browser.js(session, "window.__placeComposition(#{Jason.encode!(composition)}, #{mid_col}, #{mid_row})")
    Browser.js(session, "window.__centerOn(#{mid_col}, #{mid_row})")
    Browser.wait_for_js(session, "(window.__nebulithDrawn ?? []).length > 0", "#{composition} to draw")

    drawn_bars(session, mid_col, mid_row)
  end

  # WHAT THE DRAW DECIDED AND WHAT IT ACTUALLY PAINTED, per bar.
  #
  # `hullWidth` is the polygon the renderer recorded (`__nebulithDrawn`), kept as a diagnostic: it is the
  # block's whole cell and it does NOT shrink when a thickness pulls the faces in, which is the trap the
  # moduledoc describes. `paintedWidth` is the widest run of this tile's own colour on the canvas, which is
  # the thing a person looking at the screen sees.
  defp drawn_bars(session, col, row) do
    Browser.js(session, """
    (() => {
      const grid = window.__nebulithGrid
      const proj = window.__nebulithProject
      const drawn = window.__nebulithDrawn ?? []
      if (!grid || !proj) return []

      const assets = (grid.assets ?? []).filter(a => a.col === #{col} && a.row === #{row} && a.label)
      const hits = drawn.filter(h => h.col === #{col} && h.row === #{row})

      const spanOf = (geom) => {
        const pts = geom.kind === 'cube' ? [...geom.base, ...geom.top] : geom.pts
        const xs = pts.map(p => p.x)
        return Math.round(Math.max(...xs) - Math.min(...xs))
      }

      // THE HUE OF A COLOUR THE PLACEMENT CARRIES, never one written down in the test. A block's faces are
      // shaded, so value and saturation move from face to face while the hue is what the tint preserves.
      const hueOf = (hex) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
        if (!m) return null
        const n = parseInt(m[1], 16)
        const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
        const hi = Math.max(r, g, b), lo = Math.min(r, g, b)
        if (hi === lo) return null
        const d = hi - lo
        const h = hi === r ? ((g - b) / d + (g < b ? 6 : 0)) : hi === g ? ((b - r) / d + 2) : ((r - g) / d + 4)
        return h / 6
      }

      // THE WIDEST RUN OF THAT HUE ON THE CANVAS. The region was cleared and one object stamped into it, so
      // the only thing wearing this hue is the object.
      const paintedWidth = (hue) => {
        if (hue === null) return 0
        const cv = document.querySelector('canvas')
        if (!cv) return 0
        const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
        let best = 0
        for (let y = 0; y < cv.height; y++) {
          let run = 0
          for (let x = 0; x < cv.width; x++) {
            const i = (y * cv.width + x) * 4
            const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
            const hi = Math.max(r, g, b), lo = Math.min(r, g, b)
            const d = hi - lo
            let ok = false
            if (d > 0.06 && hi > 0.1) {
              const h = hi === r ? ((g - b) / d + (g < b ? 6 : 0)) : hi === g ? ((b - r) / d + 2) : ((r - g) / d + 4)
              const dist = Math.abs(h / 6 - hue)
              ok = Math.min(dist, 1 - dist) < 0.04
            }
            run = ok ? run + 1 : 0
            if (run > best) best = run
          }
        }
        return best
      }

      const widths = new Map()
      for (const a of assets) {
        if (!widths.has(a.color)) widths.set(a.color, paintedWidth(hueOf(a.color)))
      }

      return assets.map((a, i) => {
        const hit = hits.find(h => h.level === (a.heightLevel ?? 0) && h.stackIndex === i) ?? hits[i]
        return {
          label: a.label,
          width: a.width ?? null,
          height: a.height ?? null,
          tileW: proj.tileW,
          hullWidth: hit ? spanOf(hit.geom) : 0,
          paintedWidth: widths.get(a.color) ?? 0,
        }
      })
    })()
    """) || []
  end
end
