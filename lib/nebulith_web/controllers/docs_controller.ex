defmodule NebulithWeb.DocsController do
  @moduledoc """
  The documentation site: an index of every document in the repo, and a page per document.

  Mounted on the plain `:browser` pipeline rather than behind `:admin`, because a reference nobody can open
  without a login is not a reference.
  """
  use NebulithWeb, :controller

  alias Nebulith.Docs

  @doc """
  The documentation root.

  It serves the PRIMARY document rather than a list of links to it. The engine spec is what the
  documentation is, so `/docs` is that page: *"i want /docs/spec to be /docs, it's basically what it is"*.
  The card index only appears when there is no primary document to show, which is the honest thing to
  render when the corpus is a set of peers.
  """
  @primary "spec"

  def index(conn, _params) do
    case Docs.fetch(@primary) do
      {:ok, doc} -> render(conn, :show, doc: doc, sections: Docs.sections())
      :error -> render(conn, :index, sections: Docs.sections(), count: length(Docs.list()))
    end
  end

  def show(conn, %{"slug" => slug}) do
    case Docs.fetch(slug) do
      {:ok, doc} -> render(conn, :show, doc: doc, sections: Docs.sections())
      :error -> conn |> put_status(:not_found) |> render(:missing, slug: slug, sections: Docs.sections())
    end
  end
end
