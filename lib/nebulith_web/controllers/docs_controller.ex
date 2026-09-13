defmodule NebulithWeb.DocsController do
  @moduledoc """
  The documentation site: an index of every document in the repo, and a page per document.

  Mounted on the plain `:browser` pipeline rather than behind `:admin`, because a reference nobody can open
  without a login is not a reference.
  """
  use NebulithWeb, :controller

  alias Nebulith.Docs

  def index(conn, _params) do
    render(conn, :index, sections: Docs.sections(), count: length(Docs.list()))
  end

  def show(conn, %{"slug" => slug}) do
    case Docs.fetch(slug) do
      {:ok, doc} -> render(conn, :show, doc: doc, sections: Docs.sections())
      :error -> conn |> put_status(:not_found) |> render(:missing, slug: slug, sections: Docs.sections())
    end
  end
end
