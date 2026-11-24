// Borderless Studio: page furniture. Running heads, page numbers, and the
// logic that keeps them off chapter opening pages, blank pages, and the
// display pages at the front of the book.

#import "core.typ": *

// "front" pages are numbered i, ii, iii; "body" and "back" pages 1, 2, 3.
#let st-zone = state("bs-zone", "front")
// Title shown in the running head for the current chapter or section.
#let st-section = state("bs-section", "")
#let st-part = state("bs-part", "")

// Every section drops a marker on its first and last page. A page that lies
// between the end of one section and the start of the next is a blank page
// (they appear when a chapter is forced to start on a right hand page).
//
// Returns: (blank, first, style) where style is "opener", "quiet" or "plain".
#let page-info(p) = {
  let starts = query(<bs-sec-start>)
  let ends = query(<bs-sec-end>)
  let quiet = query(<bs-quiet>).filter(m => m.location().page() == p).len() > 0
  let found = none
  for (i, s) in starts.enumerate() {
    let sp = s.location().page()
    if sp > p { break }
    let ep = if i < ends.len() { ends.at(i).location().page() } else { sp }
    if p <= ep { found = (first: sp == p, style: s.value.style) }
  }
  if found == none { (blank: true, first: false, style: "quiet", quiet: true) }
  else { (blank: false, first: found.first, style: found.style, quiet: quiet) }
}

#let folio-text(cfg, zone) = {
  let n = counter(page).get().first()
  text(size: cfg.design.folio.sizePt * 1pt, number-type: "lining",
    fmt-number(cfg, n, style: if zone == "front" { "roman" } else { "arabic" }))
}

#let head-style(cfg, s) = {
  let rh = cfg.design.runningHeads
  let size = rh.sizePt * 1pt
  let track = rh.trackingMilliEm / 1000 * 1em
  set text(size: size, hyphenate: false, number-type: "lining")
  if rh.style == "smallcaps" {
    if cfg.fontCaps.body.smcp { text(tracking: track, smallcaps(all: true, s)) }
    else { text(size: 0.84em, tracking: track + 0.02em, upper(s)) }
  } else if rh.style == "caps" {
    text(font: cfg.fonts.at(if cfg.design.headingStyle == "sans-bold" { "sans" } else { "body" }), tracking: track, upper(s))
  } else if rh.style == "italic" {
    emph(s)
  } else { s }
}

#let running-head(cfg) = context {
  let d = cfg.design
  let rh = d.runningHeads
  let p = here().page()
  let info = page-info(p)
  if info.blank or info.quiet { return none }
  if info.first and info.style != "plain" { return none }
  if info.style == "quiet" { return none }
  let folio-top = d.folio.position == "top-outside"
  if not rh.enabled and not folio-top { return none }
  let verso = calc.even(p)
  let which = if verso { rh.verso } else { rh.recto }
  let fallback(v) = if v == "" { cfg.meta.title } else { v }
  let raw = if not rh.enabled { none }
    else if which == "author" { cfg.meta.author }
    else if which == "title" { cfg.meta.title }
    else if which == "part" { fallback(st-part.get()) }
    else if which == "chapter" { fallback(st-section.get()) }
    else { none }
  let head = if raw == none or raw == "" { none } else { head-style(cfg, raw) }
  let folio = if folio-top { folio-text(cfg, st-zone.get()) } else { none }
  // Left-hand pages are even in a left-to-right book and odd in a right-to-left one.
  // In both, the outer edge of an even page is where its lines start.
  set par(first-line-indent: 0pt, justify: false)
  set text(dir: book-dir(cfg))
  let line-content = if rh.align == "outside" {
    let gap = h(1.1em)
    if verso { align(start, { folio; if folio != none and head != none { gap }; head }) }
    else { align(end, { head; if folio != none and head != none { gap }; folio }) }
  } else {
    // Centred head, page number (if it lives at the top) on the outer edge.
    grid(columns: (1fr, auto, 1fr), align: (start, center, end),
      if verso { folio }, head, if not verso { folio })
  }
  if rh.rule {
    stack(dir: ttb, spacing: 0.35em, line-content, line(length: 100%, stroke: 0.4pt + ink))
  } else {
    line-content
  }
}

#let running-foot(cfg) = context {
  let d = cfg.design
  let p = here().page()
  let info = page-info(p)
  if info.blank or info.quiet or info.style == "quiet" { return none }
  let pos = d.folio.position
  if pos == "none" { return none }
  let folio = folio-text(cfg, st-zone.get())
  set text(dir: book-dir(cfg))
  if info.first and info.style == "opener" {
    // Drop folio on chapter opening pages.
    if d.folio.showOnOpeners { align(center, folio) } else { none }
  } else if pos == "bottom-center" {
    align(center, folio)
  } else if pos == "bottom-outside" {
    align(if calc.even(p) { start } else { end }, folio)
  } else {
    none
  }
}

// Start a new section on a fresh page. `recto` forces a right hand page.
// `style`: "opener" (no running head, drop folio), "quiet" (nothing at all,
// for title pages), "plain" (normal head and folio from the first page).
#let begin-section(cfg, sec, style: "opener", recto: false) = {
  pagebreak(weak: true, to: if recto { "odd" } else { none })
  [#metadata((id: sec.id, kind: sec.kind, style: style)) <bs-sec-start>]
}

#let end-section() = [#metadata(none) <bs-sec-end>]
