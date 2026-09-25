defmodule Nebulith.E2E.TheFrontendSetsNoLimitsTest do
  @moduledoc """
  A SIZE YOU TYPE IS A SIZE YOU GET. The panel invents no maximum.

  `docs/SPEC.md` law 12: *"The frontend sets no limits. No minimum, no maximum, no step invented in
  React."* Phase 1 DELETE names the offender by name: *"the hardcoded `ascii` default, and
  `MAP_SIZE_MAX` as a constant"*. Quoted into the spec from his own words:

      none of the sliders should be limited... the react side just reacts the values of the backend and
      allow us to change them in the state, as simple as that

  ## Measured before the fix

  `assets/game/lib/mapSize.ts` exported `MAP_SIZE_MAX = 100`, and `mapSizeValid/1` returned false above
  it, which DISABLED the resize button. The backend has no such rule: `Grid.changeset/2` validates
  `cols` and `rows` with `greater_than: 0` and nothing else. So a 120 cell map was refused by React
  alone, on a number React made up, against a backend that would have accepted it.

  Its own file admitted it: *"A CEILING is back... this is a deliberate, temporary bound while the
  renderer catches up, not a return to the old rule."* A temporary bound that outlived the phase that
  said to delete it.

  ## Why through the panel and not the API

  Because the defect only exists in the panel. `World.scratch_map/1` builds a map through the backend
  and would have sailed past a cap that stops a person dead. The only way to see what a person sees is
  to type into the box they type into and press the button they press.

  ## Why this reads `Template` and not `grids`

  Because that is where the editor actually saves. `api.ts` posts and puts to `/api/templates`, and
  `Catalog.create_template/1` writes the `Template` row and nothing else. `maps`, `grids`, `cells` and
  `cell_tiles` all exist, with a controller, and the editor's SAVE does not use them.

  That is phase 3's REWIRE half, undone: the tables were built and the writer never moved. `docs/SPEC.md`
  8.0 is explicit that this means the phase is not done, and it is why `Template` still holds six jsonb
  blobs that the spec's schema does not contain at all. When that port happens this assertion moves to
  `grids`, and it should be the same three lines.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :phase1
  @moduletag timeout: 600_000

  alias Nebulith.E2E.Browser
  alias Nebulith.E2E.Canvas
  alias Nebulith.Repo

  import Ecto.Query

  # ABOVE THE OLD CEILING OF 100, and no larger than it needs to be: this is about whether the number is
  # honoured, not about how big a map can render.
  @cols 120
  @rows 104

  setup context do
    context
    |> Elixir.Map.put(:map, %{cols: 20, rows: 20})
    |> a_signed_in_editor()
  end

  test "a map larger than the old frontend cap can be typed and built", %{
    session: session,
    map: map
  } do
    Browser.fill(session, ~s|input[aria-label="Map columns"]|, "#{@cols}")
    Browser.fill(session, ~s|input[aria-label="Map rows"]|, "#{@rows}")

    # THE BUTTON MUST BE OFFERED AND ENABLED. Before the fix it rendered disabled, which is the whole
    # defect: the panel refusing a number the backend would have taken.
    enabled? = """
    (() => {
      const b = [...document.querySelectorAll('button')].find(x => /Resize this map to/.test(x.textContent || ''))
      return !!b && !b.disabled
    })()
    """

    Browser.wait_for_js(session, enabled?, "the resize button to be offered and enabled")

    {:ok, _} =
      PlaywrightEx.Frame.click(session.frame_id,
        selector: ~s|button:has-text("Resize this map to")|,
        timeout: 20_000
      )

    Browser.wait_until(
      session,
      fn s -> Canvas.grid(s)["cols"] == @cols and Canvas.grid(s)["rows"] == @rows end,
      "the open map to become #{@cols} x #{@rows}",
      timeout: 120_000
    )

    # …THEN SAVE IT, through the button, because a resize is a local edit until you press Save and a
    # scenario that skips the press is not the journey a person takes.
    Nebulith.E2E.Editor.save(session, map.id)

    # …AND THE ROW THE APP ACTUALLY SAVED, because the grid in the browser is what it drew and the row is
    # what it kept. *"we just use the UI and validate that the data is correct, as simple as that."*
    # THE GRID ROW, because that is what owns a map's shape (`docs/SPEC.md` §3.2). It used to be read off
    # the template, which carried its own copy of `cols` and `rows` and was written on every save. Phase 3
    # moved the shape to `grids` and the template stopped carrying it, so reading the old copy here would
    # be checking a number nothing writes any more.
    saved =
      Repo.one!(
        from(g in Nebulith.World.Grid, join: m in assoc(g, :map), where: m.template_id == ^map.id)
      )

    assert {saved.cols, saved.rows} == {@cols, @rows},
           "the panel accepted #{@cols}x#{@rows} but the saved row is #{saved.cols}x#{saved.rows}"
  end
end
