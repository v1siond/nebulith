defmodule NebulithWeb.EnumController do
  @moduledoc """
  ONE DOOR FOR EVERY LIST A PICKER OFFERS.

  `docs/SPEC.md` phase 0 REWIRE: *"The engine's own enum lists are served so a picker cannot be missing a
  value the engine accepts (D17)."* Both halves of law 11 come out of here, because a `<select>` does not
  care whether a list is code or data: the engine's own lists from `Nebulith.EngineLists`, and the ones a
  person may extend from `enum_sets`.
  """
  use NebulithWeb, :controller

  alias Nebulith.EngineLists

  def index(conn, _params) do
    json(conn, %{data: EngineLists.all()})
  end
end
