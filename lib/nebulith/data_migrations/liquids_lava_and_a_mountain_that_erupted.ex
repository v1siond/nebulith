defmodule Nebulith.DataMigration.LiquidsLavaAndAMountainThatErupted do
  @moduledoc """
  Water becomes LIQUIDS, lava joins it as a choice, and a volcano grows burned trees.

  ## 1. Liquids, and lava as one of them

  *"the lava river shouldn't be the default for volcanic, just another option on water, we can call water
  liquids or something"*, and *"we also must do lava, which is basically water colored as lava"*.

  So the group is **Liquids**, the option reads "Kind of liquid", and `lava` is a third choice beside the two
  water looks. Anyone can fill any map's channels with magma; a volcano keeps its river unless somebody asks
  for lava. That is the opposite of making it a property of being volcanic, which is what I was about to do.

  Lava needs no art of its own. It wears the smooth family's pieces, border pieces included, and differs in
  the two things that actually matter: the colour (the served `palette.lava`, the existing `lava` tile's own
  #ff5a1f) and the fact that nothing wades it at any depth.

  ## 2. A mountain that erupted

  *"for volcanic add variations of burned trees, we'll assume the vulcan erupted, we can use woodland and
  mountain trees, since a vulcan is just a mountain that erupts lava"*.

  Volcanic served `tree_conifer, tree_tall, tree_stub`, which is byte-identical to Mountain's list, so the
  two environments had no flavour between them at all. It now grows the four burned species: pine, oak,
  birch and encina, the ones a woodland and a mountain between them actually grow, after the fire. Its
  sub-regions get the same treatment, so a burned wood is burned all the way through.

  And its PALETTE was the woodland's, verbatim: green canopy #5d7340, blue water, green floor, on a volcano.
  Ash and charcoal now, with the lava tone served so a lava liquid has a colour to take.

  Idempotent: matches only what is still unchanged.
  """
  require Logger

  alias Nebulith.Repo

  @liquid_option %{
    "key" => "water",
    "label" => "Kind of liquid",
    "type" => "choice",
    "requires" => "river",
    "group" => "water",
    "preview" => true,
    "default" => "smooth",
    "choices" => [
      %{"key" => "smooth", "label" => "Smooth water"},
      %{"key" => "lined", "label" => "Lined water"},
      %{"key" => "lava", "label" => "Lava"}
    ]
  }

  # The four species a woodland and a mountain grow between them, burned. Weighted so the taller two lead,
  # which is what is left standing after a fire goes through.
  @burned [
    %{"kind" => "tree_burned_pine", "weight" => 34},
    %{"kind" => "tree_burned_birch", "weight" => 26},
    %{"kind" => "tree_burned_oak", "weight" => 24},
    %{"kind" => "tree_burned_encina", "weight" => 16}
  ]

  # Ash, charcoal and cooled basalt, taken from the tiles that already carry those names rather than invented.
  @volcanic_palette %{
    "floor" => "#4a3f3a",
    "floorAlt" => "#5a4a42",
    "litter" => "#6e3a30",
    "canopy" => "#4a423c",
    "canopyAlt" => "#5c524a",
    "undergrowth" => "#55483f",
    "bank" => "#6e3a30",
    "lava" => "#ff5a1f"
  }

  def run do
    liquids = replace_liquid_option()
    label = rename_the_group()
    lava = serve_the_lava_tone()
    burned = burn_the_volcano()

    Logger.info(
      "[data_migrate] #{liquids} generators offer lava as a liquid, #{label} renamed the group, " <>
        "#{lava} carry a lava tone, #{burned} volcanic generators grow burned trees"
    )

    :ok
  end

  defp replace_liquid_option do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET options = (
          SELECT jsonb_agg(CASE WHEN opt->>'key' = 'water' THEN $1::text::jsonb ELSE opt END)
          FROM jsonb_array_elements(options) opt
        )
        WHERE options @> '[{"key": "water"}]'
        """,
        [Jason.encode!(@liquid_option)]
      )

    rows
  end

  # The heading the group shows. Water is one liquid among them now, so the section cannot be called Water.
  defp rename_the_group do
    %{num_rows: rows} =
      Repo.query!("""
      UPDATE generators
      SET config = jsonb_set(config, '{optionGroups,water}', '"Liquids"')
      WHERE config->'optionGroups' ? 'water'
      """)

    rows
  end

  # EVERY generator, not just the volcanic ones: lava is a choice anyone can make on any map, so any map that
  # offers it needs a tone to paint it with.
  defp serve_the_lava_tone do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{palette,lava}', $1::text::jsonb)
        WHERE config->'palette' IS NOT NULL AND NOT config->'palette' ? 'lava'
        """,
        [Jason.encode!(@volcanic_palette["lava"])]
      )

    rows
  end

  defp burn_the_volcano do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(
              jsonb_set(config, '{trees}', $1::text::jsonb),
              '{palette}', COALESCE(config->'palette', '{}'::jsonb) || $2::text::jsonb
            )
        WHERE name ILIKE '%volcanic%'
        """,
        [Jason.encode!(@burned), Jason.encode!(@volcanic_palette)]
      )

    # Its sub-regions grow the same burned wood, or the map is charred in the middle and green at its edges.
    %{num_rows: zones} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{subZones}', (
          SELECT jsonb_agg(jsonb_set(z, '{trees}', $1::text::jsonb))
          FROM jsonb_array_elements(config->'subZones') z
        ))
        WHERE name ILIKE '%volcanic%' AND config->'subZones' IS NOT NULL
        """,
        [Jason.encode!(@burned)]
      )

    rows + zones
  end
end
