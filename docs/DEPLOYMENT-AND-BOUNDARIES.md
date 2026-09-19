# Deployment and boundaries

Where each piece of this product lives, how it is built, how it is served, and what is allowed to
reach across. Written 2026-09-18, when the engine moved out of `game-website` and into nebulith.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for what the engine IS. This document covers where it RUNS.

---

## 1. The law

**One product, two deployments, and the boundary is the network.**

| Deployment | Owns | Stack |
|---|---|---|
| **nebulith** | The engine, the editor, the game data, the tile art, the API, the admin, the docs site | Phoenix + Postgres, serving a React SPA it bundles itself |
| **game-website** | The CV, the world-design themes, the personal project links | Next.js, no game code at all |

The CV site reaches nebulith exactly twice: `GET /api/cv` for its own content, and an `<iframe>`
pointing at the engine. Nothing else crosses. There is no shared module, no shared build, no shared
config file, and no import in either direction.

**Why the engine is not LiveView.** The engine is a canvas render loop with its own frame budget. A
render loop cannot round-trip to the server per frame, so the drawing stays in the browser whatever
the shell is written in. Rewriting the ~176-file React app as LiveView buys nothing the SPA does not
already have, and costs the entire editor. The staged plan for revisiting that is
[`LIVEVIEW-MIGRATION-PLAN.md`](LIVEVIEW-MIGRATION-PLAN.md), which is deferred work, not a roadmap item.

**Why the engine is not its own Next service.** Measured before the move: across `src/engine`,
`src/game`, `src/components/game` and the four engine pages there were **8 `next/*` import sites**
(`next/router` x3, `next/link` x2, `next/head` x2, one `GetServerSideProps` type) and **one**
`getServerSideProps` in the whole repository, which was a redirect that the new route map deletes.
The engine was already a client-side React SPA. Keeping Next would have bought a second service, a
second deploy, a CORS boundary and build-time `NEXT_PUBLIC_` baking, in exchange for nothing.

---

## 2. Where the code lives

```
nebulith/
  assets/
    game/            the engine: what used to be game-website/src
      engine/        generation, render, tilesets, entities
      game/          runtime, editor state, combat, items
      components/    React components, editor chrome, modals
      lib/           API clients, codecs, persistence
      routes/        the page components, now plain routes
      assets/        ascii art frames
      levels/
    js/
      app.js         the Phoenix side: admin, docs, LiveView
      game.tsx       the SPA entry point
    css/
      app.css        Tailwind entry, covers BOTH bundles
      editor.css     the `.neb` scoped editor styling
    __tests__/       the engine test suite
    package.json     jest, testing-library, typescript
    tsconfig.json    `@/` maps to `game/`
  lib/nebulith_web/
    controllers/game_controller.ex   serves the SPA shell
  priv/static/assets/js/game.js      the built bundle
```

`assets/` is Phoenix's own convention and `esbuild` already runs with `cd: assets`, so the engine
sits where the asset pipeline already looks.

---

## 3. How it is built

Two esbuild targets, one Tailwind build.

- `esbuild nebulith` builds `js/app.js`, the Phoenix side. Unchanged.
- `esbuild game` builds `js/game.tsx` with `--splitting --format=esm --alias:@=./game`, so the
  ~176-file engine code-splits instead of shipping one blob.
- `tailwind nebulith` builds `css/app.css` with content globs covering `assets/game/**` and the
  Phoenix heex templates, so both sides draw from one utility build.

`mix assets.build` and `mix assets.deploy` run all three. `mix phx.server` watches all three.

**Tailwind is the styling direction, not a leftover.** The engine already carries 978 `className`
sites and zero uses of the CV's `df-*` palette, so it ported to Tailwind 4 with no palette work.
`editor.css` (the 676-line `.neb` block) survives as plain CSS for now and is queued for conversion
to utilities. New work uses utilities, not new rules in that file.

**Tests.** `assets/package.json` holds jest, `@testing-library/*` and typescript. `npm test` from
`assets/` runs the engine suite. It is deliberately not wired into `mix test`, because an Elixir test
run should not need node installed.

---

## 4. The route map

