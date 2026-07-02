defmodule Nebulith.Repo do
  use Ecto.Repo,
    otp_app: :nebulith,
    adapter: Ecto.Adapters.Postgres
end
