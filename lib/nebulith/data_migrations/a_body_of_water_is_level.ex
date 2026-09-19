defmodule Nebulith.DataMigration.ABodyOfWaterIsLevel do
  @moduledoc """
  Drop the "How deep the channel is cut" option, because there is no channel.

  His correction of 2026-09-16, recorded in `WATER.md` §1: *"we don't need a river channel layer whatsoever,
  that was implemented because I thought it'll facilitate things with water, but after watching various
  videos and understanding the logic behind it, I realized it's wrong. water is just terrain, floor tiles"*.

  The option survived that and defaulted to "1", with no way to turn it off, so every river on every template
  was still cut. Worse, a cut subtracts a constant from each cell and therefore KEEPS whatever unevenness the
  ground had, so one body of water came out at several heights at once. Measured over all 40 generators: a
  woodland river held 183 cells at -1 and 11 at 0, a BEACH held 174 at -1 and 158 at 0, and a mountain river
  spread across four levels. Every step reads as a separate pool, which is what was reported: *"WE'RE USING
  RIVERS AND BEACH WATER LIKE POOLS/PODDLES AND THAT DOESN'T WORK"*.

  The engine levels each connected body to the lowest ground it covers now, so the option has nothing left to
  mean. Saved templates are untouched: this drops a key from the generator configs and the option lists.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    %Postgrex.Result{num_rows: configs} =
      Repo.query!("UPDATE generators SET config = config - 'depth' WHERE jsonb_exists(config, 'depth')")

    %Postgrex.Result{num_rows: options} =
      Repo.query!("""
      UPDATE generators
         SET options = (
               SELECT COALESCE(jsonb_agg(opt), '[]'::jsonb)
                 FROM jsonb_array_elements(options) AS opt
                WHERE opt->>'key' <> 'depth'
             )
       WHERE options IS NOT NULL
         AND EXISTS (SELECT 1 FROM jsonb_array_elements(options) AS o WHERE o->>'key' = 'depth')
      """)

    Logger.info("[data_migrate] no channel to cut: #{configs} config(s), #{options} option list(s)")
    :ok
  end
end
