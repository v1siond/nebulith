defmodule NebulithWeb.AdminHTML do
  @moduledoc """
  Templates for the admin data browser rendered by `NebulithWeb.AdminController`.
  """
  use NebulithWeb, :html

  embed_templates "admin_html/*"

  @grid_cap 60
  @collection_cap 25

  @doc """
  A GRID DRAWN AS A GRID.

  `groundData` is 40 by 40 ground labels and `heightData` is the same 40 by 40 of numbers. Printed as JSON
  they are a wall; drawn as a grid you can see the river in one and the trench under it in the other, and
  the cell you are looking at is the same cell in both.

  Numbers are shaded by value so relief reads at a glance, and every cell carries its `col,row` and value
  as a title, so the exact number is one hover away.
  """
  attr :shape, :any, required: true

  def grid_value(assigns) do
    {:grid, rows, cols, values} = assigns.shape
    shown = Enum.take(values, @grid_cap)

    numbers = for r <- values, v <- r, is_number(v), do: v
    {low, high} = if numbers == [], do: {0, 0}, else: Enum.min_max(numbers)

    assigns =
      assign(assigns,
        rows: rows,
        cols: cols,
        shown: shown,
        clipped: rows > @grid_cap or cols > @grid_cap,
        low: low,
        high: high,
        numeric?: numbers != [],
        grid_cap: @grid_cap
      )

    ~H"""
    <div class="overflow-x-auto rounded-box border border-base-300 bg-base-200 p-3">
      <p :if={@clipped} class="mb-2 font-mono text-[11px] text-warning">
        showing the first {min(@rows, @grid_cap)} rows and {min(@cols, @grid_cap)} columns of {@cols} x {@rows}
      </p>
      <table class="border-collapse">
        <tbody>
          <tr :for={{row, r} <- Enum.with_index(@shown)}>
            <th class="pr-2 text-right font-mono text-[9px] font-normal text-base-content/30 tabular-nums">
              {r}
            </th>
            <td
              :for={{cell, c} <- row |> Enum.take(@grid_cap) |> Enum.with_index()}
              title={"col #{c}, row #{r} = #{cell}"}
              class="h-5 w-5 border border-base-300/40 text-center align-middle font-mono text-[8px] leading-none tabular-nums"
              style={cell_style(cell, @low, @high, @numeric?)}
            >
              {cell_label(cell)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    """
  end

  @doc "A list of records drawn as a table: the union of their fields, and the first few rows."
  attr :shape, :any, required: true

  def collection_value(assigns) do
    {:collection, count, keys, items} = assigns.shape

    assigns =
      assign(assigns,
        count: count,
        keys: keys,
        items: Enum.take(items, @collection_cap),
        clipped: count > @collection_cap,
        collection_cap: @collection_cap
      )

    ~H"""
    <div class="overflow-x-auto rounded-box border border-base-300">
      <table class="w-full border-collapse text-[12px]">
        <thead>
          <tr>
            <th
              :for={key <- @keys}
              class="whitespace-nowrap border-b border-base-300 bg-base-200 px-2.5 py-1.5 text-left font-mono text-[10px] font-bold uppercase tracking-wider text-base-content/50"
            >
              {key}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr :for={item <- @items} class="border-b border-base-300/50 last:border-b-0">
            <td
              :for={key <- @keys}
              class="max-w-xs truncate px-2.5 py-1.5 align-top font-mono tabular-nums"
              title={brief(Map.get(item, key))}
            >
              {brief(Map.get(item, key))}
            </td>
          </tr>
        </tbody>
      </table>
      <p :if={@clipped} class="border-t border-base-300 bg-base-200 px-2.5 py-1.5 font-mono text-[11px] text-base-content/50">
        showing {@collection_cap} of {@count}
      </p>
    </div>
    """
  end

  @doc "A flat list of values."
  attr :shape, :any, required: true

  def list_value(assigns) do
    {:list, count, values} = assigns.shape
    assigns = assign(assigns, count: count, values: Enum.take(values, 200))

    ~H"""
    <div :if={@count == 0} class="rounded-box border border-base-300 bg-base-200 px-4 py-3 text-sm text-base-content/50">
      empty
    </div>
    <div :if={@count > 0} class="flex flex-wrap gap-1.5 rounded-box border border-base-300 bg-base-200 p-3">
      <span
        :for={value <- @values}
        class="rounded border border-base-300 bg-base-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums"
      >
        {brief(value)}
      </span>
    </div>
    """
  end

  @doc "An object, one field per row."
  attr :shape, :any, required: true

  def object_value(assigns) do
    {:object, pairs} = assigns.shape
    assigns = assign(assigns, pairs: pairs)

    ~H"""
    <dl class="grid gap-px overflow-hidden rounded-box border border-base-300 bg-base-300">
      <div :for={{key, value} <- @pairs} class="grid gap-1 bg-base-100 px-4 py-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <dt class="truncate font-mono text-[12px] text-base-content/60">{key}</dt>
        <dd class="break-words font-mono text-[12px] tabular-nums">{value}</dd>
      </div>
    </dl>
    """
  end

  # A number is shaded by where it sits between the grid's own lowest and highest, so relief is visible
  # without reading every cell. A label gets no shade: its meaning is not its magnitude.
  defp cell_style(value, low, high, true) when is_number(value) and high > low do
    t = (value - low) / (high - low)
    "background-color: color-mix(in oklch, var(--color-primary) #{round(t * 70)}%, transparent)"
  end

  defp cell_style(_, _, _, _), do: nil

  defp cell_label(value) when is_number(value), do: value
  defp cell_label(nil), do: ""
  defp cell_label(value) when is_binary(value), do: String.slice(value, 0, 2)
  defp cell_label(value), do: value |> to_string() |> String.slice(0, 2)

  defp brief(nil), do: ""
  defp brief(value) when is_binary(value), do: String.slice(value, 0, 80)
  defp brief(value) when is_number(value) or is_boolean(value), do: to_string(value)
  defp brief(value), do: value |> Jason.encode!() |> String.slice(0, 80)
end
