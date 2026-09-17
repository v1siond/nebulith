defmodule Nebulith.DataMigration.ATownBuildsTheCrossingYouPicked do
  @moduledoc """
  A settlement builds the crossing you asked for.

  *"I selected the wooden bridge on a town generator and used dirt pathway, which tells me the town aren't
  using the setting from the preview"*.

  He is right and the cause is not in the engine. Measured on the live catalog: every village, town and city
  OFFERS the `bridge` option, with all five choices in the dropdown, and serves **no `crossings` at all**.
  The nine wilderness generators serve three. So a settlement's bridge option selected a kind the generator
  had no definition for, and the build fell through to whatever the default was, whatever you picked.

  An option that is offered and cannot be honoured is worse than one that is missing: it says the map will do
  something and then does not.

  The three kinds are the wilderness ones, because they are the same three things:

    * `dirt`  a ford, the river run shallow enough to wade, tinted with the dirt path's own colour
    * `stone` the stone bridge composition, approached over cobblestone
    * `wood`  the timber bridge composition, approached over planking

  What a settlement APPROACHES the crossing on differs from a wood, and that is what the `tile` field is:
  cobblestone into a stone bridge reads as a town, a dirt track into one does not.

  Idempotent: matches only generators that offer `bridge` and carry no `crossings`.
  """
  require Logger

  alias Nebulith.Repo

  @crossings %{
    "dirt" => %{"colorOf" => "path_dirt", "tile" => "floor"},
    "stone" => %{"composition" => "bridge_stone", "tile" => "cobblestone"},
    "wood" => %{"composition" => "bridge_wood", "tile" => "bridge"}
  }

  def run do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{crossings}', $1::text::jsonb)
        WHERE options @> '[{"key": "bridge"}]'
          AND (config->'crossings' IS NULL OR config->'crossings' = '{}'::jsonb)
        """,
        [Jason.encode!(@crossings)]
      )

    Logger.info("[data_migrate] #{rows} generators can now build the crossing you pick")
    :ok
  end
end
