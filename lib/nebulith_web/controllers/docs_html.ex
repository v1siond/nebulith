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
    <nav
      aria-label="Documents"
      class="sticky top-0 hidden max-h-screen w-80 shrink-0 self-start overflow-y-auto border-r border-base-300 py-7 pl-6 pr-5 lg:block"
    >
      <a
        href="/docs"
        class="mb-4 block text-xs font-bold uppercase tracking-[0.14em] text-base-content/50 hover:text-primary"
      >
        Documentation
      </a>
      <div :for={section <- @sections} class="mt-5">
        <p class="mb-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-base-content/40">
          {section.title}
        </p>
        <ul>
          <li :for={doc <- section.docs}>
            <a
              href={"/docs/#{doc.slug}"}
              aria-current={@current == doc.slug && "page"}
              class={[
                "block rounded py-1 pr-2 text-[13.5px] leading-snug hover:text-primary",
                "focus-visible:outline-2 focus-visible:outline-primary",
                @current == doc.slug && "font-semibold text-primary",
                @current != doc.slug && "text-base-content/70"
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
