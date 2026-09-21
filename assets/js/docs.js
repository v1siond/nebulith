/**
 * THE DOCUMENTATION SITE'S DIAGRAMS.
 *
 * Its own bundle, loaded only on a page that actually has a diagram, because mermaid is large and the rest
 * of the app must not pay for it. `Nebulith.Docs` decides whether a document has one and the template only
 * emits this script when it does.
 *
 * The source arrives HTML-escaped inside `<pre class="mermaid">`, which is exactly what mermaid wants: it
 * reads `textContent`, so `&lt;br/&gt;` decodes back to the `<br/>` a flowchart label needs.
 *
 * ## Why they draw lazily
 *
 * The engine spec carries 26 diagrams, several of them whole-schema ER drawings. Rendering them in a loop
 * on load took longer than the page was worth: measured at 8 seconds only 13 of the 26 had appeared, and
 * nothing had failed, the loop was simply still working. So each one draws when it comes near the viewport.
 * The reader sees the first screen immediately and never waits for a diagram they have not scrolled to.
 */
import mermaid from 'mermaid'

/** daisyUI writes the chosen theme onto <html>; a diagram follows it rather than guessing. */
function mermaidTheme() {
  const theme = document.documentElement.getAttribute('data-theme') || ''
  if (theme === 'dark') return 'dark'
  if (theme) return 'default'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'default'
}

mermaid.initialize({
  startOnLoad: false,
  theme: mermaidTheme(),
  securityLevel: 'strict',
  fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  // A schema diagram is wide. Let it be wide and let its own plate scroll, rather than shrinking the type.
  maxTextSize: 200000,
  flowchart: { useMaxWidth: false },
  er: { useMaxWidth: false },
  sequence: { useMaxWidth: false },
})

/** Draw one diagram. A failure marks its own plate and never stops the others. */
async function draw(block) {
  if (block.dataset.drawn) return
  block.dataset.drawn = '1'
  try {
    await mermaid.run({ nodes: [block] })
  } catch (err) {
    block.closest('.nebulith-diagram')?.classList.add('is-broken')
    block.setAttribute('data-error', String(err?.message ?? err))
  }
}

function start() {
  const blocks = Array.from(document.querySelectorAll('pre.mermaid'))
  if (!blocks.length) return

  // No observer (or an old browser): draw everything, correctness over speed.
  if (!('IntersectionObserver' in window)) {
    blocks.forEach(draw)
    return
  }

  // A generous margin so a diagram is already drawn by the time it is scrolled to.
  const io = new IntersectionObserver(
    entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        io.unobserve(entry.target)
        draw(entry.target)
      }
    },
    { rootMargin: '800px 0px' },
  )

  blocks.forEach(block => io.observe(block))
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start)
} else {
  start()
}
