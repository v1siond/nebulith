defmodule Nebulith.Repo.Migrations.AddOptionsToGenerators do
  use Ecto.Migration

  @moduledoc """
  A generator declares its OPTIONS, so a variation stops being a new row.

  Alexander, 2026-09-10:

    > our current layout has a proble, every time we add a new template, the list grows, even when the
    > template is in a similar category as others. for example, we have woodland, woodland + river, Jungle,
    > meadow, meadow + river and now we'll add bridges on river, we might have woodlan, woodlan + river,
    > woodlan + river + bridge — you see the issue? that's not sustainable. Instead, we should just have
    > extra options for each template

  The code already agreed with him: `FOREST_LAYOUTS` reads `woodland_river: ctx => layoutWoodland(ctx, {
  river: true })`, and the meadow builder takes `{river, twoWays}`. A river has always been an OPTION
  internally; only the catalog row and the layout string duplicated per combination.

  So `options` is a DECLARATION — what a person may switch on for this generator, with its type, label and
  default. Separate from `config`, which is the fixed tuning the generator runs with, because they answer
  different questions: config is what it uses, options are what you may change.
  """

  def change do
    alter table(:generators) do
      add :options, :map, null: false, default: "[]"
    end
  end
end
