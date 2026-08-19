import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"

import { Window } from "happy-dom"

/** The page's behaviour lives in one inline script, and every bug in it so
 *  far was found by hand. This runs the shipped script — read out of the
 *  component, not copied — against a document shaped like the page. */
const astro = readFileSync(new URL("../src/pages/index.astro", import.meta.url), "utf8")
const inline = [...astro.matchAll(/<script[^>]*is:inline[\s\S]*?>([\s\S]*?)<\/script>/g)]
const script = inline.at(-1)?.[1] ?? ""

const LABELS =
  'var resolveLabel="R", failedLabel="F", throttledLabel="T", rejectedLabel="J", offlineLabel="O";'

const BODY = `
  <div class="top"><button id="theme"></button><select id="lang">
    <option value="tr" selected>T</option><option value="de">D</option><option value="fr">F</option>
  </select></div>
  <p id="say"></p>
  <main><p class="hero-s">Tüm sistemler çalışıyor</p>
    <a id="pen" href="#notice">n</a><a href="/feed.xml">panel</a></main>
  <footer><a href="/feed.xml">RSS</a><a href="/llms.txt">llms</a></footer>
  <dialog id="ed"><div class="seg" id="sev">
    <button data-v="info" aria-checked="true">i</button>
    <button data-v="maintenance">m</button>
    <button data-v="degraded">d</button>
    <button data-v="outage">o</button>
  </div><textarea id="txt"></textarea>
  <select id="nlang"><option value="all" selected>a</option></select>
  <input id="tok" type="password"><div id="resolvables"></div><p id="ederr"></p>
  <button id="cancel">c</button><button id="pub">p</button></dialog>`

/** Just enough of an element for what these tests touch — the checker has
 *  no DOM in this project, and the runner brings the real one. */
interface El {
  value: string
  disabled: boolean
  textContent: string | null
  tabIndex: number
  click: () => void
  remove: () => void
  dispatchEvent: (event: unknown) => boolean
  getAttribute: (name: string) => string | null
  classList: { add: (c: string) => void; contains: (c: string) => boolean }
}

interface Doc {
  documentElement: { lang: string }
  body: { innerHTML: string }
  getElementById: (id: string) => El | null
  querySelector: (sel: string) => El | null
  querySelectorAll: (sel: string) => Iterable<El>
}

interface Page {
  window: Window
  document: Doc
  sent: { path: string; body: Record<string, unknown> }[]
  close: () => Promise<void>
}

function open(
  over: { selected?: string; answer?: { status: number } | "offline"; url?: string } = {},
): Page {
  const window = new Window({
    url: over.url ?? "https://status.example.com/?lang=tr",
    settings: { disableJavaScriptEvaluation: false },
  })
  const document = window.document as unknown as Doc
  document.documentElement.lang = "tr"
  document.body.innerHTML = BODY
  const chosen = over.selected ?? "info"
  document.querySelector(`#sev button[data-v="${chosen}"]`)?.classList.add("on")

  const sent: { path: string; body: Record<string, unknown> }[] = []
  ;(window as unknown as { fetch: unknown }).fetch = (path: string, init: { body: string }) => {
    if (path.startsWith("/api/")) {
      sent.push({ path, body: JSON.parse(init.body) as Record<string, unknown> })
      if (over.answer === "offline") return Promise.reject(new Error("offline"))
      const status = over.answer?.status ?? 201
      return Promise.resolve({ ok: status < 400, status })
    }
    return Promise.resolve({ ok: true, text: () => Promise.resolve("<html><body></body></html>") })
  }
  ;(window as unknown as { eval: (s: string) => void }).eval(LABELS + script)
  return {
    window,
    document,
    sent,
    close: () =>
      (window as unknown as { happyDOM: { close: () => Promise<void> } }).happyDOM.close(),
  }
}

const settle = () => new Promise((r) => setTimeout(r, 10))

