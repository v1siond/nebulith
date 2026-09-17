defmodule Nebulith.DataMigration.AnElementShowsWhatItDoes do
  @moduledoc """
  The options whose choices are worth SEEING say so, and the panel draws a picture of each one.

  *"we see the preview of the element like we do on objects and I want to see the preview of the element after
  adding it to the map too"*, and the things he named as elements: *"water -> river, lake, beach, bridges ->
  stone, dirt, wood"*.

  So `river`, `bridge` and `water` carry `preview: true`. Their choices are visibly different things, and a
  picture says what a word cannot: "Divides the map in two" and "Around the edge" are two different maps.

  ## What does NOT carry it, and why that is the point

  `exits`, `pathways` and `region` are counts and placements. A thumbnail of "3 exits" beside "4 exits" is two
  nearly identical pictures, which teaches nothing and costs a whole map generation each. `depth` is a number
  about the channel rather than a kind of thing.

  The flag is served rather than decided in the panel for the same reason the groups are: the frontend renders
  what the catalog says and infers nothing (`docs/EDITOR-UX.md` §2.1). Turning a preview on for another option
  is one row here, not a frontend change.

  Idempotent: matches only options that lack the field.
  """
  require Logger

  alias Nebulith.Repo

  @previewed ~w(river bridge water)

  def run do
    rows =
      for key <- @previewed, reduce: 0 do
        acc ->
          %{num_rows: n} =
            Repo.query!(
              """
              UPDATE generators SET options = (
                SELECT jsonb_agg(
                  CASE WHEN opt->>'key' = $1 THEN jsonb_set(opt, '{preview}', 'true') ELSE opt END
                )
                FROM jsonb_array_elements(options) opt
              )
              WHERE options @> jsonb_build_array(jsonb_build_object('key', $1::text))
              """,
              [key]
            )

          acc + n
      end

    Logger.info("[data_migrate] #{rows} option rows show a picture of each choice")
    :ok
  end
end
