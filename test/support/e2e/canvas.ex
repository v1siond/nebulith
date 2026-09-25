defmodule Nebulith.E2E.Canvas do
  @moduledoc """
  Acting on the map, and reading what came of it.

  ## There is no DOM on a canvas, so what is asserted changes, not whether

  The map is one `<canvas>` element. There are no nodes to query, no text to match, no roles to find.
  That decides WHAT a scenario asserts on, and it is two things, both exact:

  * THE CONTENT. `window.__nebulithGrid` is the grid the app is holding, tile by tile, with every
    setting on it. A scenario that places a tile and then reads the grid is asserting on the data the
    app actually has, not on a picture of it.
  * THE DRAW. `window.__nebulithDrawn` is what the renderer DECIDED for each tile in the last frame:
    which image, at which pixel, or nothing at all. When something is missing from the screen, the
    draw log names the tile responsible, where five pixel detectors only agree that a pixel is wrong.

  ## Pixels, when the question really is about pixels

  `pixel/3` reads the canvas back through its own 2D context, so "is this cell blue" is answered with
  the four numbers the browser has rather than with a baseline image that has to be regenerated on
  every machine. Use `PhoenixTest.Playwright.assert_screenshot/3` for layout and chrome, where a
  baseline earns its keep, and use this where one colour at one place is the whole question.

  ## Clicking a CELL, not a coordinate

  A test should say "place this on cell 12,7", never "click at 431,288". `click_cell/3` asks the live
  render where that cell is via the projection seam, so the click follows the camera instead of
  breaking whenever the view moves.
  """

  import ExUnit.Assertions, only: [flunk: 1]

  alias Nebulith.E2E.Browser

  @canvas "canvas.nebcanvas"

  @doc "The grid the app is holding: cols, rows and every placed tile with its settings."
  def grid(session), do: Browser.js(session, "window.__nebulithGrid")

  @doc "Every placed tile in the open map."
  def tiles(session), do: Browser.js(session, "(window.__nebulithGrid?.assets ?? [])") || []

  @doc """
  THE LABEL OF EVERY PLACED TILE, read in the page.

  Almost every sweep in this suite wants the labels and nothing else, and reaching them through `tiles/1`
  ships the whole asset array to get there: on a 60x60 woodland that is around 2,500 objects, each with its
  settings and its untyped column bag, for 2,500 short strings. That read is the one that intermittently
  comes back empty, and `|| []` then says the map is empty, which is how a built woodland was reported as
  "built an EMPTY map".

  So the page does the projection and sends the strings. Same reasoning as `tile_count/1`, and a nil is
  raised on for the same reason: "the page could not answer" is not "the map has nothing on it".
  """
  def tile_labels(session) do
    case Browser.js(session, "((window.__nebulithGrid?.assets) ?? []).map(a => a.label ?? a.tileKey ?? null).filter(Boolean)") do
      labels when is_list(labels) -> labels
      other -> flunk("the page could not say what it holds, it answered #{inspect(other)}")
    end
  end

  @doc """
  HOW MANY placed tiles, counted in the page.

  `tiles/1` ships every asset over the wire, each with its settings and its untyped column bag, and on a
  100x100 city that is 13,618 of them on EVERY read. A read that big intermittently comes back empty, and
  `|| []` then turns it into zero tiles, which is the same answer as a map that built nothing: measured on
  the big-map scenario, 13,618 on most reads and 0 on roughly one in six, which failed a build that had
  worked perfectly.

  So anything that only wants the COUNT asks for the count, which is one number whatever the map holds. A
  nil is raised on rather than defaulted, because "the page could not answer" and "the map is empty" are
  different facts and the whole defect above was a `||` that treated them as one.
  """
  def tile_count(session) do
    case Browser.js(session, "(window.__nebulithGrid?.assets?.length ?? 0)") do
      n when is_integer(n) -> n
      other -> flunk("the page could not say how many tiles it holds, it answered #{inspect(other)}")
    end
  end

  @doc "Placed tiles carrying `label`."
  def tiles_labelled(session, label),
    do: Enum.filter(tiles(session), &(&1["label"] == label or &1["tileKey"] == label))

  @doc "What the renderer decided to draw in the last frame."
  def drawn(session), do: Browser.js(session, "(window.__nebulithDrawn ?? [])") || []

  @doc "Waits until the map has tiles in it, so a scenario never asserts against a half-built world."
  def wait_for_tiles(session, at_least \\ 1, opts \\ []),
    do:
      Browser.wait_until(
        session,
        &(tile_count(&1) >= at_least),
        "at least #{at_least} tile(s) on the map",
        opts
      )

  @doc """
  Clicks the cell at `col`,`row`, the way a person does.

  A real click at a real place on the canvas. A canvas reads pointer position, so a dispatched event
  with no position tells it nothing, and a bare mouse down and up at the same point is not a click:
  the driver's own click is what carries the click count the page listens for.
  """
  def click_cell(session, col, row) do
    point = cell_point(session, col, row)
    click_at(session, point["x"], point["y"])
  end

  @doc """
  ⌥Alt-clicks the cell at `col`,`row`: "act on the CELL, not on whatever is standing on it".

  One modifier with one meaning across the editor (EDITOR-INTERACTION-SPEC §3), so it is worth being
  able to press it from a scenario. Same projection and the same real click as `click_cell/3`, with
  the modifier held, rather than a second way of reaching a cell.
  """
  def alt_click_cell(session, col, row) do
    point = cell_point(session, col, row)
    click_at(session, point["x"], point["y"], modifiers: ["Alt"])
  end

  @doc """
  Clicks the middle of the canvas, which selects whatever is drawn there.

  For a scenario that needs SOMETHING selected and does not care what. Naming a cell would be a better
  sentence, but on a generated world which cell holds a tile worth selecting is up to the generator
  that day.
  """
  def click_middle(session) do
    %{"width" => w, "height" => h} =
      Browser.js(session, """
      (() => {
        const c = document.querySelector('#{@canvas}')
        if (!c) return null
        const r = c.getBoundingClientRect()
        return { width: r.width, height: r.height }
      })()
      """) || flunk("there is no canvas to click")

    click_at(session, w / 2, h / 2)
  end

  @doc """
  A tile that is actually ON SCREEN right now, with its cell, or nil when none is.

  The camera does not show the whole map, so most of a world's cells project to a point outside the
  canvas. Clicking one of those is not a click on nothing, it is a click somewhere else entirely, and
  what comes back is a ten thousand character Playwright timeout about intercepted pointer events.
  A scenario that wants to select "a tile" asks for one it can reach.
  """
  def a_visible_tile(session, pick \\ fn _ -> true end) do
    %{"width" => w, "height" => h} = canvas_size(session)

    session
    |> tiles()
    |> Enum.filter(pick)
    |> Enum.find(fn tile ->
      case cell_point(session, tile["col"], tile["row"]) do
        %{"x" => x, "y" => y} -> x > 8 and y > 8 and x < w - 8 and y < h - 8
        _ -> false
      end
    end)
  end

  @doc """
  A CELL that is on screen, as `%{"col" => c, "row" => r}`, searching outward from the middle.

  `a_visible_tile/2` answers a different question: it looks through the tiles the map HOLDS, so on a
  scratch map, which carries its ground as `groundData` and an empty asset list, it finds nothing and
  a scenario reads "no cell is on screen" when the whole map is. This asks the projection instead, so
  it answers on a bare map as readily as on a generated one.

  From the middle outward because the camera starts there, so the first candidate is usually the
  answer and the scan costs one round trip.
  """
  def a_visible_cell(session) do
    Browser.js(session, """
    (() => {
      const p = window.__nebulithProject
      const g = window.__nebulithGrid
      const c = document.querySelector('#{@canvas}')
      if (!p || !g || !c) return null
      const r = c.getBoundingClientRect()
      const midCol = Math.floor(g.cols / 2), midRow = Math.floor(g.rows / 2)
      for (let ring = 0; ring < Math.max(g.cols, g.rows); ring++) {
        for (let dc = -ring; dc <= ring; dc++) {
          for (let dr = -ring; dr <= ring; dr++) {
            if (Math.max(Math.abs(dc), Math.abs(dr)) !== ring) continue
            const col = midCol + dc, row = midRow + dr
            if (col < 0 || row < 0 || col >= g.cols || row >= g.rows) continue
            const pt = p.toScreen(col, row)
            if (!pt) continue
            if (pt.x > 8 && pt.y > 8 && pt.x < r.width - 8 && pt.y < r.height - 8) return { col, row }
          }
        }
      }
      return null
    })()
    """)
  end

  defp canvas_size(session) do
    Browser.js(session, """
    (() => {
      const c = document.querySelector('#{@canvas}')
      if (!c) return null
      const r = c.getBoundingClientRect()
      return { width: r.width, height: r.height }
    })()
    """) || flunk("there is no canvas on this page")
  end

  # Coordinates are relative to the canvas itself, which is also what the projection seam speaks, so
  # there is no page offset to carry around and nothing to go wrong when the layout moves.
  defp click_at(session, x, y, opts \\ []) do
    %{"width" => w, "height" => h} = canvas_size(session)

    # SAY IT PLAINLY. A click outside the canvas comes back as a wall of driver log about the document
    # intercepting pointer events, which reads as a defect in the page rather than as a coordinate
    # that was never on it.
    if x < 0 or y < 0 or x > w or y > h do
      flunk(
        "#{round(x)},#{round(y)} is outside the #{round(w)}x#{round(h)} canvas, so that cell is not on screen"
      )
    end

    do_click_at(session, x, y, opts)
  end

  defp do_click_at(session, x, y, opts) do
    session.frame_id
    |> PlaywrightEx.Frame.click(
      [selector: @canvas, position: %{x: x, y: y}, timeout: 10_000] ++ opts
    )
    |> case do
      {:ok, _} -> session
      other -> flunk("clicking the canvas at #{round(x)},#{round(y)} failed: #{inspect(other)}")
    end
  end

  @doc """
  Turns the wheel down until the camera stops zooming out, and says where it stopped.

  MAX ZOOM OUT IS THE WORST CASE, and measuring at the default is measuring the easy one. The camera
  shows a window onto the map, so at 100% a big map has most of itself off screen and the drawn count
  stays flat however large the map gets. Zoomed all the way out that stops being true and the frame has
  to deal with everything at once.

  Real wheel events on the canvas, which is what the handler listens for, rather than reaching for the
  ref behind it.
  """
  def zoom_out_fully(session) do
    Browser.js(session, """
    (() => {
      const c = document.querySelector('#{@canvas}')
      if (!c) return false
      const r = c.getBoundingClientRect()
      for (let i = 0; i < 40; i++) {
        c.dispatchEvent(new WheelEvent('wheel', {
          deltaY: 120, bubbles: true, cancelable: true,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
        }))
      }
      return true
    })()
    """)

    Browser.wait_until(session, &(zoom_percent(&1) != nil), "the zoom readout", timeout: 10_000)
    session
  end

  @doc "What the zoom readout says, as a number, or nil when it is not on screen."
  def zoom_percent(session) do
    # BY ITS TITLE, not by the magnifying glass it wears. Matching the emoji means matching an emoji
    # through two layers of string escaping, and the readout already identifies itself.
    read =
      Browser.js(session, """
      (() => {
        const el = document.querySelector('[title="Camera zoom (mouse wheel)"]')
        if (!el) return null
        const m = (el.textContent || '').match(/(\\d+)\\s*%/)
        return m ? Number(m[1]) : null
      })()
      """)

    case read do
      n when is_number(n) -> round(n)
      _ -> nil
    end
  end

  @doc """
  The frame rate the EDITOR ITSELF is showing, read off the readout a person reads.

  Counting `requestAnimationFrame` is the independent measure; this is the number on screen, and the
  two disagreeing is worth knowing about.
  """
  def readout_fps(session) do
    Browser.js(session, """
    (() => {
      const m = document.body.innerText.match(/FPS\\s*([\\d.]+)/)
      return m ? Number(m[1]) : null
    })()
    """)
  end

  @doc "Where cell `col`,`row` is on the canvas right now, in canvas pixels."
  def cell_point(session, col, row) do
    case Browser.js(session, """
         (() => {
           const p = window.__nebulithProject
           if (!p) return null
           return p.toScreen(#{col}, #{row})
         })()
         """) do
      %{"x" => _, "y" => _} = point ->
        point

      _ ->
        flunk(
          "the render has not published a projection, so cell #{col},#{row} has no place on screen yet"
        )
    end
  end

  @doc """
  The colour of one pixel of the canvas, as `%{r:, g:, b:, a:}`, read from the canvas itself.

  `x` and `y` are canvas coordinates, which is what the projection seam speaks.
  """
  def pixel(session, x, y) do
    case Browser.js(session, """
         (() => {
           const c = document.querySelector('#{@canvas}')
           if (!c) return null
           const d = c.getContext('2d').getImageData(#{x}, #{y}, 1, 1).data
           return { r: d[0], g: d[1], b: d[2], a: d[3] }
         })()
         """) do
      %{"r" => r, "g" => g, "b" => b, "a" => a} -> %{r: r, g: g, b: b, a: a}
      _ -> flunk("could not read the canvas at #{x},#{y}")
    end
  end

  @doc "The colour drawn at the middle of a cell. The visual question, asked about a place on the map."
  def pixel_at_cell(session, col, row) do
    point = cell_point(session, col, row)
    pixel(session, round(point["x"]), round(point["y"]))
  end
end
