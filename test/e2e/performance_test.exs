defmodule Nebulith.E2E.PerformanceTest do
  @moduledoc """
  HOW MANY FRAMES A REAL MAP DRAWS, measured through the UI a person uses.

  We are building isometric games. The target is near 120 frames a second, and the number this reports
  is the app's OWN frame rate: `requestAnimationFrame` is wrapped before the page loads, so what is
  counted is the render loop's callbacks rather than anything this test does.

  ## It refuses to measure nothing

  This harness once reported 120 fps at 0.37ms a frame, and 0.37ms cannot draw five thousand tiles: the
  run had not built a world, and an empty canvas redraws very fast. A measurement that cannot tell
  "fast" from "nothing there" is worse than none, because it gets quoted. So every sample asserts the
  scene has tiles in it before it believes a number.

  ## Run it

      bin/e2e test/e2e/performance_test.exs --include perf

  Excluded from the normal run because it takes minutes: each size is a whole world generation plus
  three timed samples.

  The 100 fps floor is this file's reading of "close to 120", stated here so it is arguable rather
  than buried.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e
  @moduletag :perf
  @moduletag timeout: 900_000

  alias Nebulith.E2E.GeneratePanel

  # "close to 120fps"
  @floor_fps 100
  @seconds 5

  # Different types, regions and sizes, as asked.
  @worlds [
    {"a small wilderness", %{cols: 40, rows: 40}, "wilderness", "Woodland"},
    {"a wide city", %{cols: 100, rows: 60}, "city", "Woodland city"},
    {"a large city", %{cols: 100, rows: 100}, "city", "Jungle city"}
  ]

  setup %{conn: conn} do
    World.seed_catalog()
    %{conn: count_frames(conn), user: Account.an_admin()}
  end

  for {what, size, category, preset} <- @worlds do
    @what what
    @size size
    @category category
    @preset preset

    test "#{what} at #{size.cols}x#{size.rows} draws near 120 frames a second",
         %{conn: conn, user: user} do
      map = World.scratch_map(@size)

      session =
        conn
        |> Account.sign_in(user)
        |> Editor.open(map.id)
        |> GeneratePanel.build_world(@category, @preset)

      tiles = length(Canvas.tiles(session))

      assert tiles >= 500,
             "refusing to measure an empty scene: #{@what} built #{tiles} tiles, so it never generated"

      idle = sample(session, [])
      walking = sample(session, ["w", "d"])

      report(@what, @size, tiles, idle, walking)

      assert walking.fps >= @floor_fps,
             "#{@what} (#{@size.cols}x#{@size.rows}, #{tiles} tiles) draws #{Float.round(walking.fps, 1)} " <>
               "frames a second while walking, against a floor of #{@floor_fps}. " <>
               "One render costs #{Float.round(walking.render_avg, 2)}ms of a #{Float.round(1000 / @floor_fps, 1)}ms budget."
    end
  end

  # COUNT THE APP'S OWN FRAMES. The loop is one rAF chain, so counting its callbacks counts its frames.
  # Installed before any page script, or the app's own loop is already running unwrapped.
  defp count_frames(conn) do
    {:ok, _} =
      PlaywrightEx.BrowserContext.add_init_script(conn.context_id,
        source: """
        (() => {
          const w = window
          w.__frames = 0
          const raf = w.requestAnimationFrame.bind(w)
          w.requestAnimationFrame = (cb) => raf((t) => { w.__frames++; return cb(t) })
        })()
        """,
        timeout: 10_000
      )

    conn
  end

  defp sample(session, keys) do
    Browser.js(session, "window.__frames = 0; window.__iso = []; true")

    Browser.js(session, """
    window.__isoTimer = setInterval(() => {
      if (typeof window.__isoRenderMs === 'number') window.__iso.push(window.__isoRenderMs)
    }, 50)
    """)

    started = System.monotonic_time(:millisecond)
    walk(session, keys, started + @seconds * 1000)
    elapsed = (System.monotonic_time(:millisecond) - started) / 1000

    raw =
      Browser.js(session, """
      (() => {
        clearInterval(window.__isoTimer)
        const iso = window.__iso ?? []
        const sorted = [...iso].sort((a, b) => a - b)
        const p = window.__isoPhases ?? {}
        return {
          frames: window.__frames,
          avg: iso.length ? iso.reduce((a, b) => a + b, 0) / iso.length : 0,
          p95: sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0,
          samples: iso.length,
          setup: p.setup ?? 0, cull: p.cull ?? 0, sort: p.sort ?? 0, draw: p.draw ?? 0,
          objects: p.objects ?? 0,
        }
      })()
      """) || %{}

    frames = number(raw, "frames")

    %{
      fps: frames / elapsed,
      render_avg: number(raw, "avg"),
      render_p95: number(raw, "p95"),
      samples: number(raw, "samples"),
      setup: number(raw, "setup"),
      cull: number(raw, "cull"),
      sort: number(raw, "sort"),
      draw: number(raw, "draw"),
      objects: number(raw, "objects")
    }
  end

  # A reading that did not come back is zero, said once rather than twelve times.
  defp number(raw, key) do
    case Elixir.Map.get(raw, key) do
      n when is_number(n) -> n * 1.0
      _ -> 0.0
    end
  end

  # REAL KEYS, REPEATEDLY. The binding can press a key but cannot HOLD one, and a single press moves the
  # hero one step and then stops, which would measure a standing still scene and call it walking. A held
  # key produces a repeat anyway, so this is what holding one looks like from the page's side.
  #
  # An empty key list is the idle sample, which just waits out the window.
  defp walk(_session, [], until) do
    remaining = until - System.monotonic_time(:millisecond)
    if remaining > 0, do: Process.sleep(remaining)
  end

  defp walk(session, keys, until) do
    case System.monotonic_time(:millisecond) >= until do
      true -> :ok
      false -> press_then_walk(session, keys, until)
    end
  end

  defp press_then_walk(session, keys, until) do
    for key <- keys do
      PlaywrightEx.Frame.press(session.frame_id, selector: "body", key: key, timeout: 5_000)
    end

    Process.sleep(80)
    walk(session, keys, until)
  end

  defp report(what, size, tiles, idle, walking) do
    IO.puts("""

    #{what}  #{size.cols}x#{size.rows}  #{tiles} tiles
      idle     #{pad(idle.fps)} fps   render #{pad(idle.render_avg)}ms avg  #{pad(idle.render_p95)}ms p95
      walking  #{pad(walking.fps)} fps   render #{pad(walking.render_avg)}ms avg  #{pad(walking.render_p95)}ms p95

      where the frame goes, walking, over #{walking.objects} objects
        setup #{pad(walking.setup)}ms   cull #{pad(walking.cull)}ms   sort #{pad(walking.sort)}ms   draw #{pad(walking.draw)}ms
    """)
  end

  defp pad(n), do: n |> Float.round(1) |> Float.to_string() |> String.pad_leading(6)
end