| Path | Serves | Notes |
|---|---|---|
| `/` | Phoenix `PageController` | The nebulith landing page |
| `/games` | The SPA, games gallery | **The iframe's entry point** |
| `/games/:id` | The SPA, a game's editor | `?play=1` deep-links into play mode |
| `/templates` | The SPA, the standalone builder | The fallback when a game cannot open |
| `/sprite-generator`, `/sprites-test` | The SPA, the sprite authoring tools | Lazy-loaded chunks; most sessions never fetch them |
| `/api/pixellab` | JSON | Holds the pixellab.ai key so the browser never does |
| `/personal-projects/game-engine/*` | 301 to the matching short path | So the probe harness and any old link still resolve |
| `/api/*` | JSON | Unchanged, now same-origin for the engine |
| `/admin`, `/docs` | Phoenix | Unchanged |

Every SPA path returns the same shell. The client router reads `location.pathname`. A path that is
neither a known SPA route nor a Phoenix route is a 404 from Phoenix, not from the SPA.

---

## 5. The iframe contract

The CV site's `/personal-projects/game-engine/[[...path]]` renders one `<iframe>` and nothing else of
substance. It is a CATCH-ALL: everything after `game-engine` is handed to the frame as the engine's own path,
so every engine route is reachable, and shareable, from the outside.

```tsx
// /personal-projects/game-engine/games/<id>  frames  ENGINE_URL/games/<id>
<iframe
  src={`${ENGINE_URL}/${path || 'games'}`}
  allow="fullscreen; gamepad; clipboard-write"
  className="fixed inset-0 h-full w-full border-0"
/>
```

Rules that bind that frame:

1. **The frame is the whole viewport.** The engine draws its own chrome. The CV must not wrap it in
   a header, a sidebar or a max-width container, because the editor's layout maths reads the
   viewport and a letterboxed frame makes every panel wrong.
2. **ONE message, one direction, and it is a statement.** This used to forbid cross-frame messaging
   outright. It does not, because *"when clicking 'open' on the iframe I want to chain the link to the url"*,
   and a framed page cannot write the address bar on its own.

   So the engine ANNOUNCES its route, from `navigate` in `router.tsx`, the single place it navigates:
   `{ type: 'nebulith:route', path }`. The CV mirrors that into its own URL with a SHALLOW replace, so the
   frame is never torn down by the navigation it just reported, and the back button does not fill with an
   entry per level.

   The limits that remain are what keep this from becoming a protocol:
   - It is a STATEMENT, never a command. The engine says where it is; it never asks the host to do anything.
   - It is ONE WAY. The engine does not listen for a reply, and the CV never messages the engine.
   - The CV checks `event.origin` against `ENGINE_URL` before believing a word of it.
   - The frame's `src` is read ONCE. Tracking the URL would reload the engine every time it reported a
     navigation, which is a loop that throws away the map you are looking at.

   If a link needs to leave the frame it still uses `target="_top"` on a full URL.
3. **The engine never assumes it is framed.** `/games` has to work opened directly, because that is
   how it is developed and probed.
4. **`ENGINE_URL` is read from the environment, never hardcoded.** Unset falls back to the dev
   server so a fresh checkout works with no `.env`. A production build with it unset fails the build
   rather than shipping a dead frame.

---

## 6. Browser storage inside a frame

A cross-origin iframe gets **partitioned** storage in Chrome (a separate bucket per embedding site)
and **no** storage in Safari's default third-party configuration. Anything the engine keeps in
`localStorage` can therefore be empty on every load, and can throw on write.

Measured at the time of the move, the engine keeps **5 keys**: `village-debug`,
`village-show-collisions`, `village-topview`, `village-topview-zoom` and `GAMES_STORAGE_KEY`. The
first four are view toggles. The fifth is the legacy pre-backend game store that `gamesMigration.ts`
drains into the API. Games, templates and levels live in Postgres.

**The law: nothing a user would be upset to lose goes in browser storage.** Storage is for a
remembered toggle. State belongs in the database, reached through the API. Every read must tolerate
an empty result and every write must tolerate a throw.

**Every access goes through `game/lib/storage.ts`.** Not a try/catch at each call site: one module
owns it, and it says once in the console that this browser gave it nothing rather than swallowing
ten failures silently.

