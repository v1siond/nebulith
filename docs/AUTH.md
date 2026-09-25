# Auth

How a person proves who they are, and what that buys them.

This follows the pattern `mix phx.gen.auth` generates, which is the Phoenix team's own answer and the
one every Phoenix codebase recognises. It is written down here rather than generated because this app
already had a `users` table, an `Accounts` context and a password hasher before the session layer
existed, and a generator run would have overwritten all three.

Source: https://hexdocs.pm/phoenix/mix_phx_gen_auth.html

---

## 1. The model

One table answers who a person is: `users`. `is_admin` is the only difference between a player and an
admin. There is no roles table, because there are two roles.

A logged-in session is a ROW, not a cookie. `users_tokens` holds a random 32-byte token per session;
the cookie carries the token and nothing else.

```mermaid
flowchart LR
  Person -->|email + password| Login
  Login -->|Accounts.authenticate| users[(users)]
  Login -->|inserts a row| tokens[(users_tokens)]
  tokens -->|token in the session cookie| Browser
  Browser -->|every request| Plug[fetch_current_user]
  Plug -->|token to row to user| users
```

### Why a row and not just the user id in the cookie

A signed cookie holding `user_id` is simpler and is genuinely secure against forgery, so the reason to
reject it is not forgery. It is that the server then has no record a session exists, which costs three
concrete things:

1. **No revocation.** Changing a password cannot end the sessions opened with the old one. A stolen
   cookie stays valid until `SECRET_KEY_BASE` rotates, which invalidates everybody at once.
2. **No "sign out everywhere".** There is nothing to delete.
3. **No audit.** Nobody can answer how many sessions are open, or when one started.

A row costs one index lookup per request and answers all three.

### The token is compared as raw bytes

`users_tokens.token` is `bytea` and holds 32 bytes from `:crypto.strong_rand_bytes/1`. It is not
hashed, because unlike a password it is already high-entropy random and not reused anywhere else, and
it is not base64 in the database, because encoding is a transport concern.

---

## 2. The doors

| Area | Who gets in | How |
|---|---|---|
| `/` , `/docs` , `/health` | anyone | no gate. A reference you need a login to read is not a reference |
| `/login` , `/signup` | anyone NOT already signed in | `:signed_out_only`. Both bounce a signed-in person out |
| `/games`, `/games/:id`, `/templates`, `/sprite-generator`, `/sprites-test` | any logged-in user | session cookie |
| `/admin` and everything under it | a logged-in user **with `is_admin`** | session cookie, or HTTP Basic |
| `/api/*` | any logged-in user, or any API token | session cookie, or `Authorization: Bearer` |
| `/health` | anyone | no gate, and it must stay that way |

`/admin` accepts two credentials on purpose. A browser session is what a person uses; HTTP Basic is what
a script uses, and the end-to-end gate is a script. Both resolve to the same row in `users`, and both
require `is_admin`.

> `is_admin` was NOT checked before this document existed. `AdminAuth` called `Accounts.authenticate/2`,
> which returns any user whose password matches, so every account reached `/admin`. The fix is
> `get_admin_user_by_email/1`, which was already written and simply was not being called.

### Signing up

The door is open. Anyone can create an account at `/signup`, and doing so logs them straight in
through the same `log_in_user/2` the login form uses, so a session is a row there exactly as it is
here and one place decides where a person lands.

**A new account is a PLAYER, and the public door cannot make anything else.** `User.changeset/2`
casts `is_admin`, because seeding and the admin screens need to set it. Registration does NOT use it:
`User.registration_changeset/2` casts email, password and display name, and there is no fourth field.

That distinction is the whole security of this page. Had registration reused the general changeset, a
form post carrying `user[is_admin]=true` would mint an administrator, and `is_admin` is what opens
`/admin`, which can write to any table in the database. It is gated in
`RegistrationControllerTest` and checked again through the browser in `phase_01_accounts_test.exs`,
and both were confirmed to FAIL when registration is pointed at the permissive changeset.

**The two forms report errors differently, on purpose.**

| | Login | Signup |
|---|---|---|
| Wrong password | one message for both halves, so the page is not a directory of who has an account | n/a |
| Email already registered | n/a | "That email cannot be used. Try logging in instead." Never "taken" or "already exists" |
| Password too short | n/a | says so plainly. Somebody choosing a password needs to know |

The asymmetry is not an inconsistency. Login must not confirm whether an address has an account;
signup must help a person fix their own input, while still refusing to confirm an address exists. The
"cannot be used" wording is true either way and tells an outsider nothing.

---

## 3. The session cookie and the iframe

The engine pipeline was built with no session at all, deliberately, and the reason is written in the
router: the engine is embeddable in a cross-origin iframe, and a cross-site cookie is blocked or
partitioned by every current browser.

Requiring a login on the engine pages ends that property. An embedded engine sends no cookie, so it
sees the login page, and logging in from inside the frame does not help because that cookie is blocked
too.

This is a real trade, not an oversight:

