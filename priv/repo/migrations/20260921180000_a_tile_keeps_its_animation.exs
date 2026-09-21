defmodule Nebulith.Repo.Migrations.ATileKeepsItsAnimation do
  @moduledoc """
  A PLACED TILE KEEPS ITS ANIMATION.

      animations are lost on reload too ... when generating a new map, fountain water animation looks
      great, on reload it doesn't animate anymore

  `cell_tiles` had 53 columns and none of them was this, so a save simply dropped it. The fountain's
  water rises and fades when it is stamped and sits still forever after a reload.

  ## Why a column and not a re-derivation

  Everything else the load path lost was recoverable from the catalogue: a tile's height, its display,
  whether its shell is transparent. Those are facts about a LABEL, so a placement can be born with them
  and the two paths agree.

  An animation is not. The fountain has nine `water_c` cells and only the centre row of three carries the
  rise-and-fade, so the same label animates in one cell and not in the one beside it. That is a fact
  about the PLACEMENT, and the placement is where it has to live (law 5: the catalog is thin, the
  placement is fat).

  ## Why jsonb

  Law 8 admits `jsonb` where the payload is heterogeneous AND never queried, and this is both. An
  animation is a list of keyframes, each a partial transform, with an easing, a trigger and a loop flag,
  and nothing selects a map by what its tiles animate. Typing it into columns would be a table of frames
  hanging off every placed tile, queried by nobody.

  `placed_at` is the clock origin the loop is measured from. It rides along because a composition's
  default animations are anchored at 0 on purpose, so every fountain on a map stays in step; a wall clock
  time would read as "far future" and the loop would never start.
  """
  use Ecto.Migration

  def change do
    alter table(:cell_tiles) do
      add :animations, :jsonb
      # DEFAULTED, like every other numeric column here, so "what is this when nobody said" has an
      # answer the database gives rather than one the engine invents. A composition's defaults anchor at
      # 0 on purpose, so every copy of the same object stays in step.
      add :placed_at, :decimal, precision: 14, scale: 3, default: 0, null: false
    end
  end
end
