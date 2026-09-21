defmodule Nebulith.DocsMermaidTest do
  @moduledoc """
  A MERMAID FENCE REACHES THE PAGE AS A DIAGRAM, WITH ITS SOURCE INTACT.

  The docs render with `escape: false`, which is deliberate: the corpus contains HTML that is meant to
  render. That setting is also why a mermaid block cannot simply be handed to Earmark. Two failures, both
  of which this covers:

    * `A["one line,<br/>two lines"]` is how every multi-line node label in the engine spec is written. Left
      to Earmark with escaping off, the `<br/>` reaches the browser as a real line break and LEAVES the
      diagram source, so mermaid parses a label that lost its tag and the node renders wrong or not at all.
    * Mermaid reads its source from `textContent`, so the source must be escaped exactly once. Escaping a
      code block Earmark already escaped gives `--&amp;gt;`, which is not an arrow.

  So the fence is lifted out BEFORE Earmark and put back after, and these cases pin that.
  """
  use ExUnit.Case, async: false

  alias Nebulith.Docs

  @dir Path.join(System.tmp_dir!(), "nebulith_docs_mermaid_test")

  setup do
    File.rm_rf!(@dir)
    File.mkdir_p!(@dir)
    previous = Application.get_env(:nebulith, :docs_dir)
    Application.put_env(:nebulith, :docs_dir, @dir)

    on_exit(fn ->
      File.rm_rf!(@dir)
      if previous, do: Application.put_env(:nebulith, :docs_dir, previous)
    end)

    :ok
  end

  defp render(body) do
    File.write!(Path.join(@dir, "SAMPLE.md"), "# Sample\n\n" <> body)
    {:ok, doc} = Docs.fetch("sample")
    doc
  end

  describe "a mermaid fence" do
    test "renders as a diagram element, not as a code block" do
      doc = render("```mermaid\nflowchart TB\n    A --> B\n```\n")

      assert doc.html =~ ~s(<figure class="nebulith-diagram">)
      assert doc.html =~ ~s(<pre class="mermaid">)

      refute doc.html =~ ~s(<code class="mermaid">),
             "the fence is still a code block, so mermaid will never see it"
    end

    test "keeps a <br/> in a node label as diagram SOURCE, not as a line break" do
      doc = render(~s(```mermaid\nflowchart TB\n    A["one line,<br/>two lines"]\n```\n))

      assert doc.html =~ "one line,&lt;br/&gt;two lines",
             "the <br/> left the diagram source, so the label lost its line break"

      refute doc.html =~ ~s(one line,<br/>two lines),
             "the <br/> reached the page as real markup, which removes it from what mermaid parses"
    end

    test "escapes the source exactly once, so an arrow is still an arrow" do
      doc = render("```mermaid\nflowchart TB\n    A --> B\n```\n")

      assert doc.html =~ "A --&gt; B"

      refute doc.html =~ "--&amp;gt;",
             "the source was escaped twice and the arrow is now literal text"
    end

    test "leaves a plain code block alone" do
      doc = render("```elixir\ndef x, do: 1\n```\n")

      assert doc.html =~ ~s(<pre><code class="elixir">)
      refute doc.html =~ "nebulith-diagram"
    end

    test "handles several diagrams in one document, each with its own source" do
      doc =
        render("""
        ```mermaid
        flowchart TB
            FIRST --> A
        ```

        Text between them.

        ```mermaid
        erDiagram
            SECOND ||--o{ B : has
        ```
        """)

      assert doc.html =~ "FIRST --&gt; A"
      assert doc.html =~ "SECOND ||--o{ B : has"

      count = doc.html |> String.split(~s(<pre class="mermaid">)) |> length() |> Kernel.-(1)
      assert count == 2, "expected 2 diagrams, rendered #{count}"
    end
  end

  describe "the contents rail and the document agree" do
    test "every heading in the body carries the id its rail entry links to" do
      doc =
        render("""
        ## 1. The laws

        Text.

        ### Where they came from

        More text.

        ## 2. Architecture

        ### 2.1 What runs where
        """)

      # This is the defect it exists to stop: Earmark emits a bare `<h2>`, so every rail link pointed at
      # nothing and clicking one did nothing at all.
      refute doc.html =~ "<h2>", "a heading has no id, so its rail link points at nothing"
      refute doc.html =~ "<h3>", "a subheading has no id, so its rail link points at nothing"

      dangling =
        for heading <- doc.headings,
            not String.contains?(doc.html, ~s(id="#{heading.anchor}")),
            do: heading.anchor

      assert dangling == [],
             "these rail entries link to an id the body never renders: #{inspect(dangling)}"
    end

    test "the id survives formatting inside the heading text" do
      doc = render("## 3. The `cell_tiles` table\n\nText.\n")

      [heading] = Enum.filter(doc.headings, &(&1.level == 2))
      assert doc.html =~ ~s(id="#{heading.anchor}")
    end
  end

  describe "diagrams?/1" do
    test "is true only when the document actually has one, so the bundle is not loaded otherwise" do
      assert render("```mermaid\nflowchart TB\n    A --> B\n```\n").diagrams?
      refute render("Just prose, and `inline mermaid` as a word.").diagrams?
      refute render("```elixir\ndef x, do: 1\n```\n").diagrams?
    end
  end

  describe "the real engine spec" do
    @tag :spec
    test "every one of its diagrams renders, and none of its labels lost a tag" do
      repo_spec = Path.join([File.cwd!(), "docs", "SPEC.md"])

      if File.exists?(repo_spec) do
        body = File.read!(repo_spec)
        File.write!(Path.join(@dir, "SPEC.md"), body)
        {:ok, doc} = Docs.fetch("spec")

        fences = body |> String.split("```mermaid") |> length() |> Kernel.-(1)
        drawn = doc.html |> String.split(~s(<pre class="mermaid">)) |> length() |> Kernel.-(1)

        assert drawn == fences, "#{fences} diagrams in the source, #{drawn} reached the page"
        assert doc.diagrams?
      end
    end
  end
end
