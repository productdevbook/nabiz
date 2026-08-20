/** The slice of markdown a status notice actually needs — bold, italic,
 *  code, links, lists, paragraphs — rendered escape-first, so whatever is
 *  pasted into a notice comes out as text and never as markup. */

function esc(s: string): string {
  return (
    s
      // Control characters, which render as nothing, are dropped rather
      // than escaped; the feed already drops them.
      .replace(/\p{Cc}/gu, (c) => (c === "\n" || c === "\t" ? c : ""))
      .replace(
        /[&<>"]/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
      )
  )
}

function stars(s: string): string {
  return s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>")
}

/** A link's text is bounded because `[` and `]` are different characters:
 *  an unbounded `[^\]]+` rescans to the end of the body from every `[`, and
 *  a notice of four thousand of them — the write limit — cost fourteen
 *  milliseconds, more than the ten a Worker request is given. */
function inline(s: string): string {
  const held: string[] = []
  // A bare ampersand cannot come out of esc(), so an operator cannot type
  // one of these: what is put back is only ever what was held.
  const hold = (html: string): string => `&${held.push(html) - 1}&`
  const put = (text: string): string =>
    text.replace(/&(\d+)&/g, (whole, i: string) => held[Number(i)] ?? whole)
  return (
    s
      // Code first and held out of everything after it: the stars inside a
      // code span are not emphasis, and a link inside one is not a link.
      .replace(/`([^`]{1,1000})`/g, (_, code: string) => hold(`<code>${code}</code>`))
      // Then links, held too. Emphasis inside the text still reads, but a
      // star or a backtick inside the address is part of the address —
      // running those rules over a URL wrote their tags into the href.
      .replace(
        /\[([^\]]{1,400})\]\((https?:\/\/[^)\s<>]{1,2000})\)/g,
        // Put back inside the link's own text, because a replacement is
        // not rescanned: a code span held before the link would otherwise
        // be published as the marker itself.
        (_, text: string, url: string) =>
          hold(
            `<a href="${url}" rel="noopener noreferrer" target="_blank">${put(stars(text))}</a>`,
          ),
      )
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/&(\d+)&/g, (whole, i: string) => held[Number(i)] ?? whole)
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