This is not theoretical. Measured 2026-09-18 with every storage accessor throwing, which is what
Safari does to a third-party frame: the engine did not mount at all, blank page, because the editor
read four view toggles unguarded during mount. Chrome's default is *partitioned* storage, which still
works, so the plain iframe check passed and hid it. `game/__tests__/lib/storageSurvivesABlockedFrame.test.ts`
keeps it fixed. Verified after the fix: the editor mounts, generates a desert and draws it at 24 FPS
with storage fully blocked.

---

## 7. `frame-ancestors *` and CORS `*`, and what they cost

Phoenix 1.8.8's `put_secure_browser_headers` sets
`content-security-policy: base-uri 'self'; frame-ancestors 'self';` and no `x-frame-options`
(`deps/phoenix/lib/phoenix/controller.ex`). That `frame-ancestors 'self'` is the only thing stopping
the CV site from framing the engine.

The engine scope overrides it to `frame-ancestors *`, and `CORSPlug` runs with `origin: "*"`.

**What that buys:** any site can frame the engine and any origin can call the API. That is the ask,
and for a public portfolio piece it is the right posture. Someone embedding your engine in their page
is a demo, not an attack.

**What it costs, stated plainly so it is a decision and not an accident:**

1. **Clickjacking is possible on any page the frame can act on.** The engine has no destructive
   one-click action behind a confirm-free button today, and it must not grow one. A "delete game"
   that fires on a single click inside a frame someone else controls is the failure mode.
2. **`/admin` must never be inside the open scope.** It is HTTP Basic against `admin_users`. It keeps
   Phoenix's default `frame-ancestors 'self'` and is excluded from the CORS wildcard.
3. **Any future authenticated engine route stops working in a third-party frame** unless its cookie
   is `SameSite=None; Secure`, and even then Safari drops it. The engine's API is unauthenticated
   today. If that changes, the iframe plan has to be revisited, not patched.

---

## 8. What is not allowed

- **The engine importing a CV module, or the CV importing an engine module.** The split cost five
  edges and 187 lines to undo. It goes back to zero and stays there.
- **A second copy of the docs.** `nebulith/docs/` is the only copy. `game-website` carries no engine
  documentation.
- **Hardcoding either origin.** Both directions go through one exported constant, read from the
  environment.
- **A route that exists only in the SPA router.** Every SPA path has a matching Phoenix route serving
  the shell, or a direct load of that URL 404s.

---

## 9. Checklist

Run this before calling any change to the boundary done.

1. `grep -rn "@/engine/\|@/game/\|@/components/game/\|lib/nebulithApi" game-website/src`. Zero hits.
2. `ls nebulith/assets/game/components/` contains Toast, ErrorBoundary and useFps. The engine owns its
   copies; an `@/components/Toast` import inside the engine resolves to `assets/game/components/` and is
   correct. What must be zero is a CV-only module there: `themes/`, `contexts/`, `cv-data`.
3. `grep -rn "localhost:[0-9]" nebulith/assets/game --include=*.ts --include=*.tsx` outside
   `game/lib/routes.ts` and the suite. Zero hits. On the CV side the only origin constants are
   `src/lib/engineUrl.ts` and `src/lib/cvApi.ts`; his own email and profile links are not origins and
   do not count.
4. `npm test` in `assets/` matches the recorded baseline exactly, failure for failure.
5. `npx tsc --noEmit` in `assets/` is clean. The 40 pre-existing errors were all CV theme files and do not come along.
6. `mix test` matches its recorded baseline.
7. `mix assets.deploy` completes and writes both bundles.
8. Load `/games` directly. It renders and a map generates.
9. Load the CV's `/personal-projects/game-engine`. The frame fills the viewport and the same map generates inside it.
10. Check the response headers on `/games`: `frame-ancestors *`. Check them on `/admin`: `frame-ancestors 'self'`.
11. Load an old `/personal-projects/game-engine/games` URL against Phoenix. It redirects rather than 404s.
12. Block storage entirely (not just clear it: make the accessor throw, as Safari does to a third-party
    frame) and confirm the engine mounts, generates and draws. `.probe` can do this with an init script.

Items that cannot be checked headlessly, and therefore are not "done" until confirmed in a real
browser: 8, 9 and 12 at the visual level, and the frame's sizing on a phone.
