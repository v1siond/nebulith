# The probes

**These are instruments, not tests.** They PRINT numbers and never fail. The tests are Elixir, in
`test/e2e`, and `bin/e2e` runs them: see `docs/TESTING.md`, which is the framework.

Keeping the two apart matters. A script that cannot fail sitting in a list of gates makes the list look
longer than it is, and a question you are holding ("how many frames does a city draw") is a different job
from a rule you are guarding ("a reloaded map stops you where the built one did").

    bin/probe fps            how many frames a big map draws
    bin/probe treeSheet      stamp every tree species and measure the silhouettes
    bin/probe groundCensus   what the ground of a generated world is made of

`waterBorders` is the exception: it still asserts, so it is still a gate, and it is waiting to be ported.

## fps.mjs

Clicks through: pick a category, pick a preset, Build this world, then walk with WASD and measure.

It counts the app's OWN frames by wrapping `requestAnimationFrame` before the page loads, so the number is
the loop's real rate rather than a guess, and samples `window.__isoRenderMs` for the cost of one draw.

Measured 2026-09-19, headless (so the absolute numbers run below a real machine's, but the comparisons hold):

    woodland   editor idle 33.1   editor WASD 31.2   play WASD 33.9   render ~11ms
    town       editor idle 28.7   editor WASD 22.8   play WASD 25.2   render ~15ms
    city       editor idle 22.4   editor WASD 20.8   play WASD 26.3   render ~16ms

Two things that says. The editor is SLOWER than play on a town and a city, which is the editor's own overhead.
And one draw costs 11 to 16ms against a 16.6ms budget for 60fps, so the draw alone is most of the frame.
