// Base URL for the nebulith Elixir backend, shared by every client that talks to it
// (templates, tilesets, cv, games). ALWAYS configured through the environment — set
// NEXT_PUBLIC_NEBULITH_API in .env.local so the port can move without editing code.
// The NEXT_PUBLIC_ prefix is required for the value to reach the browser bundle (these
// fetches run client-side).
//
//   .env.local:  NEXT_PUBLIC_NEBULITH_API=http://localhost:6328/api
//   backend:     PORT=6328 mix phx.server   (6328 is the nebulith default; see nebulith/config/runtime.exs)
//
// The literal below is the last-resort default for a checkout with no .env.local; it must
// stay in step with nebulith's own default port.
export const NEBULITH_API =
  process.env.NEXT_PUBLIC_NEBULITH_API ?? 'http://localhost:6328/api'
