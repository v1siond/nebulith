defmodule Nebulith.AccountsTest do
  use Nebulith.DataCase, async: true

  alias Nebulith.Accounts
  alias Nebulith.Accounts.AdminUser

  describe "create_admin_user/1" do
    test "creates an admin and hashes the password" do
      assert {:ok, %AdminUser{} = admin} =
               Accounts.create_admin_user(%{email: "a@b.com", password: "supersecret"})

      assert admin.email == "a@b.com"
      assert admin.role == "admin"
      assert is_binary(admin.hashed_password)
      refute admin.hashed_password == "supersecret"
      assert String.starts_with?(admin.hashed_password, "pbkdf2$sha256$")
    end

    test "requires email and password" do
      assert {:error, changeset} = Accounts.create_admin_user(%{})
      assert %{email: ["can't be blank"], password: ["can't be blank"]} = errors_on(changeset)
    end

    test "rejects short passwords" do
      assert {:error, changeset} =
               Accounts.create_admin_user(%{email: "a@b.com", password: "short"})

      assert "should be at least 8 character(s)" in errors_on(changeset).password
    end

    test "enforces a unique email" do
      {:ok, _} = Accounts.create_admin_user(%{email: "dup@b.com", password: "supersecret"})

      assert {:error, changeset} =
               Accounts.create_admin_user(%{email: "dup@b.com", password: "supersecret"})

      assert "has already been taken" in errors_on(changeset).email
    end
  end

  describe "upsert_admin_user/2" do
    test "creates then updates the same email" do
      assert {:ok, first} = Accounts.upsert_admin_user("seed@b.com", %{password: "supersecret"})
      assert {:ok, second} = Accounts.upsert_admin_user("seed@b.com", %{password: "differentpw"})

      assert first.id == second.id
      assert length(Accounts.list_admin_users()) == 1
      # password change actually took effect
      assert {:ok, _} = Accounts.authenticate("seed@b.com", "differentpw")
      assert :error = Accounts.authenticate("seed@b.com", "supersecret")
    end
  end

  describe "authenticate/2" do
    setup do
      {:ok, admin} = Accounts.create_admin_user(%{email: "auth@b.com", password: "supersecret"})
      %{admin: admin}
    end

    test "succeeds with the right password", %{admin: admin} do
      assert {:ok, found} = Accounts.authenticate("auth@b.com", "supersecret")
      assert found.id == admin.id
    end

    test "fails with a wrong password" do
      assert :error = Accounts.authenticate("auth@b.com", "wrongpassword")
    end

    test "fails for an unknown email" do
      assert :error = Accounts.authenticate("nobody@b.com", "supersecret")
    end
  end
end
