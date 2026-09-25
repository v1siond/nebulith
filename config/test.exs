import Config

# Configure your database
#
# The MIX_TEST_PARTITION environment variable can be used
# to provide built-in test partitioning in CI environment.
# Run `mix help test` for more information.
config :nebulith, Nebulith.Repo,
  username: "postgres",
  password: "postgres",
  hostname: "localhost",
  database: "nebulith_test#{System.get_env("MIX_TEST_PARTITION")}",
  pool: Ecto.Adapters.SQL.Sandbox,
  pool_size: System.schedulers_online() * 2,
  # THE BROWSER AND THE TEST SHARE ONE CONNECTION. A scenario runs the sandbox in shared mode so the
  # browser's requests join the test's transaction, which means both are queueing for the same
  # connection: the page saves a map while the test polls the row to see the save land. The default
  # 50ms target drops that poll as "connection not available" and reports it as a failure of the
  # thing under test. These are the waits of a browser, not of a unit test.
  queue_target: 5_000,
  queue_interval: 10_000,
  # …AND A SCENARIO OWNS THAT CONNECTION FOR AS LONG AS IT RUNS. At 120 seconds this fired in the
  # middle of live scenarios, which generate several worlds: the owner lost the connection, every
  # later query and every page request on it failed, and the scenario reported whatever it was
  # measuring as broken. Measured: a four-city street scenario runs 168 seconds and logged
  # "owner timed out because it owned the connection for longer than 120000ms" while passing, so the
  # same shape was silently failing runs that took a little longer.
  #
  # Matched to the LONGEST `@moduletag timeout` in the suite rather than to a guess: a scenario should
  # be stopped by its own timeout, saying what it was waiting for, not by its database vanishing.
  ownership_timeout: 900_000

# THE SERVER RUNS IN TEST, because the end-to-end layer drives a real browser at it (PhoenixTest.Playwright,
# see docs/TESTING.md). On port 4002 against `nebulith_test`, so a click-through can never reach the dev
# database. It could before, when the browser was pointed at the dev server on 6328, and a test that clicked
# Save overwrote the saved map that was there.
# BOUND WIDE, not to loopback: the browser that drives it runs in a container (see below), so the endpoint
# has to be reachable from outside this network namespace. It is the TEST endpoint on a test database, and it
# only listens while `mix test` runs.
config :nebulith, NebulithWeb.Endpoint,
  http: [ip: {0, 0, 0, 0}, port: 4002],
  secret_key_base: "OehDm/6b1NkUTsAG9dhxaFZVPGFAHePzcZbLfS9TEIlq0kOwx/LIgoDhPvZhgM7H",
  server: true

config :phoenix_test, otp_app: :nebulith

# A DESKTOP WINDOW, because the editor is a desktop application. The driver's default is 1280x720,
# and at that width the generate panel lies over the middle of the canvas: a click meant for a tile
# lands on the panel, selects nothing, and the scenario then fails looking for a settings control
# that was never going to appear. Measured: `elementFromPoint` at the canvas centre returned the
# panel, not the canvas.
# …AND THE FAMILY PORTRAITS LAND BESIDE THE REFERENCE RENDERS. `docs/renders/` already holds the
# pictures an object was judged against, so the sheet that renders a whole family belongs there too.
# `screenshot_dir` is read from INSIDE the `:playwright` keyword (`Config.global/0` validates that one
# list against its schema), so setting it as a sibling of `:playwright` is silently ignored and the
# files go to the default `screenshots/`. See `test/e2e/the_render_sheet_test.exs`.
#
# AND THE DRIVER WAITS AS LONG AS THIS APP ACTUALLY TAKES. Its default per-action timeout is TWO SECONDS,
# which covers a form on a static page and not an editor that boots a whole tileset before it paints. Left
# at the default it produced a failure a run, always in a different scenario, always the same shape: a
# navigation or a select giving up at 2000ms and the harness reporting it as whatever the scenario happened
# to be measuring. Measured over three full suite runs: phase 3's own round-trip gate, the settings gate and
# the city street gate each failed once and passed alone.
#
# 15 seconds is not a guess, it is what `Browser.wait_until` in this same suite already waits for this same
# app, so the driver and the scenarios now give it the same amount of rope.
config :phoenix_test,
  playwright: [
    browser_context_opts: [viewport: %{width: 1700, height: 1000}],
    screenshot_dir: "docs/renders",
    timeout: 15_000
  ]

# THE BROWSER LIVES OUTSIDE THIS MACHINE'S PLAYWRIGHT. Ubuntu 20.04 (focal) stopped being a supported target
# for Playwright's chromium download at 1.63, and the Elixir driver requires 1.63 or newer, so the local
# driver cannot start here. It connects to a Playwright SERVER over a websocket instead, which is the route
# the package documents for exactly this (glibc / unsupported base image).
#
#     PLAYWRIGHT_WS_ENDPOINT=ws://localhost:3111/ mix test test/e2e
#
# See docs/TESTING.md for how to start one.
if ws = System.get_env("PLAYWRIGHT_WS_ENDPOINT") do
  config :phoenix_test, playwright: [ws_endpoint: ws, browser_pool: false]
end

# Print only warnings and errors during test
config :logger, level: :warning

# Initialize plugs at runtime for faster test compilation
config :phoenix, :plug_init_mode, :runtime

# Enable helpful, but potentially expensive runtime checks
config :phoenix_live_view,
  enable_expensive_runtime_checks: true

# Sort query params output of verified routes for robust url comparisons
config :phoenix,
  sort_verified_routes_query_params: true
