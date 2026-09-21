defmodule Nebulith.DataMigration.ABeachHasASea do
  @moduledoc """
  A beach has a sea, and every map can ask for one.

  *"WE ALREADY HAVE WATER AND WE SHOULD HAVE LAKE, RIVER AND OTHER TYPES, SO WHY IT'S HARD TO ADD A BEACH
  WHICH IS BASICALLY A LAKE WITH CURRENT???"*, after loading a beach and finding *"THERE'S NOT A FUCKING BEACH
  IN SIGHT"*.

  He is right that it is not hard, and measuring it says why: everything was already here except the SHAPE.

      WaterKind carries `beach`                        already
      both piece families baked for it, 72 tiles       already
      classifyBody answers "beach" for an edge body    already
      a course that paints water along an edge         MISSING

  `WATER.md` §1 is explicit that this is all a beach is: *"a river, a lake and a beach are the same thing, a
  set of cells painted with a water tile ... They differ in the SHAPE that is painted, nothing else."* So
  `shore` is a fourth course beside `through`, `divides` and `around`, and nothing else in the water stack
  needed a line changed: the body runs along the map edge, `classifyBody` reads that on its own, and the
  border pass picks the beach rim with no branch anywhere.

  ## What changes

  Every generator that offers a river now offers "Sea along the shore" as well, because a lake with current is
  a thing any map can want, the same reasoning that made lava a liquid rather than a property of being
  volcanic.

  And the four beach templates DEFAULT to it. A beach whose water is an inland river is the thing he loaded
  and objected to.

  Idempotent: adds the choice if it is absent, sets the default by name.
  """
  require Logger

  alias Nebulith.Repo

  @choice %{"key" => "shore", "label" => "Sea along the shore"}

  def run do
    offered = offer_everywhere()
    defaulted = default_on_beaches()

    Logger.info(
      "[data_migrate] #{offered} generators offer a sea, #{defaulted} beaches have one by default"
    )

    :ok
  end

  defp offer_everywhere do
    for %{key: key, options: options} <- with_river(), reduce: 0 do
      acc ->
        updated =
          for option <- options do
            case option do
              %{"key" => "river", "choices" => choices} = o ->
                if Enum.any?(choices, &(&1["key"] == "shore")),
                  do: o,
                  else: Map.put(o, "choices", choices ++ [@choice])

              other ->
                other
            end
          end

        acc + write(key, updated, options)
    end
  end

  # A BEACH STARTS WITH ITS SEA. Every other template keeps whatever default it had.
  defp default_on_beaches do
    for %{key: key, options: options} <- with_river(),
        String.ends_with?(key, "_beach"),
        reduce: 0 do
      acc ->
        updated =
          for option <- options do
            case option do
              %{"key" => "river"} = o -> Map.put(o, "default", "shore")
              other -> other
            end
          end

        acc + write(key, updated, options)
    end
  end

  defp with_river do
    %{rows: rows} =
      Repo.query!("SELECT key, options FROM generators WHERE options IS NOT NULL")

    for [key, options] <- rows,
        is_list(options),
        Enum.any?(options, &(is_map(&1) and &1["key"] == "river")),
        do: %{key: key, options: options}
  end

  defp write(_key, same, same), do: 0

  defp write(key, updated, _options) do
    %{num_rows: rows} =
      Repo.query!("UPDATE generators SET options = $2::text::jsonb WHERE key = $1", [
        key,
        Jason.encode!(updated)
      ])

    rows
  end
end
