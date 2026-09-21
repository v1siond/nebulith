defmodule Nebulith.Accounts.UserToken do
  @moduledoc """
  A LIVE SESSION, as a row.

  The browser's cookie carries `token` and nothing else, so the server resolves who someone is by
  looking the row up rather than by trusting what the cookie says. That is what makes signing out
  possible: the row is deleted and the cookie stops meaning anything.

  See docs/AUTH.md §1.
  """
  use Ecto.Schema
  import Ecto.Query

  alias Nebulith.Accounts.{User, UserToken}

  # 32 bytes. Long enough that guessing is not a strategy, short enough to sit in a cookie.
  @rand_size 32

  # How long a session lasts without being used again. Deliberately generous: this is a game engine,
  # not a bank, and being logged out mid-map is worse than the risk it buys back.
  @session_validity_in_days 60

  @primary_key {:id, :binary_id, autogenerate: true}
  @foreign_key_type :binary_id

  schema "users_tokens" do
    field :token, :binary
    field :context, :string
    belongs_to :user, User

    timestamps(type: :utc_datetime, updated_at: false)
  end

  @doc "A new session token and the row that will vouch for it."
  def build_session_token(user) do
    token = :crypto.strong_rand_bytes(@rand_size)
    {token, %UserToken{token: token, context: "session", user_id: user.id}}
  end

  @doc "The query that turns a session token back into the person who holds it, or nothing."
  def verify_session_token_query(token) do
    from token in by_token_and_context_query(token, "session"),
      join: user in assoc(token, :user),
      where: token.inserted_at > ago(@session_validity_in_days, "day"),
      select: user
  end

  @doc """
  A new API token and its row.

  Separate from a session on purpose. A session belongs to a browser and dies when someone signs out;
  an API token belongs to a script and has to survive that, so "sign out everywhere" must not take it.
  """
  def build_api_token(user) do
    token = :crypto.strong_rand_bytes(@rand_size)
    {token, %UserToken{token: token, context: "api", user_id: user.id}}
  end

  @doc """
  The query that turns an API token back into the person who holds it.

  No expiry clause, deliberately: a machine credential that stops working on a date nobody wrote down
  fails in the middle of the night. An API token lives until the row is deleted.
  """
  def verify_api_token_query(token) do
    from token in by_token_and_context_query(token, "api"),
      join: user in assoc(token, :user),
      select: user
  end

  @doc "One token, by its bytes and what it is for."
  def by_token_and_context_query(token, context) do
    from UserToken, where: [token: ^token, context: ^context]
  end

  @doc "Every token a person holds, which is how signing out everywhere is spelled."
  def by_user_and_contexts_query(user, :all) do
    from t in UserToken, where: t.user_id == ^user.id
  end

  def by_user_and_contexts_query(user, [_ | _] = contexts) do
    from t in UserToken, where: t.user_id == ^user.id and t.context in ^contexts
  end
end
