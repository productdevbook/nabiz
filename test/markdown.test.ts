import { describe, expect, test } from "bun:test"

import { render } from "../src/lib/markdown.ts"

describe("a notice renders what was meant and nothing that was smuggled", () => {
  test("html arrives as text, never as markup", () => {
    const out = render('<script>alert("x")</script>')
    expect(out).not.toContain("<script>")
    expect(out).toContain("&lt;script&gt;")
  })

  test("emphasis, code and links work", () => {
    const out = render("**bold** and *soft* and `code` and [docs](https://example.com/a)")
    expect(out).toContain("<strong>bold</strong>")
    expect(out).toContain("<em>soft</em>")
    expect(out).toContain("<code>code</code>")
    expect(out).toContain('href="https://example.com/a"')
  })

  test("a javascript: link stays plain text", () => {
    const out = render("[click](javascript:alert(1))")
    expect(out).not.toContain("href")
  })

  test("stars inside code are code, not emphasis", () => {
    expect(render("`a ** b`")).toContain("<code>a ** b</code>")
  })

  test("blank lines make paragraphs, dashes make lists", () => {
    const out = render("first\n\n- one\n- two")
    expect(out).toContain("<p>first</p>")
    expect(out).toContain("<ul><li>one</li><li>two</li></ul>")
  })

  test("attribute escape holds inside link text", () => {
    const out = render('["quoted"](https://example.com/)')
    expect(out).toContain("&quot;quoted&quot;")
  })
})

/** What rendering n open brackets costs. */
function one(n: number): number {
  const at = performance.now()
  render("[".repeat(n))
  return performance.now() - at
}

describe("a marker is not part of an address", () => {
  test("a star in a URL stays in the URL", () => {
    const html = render("[a](https://example.com/*x) and *y*")
    expect(html).toContain('href="https://example.com/*x"')
    expect(html).not.toContain("<em>x")
    expect(html).toContain("<em>y</em>")
  })

  test("no marker can put a tag inside an address", () => {
    // A backtick pair binds tighter than a link, here as in CommonMark, so
    // this one is not a link at all — what matters is that no rule ever
    // writes its own tags into an href.
    for (const body of [
      "[a](https://example.com/`x) and `y`",
      "[a](https://example.com/**x) [b](https://example.com/**y)",
      "[a](https://example.com/*x)",
    ])
      expect(/href="[^"]*[<>]/.test(render(body))).toBe(false)
  })

  test("a link inside a code span is not a link", () => {
    const html = render("`[a](https://evil.example)`")
    expect(html).not.toContain("<a ")
    expect(html).toContain("<code>[a](https://evil.example)</code>")
  })

  test("emphasis inside a link's text still reads", () => {
    expect(render("[*a*](https://example.com/)")).toContain("<em>a</em></a>")
  })

  test("what marks a held span cannot be typed into a notice", () => {
    // The marker is a bare ampersand, which esc() never emits — so a body
    // that looks like one comes out as text.
    const html = render("&0& and [a](https://example.com/)")
    expect(html).toContain("&amp;0&amp;")
    expect(html).toContain('href="https://example.com/"')
  })

  test("a body of four thousand open brackets renders in linear time", () => {
    one(1000)
    const small = Math.max(one(2000), 0.01)
    const large = one(8000)
    // Four times the input, not sixteen times the work: the unbounded
    // run to a closing bracket cost 14 ms at the write limit, more than
    // the ten a Worker request is given.
    expect(large / small < 12).toBe(true)
  })
})
