defmodule NebulithWeb.UiJSON do
  alias Nebulith.Catalog.Ui.{Action, Bar, BarSlot, Binding, Element, Profile}

  @doc """
  The catalog plus one whole profile: its bindings, its per-form element placements and its bars.

  One answer rather than four, because the frontend needs all of it before it can draw a single frame.
  """
  def index(%{actions: actions, profile: profile}) do
    %{data: %{actions: Enum.map(actions, &action/1), profile: profile(profile)}}
  end

  defp action(%Action{} = a),
    do: %{key: a.key, category: a.category, label: a.label, defaultChord: a.default_chord, position: a.position}

  defp profile(nil), do: nil

  defp profile(%Profile{} = p) do
    %{
      key: p.key,
      name: p.name,
      gameId: p.game_id,
      playerMay: p.player_may,
      bindings: Enum.map(p.bindings, &key_binding/1),
      elements: Enum.map(p.elements, &element/1),
      bars: p.bars |> Enum.sort_by(& &1.position) |> Enum.map(&bar/1)
    }
  end

  defp key_binding(%Binding{} = b),
    do: %{actionKey: b.action_key, input: b.input, editable: b.editable, position: b.position}

  defp element(%Element{} = e),
    do: %{elementKey: e.element_key, form: e.form, placement: e.placement, editable: e.editable}

  defp bar(%Bar{} = b) do
    %{
      name: b.name,
      position: b.position,
      rows: b.rows,
      cols: b.cols,
      settings: b.settings,
      # nil means ALWAYS UP. A rule here is what swaps a bar in on an event / quest / ability.
      condition: b.condition,
      slots: b.slots |> Enum.sort_by(& &1.slot) |> Enum.map(&slot/1)
    }
  end

  defp slot(%BarSlot{} = s), do: %{slot: s.slot, refKind: s.ref_kind, refKey: s.ref_key}
end
