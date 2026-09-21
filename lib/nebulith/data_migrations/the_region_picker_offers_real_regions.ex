defmodule Nebulith.DataMigration.TheRegionPickerOffersRealRegions do
  @moduledoc """
  The Region picker offers the regions the map actually has.

  *"basically NONE of the regions are ANY DIFFERENT between each other, selecting any region will give you the
  asme result randomized, nothing particular about anything"*, and *"I dont even understand where you're
  building stuff, it's obviously not in the real app"*.

  He was looking at the right thing and it was genuinely doing nothing.

  ## The bug, exactly

  A generator keeps its regions in TWO places: `config.subZones`, which is the map data, and the `region`
  option's `choices`, which is the dropdown. `EveryBiomeItsOwnRegions` rewrote the first and not the second,
  so on a mountain the picker offered `edge / deep / glade / thicket / lakeside` while the map had
  `foot / slope / treeline / crag / summit`.

  `leadRegion` weights up the picked region by looking it up:

      if (!served.some(z => z.key === picked)) return served

  A key that is not in the map's own list is IGNORED, silently and by design, because guessing at an unknown
  region is worse than ignoring it. So every pick fell through to the unweighted set and every build came out
  the same randomised map, which is precisely what he reported. The data was right, live and correct the whole
  time; the control that drives it was pointing at the old list.

  ## The fix, and why it is derived rather than restated

  The choices are BUILT from the generator's own `subZones` here, keyed by `key` and labelled by `name`. That
  is the only way the two cannot drift again: a generator that changes its regions changes its picker in the
  same breath, and nothing has to remember to update a second list.

  `random` stays first and stays the default, so a build that asks for nothing behaves exactly as it did.

  Runs for EVERY generator that serves regions, wild and settlement alike, since the cities had the same split.

  Idempotent: rebuilt from `subZones` each run.
  """
  require Logger

  alias Nebulith.Repo

  def run do
    rows =
      for %{key: key, zones: zones, options: options} <- with_regions(), reduce: 0 do
        acc -> acc + rewrite(key, zones, options)
      end

    Logger.info("[data_migrate] #{rows} region pickers offer the regions their map actually has")

    :ok
  end

  defp with_regions do
    %{rows: rows} =
      Repo.query!("""
      SELECT key, config->'subZones', options
      FROM generators
      WHERE config->'subZones' IS NOT NULL AND options IS NOT NULL
      """)

    for [key, zones, options] <- rows,
        is_list(zones),
        is_list(options),
        do: %{key: key, zones: zones, options: options}
  end

  defp rewrite(key, zones, options) do
    choices =
      [%{"key" => "random", "label" => "Random"}] ++
        for zone <- zones, do: %{"key" => zone["key"], "label" => zone["name"] || zone["key"]}

    updated =
      for option <- options do
        case option do
          %{"key" => "region"} -> Map.put(option, "choices", choices)
          other -> other
        end
      end

    # Nothing to do for a generator that serves no region picker, rather than inventing one it never had.
    if updated == options do
      0
    else
      %{num_rows: rows} =
        Repo.query!("UPDATE generators SET options = $2::text::jsonb WHERE key = $1", [
          key,
          Jason.encode!(updated)
        ])

      rows
    end
  end
end
