defmodule Nebulith.MixProject do
  use Mix.Project

  def project do
    [
      app: :nebulith,
      version: "0.1.0",
      elixir: "~> 1.15",
      elixirc_paths: elixirc_paths(Mix.env()),
      start_permanent: Mix.env() == :prod,
      aliases: aliases(),
      deps: deps(),
      compilers: [:phoenix_live_view] ++ Mix.compilers(),
      listeners: [Phoenix.CodeReloader]
    ]
  end

  # Configuration for the OTP application.
  #
  # Type `mix help compile.app` for more information.
  def application do
    [
      mod: {Nebulith.Application, []},
      extra_applications: [:logger, :runtime_tools]
    ]
  end

  def cli do
    [
      preferred_envs: [precommit: :test]
    ]
  end

  # Specifies which paths to compile per environment.
  defp elixirc_paths(:test), do: ["lib", "test/support"]
  defp elixirc_paths(_), do: ["lib"]

  # Specifies your project dependencies.
  #
  # Type `mix help deps` for examples and options.
  defp deps do
    [
      {:phoenix, "~> 1.8.8"},
      {:phoenix_ecto, "~> 4.5"},
      {:ecto_sql, "~> 3.13"},
      {:postgrex, ">= 0.0.0"},
      {:phoenix_html, "~> 4.1"},
      {:phoenix_live_reload, "~> 1.2", only: :dev},
      {:phoenix_live_view, "~> 1.2.0"},
      {:lazy_html, ">= 0.1.0", only: :test},
      # THE END-TO-END LAYER, in Elixir, driving a real browser. PhoenixTest's visit/click DSL backed by
      # Playwright, so a click-through runs inside `mix test`, against the TEST database, with the Ecto
      # sandbox holding the transaction. See docs/TESTING.md.
      {:phoenix_test_playwright, "~> 0.18.0", only: :test, runtime: false},
      # The websocket transport to a Playwright SERVER. This machine is Ubuntu 20.04 and Playwright stopped
      # shipping a chromium for focal, so the local driver cannot run; the browser is reached over ws instead.
      {:websockex, "~> 0.4", only: :test},
      {:phoenix_live_dashboard, "~> 0.8.3"},
      {:esbuild, "~> 0.10", runtime: Mix.env() == :dev},
      {:tailwind, "~> 0.3", runtime: Mix.env() == :dev},
      {:heroicons,
       github: "tailwindlabs/heroicons",
       tag: "v2.2.0",
       sparse: "optimized",
       app: false,
       compile: false,
       depth: 1},
      {:telemetry_metrics, "~> 1.0"},
      {:telemetry_poller, "~> 1.0"},
      {:gettext, "~> 1.0"},
      {:jason, "~> 1.2"},
      {:dns_cluster, "~> 0.2.0"},
      {:bandit, "~> 1.5"},
      {:cors_plug, "~> 3.0"},
      # Talking OUT to pixellab.ai for the sprite generator. The only outbound HTTP this app makes.
      {:req, "~> 0.5"},
      # The static analysis. Not a formatter and not a compiler: it reads for the things neither of them
      # can see, a function doing too much, a name that says nothing, a nesting level nobody needs.
      {:credo, "~> 1.7", only: [:dev, :test], runtime: false},
      # Renders the repo's markdown docs into the /docs pages. The documentation is many markdown files
      # behind one index, a page per section of the system and the api, so the reference lives with the
      # code rather than beside it.
      {:earmark, "~> 1.4"}
    ]
  end

  # Aliases are shortcuts or tasks specific to the current project.
  # For example, to install project dependencies and perform other setup tasks, run:
  #
  #     $ mix setup
  #
  # See the documentation for `Mix` for more info on aliases.
  defp aliases do
    [
      setup: ["deps.get", "ecto.setup", "assets.setup", "assets.build"],
      "ecto.setup": ["ecto.create", "ecto.migrate", "run priv/repo/seeds.exs"],
      "ecto.reset": ["ecto.drop", "ecto.setup"],
      test: ["ecto.create --quiet", "ecto.migrate --quiet", "test"],
      "assets.setup": ["tailwind.install --if-missing", "esbuild.install --if-missing"],
      "assets.build": [
        "compile",
        "tailwind nebulith",
        "tailwind game",
        "esbuild nebulith",
        "esbuild game",
        "esbuild docs"
      ],
      "assets.deploy": [
        "tailwind nebulith --minify",
        "tailwind game --minify",
        "esbuild nebulith --minify",
        "esbuild game --minify",
        "esbuild docs --minify",
        "phx.digest"
      ],
      precommit: ["compile --warnings-as-errors", "deps.unlock --unused", "format", "test"]
    ]
  end
end
