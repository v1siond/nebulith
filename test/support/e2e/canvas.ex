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
    do: Browser.wait_until(session, &(length(tiles(&1)) >= at_least), "at least #{at_least} tile(s) on the map", opts)

  @doc """
  Presses the pointer on the cell at `col`,`row`, the way a person does.

  Real mouse events at real coordinates, not a synthetic DOM event: a canvas reads pointer position,
  and a dispatched event with no position tells it nothing.
  """
  def click_cell(session, col, row) do
    point = cell_point(session, col, row)
    {:ok, _} = PlaywrightEx.Page.mouse_move(session.page_id, x: point["x"], y: point["y"])
    {:ok, _} = PlaywrightEx.Page.mouse_down(session.page_id)
    {:ok, _} = PlaywrightEx.Page.mouse_up(session.page_id)
    session
  end

  @doc "Where cell `col`,`row` is on screen right now, in page pixels."
  def cell_point(session, col, row) do
    case Browser.js(session, """
         (() => {
           const p = window.__nebulithProject
           const c = document.querySelector('#{@canvas}')
           if (!p || !c) return null
           const r = c.getBoundingClientRect()
           const s = p.toScreen(#{col}, #{row})
           return { x: r.left + s.x, y: r.top + s.y }
         })()
         """) do
      %{"x" => _, "y" => _} = point -> point
      _ -> flunk("the render has not published a projection, so cell #{col},#{row} has no place on screen yet")
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
    canvas = Browser.js(session, "document.querySelector('#{@canvas}').getBoundingClientRect()")
    pixel(session, round(point["x"] - canvas["x"]), round(point["y"] - canvas["y"]))
  end
end
