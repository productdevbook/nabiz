import { describe, expect, test } from "bun:test"

import { render } from "../src/lib/markdown"

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
