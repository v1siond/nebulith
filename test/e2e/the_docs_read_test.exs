defmodule Nebulith.E2E.TheDocsReadTest do
  @moduledoc """
  The documentation is readable, and its contents rail takes you where it says.

  The spec drives development, so a broken link in it is not cosmetic: it is the difference between a
  rule being read and a rule being guessed at. The document root IS the spec rather than a list of
  links to it.

  Not tied to a phase. It covers the docs site, which every phase depends on.
  """
  use Nebulith.E2ECase, async: false

  @moduletag :e2e

  describe "the contents rail" do
    test "is populated and every entry points at a heading that exists", %{conn: conn} do
      session = visit(conn, "/docs")

      entries = Browser.count(session, ~s|nav a[href^="#"]|)

      assert entries > 20,
             "the contents rail has #{entries} entries, so the document did not render"

      dangling =
        Browser.js(session, """
        [...document.querySelectorAll('nav a[href^="#"]')]
          .map(a => a.getAttribute('href').slice(1))
          .filter(id => !document.getElementById(id))
        """)

      assert dangling == [],
             "rail links point at headings that do not exist: #{inspect(dangling)}"
    end

    test "scrolls to the section you click, spread across the whole document", %{conn: conn} do
      session = visit(conn, "/docs")

      for label <- ["The laws", "The schema", "The implementation plan", "The setting ledger"] do
        assert Browser.true?(
                 session,
                 ~s|[...document.querySelectorAll('nav a')].some(a => a.textContent.includes('#{label}'))|
               ),
               "the rail has no entry for #{label}"

        Browser.js(session, """
        [...document.querySelectorAll('nav a')].find(a => a.textContent.includes('#{label}'))?.click()
        """)

        landed =
          Browser.wait_value(session, """
          (() => {
            const target = document.getElementById(location.hash.slice(1))
            if (!target) return null
            const top = target.getBoundingClientRect().top
            return { top: Math.round(top), text: target.textContent.trim().slice(0, 40) }
          })()
          """)

        assert landed,
               "clicking #{label} went to #{Browser.js(session, "location.hash")}, which is not a heading"

        # At the top of the viewport, allowing for its scroll margin.
        top = pixels(landed["top"])

        assert top >= -4 and top < 120,
               "clicking #{label} left it at #{top}px, not at the top: #{landed["text"]}"
      end
    end
  end

  # `Math.round` gives -0 for anything just above the fold, and the driver hands -0 back as the atom
  # :negative_zero rather than as a number. Comparing that against -4 raises instead of failing, which
  # reads as a broken test rather than as a heading sitting exactly where it should.
  # Two equal readings of the document's width, a beat apart. A page still laying itself out disagrees
  # with itself.
  defp settle(session, last \\ -1, tries \\ 20)

  defp settle(session, _last, 0), do: session

  defp settle(session, last, tries) do
    now = Browser.js(session, "document.documentElement.scrollWidth")
    if now == last, do: session, else: settle_again(session, now, tries)
  end

  defp settle_again(session, now, tries) do
    Process.sleep(1_000)
    settle(session, now, tries - 1)
  end

  defp pixels(:negative_zero), do: 0
  defp pixels(n) when is_number(n), do: n

  describe "the diagrams" do
    test "draw when you reach them, and none of them fails to parse", %{conn: conn} do
      session = visit(conn, "/docs")

      Browser.js(
        session,
        "document.querySelector('.nebulith-diagram')?.scrollIntoView({block:'center'})"
      )

      plates = Browser.count(session, ".nebulith-diagram")
      assert plates > 0, "the document has no diagrams in it, so this proves nothing"

      Browser.wait_until(
        session,
        &(Browser.count(&1, ".nebulith-diagram svg") > 0),
        "a diagram to draw once it is scrolled to",
        timeout: 30_000
      )

      broken = Browser.count(session, ".nebulith-diagram.is-broken")
      assert broken == 0, "#{broken} of #{plates} diagrams failed to parse"
    end
  end

  describe "the page itself" do
    test "never scrolls sideways", %{conn: conn} do
      session = visit(conn, "/docs")

      # AFTER the page has settled, not after the first diagram appears. A mermaid plate is several
      # thousand pixels wide while it is being laid out, so measuring the moment an svg exists reports
      # a page that scrolls sideways for about a second and then does not. Two equal readings a beat
      # apart is the page having finished.
      Browser.js(
        session,
        "document.querySelector('.nebulith-diagram')?.scrollIntoView({block:'center'})"
      )

      settle(session)

      refute Browser.true?(
               session,
               "document.documentElement.scrollWidth > document.documentElement.clientWidth"
             ),
             "the page scrolls sideways, so a wide table or diagram is not scrolling inside its own box"
    end
  end
end