describe("the language a reader is given is the one they asked for", () => {
  // The address a reader arrives at has no lang in it, which is where the
  // guard has to hold: comparing against the query string, there is
  // nothing to compare with and every blur is a change.
  test("passing through the select without touching it changes nothing", async () => {
    const page = open({ url: "https://status.example.com/" })
    try {
      const select = page.document.getElementById("lang") as El
      select.dispatchEvent(new page.window.Event("focus"))
      select.dispatchEvent(new page.window.Event("blur"))
      expect(page.window.location.href).toBe("https://status.example.com/")
    } finally {
      await page.close()
    }
  })

  test("a language chosen and then left behind is the one that loads", async () => {
    const page = open()
    try {
      const select = page.document.getElementById("lang") as El
      select.dispatchEvent(new page.window.Event("focus"))
      select.value = "de"
      select.dispatchEvent(new page.window.Event("blur"))
      expect(page.window.location.href).toBe("https://status.example.com/?lang=de")
    } finally {
      await page.close()
    }
  })

  test("a select taken out of the page by a refresh is not a person choosing", async () => {
    const page = open()
    try {
      const select = page.document.getElementById("lang") as El
      select.dispatchEvent(new page.window.Event("focus"))
      select.value = "fr"
      select.remove()
      select.dispatchEvent(new page.window.Event("blur"))
      expect(page.window.location.href).toBe("https://status.example.com/?lang=tr")
    } finally {
      await page.close()
    }
  })
})

describe("the dialog publishes what it shows", () => {
  test("the severity is read from the page, not remembered across a refresh", async () => {
    // The body is redrawn with "notice" selected; a script that kept its
    // own answer would publish the one nobody can see any more.
    const page = open({ selected: "outage" })
    try {
      const text = page.document.getElementById("txt")
      if (text) text.value = "bir sey oldu"
      page.document.getElementById("pub")?.click()
      await settle()
      expect(page.sent[0]?.body.severity).toBe("outage")
    } finally {
      await page.close()
    }
  })

  test("arrow keys move the choice and wrap around", async () => {
    const page = open()
    try {
      const buttons = [...page.document.querySelectorAll("#sev button")]
      const press = (from: El | undefined, key: string) =>
        from?.dispatchEvent(new page.window.KeyboardEvent("keydown", { key, bubbles: true }))
      press(buttons[0], "ArrowRight")
      expect(buttons[1]?.getAttribute("aria-checked")).toBe("true")
      press(buttons[1], "ArrowLeft")
      press(buttons[0], "ArrowLeft")
      expect(buttons[3]?.getAttribute("aria-checked")).toBe("true")
      // One stop in the tab order, wherever the choice is.
      expect(buttons.map((b) => b.tabIndex)).toEqual([-1, -1, -1, 0])
    } finally {
      await page.close()
    }
  })
})

describe("a refusal says which refusal it was", () => {
  const cases: [number | "offline", string][] = [
    [401, "F"],
    [429, "T"],
    [400, "J"],
    ["offline", "O"],
  ]
  for (const [answer, label] of cases) {
    test(`${answer} is told apart from the others`, async () => {
      const page = open({ answer: answer === "offline" ? "offline" : { status: answer } })
      try {
        page.document.getElementById("pub")?.click()
        await settle()
        expect(page.document.getElementById("ederr")?.textContent).toBe(label)
        // And the button is usable again, whatever the answer was.
        expect(page.document.getElementById("pub")?.disabled).toBe(false)
      } finally {
        await page.close()
      }
    })
  }

  test("a wrong token is forgotten rather than kept for the next person", async () => {
    const page = open({ answer: { status: 401 } })
    try {
      page.window.sessionStorage.setItem("nabiz-token", "stale")
      page.document.getElementById("pub")?.click()
      await settle()
      expect(page.window.sessionStorage.getItem("nabiz-token")).toBeNull()
    } finally {
      await page.close()
    }
  })
})

describe("the script and the page agree on what is in the page", () => {
  test("every element the script asks for by id is in the markup", () => {
    const asked = [...script.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1] as string)
    expect(asked.length).toBeGreaterThan(5)
    const missing = [...new Set(asked)].filter((id) => !astro.includes(`id="${id}"`))
    expect(missing).toEqual([])
  })
})
