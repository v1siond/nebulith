defmodule NebulithWeb.DocsHTML do
  @moduledoc """
  Templates for the documentation site rendered by `NebulithWeb.DocsController`.
  """
  use NebulithWeb, :html

  embed_templates "docs_html/*"

  @doc """
  The sidebar shared by the index and every document page, so navigation is identical wherever you are.
  """
  attr :sections, :list, required: true
  attr :current, :string, default: nil

  def sidebar(assigns) do
    ~H"""
    <nav class="w-64 shrink-0 border-r border-base-300 pr-4">
      <a href="/docs" class="block font-mono text-sm font-bold hover:underline">Documentation</a>
      <div :for={section <- @sections} class="mt-5">
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-base-content/50">
          {section.title}
        </p>
        <ul class="space-y-0.5">
          <li :for={doc <- section.docs}>
            <a
              href={"/docs/#{doc.slug}"}
              class={[
                "block rounded px-2 py-1 text-sm hover:bg-base-200",
                @current == doc.slug && "bg-base-200 font-semibold"
              ]}
            >
              {doc.title}
            </a>
          </li>
        </ul>
      </div>
    </nav>
    """
  end
end
