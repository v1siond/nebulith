defmodule Nebulith.Catalog.ZoneSource do
  @moduledoc """
  The SEED for the season catalog, dumped VERBATIM from the frontend tables it replaces.

  `src/engine/zones.ts` carried all of this, ground palettes, the hazard and trail tile, the curated tree /
  decor / flower tile per season, the bloom variants, and the temple and cave palettes. Its own comment said
  where it belonged:

  Every value here was dumped out of that module rather than retyped, so the seed cannot have drifted from
  what shipped. Idempotent: `seed/0` upserts by `key`, the contract every other source here has.
  """
  import Ecto.Query, warn: false

  alias Nebulith.Repo
  alias Nebulith.Catalog.{Zone, CombatSource}

  @doc "Every season, in menu order."
  def zones do
    [
      %{
        key: "spring",
        name: "Spring",
        position: 0,
        palette: %{
          "id" => "spring",
          # THE OPEN FIELD'S OWN COLOURS for this season: the row gradient's two ends, the grass and earth
          # patches, the cobble at its entrance, and the river and its bank. Every colour a meadow layout
          # writes as floor STATE.
          #
          # This was a table in `stageGenerator.ts`, seven seasons of it, which is a map's appearance decided
          # in the frontend. The frontend reads this and invents nothing: a season that does not serve it
          # paints no meadow rather than falling back to a colour of its own.
          "meadow" => %{
            "top" => "#b0c85f",
            "bottom" => "#8fb14c",
            "grass" => "#7cae44",
            "earth" => "#b69c78",
            "cobble" => "#bcac90",
            "river" => "#57a1bd",
            "bank" => "#c8b07d",
            "plot" => "#c8cf94"
          },
          "groundTypes" => ["meadow", "grass_tall", "grass"],
          "hazard" => "water",
          "trail" => "path",
          "wallColor" => "#6a5a3a",
          "accentColor" => "#ff9ecf"
        },
        tiles: %{
          "tree" => "emoji:cherry-blossom",
          # A BLOOM IS NOT GROUND COVER. Spring served a FLOWER here, and the ground cover pass scatters this
          # tile over every walkable cell of every map, so every spring map in the catalogue came out strewn
          # with blossom whatever it was: a volcano, a mountain, a desert. Which blooms grow somewhere is the
          # ENVIRONMENT's to say, and it already says it, region by region, in the generator catalogue. Four
          # environments serve no blooms at all and got 94 of them each. Clover is ground cover, which is what
          # this field is for, and what the season legitimately decides.
          "decor" => "emoji:clover",
          "flower" => "emoji:tulip"
        },
        flowers: %{
          "variants" => [
            %{
              "char" => "✿",
              "color" => "#ff8fc8"
            },
            %{
              "char" => "❀",
              "color" => "#ffd24a"
            },
            %{
              "char" => "✾",
              "color" => "#c89bff"
            },
            %{
              "char" => "❁",
              "color" => "#ff7a7a"
            },
            %{
              "char" => "✽",
              "color" => "#ffffff"
            },
            %{
              "char" => "❋",
              "color" => "#7ad0ff"
            }
          ]
        },
        temple: %{
          "floor" => "temple_floor",
          "accent" => "cave_moss",
          "wall" => ["#5b6a52", "#53614b", "#4c5945", "#616e58"],
          "pillar" => "#b9c6a6",
          "torch" => "#ffb24a",
          "altar" => "#d8f0b0",
          "pool" => "water",
          "poolBlocks" => true,
          "spikeChar" => "▲",
          "spikeColor" => "#6a9f4a"
        },
        cave: %{
          "floor" => "cave_floor",
          "accent" => "cave_moss",
          "accentChance" => 0.14,
          "wall" => ["#4c4a44", "#565248", "#42403a", "#514d46"],
          "pool" => "water",
          "poolBlocks" => true,
          "crystal" => "#e79ec8",
          "mushrooms" => true
        }
      },
      %{
        key: "summer",
        name: "Summer",
        position: 1,
        palette: %{
          "id" => "summer",
          # THE OPEN FIELD'S OWN COLOURS for this season: the row gradient's two ends, the grass and earth
          # patches, the cobble at its entrance, and the river and its bank. Every colour a meadow layout
          # writes as floor STATE.
          #
          # This was a table in `stageGenerator.ts`, seven seasons of it, which is a map's appearance decided
          # in the frontend. The frontend reads this and invents nothing: a season that does not serve it
          # paints no meadow rather than falling back to a colour of its own.
          "meadow" => %{
            "top" => "#b4c05a",
            "bottom" => "#8ba341",
            "grass" => "#7f9b39",
            "earth" => "#b39a72",
            "cobble" => "#b7a488",
            "river" => "#4f93b3",
            "bank" => "#c1a877",
            "plot" => "#c6cb92"
          },
          "groundTypes" => ["meadow", "grass_tall", "grass"],
          "hazard" => "water",
          "trail" => "path",
          "wallColor" => "#5a4a30",
          "accentColor" => "#2e8b2e"
        },
        tiles: %{
          "tree" => "emoji:oak-tree",
          "decor" => "emoji:clover",
          "flower" => "emoji:sunflower"
        },
        flowers: %{
          "variants" => [
            %{
              "char" => "*",
              "color" => "#ff88cc"
            },
            %{
              "char" => "✿",
              "color" => "#ffd24a"
            },
            %{
              "char" => "❁",
              "color" => "#ff6f6f"
            },
            %{
              "char" => "✽",
              "color" => "#f4f4ec"
            },
            %{
              "char" => "✾",
              "color" => "#b892ff"
            },
            %{
              "char" => "❋",
              "color" => "#7ac6ff"
            }
          ]
        },
        temple: %{
          "floor" => "ancient_stone",
          "accent" => "marble",
          "wall" => ["#7a736a", "#6f6860", "#847c72", "#655f57"],
          "pillar" => "#e6ddc8",
          "torch" => "#ff9a3a",
          "altar" => "#ffe7a8",
          "pool" => "water",
          "poolBlocks" => true,
          "spikeChar" => "▲",
          "spikeColor" => "#c0402a"
        },
        cave: %{
          "floor" => "cave_floor",
          "accent" => "cave_moss",
          "accentChance" => 0.24,
          "wall" => ["#46493f", "#3f463a", "#4e5145", "#3a3f36"],
          "pool" => "water",
          "poolBlocks" => true,
          "crystal" => "#5fd0e0",
          "mushrooms" => true
        }
      },
      %{
        key: "autumn",
        name: "Autumn",
        position: 2,
        palette: %{
          "id" => "autumn",
          # THE OPEN FIELD'S OWN COLOURS for this season: the row gradient's two ends, the grass and earth
          # patches, the cobble at its entrance, and the river and its bank. Every colour a meadow layout
          # writes as floor STATE.
          #
          # This was a table in `stageGenerator.ts`, seven seasons of it, which is a map's appearance decided
          # in the frontend. The frontend reads this and invents nothing: a season that does not serve it
          # paints no meadow rather than falling back to a colour of its own.
          "meadow" => %{
            "top" => "#bba750",
            "bottom" => "#8f7d38",
            "grass" => "#93813a",
            "earth" => "#a5875c",
            "cobble" => "#b39d82",
            "river" => "#4d8aa2",
            "bank" => "#b8996e",
            "plot" => "#cbbd84"
          },
          "groundTypes" => ["autumn_ground", "autumn_leaves", "autumn_ground"],
          "hazard" => "water",
          "trail" => "path",
          "wallColor" => "#6a4a28",
          "accentColor" => "#d2691e"
        },
        tiles: %{
          "tree" => "emoji:maple-leaf",
          "decor" => "emoji:fallen-leaf",
          "flower" => "emoji:rose"
        },
        flowers: nil,
        temple: %{
          "floor" => "ancient_stone",
          "accent" => "gold_tile",
          "wall" => ["#6a5540", "#5f4c3a", "#74604a", "#544433"],
          "pillar" => "#d8c090",
          "torch" => "#ff8a3a",
          "altar" => "#ffcf8a",
          "pool" => "water",
          "poolBlocks" => true,
          "spikeChar" => "▲",
          "spikeColor" => "#b5602a"
        },
        cave: %{
          "floor" => "cave_floor",
          "accent" => "autumn_leaves",
          "accentChance" => 0.16,
          "wall" => ["#5a4a38", "#6a5540", "#4e4030", "#5f4c3a"],
          "pool" => "water",
          "poolBlocks" => true,
          "crystal" => "#e0a020",
          "mushrooms" => true
        }
      },
      %{
        key: "winter",
        name: "Winter",
        position: 3,
        palette: %{
          "id" => "winter",
          # THE OPEN FIELD'S OWN COLOURS for this season: the row gradient's two ends, the grass and earth
          # patches, the cobble at its entrance, and the river and its bank. Every colour a meadow layout
          # writes as floor STATE.
          #
          # This was a table in `stageGenerator.ts`, seven seasons of it, which is a map's appearance decided
          # in the frontend. The frontend reads this and invents nothing: a season that does not serve it
          # paints no meadow rather than falling back to a colour of its own.
          "meadow" => %{
            "top" => "#ccd6cf",
            "bottom" => "#aabbb6",
            "grass" => "#b2c1bc",
            "earth" => "#8d887e",
            "cobble" => "#c1c4bf",
            "river" => "#7cb8d8",
            "bank" => "#c9ccc5",
            "plot" => "#dde4de"
          },
          "groundTypes" => ["snow", "ice", "frost"],
          "hazard" => "ice_water",
          "trail" => "path",
          "wallColor" => "#3a5a7a",
          "accentColor" => "#a0e0ff"
        },
        tiles: %{
          "tree" => "emoji:dead-tree",
          "decor" => "emoji:snowflake",
          "flower" => "emoji:blossom"
        },
        flowers: nil,
        temple: %{
          "floor" => "frost",
          "accent" => "ice",
          "wall" => ["#5a6a7a", "#647486", "#516070", "#6d7d8e"],
          "pillar" => "#bcd6e6",
          "torch" => "#8fd0ff",
          "altar" => "#dff0ff",
          "pool" => "ice_water",
          "poolBlocks" => false,
          "spikeChar" => "❆",
          "spikeColor" => "#bfe8f5"
        },
        cave: %{
          "floor" => "frost",
          "accent" => "ice",
          "accentChance" => 0.2,
          "wall" => ["#5a6a7a", "#647486", "#516070", "#6d7d8e"],
          "pool" => "ice_water",
          "poolBlocks" => false,
          "crystal" => "#bfe8f5",
          "mushrooms" => false
        }
      },
      %{
        key: "desert",
        name: "Desert",
        position: 4,
        palette: %{
          "id" => "desert",
          # THE OPEN FIELD'S OWN COLOURS for this season: the row gradient's two ends, the grass and earth
          # patches, the cobble at its entrance, and the river and its bank. Every colour a meadow layout
          # writes as floor STATE.
          #
          # This was a table in `stageGenerator.ts`, seven seasons of it, which is a map's appearance decided
          # in the frontend. The frontend reads this and invents nothing: a season that does not serve it
          # paints no meadow rather than falling back to a colour of its own.
          "meadow" => %{
            "top" => "#cabf6c",
            "bottom" => "#aea050",
            "grass" => "#bcb35c",
            "earth" => "#b07f4a",
            "cobble" => "#c8b48a",
            "river" => "#5aa6b4",
            "bank" => "#d3ba80",
            "plot" => "#dbd29a"
          },
          "groundTypes" => ["sand", "sand_dune", "sand"],
          "hazard" => "water",
          "trail" => "path",
          "wallColor" => "#b89a5a",
          "accentColor" => "#e8c97a"
        },
        tiles: %{
          "tree" => "emoji:cactus",
          "decor" => "emoji:wheat",
          "flower" => "emoji:hibiscus"
        },
        flowers: nil,
        temple: %{
          "floor" => "sandstone",
          "accent" => "sand",
          "wall" => ["#b08a52", "#c2975c", "#9c7a46", "#b89060"],
          "pillar" => "#e2c88a",
          "torch" => "#ffc24a",
          "altar" => "#ffe6a0",
          "pool" => "sand_trap",
          "poolBlocks" => true,
          "spikeChar" => "▲",
          "spikeColor" => "#c99a52"
        },
        cave: %{
          "floor" => "sand",
          "accent" => "sandstone",
          "accentChance" => 0.2,
          "wall" => ["#b08a52", "#c2975c", "#9c7a46", "#b89060"],
          "pool" => "water",
          "poolBlocks" => true,
          "crystal" => "#e8c060",
          "mushrooms" => false
        }
      },
      %{
        key: "beach",
        name: "Beach",
        position: 5,
        palette: %{
          "id" => "beach",
          # THE OPEN FIELD'S OWN COLOURS for this season: the row gradient's two ends, the grass and earth
          # patches, the cobble at its entrance, and the river and its bank. Every colour a meadow layout
          # writes as floor STATE.
          #
          # This was a table in `stageGenerator.ts`, seven seasons of it, which is a map's appearance decided
          # in the frontend. The frontend reads this and invents nothing: a season that does not serve it
          # paints no meadow rather than falling back to a colour of its own.
          "meadow" => %{
            "top" => "#c2c86a",
            "bottom" => "#a3b24e",
            "grass" => "#9fb84a",
            "earth" => "#c2a466",
            "cobble" => "#cbbf9a",
            "river" => "#4bb0c2",
            "bank" => "#dcc78e",
            "plot" => "#d6da9c"
          },
          "groundTypes" => ["sand", "sand_dune", "sand"],
          "hazard" => "water",
          "trail" => "path",
          "wallColor" => "#c2a878",
          "accentColor" => "#7fd0c0"
        },
        tiles: %{
          "tree" => "emoji:palm-tree",
          "decor" => "emoji:seashell",
          "flower" => "emoji:hibiscus"
        },
        flowers: nil,
        temple: %{
          "floor" => "sandstone",
          "accent" => "temple_floor",
          "wall" => ["#9a8a6a", "#a89a78", "#8a7c5e", "#b0a284"],
          "pillar" => "#d8c9a4",
          "torch" => "#ffb86a",
          "altar" => "#ffe6c0",
          "pool" => "water",
          "poolBlocks" => true,
          "spikeChar" => "▲",
          "spikeColor" => "#a8926a"
        },
        cave: %{
          "floor" => "sand",
          "accent" => "cave_floor",
          "accentChance" => 0.16,
          "wall" => ["#9a8a6a", "#a89a78", "#8a7c5e", "#b0a284"],
          "pool" => "water",
          "poolBlocks" => true,
          "crystal" => "#7fd0c0",
          "mushrooms" => false
        }
      },
      %{
        key: "lava",
        name: "Lava",
        position: 6,
        palette: %{
          "id" => "lava",
          # THE OPEN FIELD'S OWN COLOURS for this season: the row gradient's two ends, the grass and earth
          # patches, the cobble at its entrance, and the river and its bank. Every colour a meadow layout
          # writes as floor STATE.
          #
          # This was a table in `stageGenerator.ts`, seven seasons of it, which is a map's appearance decided
          # in the frontend. The frontend reads this and invents nothing: a season that does not serve it
          # paints no meadow rather than falling back to a colour of its own.
          "meadow" => %{
            "top" => "#8a7f4a",
            "bottom" => "#6e5f38",
            "grass" => "#726838",
            "earth" => "#7a4f3a",
            "cobble" => "#8a7d6a",
            "river" => "#a25a2a",
            "bank" => "#8a5a3a",
            "plot" => "#9c916a"
          },
          "groundTypes" => ["ash", "rock", "basalt"],
          "hazard" => "lava",
          "trail" => "path",
          "wallColor" => "#4a4038",
          "accentColor" => "#ff7a30"
        },
        tiles: %{
          "tree" => "emoji:dead-tree",
          "decor" => "emoji:boulder",
          "flower" => "emoji:wilted-flower"
        },
        flowers: nil,
        temple: %{
          "floor" => "basalt",
          "accent" => "obsidian",
          "wall" => ["#2e2824", "#3a322c", "#241f1c", "#332b26"],
          "pillar" => "#8a6a52",
          "torch" => "#ff5a1f",
          "altar" => "#ff9a5a",
          "pool" => "lava",
          "poolBlocks" => true,
          "spikeChar" => "▲",
          "spikeColor" => "#ff6a2a"
        },
        cave: %{
          "floor" => "basalt",
          "accent" => "ash",
          "accentChance" => 0.22,
          "wall" => ["#2e2824", "#3a322c", "#241f1c", "#332b26"],
          "pool" => "lava",
          "poolBlocks" => true,
          "crystal" => "#ff7a30",
          "mushrooms" => false
        }
      }
    ]
  end

  @doc """
  The season-INDEPENDENT tables: tree shape weights, rock shades, cave decor, prop art.

  Not per-zone, so they live in `game_rules` rather than being repeated in all seven rows.
  """
  def rules do
    %{
      "trees" => %{
        "variants" => [
          %{
            "kind" => "tree",
            "weight" => 32
          },
          %{
            "kind" => "tree_tall",
            "weight" => 22
          },
          %{
            "kind" => "tree_round",
            "weight" => 20
          },
          %{
            "kind" => "tree_stub",
            "weight" => 12
          },
          %{
            "kind" => "bush",
            "weight" => 8
          },
          %{
            "kind" => "bush_round",
            "weight" => 6
          }
        ],
        "defaultFlowers" => [
          %{
            "char" => "*",
            "color" => "#ff88cc"
          },
          %{
            "char" => "✿",
            "color" => "#ffd24a"
          },
          %{
            "char" => "❁",
            "color" => "#ff6f6f"
          },
          %{
            "char" => "✽",
            "color" => "#f4f4ec"
          },
          %{
            "char" => "✾",
            "color" => "#b892ff"
          },
          %{
            "char" => "❋",
            "color" => "#7ac6ff"
          }
        ]
      },
      "props" => %{
        "rockShades" => ["#3a3340", "#332e3a", "#443b50", "#2c2832", "#3d3543"],
        "caveDecor" => ["ʌ", "∧", "∴", "·"],
        "mushroomTones" => ["#d24a4a", "#c98a52", "#e0a0c0"],
        "propArt" => %{
          "pillar" => %{
            "char" => "║",
            "color" => "#cbb68c"
          },
          "brazier" => %{
            "char" => "Φ",
            "color" => "#ff8a3a"
          },
          "altar" => %{
            "char" => "‡",
            "color" => "#ffe7a8"
          },
          "torch" => %{
            "char" => "ϯ",
            "color" => "#ff9a3a"
          }
        },
        "constantRoleTile" => %{
          "rock" => "emoji:boulder",
          "bush" => "emoji:shrub",
          "mushroom" => "emoji:red-mushroom"
        }
      }
    }
  end

  def seed do
    zones = Enum.map(zones(), &upsert/1)
    CombatSource.put_rules(rules())
    %{zones: length(zones), rules: map_size(rules())}
  end

  defp upsert(attrs) do
    case Repo.get_by(Zone, key: attrs.key) do
      nil -> %Zone{}
      found -> found
    end
    |> Zone.changeset(attrs)
    |> Repo.insert_or_update!()
  end

  @doc "Every season in menu order."
  def list_zones, do: Repo.all(from z in Zone, order_by: [asc: z.position, asc: z.key])
end
