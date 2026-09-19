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
  pool_size: System.schedulers_online() * 2

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
