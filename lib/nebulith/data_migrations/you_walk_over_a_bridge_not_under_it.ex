defmodule Nebulith.DataMigration.YouWalkOverABridgeNotUnderIt do
  @moduledoc """
  Two corrections on the wooden bridge, both his, both data.

  ## 1. You walk OVER a bridge

  *"fix the user going under it"*. `unitStandLevel` decides how high a unit stands, and it counted only assets
  of type `floor`. A bridge deck is a COMPOSITION cell, so it scored nothing and the hero was drawn at the
  level of the water with the bridge above their head.

  The mechanism for this already existed and nothing used it. `actAsTile` means "this cell behaves as if a
  tile were already in it, so the next thing stacks on top", which is the definition of a walk-over surface.
  Counted on the live catalog before this: **zero** tiles carried it, so the setting was dormant data.

  The four deck tiles carry it now, and `unitStandLevel` reads it. Structure is still excluded, which is what
  that function exists for: a wall, a door, a window and a roof are passed through or blocked by, never stood
  on, and none of them claims to act as a tile, so the "hero walks in the door and ends up on the roof" case
  it was written for is untouched.

  ## 2. The handrails have to read as handrails

  *"we just have to make the sides or 'agarraderos' darker than the pathway to make it more clear"*. Measured
  on the served colours, the handrail was **10 luminance** below the planking it stands on, which at map scale
  is no difference at all:

      planking  #b2855c  lum 141.8
      handrail  #a67c53  lum 132.1   <- 10 apart
      post      #96704a  lum 119.2

  They are 45 and 60 apart now, so the rail and its posts read as a separate part rather than as more deck.

  This is a deliberate exception to the one-material-one-luminance-band rule in `docs/TILE-DESIGN.md` §2.1,
  and it is the kind that rule allows for: a handrail is a different PART of the object, not the same surface
  in a different tone. The stone bridge is untouched, he called it good.

  Idempotent: targeted setting writes.
  """
  require Logger

  alias Nebulith.Catalog

  # What a unit STANDS ON. A deck is the walking surface of the bridge; the rails, posts, ribs and masonry
  # around it are structure and stay out.
  @decks ~w(bridge bridge_deck bridge_timber_deck bridge_stone_deck)

  # Darker than the #b2855c planking by 45 and 60 luminance, so the rail reads as its own part of the object.
  @rail_colors %{"bridge_timber_rail" => "#7d5a38", "bridge_timber_post" => "#6b4c2f"}

  def run do
    decks = for label <- @decks, ts <- Catalog.list_tilesets(), reduce: 0 do
      acc ->
        {hit, _} = Catalog.put_tile_setting(ts.id, label, "actAsTile", true)
        acc + hit
    end

    rails = for {label, color} <- @rail_colors, ts <- Catalog.list_tilesets(), reduce: 0 do
      acc ->
        {hit, _} = Catalog.put_tile_setting(ts.id, label, "color", color)
        acc + hit
    end

    Logger.info("[data_migrate] #{decks} deck rows hold a walker up, #{rails} rail rows darkened")
    :ok
  end
end
