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
        &(length(tiles(&1)) >= at_least),
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
  defp click_at(session, x, y) do
    %{"width" => w, "height" => h} = canvas_size(session)

    # SAY IT PLAINLY. A click outside the canvas comes back as a wall of driver log about the document
    # intercepting pointer events, which reads as a defect in the page rather than as a coordinate
    # that was never on it.
    if x < 0 or y < 0 or x > w or y > h do
      flunk(
        "#{round(x)},#{round(y)} is outside the #{round(w)}x#{round(h)} canvas, so that cell is not on screen"
      )
    end

    do_click_at(session, x, y)
  end

  defp do_click_at(session, x, y) do
    session.frame_id
    |> PlaywrightEx.Frame.click(
      selector: @canvas,
      position: %{x: x, y: y},
      timeout: 10_000
    )
    |> case do
      {:ok, _} -> session
      other -> flunk("clicking the canvas at #{round(x)},#{round(y)} failed: #{inspect(other)}")
    end
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
