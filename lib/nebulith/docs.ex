defmodule Nebulith.Docs do
  @moduledoc """
  THE DOCUMENTATION LIBRARY: every markdown document in the repo, listed and rendered.

  after being handed `docs/API.md` and told that was the deliverable: then

  So the docs are not one page. They are the corpus already in `docs/`, indexed and served.

  ## Where the content comes from

  The repo's own `docs/` directory, read at request time in dev so an edit shows up on refresh without a
  restart. Nothing is duplicated into this module: the markdown files stay the single source, which is the
  whole point of rendering them rather than transcribing them.

  ## Grouping

  A document's SECTION is derived from its filename, not from a hand-kept list, so a new document appears in
  the index the moment it is added and nobody has to remember to register it. That is the same lesson the seed
  coverage test encodes: an invariant that depends on being remembered is not an invariant.
  """

  @sections %{
    # Read first. SPEC is the target architecture; everything else describes a part of it.
    "SPEC" => :frameworks,
    "FRAMEWORKS" => :frameworks,
    "README" => :frameworks,
    "VISION" => :frameworks,
    "CODING-STANDARDS" => :frameworks,
    "API" => :api,
    "ARCHITECTURE" => :architecture,
    "ENGINE-ARCHITECTURE" => :architecture,
    "NEBULITH-SOURCE-OF-TRUTH" => :architecture,
    "TILE-BACKEND-MIGRATION" => :architecture,
    "DEPLOY" => :deployment,
    "DEPLOYMENT-AND-BOUNDARIES" => :deployment,
    "LIVEVIEW-MIGRATION-PLAN" => :deployment,
    "MAP-MODEL" => :model,
    "TILE-VOCABULARY-CONTRACT" => :model,
    "TILESET-AUTHORING" => :model,
    "HITBOXES-AND-ELEVATION" => :model,
    "MATH-FOUNDATIONS" => :model,
    "POLYGONS" => :model,
    "GENERATION-SPEC" => :generation,
    "ALGORITHMS" => :generation,
    "REGIONS" => :generation,
    "TERRAIN" => :generation,
    "WATER" => :generation,
    "DESIGN-ENTRANCES" => :generation,
    "TILE-DESIGN" => :art,
    "TILE-EFFECTS" => :art,
    "OBJECT-CONSTRUCTION" => :art,
    "TREES" => :art,
    "EDITOR-INTERACTION-SPEC" => :editor,
    "EDITOR-UX" => :editor,
    "TRIGGERS-SPEC" => :editor,
    "COMBAT-AND-SYSTEMS-SPEC" => :systems,
    "ANIMATION-SYSTEM" => :systems,
    "LIGHTING" => :systems,
    "RENDER-AND-CAMERA" => :systems,
    "FEATURES" => :project,
    "GAPS-AND-ROADMAP" => :project
  }

  @section_titles [
    frameworks: "Start here",
    architecture: "Architecture",
    model: "The map model",
    generation: "Generation",
    art: "Tile and object art",
    editor: "The editor",
    systems: "Systems",
    deployment: "Deployment",
    api: "API reference",
    project: "Project",
    other: "Other documents"
  ]

  @doc "Every document, grouped into ordered sections for the index."
  def sections do
    by_section = Enum.group_by(list(), & &1.section)

    for {key, title} <- @section_titles,
        docs = Map.get(by_section, key, []),
        docs != [],
        do: %{key: key, title: title, docs: Enum.sort_by(docs, & &1.title)}
  end

  @doc "Every document in the corpus: slug, title, section, size and the first paragraph as a summary."
  def list do
    case File.ls(dir()) do
      {:ok, files} ->
        files
        |> Enum.filter(&String.ends_with?(&1, ".md"))
        |> Enum.map(&describe/1)
        |> Enum.reject(&is_nil/1)

      {:error, _} ->
        []
    end
  end

  @doc """
  One document as `{:ok, %{title, slug, html, headings}}`, or `:error` when the slug names no file.

  The slug is matched against the KNOWN files rather than joined onto a path, so a crafted slug cannot walk
  out of the docs directory.
  """
  def fetch(slug) do
    with %{file: file, title: title, section: section, summary: summary} <-
           Enum.find(list(), &(&1.slug == slug)),
         {:ok, body} <- File.read(Path.join(dir(), file)) do
      {:ok,
       %{
         title: title,
         slug: slug,
         section: section,
         section_title: Keyword.get(@section_titles, section, "Documentation"),
         summary: summary,
         html: to_html(body),
         headings: headings(body),
         diagrams?: diagrams?(body)
       }}
    else
      _ -> :error
    end
  end

  # ── internals ──────────────────────────────────────────────────────────

  defp dir, do: Application.get_env(:nebulith, :docs_dir, Path.join(File.cwd!(), "docs"))

  defp describe(file) do
    path = Path.join(dir(), file)

    case File.read(path) do
      {:ok, body} ->
        base = Path.basename(file, ".md")

        %{
          file: file,
          slug: slug_of(base),
          title: title_of(body, base),
          section: Map.get(@sections, base, :other),
          summary: summary_of(body),
          bytes: byte_size(body)
        }

      {:error, _} ->
        nil
    end
  end

  defp slug_of(base), do: base |> String.downcase() |> String.replace("_", "-")

  # The document's own first H1 is its title; the filename is the fallback so an untitled file still lists.
  defp title_of(body, base) do
    case Regex.run(~r/^#\s+(.+)$/m, body) do
      [_, title] -> String.trim(title)
      _ -> base
    end
  end

  # The first real paragraph after the title, trimmed to a card-sized blurb.
  defp summary_of(body) do
    body
    |> String.split("\n")
    |> Enum.drop_while(&(not String.starts_with?(&1, "# ")))
    |> Enum.drop(1)
    |> Enum.drop_while(&(String.trim(&1) == ""))
    |> Enum.take_while(&(String.trim(&1) != ""))
    |> Enum.join(" ")
    |> String.replace(~r/[*`_]/, "")
    |> String.trim()
    |> String.slice(0, 240)
  end

  # The contents rail: H2s and H3s, each with its level and, where the heading is numbered, that number
  # split off so the rail can hang it as a figure. A numbered document already HAS a structure; the rail
  # shows the one the document declares rather than inventing a second one.
  defp headings(body) do
    # The # is escaped: an unescaped #{...} is interpolation inside a sigil, not a repeat count.
    ~r/^(\#{2,3})\s+(.+)$/m
    |> Regex.scan(body)
    |> Enum.map(fn [_, hashes, text] ->
      text = String.trim(text)
      {number, label} = split_number(text)

      %{
        level: String.length(hashes),
        text: text,
        label: label,
        number: number,
        anchor: anchor(text)
      }
    end)
  end

  defp split_number(text) do
    case Regex.run(~r/^(\d+(?:\.\d+)*)\.?\s+(.*)$/, text) do
      [_, number, label] -> {number, label}
      _ -> {nil, text}
    end
  end

  defp anchor(text) do
    text
    |> String.trim()
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9\s-]/, "")
    |> String.replace(~r/\s+/, "-")
  end

  defp to_html(body) do
    {stripped, diagrams} = lift_diagrams(body)

    stripped
    |> render_markdown()
    |> drop_in_diagrams(diagrams)
    |> drop_masthead()
    |> anchor_headings()
  end

  # Earmark emits a bare `<h2>` with no id, so every link in the contents rail pointed at nothing and
  # clicking one did exactly that. The id is computed here from the heading's own text with the SAME
  # `anchor/1` the rail uses, so the two are one function and cannot drift apart.
  defp anchor_headings(html) do
    Regex.replace(~r{<(h[23])>\s*(.*?)</\1>}s, html, fn _whole, tag, inner ->
      ~s(<#{tag} id="#{anchor(strip_tags(inner))}">#{inner}</#{tag}>)
    end)
  end

  defp strip_tags(html), do: String.replace(html, ~r{<[^>]*>}, "")

  # The page's own header already shows the title and the opening line, so rendering them again at the top
  # of the body prints both twice. The markdown keeps them, because the file has to read correctly on its
  # own; the page drops them because it has somewhere better to put them.
  defp drop_masthead(html) do
    html
    |> String.replace(~r{\A\s*<h1>.*?</h1>\s*}s, "", global: false)
    |> String.replace(~r{\A\s*<p>.*?</p>\s*}s, "", global: false)
  end

  defp render_markdown(body) do
    case Earmark.as_html(body, escape: false, gfm: true, breaks: false) do
      {:ok, html, _} -> html
      {:error, html, _} -> html
    end
  end

  @doc false
  def diagrams?(body), do: Regex.match?(~r/^```mermaid\s*$/m, body)

  # ── mermaid ────────────────────────────────────────────────────────────
  #
  # A mermaid fence is pulled OUT before Earmark sees it and put back afterwards, rather than rewriting
  # Earmark's output. Two reasons, both of which bite the other way round:
  #
  #   1. The docs render with `escape: false`, so a `<br/>` inside a flowchart label would reach the page as
  #      a real line break and vanish from the diagram source. Every multi-line node label in the engine spec
  #      uses one.
  #   2. Mermaid reads its source from `textContent`, so the source has to be HTML-escaped exactly once.
  #      Escaping Earmark's already-escaped code block would double it and `--&amp;gt;` is not an arrow.
  #
  # The placeholder is a paragraph of its own so Earmark cannot fold it into surrounding text.

  @placeholder "NEBULITHMERMAID"

  defp lift_diagrams(body) do
    diagrams =
      ~r/^```mermaid\r?\n(.*?)^```/ms
      |> Regex.scan(body, capture: :all_but_first)
      |> Enum.map(&hd/1)

    stripped =
      diagrams
      |> Enum.with_index()
      |> Enum.reduce(body, fn {source, i}, acc ->
        String.replace(acc, "```mermaid\n" <> source <> "```", "#{@placeholder}#{i}",
          global: false
        )
      end)

    {stripped, diagrams}
  end

  defp drop_in_diagrams(html, diagrams) do
    diagrams
    |> Enum.with_index()
    |> Enum.reduce(html, fn {source, i}, acc ->
      String.replace(acc, "<p>\n#{@placeholder}#{i}</p>", figure(source))
      |> String.replace("<p>#{@placeholder}#{i}</p>", figure(source))
      |> String.replace("#{@placeholder}#{i}", figure(source))
    end)
  end

  # A hook class and semantic elements, no styling. Tailwind scans `lib/nebulith_web`, not this module, so
  # utilities written here would be purged; the docs template styles this the same way it styles every other
  # generated element, with an arbitrary variant. The caption is a real `figcaption` rather than a CSS
  # pseudo-element, which keeps it in the accessibility tree and out of a stylesheet.
  defp figure(source) do
    ~s(<figure class="nebulith-diagram"><figcaption>Diagram</figcaption><pre class="mermaid">) <>
      escape(source) <> ~s(</pre></figure>)
  end

  defp escape(text) do
    text
    |> String.replace("&", "\&amp;")
    |> String.replace("<", "\&lt;")
    |> String.replace(">", "\&gt;")
  end
end
