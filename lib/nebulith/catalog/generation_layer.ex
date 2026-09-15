defmodule Nebulith.Catalog.GenerationLayer do
  @moduledoc """
  ONE LAYER of map generation: what it is called, where it sits in the order, and whether it rolls.

  Generation is a stack of layers applied in order — *"we generate the grid, then we add water if any, then we
  generate pathways with number of exits around the existing area, then we add the rest of vegeation and other
  things, then we add the characters if any"* — and more are coming: *"we can apply shadow and lightning as
  extra layers, we'll also add fog layer, then we probably will add some reprocess layer too, we'll add water
  reflection layer"*.

  The LIST is data, and it lives here: *"I just don't want anything hardcoded on the frontend … we're also
  hardcoding on the actual engine, that's where we need to update it"*. The frontend reads this and builds its
  re-roll panel from it, so adding a layer is a row rather than an edit in two repos.

  WHAT IS HERE AND WHAT IS NOT. A layer's IDENTITY is data: its key, what to call it, what to say about it, what
  order it runs in, and whether it draws from a seed you can re-roll. Its BEHAVIOUR is still code, bound by
  `key`, because a `run` function is not a database row yet. That is the half his admin feature takes over:
  *"we should be able to develop and see the effects of our development as we do the layer, everything
  integrated with our AI of preference -> admin feature, not for now entirely, but at least we can seed the
  layers we have, add the crud, and leave the editor and AI integration for later"*.

  `seedable` is the difference between a layer you can re-roll and one that only follows. `gates` cuts the exits
  the `ways` layer planned, so rolling it again changes nothing, and a re-roll button on it would be a lie.
  """
  use Ecto.Schema
  import Ecto.Changeset

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id
  schema "generation_layers" do
    field :key, :string
    field :label, :string
    field :hint, :string
    field :position, :integer, default: 0
    field :seedable, :boolean, default: true
    # WHICH GROUP OF LAYERS THIS ONE BELONGS TO, or null when it stands alone.
    #
    # `layout` groups terrain, water and pathways; `objects` groups buildings, nature and decor. They were both
    # served as if they were layers themselves, which is what let a second pathways layer be added beside the
    # first without anything noticing. A group is a NAME for a run of layers, and in the UI it is also the
    # filter: run the system up to here.
    field :group, :string

    timestamps(type: :utc_datetime)
  end

  @doc false
  def changeset(layer, attrs) do
    layer
    |> cast(attrs, [:key, :label, :hint, :position, :seedable, :group])
    |> validate_required([:key, :label])
    |> validate_format(:key, ~r/^[a-z][a-z0-9_]*$/,
      message: "is the id the engine binds its pass to, so it is lower snake_case"
    )
    |> unique_constraint(:key)
  end
end