- **Keep the login** (what is built): the engine is its own deployment at its own domain, and a visitor
  goes to it directly. The iframe embed stops working.
- **Keep the embed**: the session cookie needs `same_site: "None"` and `secure: true`, which means the
  cookie rides on cross-site requests and CSRF protection has to come from somewhere else.

Set in `config/config.exs` under the endpoint's `session_options` if the embed is ever wanted back.

---

## 4. What the engine knows about the person

The shell renders two attributes onto the mount node, the same way it renders `data-cv-url`:

- `data-user-email` so the header can show who is signed in
- `data-csrf-token` so the header's Log out button can POST

The bundle reads them at render time through a function, never at module scope. A module-level const
freezes whatever was on the page when the module first loaded.

---

## 5. The API

`/api/*` is closed. Two credentials open it, because two kinds of caller ask.

**A browser on this origin** sends the session cookie. The bundle's `fetch` defaults to
`credentials: "same-origin"`, so the engine's own calls carry it with no code at all. Nothing in the
frontend holds a credential, which is the point.

**A script** sends a token:

```
Authorization: Bearer <token>
```

Mint one for an existing account:

```bash
bin/nebulith eval 'Nebulith.Release.api_token("admin@nebulith.local")'
mix run -e 'Nebulith.Release.api_token("admin@nebulith.local")'
```

It is printed once. Only the raw bytes are stored, so a lost token is replaced, not recovered.
`Nebulith.Accounts.delete_user_api_token/1` revokes one.

An API token is context `"api"`, not `"session"`, and the two do not substitute for each other. That
separation is what lets "sign out everywhere" clear a person's browsers without killing the script that
runs their backups. It also has no expiry, deliberately: a machine credential that stops working on a
date nobody wrote down fails in the middle of the night.

### Why this pipeline has no CSRF check

The session cookie is `same_site: "Lax"`, so a cross-site `POST` does not carry it. That is what
protects the writing endpoints, and it is why adding `protect_from_forgery` here would only break the
engine's own calls without buying anything.

### What refusal looks like

`401` with `{"errors":{"detail":"Unauthorized"}}` and a `WWW-Authenticate` header. Never a redirect: a
`302` to an HTML login form is the worst possible answer to a `fetch`, because the caller gets a `200`
full of markup and parses it as data.

### The one exception

`/health` is NOT behind this, and must not be. A liveness probe that needs a credential reports the app
is down whenever the credential is wrong.

---

## 5b. Who owns what, and who may change it

Sections 1 to 5 answer WHO IS SIGNED IN. This answers WHAT THEY MAY DO, which is a different question and
was not written down anywhere until it was found missing.

### The rule

A game has one owner. `games.owner_id` names them and `games.visibility` says who else may see it,
defaulting to `private`.

| Actor | May read | May change |
|---|---|---|
| The owner | their own games | their own games |
| Another signed-in person | a game whose `visibility` is not `private` | nothing |
| An admin | every game | every game |
| Nobody (signed out) | nothing under `/api` | nothing |

`docs/SPEC.md` phase 1 states the gate in one line: *"two accounts exist, one owns a game, the other can
open it and cannot edit it."*

### What was measured, and why this section exists

`games.owner_id` and `games.visibility` both existed as columns. Neither was declared on the `Game`
schema, and `owner_id` appeared nowhere in `lib/nebulith_web` or `lib/nebulith/games`. `GameController`
listed every game to every caller, and `update` and `delete` accepted any id from any signed-in person.

So authentication was enforced and authorisation was not, which is the failure mode that looks safest
from the outside: every request has a valid session, and every request is allowed to do anything.

### How it is enforced

In the CONTEXT, not the controller. `Games.list_games/1`, `get_game!/2`, `update_game/3` and
`delete_game/2` all take the acting user and filter or refuse on it, so a new caller cannot forget the
check by forgetting to write it. A controller that has to remember is a controller that will not.

A refusal is `404`, not `403`, for a game the caller may not see. Telling a stranger that a game exists
but is not theirs is itself a disclosure.

### The checklist for an authorisation change

1. The context function takes the acting user. Not the controller.
2. A read a person may not do answers as if the row did not exist.
3. A write a person may not do changes nothing and says so.
4. An admin is still able to do it.
5. Both layers: `mix test` on the context, and a browser scenario with TWO accounts.

---

## 6. The checklist

Run this before calling any auth change done.

1. A logged-out request to `/games` redirects to `/login`, and does not render the shell.
2. Logging in lands on the page that was asked for, not on a fixed home page.
3. A wrong password and an unknown email give the SAME message and take roughly the same time.
4. `/admin` refuses a logged-in user who is not an admin.
5. `/admin` still accepts HTTP Basic, because the end-to-end gate uses it.
6. Logging out ends the session, and the browser back button does not restore it.
7. `/docs`, `/health` and `/` still answer with no session.
8. `/api/*` refuses a caller with no credential, and answers the same to a session and to a token.
9. `/health` still answers with no credential.
10. Both layers ran: `mix test` for the modules, and a real browser clicking the real form.
