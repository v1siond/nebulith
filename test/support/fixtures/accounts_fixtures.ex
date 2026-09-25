defmodule Nebulith.AccountsFixtures do
  @moduledoc """
  People, for tests that need somebody to own something.

  Every game belongs to an owner now (`docs/AUTH.md` §5b), so a test that makes a game needs a person to
  make it as. That is the whole reason this exists: before the ownership rule there was nowhere in a
  plain `mix test` to get a user from, and the only maker was the end-to-end `Account.an_admin/1`, which
  drives a browser.

  Goes through `Accounts.register_user/1`, the same door a person uses, so a fixture cannot create an
  account the application itself would refuse. `is_admin` is deliberately NOT castable there, so an admin
  is made by asking for one, not by passing a flag.
  """

  alias Nebulith.Accounts

  @doc "A registered person, with a unique email unless one is given."
  def user_fixture(attrs \\ %{}) do
    {:ok, user} =
      attrs
      |> Enum.into(%{
        "email" => "person#{System.unique_integer([:positive])}@nebulith.test",
        "password" => "a long enough password",
        "display_name" => "A Person"
      })
      |> Accounts.register_user()

    user
  end

  @doc "A registered person who is an admin, for the rules that treat one differently."
  def admin_fixture(attrs \\ %{}) do
    {:ok, admin} =
      attrs
      |> Enum.into(%{
        email: "admin#{System.unique_integer([:positive])}@nebulith.test",
        password: "a long enough password",
        display_name: "An Admin"
      })
      |> Accounts.create_admin_user()

    admin
  end
end
