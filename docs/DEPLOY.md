# Deploying Nebulith

Phoenix release in a Docker image, built and run by **Railway**, with **GitHub Actions** as the gate in
front of it. Same shape as `retrogroove_api`, which is already deployed this way; only the project name
and the services differ.

```
a push to any branch   ->  ci: elixir suite, then a browser driving the pages
a push to `staging`    ->  railway, staging service
a tag  `v*`            ->  ci again at that tag, then railway, production service
```

**Production deploys from a tag, never from a branch.** A branch moves when somebody pushes to it; a tag
is a decision, and production follows the decision.

---

## 1. What is already in the repo

| File | What it does |
|---|---|
| `Dockerfile` | multi-stage build: Elixir release plus the compiled assets. Railway builds this directly |
| `rel/overlays/bin/server` | what the container runs |
| `rel/overlays/bin/migrate` | migrations, runnable without Mix |
| `lib/nebulith/release.ex` | `migrate/0` and `rollback/2` for a release |
| `.github/workflows/ci.yml` | the gate on every push and pull request |
| `.github/workflows/deploy-staging.yml` | staging, on a push to `staging` |
| `.github/workflows/deploy-production.yml` | production, on a `v*` tag |

Node is in the build image for one reason: the engine bundle is React, and esbuild reads react and
react-dom out of `assets/node_modules`. Nothing runs node at runtime.

---

## 2. Railway, once per environment

Do this twice, once for staging and once for production, so the two never share a database.

1. **New Project** → **Deploy from GitHub repo** → `v1siond/nebulith`.
2. Turn **off** Railway's own auto-deploy on push. The workflows here decide when a deploy happens; two
   things deciding that is how a branch reaches production without anybody choosing it.
3. **+ New → Database → PostgreSQL.** Set the service's `DATABASE_URL` to `${{Postgres.DATABASE_URL}}`.
4. Set the variables in the table below.
5. **Settings → Deploy → Pre-deploy Command**:
   ```
   /app/bin/migrate
   ```
   Migrations run before the new version takes traffic, every deploy.
6. Note the service name Railway gives you. That name goes in the GitHub variables below.

### Variables

| Var | Required | Purpose | Example |
|---|---|---|---|
| `DATABASE_URL` | yes | Postgres | `${{Postgres.DATABASE_URL}}` |
| `SECRET_KEY_BASE` | yes, boot fails without it | signing and encryption | `mix phx.gen.secret` |
| `PHX_HOST` | yes | the public hostname, used in generated URLs | `nebulith.up.railway.app` |
| `PHX_SERVER` | yes | start the HTTP server in the release | `true` |
| `PORT` | automatic | Railway sets it | `4000` |
| `NEBULITH_ADMIN_EMAIL` | recommended | the seeded admin account | `admin@nebulith.local` |
| `NEBULITH_ADMIN_PASSWORD` | yes in production | that account's password | a real one, not the dev default |
| `POOL_SIZE` | optional | database pool | `10` |

`NEBULITH_ADMIN_PASSWORD` has a development default of `12345678` so a fresh clone can sign in. **Set it
in production.** `/admin` can write to any table in the database.

---

## 3. GitHub, once

**Settings → Secrets and variables → Actions.**

| Kind | Name | Value |
|---|---|---|
| Secret | `RAILWAY_TOKEN` | a Railway project token with access to both services |
| Variable | `RAILWAY_SERVICE_STAGING` | the staging service's name |
| Variable | `RAILWAY_SERVICE_PRODUCTION` | the production service's name |

Both deploy workflows name a GitHub **environment** (`staging`, `production`). Adding a required reviewer
to the `production` environment makes a production deploy something a person approves, which is worth
doing before the first real user.

---

## 4. Deploying

**Staging.**
```bash
git push origin master:staging
```

**Production.**
```bash
git tag v0.2.0
git push origin v0.2.0
```

The tag runs the suite again at that commit rather than trusting the branch run: a tag can point at a
commit whose CI never ran, and "it was green on master" is a different claim from "it is green here".

---

## 5. The first deploy, and seeding

The schema comes from migrations, which the pre-deploy command runs. The CATALOG (tilesets, tiles,
compositions, generators) comes from the seeder, and a fresh database has none of it.

Once, from the Railway shell:

```bash
/app/bin/nebulith eval "Nebulith.Release.seed"
```

It is idempotent and skips what already exists, but **do not make it a pre-deploy command.** The seeder
writes whole columns from its own literals, and running it over a database somebody has edited discards
those edits. That has happened here: ten data migrations' worth of region work was erased repeatedly by a
re-seed.

---

## 6. After a deploy

1. `https://<host>/docs` renders the spec, and its diagrams draw.
2. `https://<host>/api/tilesets` returns the catalog.
3. `https://<host>/admin` asks for credentials, and accepts the ones you set.
4. `https://<host>/templates` loads the editor.

If `/docs` is up but `/api/tilesets` is empty, the schema migrated and the seed has not run yet. See
section 5.
