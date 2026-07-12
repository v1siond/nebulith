// Base URL for the nebulith Elixir backend, shared by every client that talks to it
// (templates, tilesets, cv, games). Configurable via NEXT_PUBLIC_NEBULITH_API so the dev
// port — or a same-origin proxy later — can move without editing code; falls back to the
// historical dev default. The NEXT_PUBLIC_ prefix is required for the value to reach the
// browser bundle (these fetches run client-side). Set it in .env.local, e.g.
//   NEXT_PUBLIC_NEBULITH_API=http://localhost:4000/api
export const NEBULITH_API =
  process.env.NEXT_PUBLIC_NEBULITH_API ?? 'http://localhost:4001/api'
