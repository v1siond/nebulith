defmodule Nebulith.E2E.EveryShapeObeysThicknessTest do
  @moduledoc """
  THICKNESS WORKS ON A ROUND TILE, THE SAME AS ON A SQUARE ONE.

  *"I can select any part(tile) of the tree, then modify it's thickness or width or whatever to make it
  thin."* You can select it and you can move the number. Until this, on a round tile, nothing happened.

  `ISO_SHAPE_DRAWERS` dispatches on a tile's shape, and the square drawer handed `assetThickness` to the
  block it drew while the circle and cone drawers did not. A round tile IS a cuboid with a clip over it, so
  there was never a reason for the two to differ. 26 of the catalogue's 31 round objects are trees, so this
  was every tree crown in the game carrying a control that moved and did nothing.

  It is the standing rule broken in one line: a setting applies to EVERY tile through the same path, and one
  gated by a tile's type is a bug rather than a design.

  ## Why nothing on an existing map moves

  No seeded object sets a thickness on a round cell, and an unset reach answers 1, which is the full cell. So
  every map drawn before this is drawn identically after it. What changes is that the control now does what
  it says when a person uses it, which is the only reason it is on the panel.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e

  @size %{cols: 20, rows: 20}

  setup context do
    context
    |> Elixir.Map.put(:map, @size)
    |> a_signed_in_editor()
  end

  test "a round tile thinned in the panel draws thinner, and a square one still does", %{session: session} do
    # A ROUND object and a SQUARE one, both real compositions the catalogue serves. The square one is the
    # control: it honoured thickness before this change and has to keep honouring it after. The first version
    # of this used a bare tile LABEL for the control, which `__placeComposition` does not place, so it
    # measured empty ground and reported the control as broken.
    for {object, shape} <- [{"tree_round", "round"}, {"lamp_post", "square"}] do
      wide = painted_width(session, object, nil)
      thin = painted_width(session, object, 0.3)

      assert wide > 0, "#{object} painted nothing at all, so this measures nothing"

      assert thin < wide,
             """
             #{object} is a #{shape} tile. Thinned to 0.3 of its cell it painted #{thin}px, and untouched it
             painted #{wide}px, so moving the Thickness control changed nothing about it.
             """
    end
  end

  # PLACE IT, OPTIONALLY THIN IT, MEASURE WHAT GOT PAINTED. The thinning is written the way the panel writes
  # it, onto the placement, so this measures the control's own path and not a seeder's.
  defp painted_width(session, label, reach) do
    mid = div(@size.cols, 2)
    Browser.js(session, "window.__clearRegion(#{mid - 2}, #{mid - 2}, #{mid + 2}, #{mid + 2})")
    Browser.js(session, "window.__placeComposition(#{Jason.encode!(label)}, #{mid}, #{mid})")

    thinning =
      case reach do
        nil -> "null"
        r -> ~s|{"left-down": #{r}, "right-up": #{r}, "right-down": 1, "left-up": 1}|
      end

    Browser.js(session, """
    (() => {
      const g = window.__nebulithGrid
      const here = (g.assets ?? []).filter(a => a.col === #{mid} && a.row === #{mid} && a.label)
      const reach = #{thinning}
      for (const a of here) { if (reach) a.thickness = reach; else delete a.thickness }
      return here.length
    })()
    """)

    # THE CAMERA MOVE IS WHAT REPAINTS. There is no render seam on the page, and the first version of this
    # centred BEFORE changing the placement, so it measured the same frame twice and reported the same number
    # either way. A measurement taken before the change is not a measurement of the change.
    Browser.js(session, "window.__centerOn(#{mid}, #{mid})")
    Browser.wait_for_js(session, "(window.__nebulithDrawn ?? []).length > 0", "#{label} to draw")

    Browser.js(session, """
    (() => {
      const cv = document.querySelector('canvas')
      const px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data
      const ground = new Map()
      let best = 0
      for (let y = 0; y < cv.height; y++) {
        let run = 0
        for (let x = 0; x < cv.width; x++) {
          const i = (y * cv.width + x) * 4
          const r = px[i], g2 = px[i + 1], b = px[i + 2]
          // Anything that is not the dark page ground counts as the object, which is safe because the
          // region was cleared and one object stands in it.
          const lit = (r + g2 + b) > 140 && Math.max(r, g2, b) - Math.min(r, g2, b) > 18
          run = lit ? run + 1 : 0
          if (run > best) best = run
        }
      }
      return best
    })()
    """) || 0
  end
end
