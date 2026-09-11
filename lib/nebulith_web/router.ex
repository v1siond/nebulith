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

  pipeline :admin do
    plug NebulithWeb.AdminAuth
  end

  scope "/", NebulithWeb do
    pipe_through :browser

    get "/", PageController, :home
  end

  scope "/admin", NebulithWeb do
    pipe_through [:browser, :admin]

    get "/", AdminController, :index
  end

  scope "/api", NebulithWeb do
    pipe_through :api

    resources "/tilesets", TilesetController, except: [:new, :edit]
    # Entity → baked-tile resolution DATA (enemyType/variant → slug). Read-only; the
    # frontend fetches it at load time (it holds no bundled entity data).
    get "/entities", EntityController, :index
    get "/combat", CombatController, :index
    get "/zones", ZoneController, :index
    get "/ui", UiController, :index
    put "/ui", UiController, :update
    resources "/templates", TemplateController, except: [:new, :edit]
    resources "/games", GameController, except: [:new, :edit] do
      # A game's LEVELS, nested so the route itself carries whose levels these are. *"game > has many levels
      # > has many templates"* — the layer that was missing, and the reason "Manage levels" could only show
      # him a list of games.
      resources "/levels", LevelController, only: [:index, :create]
      put "/levels/order", LevelController, :reorder
    end

    resources "/levels", LevelController, only: [:show, :update, :delete]
    # Editor UI settings — a key→value store for editor chrome geometry (per modal id).
    # The map-generator CATALOG — categories + their generators, with every knob a generate takes.
    # Read-only; the editor loads it at mount so nothing about a generator is hardcoded frontend-side.
    get "/generators", GeneratorController, :index
    # BUILDINGS AT ANY SIZE — the types the composer offers, and one composed to order. Alexander,
    # 2026-09-08: *"why having 3 size house when we can have 1 house button and allow user to make a house
    # as big or as small as he wants???"* `show` serves the SAME composition shape /api/tilesets does, so
    # the editor stamps a generated building through the path it already has.
    get "/buildings", BuildingController, :index
    get "/buildings/:type", BuildingController, :show
    # The item catalog — weapons / armour / consumables + starter kits (§3.14b #1).
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
