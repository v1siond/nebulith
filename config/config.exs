# This file is responsible for configuring your application
# and its dependencies with the aid of the Config module.
#
# This configuration file is loaded before any dependency and
# is restricted to this project.

# General application configuration
import Config

config :nebulith,
  ecto_repos: [Nebulith.Repo],
  generators: [timestamp_type: :utc_datetime]

# Configure the endpoint
config :nebulith, NebulithWeb.Endpoint,
  url: [host: "localhost"],
  adapter: Bandit.PhoenixAdapter,
  render_errors: [
    formats: [html: NebulithWeb.ErrorHTML, json: NebulithWeb.ErrorJSON],
    layout: false
  ],
  pubsub_server: Nebulith.PubSub,
  live_view: [signing_salt: "pGD1Xeby"]

# Configure LiveView
config :phoenix_live_view,
  # the attribute set on all root tags. Used for Phoenix.LiveView.ColocatedCSS.
  root_tag_attribute: "phx-r"

# Configure esbuild (the version is required)
config :esbuild,
  version: "0.25.4",
  nebulith: [
    args:
      ~w(js/app.js --bundle --target=es2022 --outdir=../priv/static/assets/js --external:/fonts/* --external:/images/* --alias:@=.),
    cd: Path.expand("../assets", __DIR__),
    env: %{"NODE_PATH" => [Path.expand("../deps", __DIR__), Mix.Project.build_path()]}
  ],
  # The DOCUMENTATION bundle: mermaid, and nothing else. Its own profile because mermaid is large and only
  # `/docs` pages that actually contain a diagram load it, so it must not ride in the app bundle.
  docs: [
    args: ~w(js/docs.js --bundle --format=esm --target=es2022 --outdir=../priv/static/assets/js),
    cd: Path.expand("../assets", __DIR__),
    env: %{"NODE_PATH" => [Path.expand("../deps", __DIR__), Mix.Project.build_path()]}
  ],
  # The ENGINE bundle. Code-split on purpose: the editor is a large tree and one blob would block
  # the gallery on the whole thing. `--alias:@=./game` is the same `@/` the source and the suite use.
  # NODE_ENV has to be defined or React's own `process.env.NODE_ENV` reads crash in the browser;
  # config/dev.exs overrides this profile so development gets React's dev build and its warnings.
  game: [
    args:
      ~w(js/game.tsx --bundle --splitting --format=esm --target=es2022 --outdir=../priv/static/assets/js/game --alias:@=./game) ++
        [~s(--define:process.env.NODE_ENV="production")],
    cd: Path.expand("../assets", __DIR__),
    env: %{"NODE_PATH" => [Path.expand("../assets/node_modules", __DIR__)]}
  ]

# Configure tailwind (the version is required)
config :tailwind,
  version: "4.3.0",
  nebulith: [
    args: ~w(
      --input=assets/css/app.css
      --output=priv/static/assets/css/app.css
    ),
    cd: Path.expand("..", __DIR__),
    env: %{"NODE_PATH" => [Path.expand("../deps", __DIR__), Mix.Project.build_path()]}
  ],
  # The ENGINE's stylesheet, built separately from app.css so the editor never inherits daisyUI's
  # base styles and the admin pages never inherit the editor's.
  game: [
    args: ~w(
      --input=assets/css/game.css
      --output=priv/static/assets/css/game.css
    ),
    cd: Path.expand("..", __DIR__),
    env: %{"NODE_PATH" => [Path.expand("../deps", __DIR__), Mix.Project.build_path()]}
  ]

# Configure Elixir's Logger
config :logger, :default_formatter,
  format: "$time $metadata[$level] $message\n",
  metadata: [:request_id]

# Use Jason for JSON parsing in Phoenix
config :phoenix, :json_library, Jason

# Import environment specific config. This must remain at the bottom
# of this file so it overrides the configuration defined above.
import_config "#{config_env()}.exs"
