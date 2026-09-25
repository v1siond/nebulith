defmodule Nebulith.Games.GameSettings do
  @moduledoc """
  THE NUMBERS A GAME IS PLAYED BY, one row per game.

  `docs/SPEC.md` §3.1 declares the table and annotates the first of them: `map_size_max`, *"100 for now.
  a NUMBER, not a constant"*. That annotation is law 12 stated as a column: *"The frontend sets no limits.
  No minimum, no maximum, no step invented in React (D18)."* A maximum is not forbidden, a maximum the
  REACT SIDE INVENTED is. This is where the number lives so a person can change it.

  Phase 1 created the table and nothing was ever wired to it: no schema, no context function, no
  serializer, and no row was written when a game was made. So the frontend deleted its constant and got
  no ceiling at all, which is not the same thing as reading the one the database states.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  @views ~w(iso 2d top)

  schema "game_settings" do
    # How big a map in this game may be. A person raises it; nothing in the engine may cap it.
    field :map_size_max, :integer, default: 100
    field :discovery_on, :boolean, default: false
    field :discovery_radius, :integer, default: 6
    field :discovery_remembers, :boolean, default: true
    field :default_view, :string, default: "iso"

    # ── HOW THE RANGE TRANSPARENCY FADES ─────────────────────────────────────
    # The four numbers a thing near the hero draws by. They were `export const` in the renderer, which is
    # why the report was "I don't see any place to manage or edit it": a value invented in React has no
    # control, because there is no row to write one against. Law 7 and law 12 read together.
    #
    # WHAT EACH IS: beyond `fade_radius` cells a thing is fully solid; within `fade_full_radius` it holds
    # flat at its most transparent; `fade_alpha` is how opaque that close band draws; `interior_alpha` is
    # how opaque a shell draws while the hero stands inside it. A tile's own `min_alpha` only ever makes it
    # MORE opaque than these, never less, which is how a door stays readable while its wall fades.
    field :fade_radius, :integer, default: 12
    field :fade_full_radius, :integer, default: 5
    field :fade_alpha, :decimal, default: Decimal.new("0.35")
    field :interior_alpha, :decimal, default: Decimal.new("0.15")

    belongs_to :game, Nebulith.Games.Game

    timestamps(type: :utc_datetime)
  end

  @doc "The views a game may open in, served rather than typed into a picker (law 11)."
  def views, do: @views

  @doc """
  EVERY SETTING A GAME STATES, asked of the schema, so a column added here is served the day it is added.

  Law 10: no hand-written field list. Typing the names out at each serializer is how a column ends up
  served by nothing and quietly unreachable, which is what happened to this whole table for a phase.
  Identity and timestamps are not settings and are the only thing dropped.
  """
  def served_fields, do: __schema__(:fields) -- ~w(id game_id inserted_at updated_at)a

  @doc false
  def changeset(settings, attrs) do
    settings
    |> cast(attrs, [
      :game_id,
      :map_size_max,
      :discovery_on,
      :discovery_radius,
      :discovery_remembers,
      :default_view,
      :fade_radius,
      :fade_full_radius,
      :fade_alpha,
      :interior_alpha
    ])
    |> validate_required([:game_id])
    |> validate_number(:map_size_max, greater_than: 0)
    |> validate_number(:discovery_radius, greater_than_or_equal_to: 0)
    |> validate_inclusion(:default_view, @views)
    # A fade that reaches zero is a tile that vanished, so the floor is above zero, not at it.
    |> validate_number(:fade_alpha, greater_than: 0, less_than_or_equal_to: 1)
    |> validate_number(:interior_alpha, greater_than: 0, less_than_or_equal_to: 1)
    |> validate_number(:fade_full_radius, greater_than_or_equal_to: 0)
    |> band_has_width()
    |> unique_constraint(:game_id)
  end

  # THE BAND NEEDS ROOM TO EASE ACROSS. At `fade_radius <= fade_full_radius` the ramp between solid and
  # faded has no width, so the transparency snaps on and the whole reason for two numbers is gone.
  defp band_has_width(changeset) do
    outer = get_field(changeset, :fade_radius)
    inner = get_field(changeset, :fade_full_radius)

    band_has_width(changeset, outer, inner)
  end

  defp band_has_width(changeset, outer, inner) when is_integer(outer) and is_integer(inner) and outer <= inner,
    do: add_error(changeset, :fade_radius, "must be further out than the distance the fade holds flat")

  defp band_has_width(changeset, _outer, _inner), do: changeset
end
