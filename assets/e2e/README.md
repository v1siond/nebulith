# End to end, in a real browser

`TESTING.md` is the framework. These drive the actual page with Playwright and assert on what the app did,
because a node test supplies its own inputs and therefore tests the app you imagined rather than the one that
runs.

Needs the dev server up (`mix phx.server`, port 6328).

    node e2e/fps.mjs "Woodland town" town 5

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
