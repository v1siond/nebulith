// Base path for the nebulith Elixir backend.
//
// The engine is served BY that backend now, so the API is same-origin and a relative path is the
// whole answer: no environment variable, no build-time baking, no CORS, and no way for a built
// bundle to point at the wrong host.
//
// `tilesetLoader` derives the asset origin from this by stripping the trailing /api, which is why
// this stays a path and not a bare '/api/' with a slash on the end.
export const NEBULITH_API = '/api'
