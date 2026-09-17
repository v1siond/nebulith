defmodule Nebulith.DataMigration.AVolcanoBurnsInBands do
  @moduledoc """
  A volcanic map's regions ARE how burnt it is.

  *"on volcanic, we need more variant, like not all trees are gonna be burn out, it depends on how close
  they're to the volcan and even if the volcan eruped or not"*, and then, when told a volcanic map has nothing
  to measure a distance from: *"we don't need to measure, just use regions for that, that's why they exist"*.

  ## What was there

  `forest_volcanic` carried the MOUNTAIN's five regions byte for byte: same keys, same names ("Edge of the
  wood", "Deep wood", "Glade", "Thicket", "Lakeside"), same conifer and stub tree lists, same canopy weights,
  with only the floor colours darkened. Nothing in a volcanic map's regions said anything about a volcano, and
  because `palette.leaf` was a flat ash grey at `leafSeasonality` 0, every tree on the map came out the same
  dead grey whether it had burned or not. One look, everywhere: the exact thing he is objecting to.

  ## The bands, read off his three references

  All three show the same gradient, and it is a gradient of HEIGHT, not of distance: bare rock at the summit,
  scorched ground below it, then living forest at the foot. So the regions become that gradient.

      crater      Crater rim        bare ash, nothing standing but snags
      burnt       Burnt slope       dead trunks, the fire went through
      ashfall     Ash fall          survivors among the dead, thinning
      sheltered   Sheltered wood    living forest, the side the flow missed
      lavaside    Lava lake shore   the standing-water region, kept for its pools

  `weight` puts the bulk of the map in `sheltered` and `ashfall`, so most of a volcanic forest is alive and
  the bare summit is the minority, which is what the references show and the inverse of what we served.

  ## Why this needs no engine change at all, which is his point

  A burnt tree is not a tinted tree, it is a different SPECIES: `tree_dead` is `trunk_base + trunk + snag`
  with no leaf cell in it, so it carries no leaf colour and reads as a bare snag. And a region already states
  which species grow in it, which `speciesAt` reads and `pickLivingTree` rolls. So "how burnt is this part of
  the map" is answered by the tree list a region already serves. Nothing new is invented.

  That also frees `palette.leaf` to be what it should always have been: the colour of the trees that are still
  ALIVE. A volcano is a mountain that erupts, so it takes the mountain's conifer tone with a little more ash
  in it, `#8c8762` against mountain's `#8c875a`. The dead trees do not read it, so the survivors go green and
  the snags stay bare, which is the variation he asked for.

  Settlements under the volcano get a share of dead trees in their own mix for the same reason.

  Idempotent: writes an absolute region list and an absolute colour.
  """
  require Logger

  alias Nebulith.Repo

  @living [
    %{"kind" => "tree_conifer", "weight" => 60},
    %{"kind" => "tree_tall", "weight" => 25},
    %{"kind" => "tree_stub", "weight" => 15}
  ]

  @bands [
    %{
      "key" => "crater",
      "name" => "Crater rim",
      "weight" => 1,
      "canopy" => 0.06,
      "undergrowth" => 0.08,
      "leafHue" => -6,
      "leafValue" => -0.14,
      "formation" => %{"lattice" => 3, "spacing" => 6, "understory" => 0.1},
      "trees" => [%{"kind" => "tree_dead", "weight" => 100}]
    },
    %{
      "key" => "burnt",
      "name" => "Burnt slope",
      "weight" => 2,
      "canopy" => 0.5,
      "undergrowth" => 0.2,
      "leafHue" => -4,
      "leafValue" => -0.1,
      "formation" => %{"lattice" => 7, "spacing" => 3, "understory" => 0.2},
      "trees" => [
        %{"kind" => "tree_dead", "weight" => 85},
        %{"kind" => "tree_stub", "weight" => 15}
      ]
    },
    %{
      "key" => "ashfall",
      "name" => "Ash fall",
      "weight" => 3,
      "canopy" => 0.8,
      "undergrowth" => 0.65,
      "leafHue" => -2,
      "leafValue" => -0.04,
      "formation" => %{"lattice" => 9, "spacing" => 2, "understory" => 0.7},
      "trees" => [
        %{"kind" => "tree_dead", "weight" => 45},
        %{"kind" => "tree_conifer", "weight" => 38},
        %{"kind" => "tree_stub", "weight" => 17}
      ]
    },
    %{
      "key" => "sheltered",
      "name" => "Sheltered wood",
      "weight" => 4,
      "canopy" => 1.15,
      "undergrowth" => 1.2,
      "leafHue" => 3,
      "leafValue" => 0.06,
      "formation" => %{"lattice" => 13, "spacing" => 0, "understory" => 1.1},
      "trees" => @living
    },
    %{
      "key" => "lavaside",
      "name" => "Lava lake shore",
      "weight" => 2,
      "canopy" => 0.7,
      "undergrowth" => 0.8,
      "leafHue" => -6,
      "leafValue" => 0.02,
      "pools" => 0.22,
      "formation" => %{"lattice" => 5, "spacing" => 3, "understory" => 0.6},
      "trees" => [
        %{"kind" => "tree_dead", "weight" => 40},
        %{"kind" => "tree_conifer", "weight" => 40},
        %{"kind" => "tree_stub", "weight" => 20}
      ]
    }
  ]

  # A town at the foot of a volcano stands among trees the last eruption killed, but it is a place people
  # live, so most of its wood is alive.
  @settlement_mix [
    %{"kind" => "tree_conifer", "weight" => 55},
    %{"kind" => "tree_dead", "weight" => 20},
    %{"kind" => "tree_tall", "weight" => 15},
    %{"kind" => "tree_stub", "weight" => 10}
  ]

  @living_leaf "#8c8762"

  def run do
    bands = write_bands()
    leaf = write_leaf()
    mix = write_settlement_mix()

    Logger.info(
      "[data_migrate] the volcano burns in bands: #{bands} region set, #{leaf} leaf colours, #{mix} settlement mixes"
    )

    :ok
  end

  defp write_bands do
    %{num_rows: rows} =
      Repo.query!(
        "UPDATE generators SET config = jsonb_set(config, '{subZones}', $1::text::jsonb) WHERE key = 'forest_volcanic'",
        [Jason.encode!(@bands)]
      )

    rows
  end

  # `key`, never `name`: `name` is the label a person reads in the picker ("Volcanic town"), `key` is the
  # identifier. A migration written against `name` matches nothing and still reports success.
  defp write_leaf do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{palette,leaf}', $1::text::jsonb)
        WHERE key LIKE '%\\_volcanic' AND config->'palette'->>'leaf' IS NOT NULL
        """,
        [Jason.encode!(@living_leaf)]
      )

    rows
  end

  defp write_settlement_mix do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{trees}', $1::text::jsonb)
        WHERE key IN ('village_volcanic', 'town_volcanic', 'city_volcanic')
        """,
        [Jason.encode!(@settlement_mix)]
      )

    rows + write_city_regions()
  end

  # AND THE CITY'S NEIGHBOURHOODS, or the line above is dead data on the one settlement that has regions.
  # The engine reads `zoneAt[row][col].trees ?? ctx.treeMix`, so a region's list SHADOWS the environment's:
  # a city whose three neighbourhoods all name living conifers grows no dead tree whatever its own mix says.
  # A village and a town have no regions, so their environment mix is the one that runs.
  defp write_city_regions do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators SET config = jsonb_set(config, '{subZones}', (
          SELECT jsonb_agg(jsonb_set(z, '{trees}', $1::text::jsonb) ORDER BY ord)
          FROM jsonb_array_elements(config->'subZones') WITH ORDINALITY AS t(z, ord)
        ))
        WHERE key = 'city_volcanic' AND config->'subZones' IS NOT NULL
        """,
        [Jason.encode!(@settlement_mix)]
      )

    rows
  end
end
