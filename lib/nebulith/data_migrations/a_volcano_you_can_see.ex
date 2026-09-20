defmodule Nebulith.DataMigration.AVolcanoYouCanSee do
  @moduledoc """
  A volcano, as base art: a faceted rock cone with a lava mouth at its summit.

  *"do the nerw art, yes"*, with three references he supplied, and *"we'll handle the elevation in ticket 2,
  for now we just need to have the base art"*. So this is the OBJECT. The terrain is not raised under it.

  ## The reference, read as structure

  All three of his references share one silhouette (`references/SOURCES.md`): a grey cone bare at the top, a
  dark crater notch at the summit, lava tongues down the flanks, a plume above, and vegetation thinning with
  height. The last of those is already built and is not art at all: it is `AVolcanoBurnsInBands`. This is
  masses 1 and 2. The tongues and the plume are not built.

  ## The material

  `volcanic_rock` was a `terrain` tile at height 0.0, so a cone built from it had cells that extruded to
  nothing. It is a BLOCK now, height 1.0. Promoted rather than given a new name, because `TILE-DESIGN.md` 2.8
  says that when a name already exists the job is to converge, not to add a third spelling, and nothing at all
  referenced it: zero generators, zero compositions.

  Its art was a baked glyph. It is drawn now, as a real triangulation: a jittered lattice of points split into
  flat triangles, each one grey, because the reference cone reads as rock precisely by being broken into flat
  facets catching light at different angles. Full bleed, checked (border alpha 255 all the way round), because
  it extrudes and rule 2.2 says an open border becomes a crate.

  `wall_stone_c`, which the approved cave mound is built from, was NOT reused: it carries `fadeNear`, so a
  structure made of it goes transparent when the hero walks up to it. `volcanic_rock` does not.

  ## The shape, and the three things that had to be measured to get it

  A radial profile: height falls from the rim to nothing at the foot, `shape: circle` on the flanks so the
  lumps merge into one outcrop instead of reading as a tray of separate domes (the same setting that separates
  `cave_entrance_rounded` from `cave_entrance_cube`).

  1. **It has to be tall enough.** The first pass came out a rock pancake. His diorama reads about 2.2 wide to
     1 high, and one level is only 0.45 of a cell, so a 7 cell footprint needs about 6.5 levels of rim, not 3.
  2. **The near lip has to be lower.** Screen depth is `col + row`, so a rim at one even height hides its own
     bowl behind the lip nearest the camera, and the crater was invisible for three passes. Every reference
     shows the mouth because the near side is lower. `@near_drop` leans the rim toward the front.
  3. **The bowl floor must be FLAT.** With `shape: circle` on it the floor is a dome, the pool sits on a hill
     and spills out past the rim as an orange collar around the summit. The floor cells keep square tops; only
     the flanks are rounded.

  And a fourth, about the loop rather than the object: the fast `SPEC` path in `.probe/objshot.mjs` draws
  labels it cannot resolve, so it showed near-black blocks with white rims for four passes and the shape was
  being judged against a lie. Seeding it and rendering with `COMP` changed the picture completely. The
  framework says this in one line and it is worth believing the first time.

  Idempotent: upserts one tile and one composition by name.
  """
  require Logger

  alias Nebulith.Catalog

  @footprint 7
  @centre 3.0
  @radius 3.7
  @rim 6.4
  @crater 1.75
  # how high the crater FLOOR sits, as a share of the rim. High on purpose: a deep pit cannot be seen into.
  @floor 0.80
  @scale 1.45
  # how much the rim leans down toward the camera, so the mouth is not hidden behind its own near lip
  @near_drop 0.44

  def run do
    {:ok, _} = seed_rock()
    {:ok, _} = seed_cone()

    Logger.info("[data_migrate] volcanic rock is a block, and a volcano stands on it")

    :ok
  end

  defp seed_rock do
    for tileset <- Catalog.list_tilesets(), tileset.key in ["ascii", "emoji"] do
      {:ok, _} =
        Catalog.upsert_tile(%{
          tileset_id: tileset.id,
          label: "volcanic_rock",
          glyph: "▩",
          emoji: "🌋",
          occupies: true,
          height: 1.0,
          category: "nature",
          title: "Volcanic rock",
          image_url: "/tiles/#{tileset.key}/volcanic_rock.png",
          settings: %{"color" => "#5a4a42", "collision" => [%{"x" => 0, "y" => 0, "w" => 1, "h" => 1}]}
        })
    end

    {:ok, :rock}
  end

  defp seed_cone do
    Catalog.upsert_composition_with_cells(
      %{name: "volcano", footprint_w: @footprint, footprint_h: @footprint, category: "nature"},
      cone_cells() ++ [mouth()]
    )
  end

  defp cone_cells do
    for dy <- 0..(@footprint - 1),
        dx <- 0..(@footprint - 1),
        r = radius(dx, dy),
        r <= @radius do
      %{
        dx: dx,
        dy: dy,
        level: 0,
        label: "volcanic_rock",
        walkable: false,
        scale: @scale,
        settings: rock_settings(r, height_at(r, dx, dy))
      }
    end
  end

  defp radius(dx, dy), do: :math.sqrt(:math.pow(dx - @centre, 2) + :math.pow(dy - @centre, 2))

  # Inside the crater the ground RISES from the floor out to the rim; outside it falls away to the foot.
  defp height_at(r, _dx, _dy) when r < @crater, do: @rim * (@floor + (1.0 - @floor) * (r / @crater))

  defp height_at(r, dx, dy) do
    near = (dx + dy) / (2 * (@footprint - 1))
    @rim * max(0.0, 1.0 - (r - @crater) / (@radius - @crater)) * (1.0 - @near_drop * near)
  end

  defp rock_settings(r, h) when r >= @crater * 0.75,
    do: %{"scaleY" => round2(max(0.5, h) / @scale), "shape" => "circle"}

  defp rock_settings(_r, h), do: %{"scaleY" => round2(max(0.5, h) / @scale)}

  # The pool, sized to the BOWL rather than to the summit, and seated at the level its own floor reaches.
  defp mouth do
    top = @scale * round2(@rim * @floor / @scale)
    %{dx: 3, dy: 3, level: round(top), label: "lava", walkable: false, scale: 1.75, settings: %{"scaleY" => 0.18}}
  end

  defp round2(n), do: Float.round(n, 2)
end
