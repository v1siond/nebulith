defmodule Nebulith.Repo.Migrations.AddVariantToGenerators do
  @moduledoc """
  A generator NAMES the archetype it runs.

  Until now the category key was silently doing that job: the editor passed "town" or "cave" straight to the
  engine as the variant. That breaks the moment two kinds share a category, which is what Alexander asked for:
  *"City and town options are the same, it'd put them in a single category"*.

  Nullable, and a row that states none inherits its parent's, so nothing existing changes until the catalog
  says otherwise.
  """
  use Ecto.Migration

  def change do
    alter table(:generators) do
      add :variant, :string
    end
  end
end
