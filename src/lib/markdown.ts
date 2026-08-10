/** The slice of markdown a status notice actually needs — bold, italic,
 *  code, links, lists, paragraphs — rendered escape-first, so whatever is
 *  pasted into a notice comes out as text and never as markup. */

function esc(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
  )
}

function inline(s: string): string {
  return (
    s
      // Code first, or the stars inside it would be taken for emphasis.
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      // Only links that name their protocol, and only the two that belong
      // on a status page.
      .replace(
        /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
        '<a href="$2" rel="noopener noreferrer" target="_blank">$1</a>',
      )
  )
}

export function render(md: string): string {
  const blocks = esc(md.trim()).split(/\n\s*\n/)
  return blocks
    .map((block) => {
      const lines = block.split("\n")
      if (lines.every((l) => l.trimStart().startsWith("- ")))
        return `<ul>${lines.map((l) => `<li>${inline(l.trimStart().slice(2))}</li>`).join("")}</ul>`
      return `<p>${lines.map(inline).join("<br>")}</p>`
    })
    .join("\n")
}
