defmodule NebulithWeb.Router do
  use NebulithWeb, :router

  import NebulithWeb.UserAuth

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {NebulithWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
    plug :fetch_current_user
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  # THE API, for a caller who has to be somebody. The session is fetched because the engine's own
  # fetches are same-origin and carry the cookie; the bearer token is for everything that is not a
  # browser. `same_site: "Lax"` on the cookie is what keeps a cross-site POST from riding it, which is
  # why this pipeline needs no CSRF check of its own.
  #
  # /health is NOT here. A liveness probe that needs a credential is a liveness probe that reports the
  # app is down whenever the credential is wrong.
  pipeline :api_signed_in do
    plug :accepts, ["json"]
    plug :fetch_session
    plug :fetch_current_user
    plug :require_api_user
  end

  # The ENGINE. It carries a session now, because the pages behind it require a login.
  #
  # That ends the cross-origin iframe embed: a third-party cookie is blocked or partitioned by every
  # current browser, so an embedded engine arrives with no session, sees the login page, and cannot log
  # in from inside the frame either. `frame-ancestors *` is left as it was, so the CSP still permits
  # the embed, but the login is what actually decides it. docs/AUTH.md §3 has the trade and the exact
  # `same_site` change that would buy the embed back.
  #
  # CSRF is on because the header's Log out button posts. It only checks non-GET requests, so the shell
  # itself is unaffected, and /api keeps its own pipeline.
  pipeline :engine do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {NebulithWeb.Layouts, :engine}
    plug :protect_from_forgery

    plug :put_secure_browser_headers, %{
      "content-security-policy" => "base-uri 'self'; frame-ancestors *;"
    }

    plug :fetch_current_user
  end

  pipeline :admin do
    plug NebulithWeb.AdminAuth
  end

  pipeline :signed_in do
    plug :require_authenticated_user
  end

  pipeline :signed_out_only do
    plug :redirect_if_user_is_authenticated
  end

  scope "/", NebulithWeb do
    pipe_through :browser

    get "/", PageController, :home
  end

  # THE DOOR. Someone already signed in is bounced off the form rather than shown it again.
  scope "/", NebulithWeb do
    pipe_through [:browser, :signed_out_only]

    get "/login", SessionController, :new
    post "/login", SessionController, :create
  end

  # Logging out is a POST, so a link on another site cannot sign a person out by being visited.
  scope "/", NebulithWeb do
    pipe_through :browser

    post "/logout", SessionController, :delete
    delete "/logout", SessionController, :delete
  end

  # The platform's liveness check. Its own pipeline: no session, no layout, no secure headers to
  # negotiate, and excluded from force_ssl in prod so the internal HTTP probe is not redirected.
  scope "/", NebulithWeb do
    pipe_through :api

    get "/health", HealthController, :show
  end

  # Every engine path serves the same shell; the client router reads the path. Listing them rather than
  # globbing keeps an unknown path a 404 instead of a silently empty gallery.
  scope "/", NebulithWeb do
    pipe_through [:engine, :signed_in]

    get "/games", EngineController, :app
    get "/games/:id", EngineController, :app
    get "/templates", EngineController, :app
    # The sprite authoring tools. Same shell; the client router loads them on demand.
    get "/sprite-generator", EngineController, :app
    get "/sprites-test", EngineController, :app
  end

  # Where the engine used to live, when it was a route inside the CV site. Redirects, so old links and
  # the probe harness resolve instead of 404ing.
  scope "/personal-projects/game-engine", NebulithWeb do
    pipe_through :engine

    get "/*rest", EngineController, :legacy
  end

  # The database browser. Every table, searchable, a row at a time, editable and deletable. Behind :admin
  # because it can write to any table in the database.
  scope "/admin", NebulithWeb do
    pipe_through [:browser, :admin]

    get "/", AdminController, :index
    get "/:table", AdminController, :table
    get "/:table/:id", AdminController, :show
    get "/:table/:id/edit", AdminController, :edit
    put "/:table/:id", AdminController, :update
    delete "/:table/:id", AdminController, :delete
  end

  # The documentation site: an index of every markdown document in the repo, and a page per document.
  # Deliberately NOT behind :admin, because a reference you need a login to read is not a reference.
  scope "/docs", NebulithWeb do
    pipe_through :browser

    get "/", DocsController, :index
    get "/:slug", DocsController, :show
  end

  scope "/api", NebulithWeb do
    pipe_through :api_signed_in

    resources "/tilesets", TilesetController, except: [:new, :edit]
    # Entity → baked-tile resolution DATA (enemyType/variant → slug). Read-only; the
    # frontend fetches it at load time (it holds no bundled entity data).
    get "/entities", EntityController, :index
    get "/combat", CombatController, :index
    get "/zones", ZoneController, :index

    # THE GENERATION LAYERS, as data. The engine binds a pass to each key and the editor builds its re-roll
    # panel from the list, so a layer is a row rather than an edit in two repos. Keyed by `key`, not id: the
    # key is what the engine binds to, so it is what a caller has in hand.
    get "/generation_layers", GenerationLayerController, :index
    post "/generation_layers", GenerationLayerController, :create
    get "/generation_layers/:key", GenerationLayerController, :show
    put "/generation_layers/:key", GenerationLayerController, :update
    delete "/generation_layers/:key", GenerationLayerController, :delete

    # The sprite generator's door to pixellab.ai. It is here rather than in the browser because the
    # API key must not be. See NebulithWeb.PixellabController.
    post "/pixellab", PixellabController, :create
    get "/ui", UiController, :index
    put "/ui", UiController, :update
    resources "/templates", TemplateController, except: [:new, :edit]

    resources "/games", GameController, except: [:new, :edit] do
      # A game's LEVELS, nested so the route itself carries whose levels these are., the layer that was missing, and
      # the reason "Manage levels" could only show
      # a list of games.
      resources "/levels", LevelController, only: [:index, :create]
      put "/levels/order", LevelController, :reorder
    end

    resources "/levels", LevelController, only: [:show, :update, :delete]
    # Editor UI settings, a key→value store for editor chrome geometry (per modal id).
    # The map-generator CATALOG, categories + their generators, with every knob a generate takes.
    # Read-only; the editor loads it at mount so nothing about a generator is hardcoded frontend-side.
    get "/generators", GeneratorController, :index
    # BUILDINGS AT ANY SIZE, the types the composer offers, and one composed to order.
    # 2026-09-08: `show` serves the SAME composition shape /api/tilesets does, so
    # the editor stamps a generated building through the path it already has.
    get "/buildings", BuildingController, :index
    get "/buildings/:type", BuildingController, :show
    # The item catalog, weapons / armour / consumables + starter kits (§3.14b #1).
    get "/items", ItemController, :index
    # The ability registry (§3.14b #2).
    get "/abilities", AbilityController, :index
    get "/editor_settings", EditorSettingController, :index
    put "/editor_settings/:key", EditorSettingController, :update

    # MAPS, as rows. `show` and `update` are exact inverses: what goes out comes back under the same
    # keys, and the keys are the column names. See docs/SPEC.md §8 phase 3.
    get "/maps", MapController, :index
    post "/maps", MapController, :create
    # Before /maps/:id, or these words are read as ids.
    get "/maps/schema", MapController, :schema
    get "/maps/for_template/:template_id", MapController, :for_template
    get "/maps/:id", MapController, :show
    put "/maps/:id", MapController, :update
    get "/cv", CVController, :index
  end

  # Enable LiveDashboard in development
  if Application.compile_env(:nebulith, :dev_routes) do
    # If you want to use the LiveDashboard in production, you should put
    # it behind authentication and allow only admins to access it.
    # If your application does not have an admins-only section yet,
    # you can use Plug.BasicAuth to set up some basic authentication
    # as long as you are also using SSL (which you should anyway).
    import Phoenix.LiveDashboard.Router

    scope "/dev" do
      pipe_through :browser

      live_dashboard "/dashboard", metrics: NebulithWeb.Telemetry
    end
  end
end
