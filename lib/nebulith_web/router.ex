defmodule NebulithWeb.Router do
  use NebulithWeb, :router

  pipeline :browser do
    plug :accepts, ["html"]
    plug :fetch_session
    plug :fetch_live_flash
    plug :put_root_layout, html: {NebulithWeb.Layouts, :root}
    plug :protect_from_forgery
    plug :put_secure_browser_headers
  end

  pipeline :api do
    plug :accepts, ["json"]
  end

  # The ENGINE. No session and no CSRF: the shell is a plain GET and the application talks to /api,
  # which carries neither. That also means nothing here depends on a cookie, which is what lets the
  # engine work inside a cross-origin iframe at all (a third-party cookie is blocked or partitioned).
  #
  # `frame-ancestors *` replaces Phoenix's default `frame-ancestors 'self'`, which is the ONLY thing
  # that stops another site from embedding this. Deliberately open: embedding the engine is the point.
  # See docs/DEPLOYMENT-AND-BOUNDARIES.md §7 for what that costs. Every other browser route keeps the
  # default, so /admin stays un-embeddable.
  pipeline :engine do
    plug :accepts, ["html"]
    plug :put_root_layout, html: {NebulithWeb.Layouts, :engine}
    plug :put_secure_browser_headers, %{
      "content-security-policy" => "base-uri 'self'; frame-ancestors *;"
    }
  end

  pipeline :admin do
    plug NebulithWeb.AdminAuth
  end

  scope "/", NebulithWeb do
    pipe_through :browser

    get "/", PageController, :home
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
    pipe_through :engine

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

  scope "/admin", NebulithWeb do
    pipe_through [:browser, :admin]

    get "/", AdminController, :index
  end

  # The documentation site: an index of every markdown document in the repo, and a page per document.
  # Deliberately NOT behind :admin, because a reference you need a login to read is not a reference.
  scope "/docs", NebulithWeb do
    pipe_through :browser

    get "/", DocsController, :index
    get "/:slug", DocsController, :show
  end

  scope "/api", NebulithWeb do
    pipe_through :api

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
