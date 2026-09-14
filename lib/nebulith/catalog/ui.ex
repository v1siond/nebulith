defmodule Nebulith.Catalog.Ui do
  @moduledoc """
  The PLAYER-UI schemas — the action catalog, and the profile aggregate that hangs off it.

  One module because they are one model: a profile owns its bindings, its elements and its bars, and
  reading any of them alone is never useful. Spec: `2026-09-06-ui-system-spec-and-plan.md` §2.3.
  """

  defmodule Action do
    @moduledoc "What CAN be bound. Seeded engine capability, read-only to the frontend."
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :binary_id, autogenerate: true}
    schema "ui_actions" do
      field :key, :string
      field :category, :string
      field :label, :string
      field :default_chord, :string
      field :position, :integer, default: 0
      timestamps(type: :utc_datetime)
    end

    def changeset(a, attrs) do
      a
      |> cast(attrs, [:key, :category, :label, :default_chord, :position])
      |> validate_required([:key, :category, :label])
      |> unique_constraint(:key)
    end
  end

  defmodule Profile do
    @moduledoc """
    One complete UI configuration. `game_id` nil is the seeded DEFAULT every new game starts from.

    `player_may` is the author's limit on the player — which of keys / layout / settings a player may change.
    """
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :binary_id, autogenerate: true}
    @foreign_key_type :binary_id
    schema "ui_profiles" do
      field :key, :string
      field :name, :string
      field :game_id, :binary_id
      field :player_may, Nebulith.EctoJSON, default: %{}
      has_many :bindings, Nebulith.Catalog.Ui.Binding, foreign_key: :profile_id
      has_many :elements, Nebulith.Catalog.Ui.Element, foreign_key: :profile_id
      has_many :bars, Nebulith.Catalog.Ui.Bar, foreign_key: :profile_id
      timestamps(type: :utc_datetime)
    end

    def changeset(p, attrs) do
      p
      |> cast(attrs, [:key, :name, :game_id, :player_may])
      |> validate_required([:key, :name])
      |> unique_constraint(:key)
    end
  end

  defmodule Binding do
    @moduledoc "One input → one action. Several rows for one action IS an alternate binding."
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :binary_id, autogenerate: true}
    @foreign_key_type :binary_id
    schema "ui_bindings" do
      field :action_key, :string
      field :input, :string
      field :editable, :boolean, default: true
      field :position, :integer, default: 0
      belongs_to :profile, Nebulith.Catalog.Ui.Profile
      timestamps(type: :utc_datetime)
    end

    def changeset(b, attrs) do
      b
      |> cast(attrs, [:action_key, :input, :editable, :position, :profile_id])
      |> validate_required([:action_key, :input, :profile_id])
    end
  end

  defmodule Element do
    @moduledoc "One HUD element's placement, per FORM — a profile carries Desktop and Mobile for each."
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :binary_id, autogenerate: true}
    @foreign_key_type :binary_id
    schema "ui_elements" do
      field :element_key, :string
      field :form, :string
      field :placement, Nebulith.EctoJSON, default: %{}
      field :editable, :boolean, default: true
      belongs_to :profile, Nebulith.Catalog.Ui.Profile
      timestamps(type: :utc_datetime)
    end

    def changeset(e, attrs) do
      e
      |> cast(attrs, [:element_key, :form, :placement, :editable, :profile_id])
      |> validate_required([:element_key, :form, :profile_id])
    end
  end

  defmodule Bar do
    @moduledoc """
    One action bar. Unlimited per profile and never paged (his Q6), and `condition` is what lets a bar
    swap in when something happens — Nil means always up.
    """
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :binary_id, autogenerate: true}
    @foreign_key_type :binary_id
    schema "ui_bars" do
      field :name, :string
      field :position, :integer, default: 0
      field :rows, :integer, default: 1
      field :cols, :integer, default: 6
      field :settings, Nebulith.EctoJSON, default: %{}
      field :condition, Nebulith.EctoJSON
      belongs_to :profile, Nebulith.Catalog.Ui.Profile
      has_many :slots, Nebulith.Catalog.Ui.BarSlot, foreign_key: :bar_id
      timestamps(type: :utc_datetime)
    end

    def changeset(b, attrs) do
      b
      |> cast(attrs, [:name, :position, :rows, :cols, :settings, :condition, :profile_id])
      |> validate_required([:profile_id])
    end
  end

  defmodule BarSlot do
    @moduledoc "One button. A blank slot is a ROW with no ref, so a bar's shape is explicit."
    use Ecto.Schema
    import Ecto.Changeset

    @primary_key {:id, :binary_id, autogenerate: true}
    @foreign_key_type :binary_id
    schema "ui_bar_slots" do
      field :slot, :integer
      field :ref_kind, :string
      field :ref_key, :string
      belongs_to :bar, Nebulith.Catalog.Ui.Bar
      timestamps(type: :utc_datetime)
    end

    def changeset(s, attrs) do
      s
      |> cast(attrs, [:slot, :ref_kind, :ref_key, :bar_id])
      |> validate_required([:slot, :bar_id])
    end
  end
end
