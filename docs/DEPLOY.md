# Deploying nebulith

One service and one database. Phoenix serves the API, the admin, the docs site and the engine, so
there is nothing else to stand up. The CV site is a separate deployment and only needs to know this
one's URL.

Read [`DEPLOYMENT-AND-BOUNDARIES.md`](DEPLOYMENT-AND-BOUNDARIES.md) first for what lives where.

---

## 1. What is in the repo

| File | What it does |
|---|---|
| `Dockerfile` | Multi-stage Elixir release. Installs node only to let esbuild bundle React out of `assets/node_modules`; nothing runs node at runtime |
| `railway.json` | Builder, start command, pre-deploy migration, health check |
| `rel/overlays/bin/server` | Starts the release with `PHX_SERVER=true` |
| `rel/overlays/bin/migrate` | Runs `Nebulith.Release.migrate` without Mix |
| `lib/nebulith/release.ex` | `migrate/0` and `rollback/2` for a release |

Measured 2026-09-18: the image builds at **185 MB**, and the built engine bundle is digested inside it
(`priv/static/assets/js/game/game-<hash>.js` plus its `.gz` and `cache_manifest.json`).

## 2. Railway

1. **New Project** then **Deploy from GitHub repo**, pick `v1siond/nebulith`, branch `master`.
2. **Add Postgres**: Project, **+ New**, **Database**, **PostgreSQL**. Set the service's
   `DATABASE_URL` to the reference `${{Postgres.DATABASE_URL}}`.
3. Set the variables in the table below.
4. Deploy. Railway builds the Dockerfile, runs `/app/bin/migrate` before the swap, then `/app/bin/server`.
5. Take the domain Railway assigns and set `PHX_HOST` to it, then redeploy so URLs are right.
6. On the CV site's deployment set `NEXT_PUBLIC_ENGINE_URL` to `https://<that domain>`, and set
   `CV_URL` here to the CV's origin.

## 3. Environment

| Var | Required | Purpose | Example |
|---|---|---|---|
| `DATABASE_URL` | yes, prod raises without it | Postgres | `${{Postgres.DATABASE_URL}}` |
| `SECRET_KEY_BASE` | yes, prod raises without it | Signs cookies and sessions | `mix phx.gen.secret` |
| `PHX_HOST` | yes | Public hostname, used to build URLs | `nebulith.up.railway.app` |
| `PHX_SERVER` | set by `bin/server` | Starts the HTTP server in a release | `true` |
| `PORT` | auto | Railway sets it | `6328` locally |
| `CV_URL` | recommended | Where "Back to CV" points, rendered onto the page at runtime | `https://alexanderpulido.com` |
| `PIXELLAB_API_KEY` | for the sprite generator | Server-side key for pixellab.ai. Without it `/api/pixellab` 500s and the generator shows no balance; nothing else is affected | (secret) |
| `POOL_SIZE` | optional | DB pool | `10` |
| `ECTO_IPV6` | optional | Set `true` only if the DB is IPv6-only | unset |
| `DNS_CLUSTER_QUERY` | optional | Clustering | unset |

**`CV_URL` is runtime, not build-time.** Phoenix renders it onto the engine's mount node, so changing
it is a variable change and a restart, not a rebuild. That is deliberate: the CV site's own
`NEXT_PUBLIC_ENGINE_URL` is baked at build time and has to be set before its build runs.

## 4. Migrations

`railway.json` sets `preDeployCommand` to `/app/bin/migrate`, so schema migrations run on every deploy
before traffic moves over.

**Data migrations are separate and are run by hand.** They live in `lib/nebulith/data_migrations/` and
change seeded content rather than schema. From the Railway shell:

```
/app/bin/nebulith rpc 'Nebulith.DataMigrations.run_pending()'
```

## 5. What breaks first, and how to see it

| Symptom | Cause |
|---|---|
| Deploy never goes healthy, app looks fine in logs | `/health` got caught by `force_ssl` and returns 301. It is excluded in `config/prod.exs`; keep it that way |
| Build fails at `mix assets.deploy`, cannot resolve `react` | `assets/package-lock.json` is not committed, so `npm ci` has nothing to install from |
| Engine loads but every tile is a broken image | `cache_static_manifest` mismatch. `mix assets.deploy` must run in the image, which the Dockerfile does |
| Sprite generator shows `$-.--` and every generate fails | `PIXELLAB_API_KEY` unset. It is server-side only and never reaches the browser |
| CV site links to a dead engine | `NEXT_PUBLIC_ENGINE_URL` was unset when the CV was BUILT. It is baked at build time; rebuild the CV |
| "Back to CV" goes to localhost | `CV_URL` unset on this service. Runtime variable, just set it and restart |
| Long image builds | `phx.digest` hashes ~1,400 tile PNGs. If it becomes annoying, that is the lever to look at |

## 6. Verifying a deploy

```
curl -s https://<host>/health                      # {"status":"ok","app":"nebulith"}
curl -sI http://<host>/games  | head -1            # 301 to https, force_ssl is live
curl -sI https://<host>/games | grep -i frame-anc  # frame-ancestors *
curl -sI https://<host>/admin | grep -i frame-anc  # frame-ancestors 'self'
```

Then open the CV site's `/personal-projects/game-engine` and confirm the engine renders in the frame.
Measured against the local release image: `/health` 200 over plain HTTP, `/games` and `/admin` both
301 to https.
