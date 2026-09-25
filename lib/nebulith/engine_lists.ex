defmodule Nebulith.EngineLists do
  @moduledoc """
  THE LISTS THE ENGINE SWITCHES ON, stated once, here, and served.

  `docs/SPEC.md` law 11: *"A list a person could extend without new code is data. A list the engine
  switches on is code, and is served (D17). Never a second copy either way."* §3.1 draws the line by name:
  *"A list a person can extend without new code lives here [`enum_sets`]: enemy types, equip slots, weapon
  kinds, dialog kinds, attack presets, HUD anchors. A list the engine must switch on stays in Elixir and is
  SERVED from there: eases, trigger events, directions, views."*

  Both halves come out of one door, `GET /api/enums`, because a picker does not care which half a list is
  in. The engine half is here; the data half is `enum_sets` and `enum_values`, which a person can add to
  without a deploy.

  ## What this fixes, measured

  Every one of these four was a `const` array in the engine, feeding a `<select>` directly:
  `EASES`, `TRIGGER_EVENTS`, `TILE_VIEWS` in `engine/animation/tileAnimation.ts` and `ANIM_DIRECTIONS` in
  `components/editorAnimation.tsx`. Phase 0's REWIRE is that sentence: *"The engine's own enum lists are
  served so a picker cannot be missing a value the engine accepts."* A list typed out beside the picker
  goes out of date the first time the engine learns a fifth ease, and nothing says so: the value is
  accepted everywhere and offered nowhere.

  The TYPE stays in TypeScript, because an exhaustive switch needs one at compile time. The LIST comes from
  here. `Nebulith.APickerCannotMissAValueTest` reads the type's union out of the engine's own source and
  fails if the two disagree, so the type cannot quietly grow a value this does not serve.
  """

  import Ecto.Query

  alias Nebulith.Catalog.EnumSet
  alias Nebulith.Repo

  # HOW A VALUE MOVES over an animation's span. `sine` and `ease` are both ease-in-out (the engine's
  # `easeT`), `linear` is the default, and `flicker` is a stepped, irregular envelope for a failing bulb
  # rather than a curve at all.
  @eases ~w(linear sine ease flicker)

  # WHAT MAKES AN ANIMATION FIRE. `load` plays at once, `proximity` measures from the hero in cells, and
  # `night` is a CONDITION rather than a one-shot: the animation runs only while the scene is in night
  # mode, so a lamp rests in daylight.
  @trigger_events ~w(load attack interact proximity night)

  # THE FACINGS an animation can be pinned to. `any` is not a direction, it is the absence of the
  # constraint, and it is in the list because the picker has to be able to say it.
  @directions ~w(up down left right any)

  # WHAT A UNIT'S ANIMATION FIRES ON. A different list from `trigger_events`, which is a TILE's, and the
  # two have been confused because both were called triggers: a unit plays on what it is DOING, a tile on
  # what HAPPENS to it.
  @unit_triggers ~w(idle move attack interact key)

  # THE VIEWS a map is drawn in. `docs/SPEC.md` D16: only iso and top carry per-view overrides, and `2d` is
  # here because the engine still draws it.
  @views ~w(iso 2d top)

  # THE SHAPES WATER CAN BE PAINTED IN, which `RiverCourse` accepts and `carveRiver` dispatches on.
  #
  # `docs/SPEC.md` A4 and the water module both say a river, a lake and a beach are one thing in different
  # shapes. Two of these were accepted by the engine and offered by no menu: the report was *"we alos lost
  # the beach and laken water options from the generators"*, and a value the engine takes with nowhere to
  # ask for it is exactly what invariant 6 is about.
  @river_courses ~w(through divides around shore lake)

  # WHAT THE LIQUID ON A MAP IS. `liquidFor` reads it off the map's options and `setForLiquid` picks the
  # piece family from it, so the engine switches on this list and it is served (law 11). Nothing offered it,
  # so every map ran on the default and a volcano's channel was water.
  @liquids ~w(smooth lined lava)

  @doc "Every list, the engine's own and the ones a person may extend, in one map."
  def all do
    Map.merge(engine(), data())
  end

  @doc "The lists the engine switches on. Code, stated here, served from here."
  def engine do
    %{
      "eases" => @eases,
      "trigger_events" => @trigger_events,
      "directions" => @directions,
      "unit_triggers" => @unit_triggers,
      "views" => @views,
      "river_courses" => @river_courses,
      "liquids" => @liquids
    }
  end

  @doc """
  The lists a person can extend without new code, from `enum_sets` and their values in order.

  Empty today: the sets that belong here (enemy types, equip slots, weapon kinds, dialog kinds) arrive
  with the phases that own them, and an empty map is the honest answer until they do.
  """
  def data do
    EnumSet
    |> Repo.all()
    |> Repo.preload(:values)
    |> Map.new(fn set -> {set.key, Enum.map(set.values, & &1.key)} end)
  end

  @doc "One list by name, or `nil` when nothing states it. For a caller that wants to check a value."
  def get(key), do: Map.get(all(), to_string(key))

  @doc "Whether a value is one the engine accepts, asked of the list rather than of a copy of it."
  def accepts?(key, value), do: value in (get(key) || [])

  @doc "The enum sets a person may extend, with their values, for an admin screen."
  def sets do
    Repo.all(from(s in EnumSet, order_by: [asc: s.key], preload: [:values]))
  end
end
