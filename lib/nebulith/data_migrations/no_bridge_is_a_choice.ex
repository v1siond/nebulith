defmodule Nebulith.DataMigration.NoBridgeIsAChoice do
  @moduledoc """
  The crossing option gains "No bridge".

  *"from time to time, the system doesn't add any bridge even when I have a river, which is fine, but we
  should have an explicit option 'no bridge'"*. It happening by accident is not the same as being able to ask
  for it. With the choice served, a river left uncrossed is an answer rather than something that went wrong.

  The generator reads it as a refusal, the same way it now reads `river: none` as one: `crossingRefused/1`
  short-circuits both the deck pass and `bridgeRiver`, so nothing is laid and nothing is stamped.

  Inserted after "Random" so the two "nothing here" answers sit together at the top of the list.

  Idempotent BY CONSTRUCTION: the bridge option's choices are rebuilt as "the first one, then No bridge, then
  everything else that is not already No bridge". A guard of "does this row already contain a none key" was
  tried and matched every row on the first run, because the RIVER option has carried a `none` choice all
  along and `@>` does not care which option it found it in.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %{num_rows: rows} =
      Repo.query!("""
      UPDATE generators SET options = (
        SELECT jsonb_agg(
          CASE WHEN opt->>'key' = 'bridge'
            THEN jsonb_set(opt, '{choices}',
              jsonb_build_array(opt->'choices'->0) ||
              '[{"key":"none","label":"No bridge"}]'::jsonb ||
              (SELECT COALESCE(jsonb_agg(c ORDER BY i), '[]'::jsonb)
                 FROM jsonb_array_elements(opt->'choices') WITH ORDINALITY t(c, i)
                WHERE i > 1 AND c->>'key' <> 'none'))
            ELSE opt END)
        FROM jsonb_array_elements(options) opt
      )
      WHERE options @> '[{"key": "bridge"}]'
      """)

    Logger.info("[data_migrate] no bridge is a choice: #{rows} option lists")
    :ok
  end
end
