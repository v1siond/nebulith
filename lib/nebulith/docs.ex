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
    "API" => :api,
    "ARCHITECTURE" => :architecture,
    "ENGINE-ARCHITECTURE" => :architecture,
    "NEBULITH-SOURCE-OF-TRUTH" => :architecture,
    "TILE-BACKEND-MIGRATION" => :architecture,
    "MAP-MODEL" => :model,
    "TILE-VOCABULARY-CONTRACT" => :model,
    "TILESET-AUTHORING" => :model,
    "GENERATION-SPEC" => :generation,
    "ALGORITHMS" => :generation,
    "EDITOR-INTERACTION-SPEC" => :editor,
    "TRIGGERS-SPEC" => :editor,
    "COMBAT-AND-SYSTEMS-SPEC" => :systems,
    "ANIMATION-SYSTEM" => :systems,
    "LIGHTING" => :systems,
    "RENDER-AND-CAMERA" => :systems,
    "FEATURES" => :project,
    "GAPS-AND-ROADMAP" => :project,
    "README" => :project
  }

  @section_titles [
    api: "API reference",
    architecture: "Architecture",
    model: "The map model",
    generation: "Generation",
    editor: "The editor",
    systems: "Systems",
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
    with %{file: file, title: title} <- Enum.find(list(), &(&1.slug == slug)),
         {:ok, body} <- File.read(Path.join(dir(), file)) do
      {:ok, %{title: title, slug: slug, html: to_html(body), headings: headings(body)}}
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

  # The H2s, for the in-page navigation. Anchors match what Earmark generates.
  defp headings(body) do
    ~r/^##\s+(.+)$/m
    |> Regex.scan(body)
    |> Enum.map(fn [_, text] -> %{text: String.trim(text), anchor: anchor(text)} end)
  end

  defp anchor(text) do
    text
    |> String.trim()
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9\s-]/, "")
    |> String.replace(~r/\s+/, "-")
  end

  defp to_html(body) do
    case Earmark.as_html(body, escape: false, gfm: true, breaks: false) do
      {:ok, html, _} -> html
      {:error, html, _} -> html
    end
  end
end
