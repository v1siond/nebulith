# Moving the engine to LiveView, later

Deferred work. Written 2026-09-18, when the engine moved into nebulith as a React application rather
than as LiveView, so the reasoning is on record and nobody has to rediscover it.

Read [`DEPLOYMENT-AND-BOUNDARIES.md`](DEPLOYMENT-AND-BOUNDARIES.md) for the shape that exists today.

---

## 1. The part that can never be LiveView

**The render loop.** The engine draws to a canvas every frame, reading a grid, a camera, a facing, a
tileset of baked PNGs and a clock. At 30 FPS that is a decision every 33ms about what pixel goes
where. LiveView's model is a server that holds state and pushes diffs over a socket. A round trip per
frame is not a performance problem to tune, it is the wrong shape.

So whatever the shell is written in, this stays JavaScript:

| Stays JS | Why |
|---|---|
| `engine/render/*` (iso, topdown, shared, lighting) | The per-frame draw |
| `engine/IsometricGrid`, `grid`, `cellStack` | Read every frame by the draw |
| `engine/stageGenerator` and its layers | Runs on demand, but produces the grid the draw reads, and runs in under a second in the browser with no round trip |
| `game/runtime/*`, movement, combat ticks | Per-frame simulation |
| Input handling, camera, picking | Must answer within one frame |

That is the majority of the 176 files. A LiveView migration that moved them would be a rewrite of the
engine, not a migration of it.

## 2. The part that could be LiveView

The chrome around the canvas, which is ordinary forms and lists over data the server already owns:

| Could move | What it is today |
|---|---|
| The games gallery | `routes/games.tsx`, a list, a create, a delete, all `/api/games` |
| Template and level management | The modals that list, rename, reorder and delete |
| The generate panel | A served catalog rendered as controls, then one POST |
| Editor settings persistence | `lib/editorSettings`, a key/value store already in Postgres |
| The tile and composition pickers | A served catalog rendered as a grid |

These are worth moving only if there is a reason, and "it is Elixir" is not one on its own. Real
reasons would be: wanting server-rendered pages for these for sharing or SEO, wanting multiple people
in one editor at once (LiveView's presence and pubsub are genuinely better at that than polling), or
wanting to delete the React dependency entirely.

## 3. What the split would cost

The canvas would become a LiveView **hook**: a `phx-hook` on the canvas element, with the JS engine
mounted inside it and `pushEvent`/`handleEvent` as the only door between the two halves. That door is
the whole difficulty.

1. **The shared state has to be cut in two, and the cut has to be exact.** Today the editor holds one
   object the panels and the draw both read. Split, the panels' half lives in the LiveView socket and
   the draw's half lives in the hook, and every change has to say which side owns it. A value that
   both sides write is a bug that shows up as flicker.
2. **Every panel interaction gains a round trip.** Dragging a slider that changes what is drawn would
   go browser to server to browser. That is fine for "rename this template" and not fine for "scrub
   the time of day", so the fast ones have to stay client-side anyway, which means the state cut has
   to follow interaction latency rather than a tidy boundary.
3. **`templates.tsx` is 6,928 lines and is the editor and the runtime at once.** It has to be
   decomposed before any of this, which is prerequisite work already named in
   [`GAPS-AND-ROADMAP.md`](GAPS-AND-ROADMAP.md).
4. **The suite is 4,717 tests written against JS modules.** The ones covering moved chrome would have
   to be rewritten as LiveView tests. The ones covering generation and rendering would not move.

## 4. If it is done, this is the order

Each step ships on its own and is reversible. Nothing here starts before `templates.tsx` is split.

1. **The gallery first.** `/games` has no canvas on it at all. Rewrite it as a LiveView and delete
   `routes/games.tsx`. This proves the layout, the styling and the deploy without touching the engine.
2. **Then the management modals.** Template list, level order, rename, delete. Still no canvas.
3. **Then the canvas as a hook, with the editor state still entirely client-side.** A LiveView that
   renders one `phx-hook` div and nothing else. This changes no behaviour and is purely the plumbing.
4. **Then one panel at a time across the door**, slowest-interaction first, measuring each. Stop when
   the next one would cost a round trip in a place a person would feel it.
5. **Never step 5.** There is no version of this where the render loop moves.

## 5. The honest recommendation

Do not start this without a reason from the list in section 2. The React application is 176 files
that work, ship as one bundle from the same Phoenix that serves the API, and cost one `esbuild`
target. LiveView would buy real-time collaboration and one less language, at the price of splitting
the editor's state across a socket. That trade is worth making the day two people need the same
editor at once, and not before.
