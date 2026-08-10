export type Lang = "en" | "tr"

const strings = {
  en: {
    all_up: "All systems operational",
    some_down: "Some systems are having trouble",
    all_down: "Major outage",
    up: "up",
    down: "down",
    recovered: "recovered",
    after: "after",
    uptime: "uptime",
    no_data: "no data yet",
    updated: "Updated",
    days: "days",
    recent_events: "Recent events",
    last_day: "latency, last 24h",
  },
  tr: {
    all_up: "Tüm sistemler çalışıyor",
    some_down: "Bazı sistemlerde sorun var",
    all_down: "Büyük kesinti",
    up: "ayakta",
    down: "yanıt vermiyor",
    recovered: "toparlandı",
    after: "süre:",
    uptime: "erişilebilirlik",
    no_data: "henüz veri yok",
    updated: "Güncellendi",
    days: "gün",
    recent_events: "Son olaylar",
    last_day: "gecikme, son 24 saat",
  },
} as const

export type Key = keyof (typeof strings)["en"]

export function t(lang: Lang, key: Key): string {
  return strings[lang][key]
}

export function langOf(value: string | undefined): Lang {
  return value === "tr" ? "tr" : "en"
}
