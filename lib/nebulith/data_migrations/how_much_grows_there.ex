defmodule Nebulith.DataMigration.HowMuchGrowsThere do
  @moduledoc """
  How much grows in a place, per biome, instead of one number shared by three of them.

  *"we need to add more variants and shapes and distribute them better in the forests"*, and the desert half
  of *"desert trees makes no sense in the context"*: the species were wrong AND there were far too many of
  them.

  ## Measured off `/api/generators`

      Woodland   canopy 0.434   flowers 0.04   groundCover 0.2   tallGrass 0.12
      Jungle     canopy 0.31    flowers 0.1    groundCover 0.2
      Beach      canopy 0.31    flowers 0.1    groundCover 0.2
      Desert     canopy 0.31    flowers 0.1    groundCover 0.2

  Jungle, Beach and Desert are byte-identical. A desert grew as thickly as a rainforest, and the WOODLAND was
  denser than the jungle, which is backwards: his note on the jungle reference was *"more enredaderas, darker
  trees, denser"*.

  Density is the other half of why a biome reads wrong. The species can all be correct and the place still
  looks like the wrong place if there are five times too many of them.

  ## What each gets, and why

      Desert   canopy 0.06   the whole point. Things grow far apart, and the gaps ARE the desert
      Beach    canopy 0.17   open coastal scrub, thicker than a desert, nowhere near a forest
      Jungle   canopy 0.52   the densest thing in the set, which is what the reference actually shows
      Mountain canopy 0.24   thinner than a woodland, per "the higher you get to the mountain the less
                             vegetation there is"

  Woodland is untouched. It is the one he has already approved and it is the reference the others are now
  placed against.

  Idempotent: sets stated values by name.
  """
  require Logger

  alias Nebulith.Repo

  @nature %{
    "Desert" => %{"canopy" => 0.06, "flowers" => 0.02, "groundCover" => 0.05},
    "Beach" => %{"canopy" => 0.17, "flowers" => 0.06, "groundCover" => 0.12},
    "Jungle" => %{"canopy" => 0.52, "flowers" => 0.12, "groundCover" => 0.34},
    "Mountain" => %{"canopy" => 0.24, "flowers" => 0.03, "groundCover" => 0.14}
  }

  def run do
    rows = Enum.sum(for {name, nature} <- @nature, do: set_nature(name, nature))
    Logger.info("[data_migrate] #{rows} generators carry their own vegetation density")
    :ok
  end

  # MERGED, not replaced: a generator may serve keys this does not name (a woodland's `tallGrass`), and
  # dropping them would quietly turn that feature off.
  defp set_nature(name, nature) do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET config = jsonb_set(config, '{nature}', COALESCE(config->'nature', '{}'::jsonb) || $2::text::jsonb)
        WHERE (name = $1 OR name LIKE $1 || ' %') AND config->'nature' IS NOT NULL
        """,
        [name, Jason.encode!(nature)]
      )

    rows
  end
end
