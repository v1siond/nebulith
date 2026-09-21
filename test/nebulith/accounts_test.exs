defmodule Nebulith.AccountsTest do
  @moduledoc """
  ONE TABLE ANSWERS WHO SOMEONE IS.

  `admin_users` and `users` both existed for a moment during phase 1 of the rebuild, which is the
  one-fact-two-owners shape this whole redesign exists to remove: an account could be in one and not the
  other, and which one a login consulted decided whether it worked.

  So there is one table now, `is_admin` is the only difference between the two roles, and these cases pin
  the parts that are easy to get wrong when folding two tables into one: the hashes had to survive, email
  has to keep matching case-insensitively without a citext column, and a non-admin must not be able to pass
  the admin lookup the `/admin` plug uses.
  """
  use Nebulith.DataCase, async: true

  alias Nebulith.Accounts

  defp unique_email(prefix), do: "#{prefix}-#{System.unique_integer([:positive])}@nebulith.test"

  describe "creating and finding" do
    test "a user is found by email whatever case it is typed in" do
      email = unique_email("Mixed.Case")
      {:ok, user} = Accounts.create_user(%{email: email, password: "12345678"})

      assert Accounts.get_user_by_email(String.upcase(email)).id == user.id
      assert Accounts.get_user_by_email(String.downcase(email)).id == user.id
      assert Accounts.get_user_by_email("  #{email}  ").id == user.id
    end

    test "the stored email is downcased, so the unique index and the lookup agree" do
      email = unique_email("UPPER")
      {:ok, user} = Accounts.create_user(%{email: email, password: "12345678"})
      assert user.email == String.downcase(email)
    end

    test "the same email cannot be taken twice, in any case" do
      email = unique_email("taken")
      {:ok, _} = Accounts.create_user(%{email: email, password: "12345678"})

      {:error, changeset} =
        Accounts.create_user(%{email: String.upcase(email), password: "12345678"})

      assert "has already been taken" in errors_on(changeset).email
    end

    test "a password shorter than the minimum is refused" do
      {:error, changeset} =
        Accounts.create_user(%{email: unique_email("short"), password: "1234567"})

      assert errors_on(changeset).password != []
    end
  end

  describe "authenticate/2" do
    setup do
      email = unique_email("auth")
      {:ok, user} = Accounts.create_user(%{email: email, password: "12345678"})
      %{user: user, email: email}
    end

    test "the right password gets in", %{user: user, email: email} do
      assert {:ok, found} = Accounts.authenticate(email, "12345678")
      assert found.id == user.id
    end

    test "the wrong password does not", %{email: email} do
      assert Accounts.authenticate(email, "wrong-password") == :error
    end

    test "an email nobody has does not", %{} do
      assert Accounts.authenticate(unique_email("nobody"), "12345678") == :error
    end

    test "a password is never stored in the clear", %{user: user} do
      refute user.hashed_password == "12345678"
      assert is_binary(user.hashed_password)
    end
  end

  describe "admin is a flag on a user, not a second table" do
    test "a plain user is not visible to the admin lookup the /admin plug uses" do
      email = unique_email("plain")
      {:ok, _} = Accounts.create_user(%{email: email, password: "12345678"})

      assert Accounts.get_user_by_email(email)
      refute Accounts.get_admin_user_by_email(email), "a non-admin passed the admin lookup"
    end

    test "an admin is visible to both, and appears in the admin list" do
      email = unique_email("boss")
      {:ok, admin} = Accounts.create_admin_user(%{email: email, password: "12345678"})

      assert admin.is_admin
      assert Accounts.get_admin_user_by_email(email).id == admin.id
      assert Enum.any?(Accounts.list_admin_users(), &(&1.id == admin.id))
    end

    test "upsert_admin_user creates once and then updates, so seeding twice is safe" do
      email = unique_email("seeded")

      {:ok, first} = Accounts.upsert_admin_user(email, %{password: "12345678"})
      {:ok, second} = Accounts.upsert_admin_user(email, %{password: "87654321"})

      assert first.id == second.id, "seeding twice made a second account"
      assert Accounts.authenticate(email, "87654321") != :error
      assert Accounts.authenticate(email, "12345678") == :error
    end
  end
end
