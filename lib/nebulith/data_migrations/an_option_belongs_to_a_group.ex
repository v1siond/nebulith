defmodule Nebulith.DataMigration.AnOptionBelongsToAGroup do
  @moduledoc """
  Every generator option gets a GROUP and, where it is a count, a rule for how the map's size limits it.

  ## 1. The group

  *"this is not clear"*, about a panel showing seven sibling dropdowns. They are not siblings: `depth`,
  `bridge` and `water` are all settings OF the river and read as peers of it, and `exits` and `pathways` are
  about the way through the map rather than about what is on it.

  Grouped as he described them, water and crossings and the rest:

      Layout      exits, pathways, region
      Water       river, depth, water
      Crossings   bridge

  The frontend renders whatever groups are named here and infers nothing, which is the rule the composition
  palette already follows: it groups by the served category with no frontend heuristic. See
  `docs/EDITOR-UX.md` §2.1.

  ## 2. The limit that moves with the map

  *"I want to have dynamic pathways limits based of size of the grid"*. Every generator offers 1 to 4 exits
  and 1 to 4 pathways whether the map is 30x24 or 120x90, and four ways across a small map is a different
  thing from four across a large one.

  `maxPer` says how many cells one of these wants: a choice of N is offered only while
  `cols * rows >= N * maxPer`. The numbers come from the smallest map a generator serves rather than from
  taste. The woodland's floor is 30x24, 720 cells, and it has always offered 4 of each there, so 180 cells
  per way is the rate the system already runs at and this states it rather than changing it. A bigger map
  therefore offers the same or more, never fewer, and only maps below the current floor lose a choice.

  The frontend reads the rule and narrows the list. It does not carry the arithmetic's constants.

  Idempotent: matches only options that do not already carry the field.
  """
  require Logger

  alias Nebulith.Repo

  @groups %{
    "exits" => "layout",
    "pathways" => "layout",
    "region" => "layout",
    "river" => "water",
    "depth" => "water",
    "water" => "water",
    "bridge" => "crossings"
  }

  # Cells a single one of these wants before another is offered. Derived from the smallest grid a generator
  # serves (30x24 = 720) still offering four, so this states today's rate rather than tightening it.
  @max_per %{"exits" => 180, "pathways" => 180}

  @group_labels %{
    "layout" => "Layout",
    "water" => "Water",
    "crossings" => "Crossings"
  }

  def run do
    groups = for {key, group} <- @groups, reduce: 0 do
      acc -> acc + set_field(key, "group", group)
    end

    limits = for {key, per} <- @max_per, reduce: 0 do
      acc -> acc + set_field(key, "maxPer", per)
    end

    labels = write_group_labels()

    Logger.info(
      "[data_migrate] #{groups} options grouped, #{limits} carry a size limit, #{labels} generators carry the group labels"
    )

    :ok
  end

  defp set_field(key, field, value) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET options = (
          SELECT jsonb_agg(
            CASE WHEN opt->>'key' = $1 THEN jsonb_set(opt, ARRAY[$2], $3::text::jsonb) ELSE opt END
          )
          FROM jsonb_array_elements(options) opt
        )
        WHERE options @> jsonb_build_array(jsonb_build_object('key', $1::text))
        """,
        [key, field, Jason.encode!(value)]
      )

    rows
  end

  # The heading a group shows, served beside the groups themselves so the panel never spells one itself. On the
  # generator rather than on each option, because a label belongs to the group and not to seven copies of it.
  defp write_group_labels do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{optionGroups}', $1::text::jsonb)
        WHERE options IS NOT NULL AND jsonb_array_length(options) > 0
        """,
        [Jason.encode!(@group_labels)]
      )

    rows
  end
end
