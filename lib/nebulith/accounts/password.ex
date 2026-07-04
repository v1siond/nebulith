defmodule Nebulith.Accounts.Password do
  @moduledoc """
  Salted PBKDF2-HMAC-SHA256 password hashing for the backend admin area.

  There is no bcrypt/argon2 dependency in this project, so we lean on the OTP
  `:crypto` primitives that ship with the runtime. Hashes are self-describing
  (`pbkdf2$sha256$iterations$salt$hash`) so the parameters travel with the value.
  """

  @digest :sha256
  @iterations 100_000
  @derived_len 32
  @salt_len 16

  @doc "Hashes a plaintext password, returning an encoded, self-describing string."
  def hash(password) when is_binary(password) do
    salt = :crypto.strong_rand_bytes(@salt_len)
    derived = derive(password, salt)
    "pbkdf2$sha256$#{@iterations}$#{Base.encode64(salt)}$#{Base.encode64(derived)}"
  end

  @doc """
  Verifies a plaintext password against an encoded hash in constant time.

  Always runs a full derivation (even for malformed input) so callers can rely
  on it to blunt timing side-channels.
  """
  def valid?(password, encoded) when is_binary(password) and is_binary(encoded) do
    case decode(encoded) do
      {:ok, salt, expected} -> Plug.Crypto.secure_compare(derive(password, salt), expected)
      :error -> false
    end
  end

  def valid?(_password, _encoded), do: false

  defp derive(password, salt) do
    :crypto.pbkdf2_hmac(@digest, password, salt, @iterations, @derived_len)
  end

  defp decode("pbkdf2$sha256$" <> rest) do
    with [_iterations, salt64, hash64] <- String.split(rest, "$"),
         {:ok, salt} <- Base.decode64(salt64),
         {:ok, hash} <- Base.decode64(hash64) do
      {:ok, salt, hash}
    else
      _ -> :error
    end
  end

  defp decode(_encoded), do: :error
end
