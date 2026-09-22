ExUnit.start()
Ecto.Adapters.SQL.Sandbox.mode(Nebulith.Repo, :manual)

# THE BROWSER, for the end-to-end layer (docs/TESTING.md). PhoenixTest.Playwright drives a real Chromium at
# the TEST endpoint, which `config/test.exs` puts on 4002 against `nebulith_test`, so a click-through runs
# inside `mix test` and cannot reach the dev database.
# ONLY WHEN A BROWSER IS CONFIGURED. `mix test` must run the unit suite on a machine with no Playwright
# server, so the browser supervisor starts only when one is pointed at. Without it the e2e cases are the only
# thing that cannot run, rather than the whole suite failing to boot.
browser? = System.get_env("PLAYWRIGHT_WS_ENDPOINT") not in [nil, ""]
if browser?, do: {:ok, _} = PhoenixTest.Playwright.Supervisor.start_link()
# GATES WRITTEN AHEAD OF THEIR PHASE are left out of a normal run.
#
# The spec gives every phase a gate and says plainly which of them cannot pass yet. Writing that gate
# first is the point: a gate added after the fix has never been seen to fail. But a suite that is red
# on purpose stops being read, so those carry `:awaiting_phase` and are asked for by name:
#
#     bin/e2e --include awaiting_phase
#
# docs/TESTING.md lists which gates are waiting and on what.
# AND THE PERFORMANCE MEASUREMENTS, which are minutes each: three whole world generations and nine
# timed samples. They are asked for by name:
#
#     bin/e2e test/e2e/performance_test.exs --include perf
ExUnit.configure(exclude: [:awaiting_phase, :perf] ++ if(browser?, do: [], else: [:e2e]))

# WHERE THE BROWSER THINKS THE APP IS. Normally that is the endpoint's own URL. When the browser runs in a
# container (this machine's Ubuntu 20.04 has no supported Playwright chromium, see config/test.exs), the app
# is on the container's host instead, so the address has to be given from outside.
#
#     PHOENIX_TEST_BASE_URL=http://host.docker.internal:4002
Application.put_env(
  :phoenix_test,
  :base_url,
  System.get_env("PHOENIX_TEST_BASE_URL") || NebulithWeb.Endpoint.url()
)
