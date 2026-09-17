defmodule Nebulith.DataMigration.AWaterSetIsAChoice do
  @moduledoc """
  "Kind of water" joins the option list, so a map picks which of the two sets its water wears.

  His ask: *"once done, we'll be able to use them as regular tiles or select the type of water in the
  river/lake/beach, whatever water container we're building"*. The tiles half is `seed_water_sets/0`, which
  puts both families in the tile panel under Terrain. This is the other half, the pick.

  Two choices, because there are two sets:

    * **Smooth water**, the layered look: rolling crests, a bright foam lip at the edge, a soft rim.
    * **Lined water**, the outlined look: flatter, fewer marks, a hard dark border.

  Shaped exactly like `river` and `bridge` beside it: a `choice` option with a `default`. It carries
  `requires: "river"` for the same reason the crossing does, a map with no water has nothing to style. A
  template that serves no river simply never shows it.

  The default is `smooth` rather than `random`. A look is not a thing to roll dice on: two maps built the same
  way should look the same, and someone who wants the other one asks for it.

  Every generator that offers a river gets the option, so the pick reaches beach, swamp, jungle and the
  settlements rather than the woodland alone.

  Idempotent: it matches only option lists that do not already carry a `water` entry.
  """
  require Logger

  alias Nebulith.Repo

  @option %{
    "key" => "water",
    "label" => "Kind of water",
    "type" => "choice",
    "requires" => "river",
    "default" => "smooth",
    "choices" => [
      %{"key" => "smooth", "label" => "Smooth water"},
      %{"key" => "lined", "label" => "Lined water"}
    ]
  }

  def run do
    %{num_rows: rows} =
      Repo.query!(
        """
        UPDATE generators
        SET options = options || $1::text::jsonb
        WHERE options @> '[{"key": "river"}]'
          AND NOT options @> '[{"key": "water"}]'
        """,
        [Jason.encode!([@option])]
      )

    Logger.info("[data_migrate] kind of water is a choice on #{rows} generators")
    :ok
  end
end
