// Borderless Studio: one renderer per kind of section (title page, copyright
// page, contents, chapters, parts, index and so on).

#import "core.typ": *
#import "blocks.typ": *
#import "page.typ": *

// Marker that the table of contents collects.
#let toc-mark(sec, level: 1) = {
  if sec.at("toc", default: true) {
    [#metadata((title: sec.at("title", default: ""), label: sec.at("tocLabel", default: none), level: level, kind: sec.kind)) <bs-toc>]
  }
}

// Switch from roman to arabic page numbers at the first page of the body.
#let enter-zone(sec) = {
  let zone = sec.at("zone", default: "body")
  if sec.at("firstOfZone", default: false) and zone == "body" {
    counter(page).update(1)
  }
  st-zone.update(zone)
}

#let bookmark(cfg, title, level: 1) = {
  if cfg.bookmarks and title != none and title != "" {
    place(hide(heading(level: level, outlined: false, bookmarked: true, numbering: none, title)))
  }
}

// Space measured as a share of the text block height, snapped to whole lines.
#let sink(cfg, share) = {
  let n = calc.round(share * cfg.textHeightPt / cfg.pitchPt)
  if n > 0 { v(n * pitch(cfg)) }
}

// ---------------------------------------------------------------- display pages

#let half-title(cfg, sec) = {
  begin-section(cfg, sec, style: "quiet", recto: true)
  enter-zone(sec)
  sink(cfg, 0.26)
  set align(center)
  set par(justify: false, first-line-indent: 0pt, leading: 0.6em)
  text(font: cfg.fonts.heading, size: 15pt, tracking: 0.06em, hyphenate: false, sc(cfg, sec.data.title, which: "heading"))
  end-section()
}

#let title-page(cfg, sec) = {
  let d = sec.data
  begin-section(cfg, sec, style: "quiet", recto: true)
  enter-zone(sec)
  bookmark(cfg, d.title)
  set align(center)
  set par(justify: false, first-line-indent: 0pt, leading: 0.5em)
  set text(font: cfg.fonts.heading, hyphenate: false, number-type: "lining")
  sink(cfg, 0.14)
  block(width: 88%, text(size: d.at("titleSizePt", default: 30) * 1pt, d.title))
  if d.at("subtitle", default: "") != "" {
    v(1.1em)
    block(width: 80%, text(size: 13.5pt, style: "italic", d.subtitle))
  }
  if d.at("series", default: "") != "" {
    v(0.9em)
    text(size: 10.5pt, tracking: 0.05em, sc(cfg, d.series, which: "heading"))
  }
  v(3.2em)
  text(size: 15pt, d.author)
  for line in d.at("contributors", default: ()) {
    v(0.5em)
    text(size: 10.5pt, style: "italic", line)
  }
  v(1fr)
  if d.at("logo", default: none) != none {
    image("/" + d.logo, height: 0.55in)
    v(0.5em)
  }
  text(size: 10.5pt, tracking: 0.08em, sc(cfg, d.imprint, which: "heading"))
  if d.at("imprintPlace", default: "") != "" {
    v(0.35em)
    text(size: 9pt, d.imprintPlace)
  }
  end-section()
}

#let copyright-page(cfg, sec) = {
  // Back of the title page, set small at the foot of the page.
  begin-section(cfg, sec, style: "quiet")
  enter-zone(sec)
  v(1fr)
  set text(size: 0.8em, number-type: "lining", hyphenate: false)
  set par(justify: false, first-line-indent: 0pt, leading: 0.5em, spacing: 0.85em)
  render-blocks(cfg, sec.blocks, ctx: (in-box: true))
  end-section()
}

#let dedication(cfg, sec) = {
  begin-section(cfg, sec, style: "quiet", recto: true)
  enter-zone(sec)
  sink(cfg, 0.24)
  set align(center)
  set par(justify: false, first-line-indent: 0pt, spacing: 0.9em)
  block(width: 78%, emph(render-blocks(cfg, sec.blocks, ctx: (in-box: true))))
  end-section()
}

#let epigraph(cfg, sec) = {
  begin-section(cfg, sec, style: "quiet", recto: true)
  enter-zone(sec)
  sink(cfg, 0.22)
  let d = sec.at("data", default: (:))
  align(center, block(width: 74%, {
    set align(start)
    set par(justify: false, first-line-indent: 0pt, spacing: 0.9em)
    emph(render-blocks(cfg, sec.blocks, ctx: (in-box: true)))
    if d.at("source", default: "") != "" {
      v(0.7em)
      align(end, text(size: 0.92em, d.source))
    }
  }))
  end-section()
}

// ---------------------------------------------------------------- chapter style opener

#let opener-heading(cfg, sec) = {
  let op = cfg.design.chapterOpener
  let label = sec.at("label", default: none)
  let title = sec.at("title", default: "")
  let subtitle = sec.at("subtitle", default: "")
  let al = if op.align == "left" { start } else if op.align == "right" { end } else { center }
  let content = {
    set align(al)
    set par(justify: false, first-line-indent: 0pt, leading: 0.5em, spacing: 0pt)
    set text(font: cfg.fonts.heading, hyphenate: false, number-type: "lining")
    if label != none and label != "" {
      let lt = text(size: op.numberSizePt * 1pt, tracking: if op.numberCase == "as-is" { 0pt } else { 0.08em },
        if op.numberCase == "smallcaps" { sc(cfg, label, which: "heading") } else { label })
      block(below: if title != "" { calc.max(9pt, op.titleSizePt * 0.55pt) } else { 0pt }, lt)
    }
    if title != "" {
      let weight = if op.titleStyle == "bold" { "bold" } else { "regular" }
      let style = if op.titleStyle == "italic" { "italic" } else { "normal" }
      let body = if op.titleStyle == "smallcaps" { text(tracking: 0.05em, sc(cfg, title, which: "heading")) }
        else if op.titleStyle == "caps" { text(tracking: 0.06em, upper(title)) }
        else { title }
      block(text(size: op.titleSizePt * 1pt, weight: weight, style: style, body))
    }
    if subtitle != "" {
      block(above: 0.75em, text(size: calc.max(10pt, op.titleSizePt * 0.6pt), style: "italic", subtitle))
    }
    if op.ornament != "none" {
      block(above: 1.1em, width: if op.ornament == "rule" { 100% } else { auto }, ornament(cfg, op.ornament))
    }
  }
  sink(cfg, op.sink)
  on-grid(cfg, content, valign: top, sticky: true)
  if op.spaceAfterLines > 0 { v(op.spaceAfterLines * pitch(cfg)) }
}

// Chapters and every other section that is ordinary running text.
#let text-section(cfg, sec) = {
  let op = cfg.design.chapterOpener
  begin-section(cfg, sec, style: "opener", recto: sec.at("recto", default: false))
  enter-zone(sec)
  st-section.update(sec.at("head", default: sec.at("title", default: "")))
  counter(footnote).update(0)
  toc-mark(sec)
  bookmark(cfg, {
    let l = sec.at("label", default: none)
    let t = sec.at("title", default: "")
    if l != none and l != "" and t != "" { l + ": " + t } else if t != "" { t } else { l }
  })
  if sec.at("showHeading", default: true) { opener-heading(cfg, sec) }
  render-blocks(cfg, sec.blocks)
  end-section()
}

#let part-page(cfg, sec) = {
  begin-section(cfg, sec, style: "quiet", recto: true)
  enter-zone(sec)
  st-part.update(sec.at("head", default: sec.at("title", default: "")))
  toc-mark(sec, level: 0)
  bookmark(cfg, sec.at("title", default: sec.at("label", default: "")))
  sink(cfg, 0.28)
  set align(center)
  set par(justify: false, first-line-indent: 0pt)
  set text(font: cfg.fonts.heading, hyphenate: false, number-type: "lining")
  let label = sec.at("label", default: none)
  if label != none and label != "" {
    text(size: 12pt, tracking: 0.1em, sc(cfg, label, which: "heading"))
    v(1.2em)
  }
  if sec.at("title", default: "") != "" {
    block(width: 85%, text(size: 24pt, sec.title))
  }
  if sec.at("blocks", default: ()).len() > 0 {
    v(2em)
    block(width: 75%, { set text(font: cfg.fonts.body.first()); emph(render-blocks(cfg, sec.blocks, ctx: (in-box: true))) })
  }
  end-section()
}

// ---------------------------------------------------------------- contents

#let contents(cfg, sec) = {
  begin-section(cfg, sec, style: "opener", recto: true)
  enter-zone(sec)
  st-section.update(sec.title)
  bookmark(cfg, sec.title)
  opener-heading(cfg, sec + (label: none, subtitle: ""))
  let depth = cfg.design.toc.depth
  let leaders = cfg.design.toc.leaders
  context {
    set par(first-line-indent: 0pt, justify: false, leading: leading(cfg))
    set text(number-type: "lining")
    let items = query(<bs-toc>).filter(m => m.value.level <= depth)
    for m in items {
      let v = m.value
      let loc = m.location()
      let zone = st-zone.at(loc)
      let n = counter(page).at(loc).first()
      let num = fmt-number(cfg, n, style: if zone == "front" { "roman" } else { "arabic" })
      let title = if v.label != none and v.label != "" and v.title != "" { v.label + h(0.9em) + v.title }
        else if v.title != "" { v.title } else { v.label }
      if v.level == 0 {
        // Part line: small capitals, with room above, no page number.
        block(above: blank-gap(cfg), below: leading(cfg), sticky: true,
          text(tracking: 0.06em, sc(cfg, title)))
      } else {
        let indent = (v.level - 1) * 1.4em
        block(above: leading(cfg), below: leading(cfg), breakable: false, grid(
          columns: (indent, 1fr, auto), column-gutter: 0pt,
          [],
          {
            if v.level > 1 { set text(size: 0.94em) }
            title
            if leaders { box(width: 1fr, inset: (x: 0.4em), repeat(gap: 0.35em, text(size: 0.8em, "."))) } else { h(1fr) }
          },
          align(bottom, box(width: 2.2em, align(end, num))),
        ))
      }
    }
  }
  end-section()
}

// ---------------------------------------------------------------- also by

#let also-by(cfg, sec) = {
  begin-section(cfg, sec, style: "quiet", recto: sec.at("recto", default: false))
  enter-zone(sec)
  sink(cfg, 0.16)
  set align(center)
  set par(justify: false, first-line-indent: 0pt, spacing: 0.75em)
  text(size: 11pt, tracking: 0.08em, sc(cfg, sec.title, which: "heading"))
  v(1.4em)
  for g in sec.data.groups {
    if g.at("label", default: "") != "" {
      v(0.9em)
      text(size: 0.9em, tracking: 0.05em, sc(cfg, g.label))
      v(0.3em)
    }
    for t in g.titles { block(emph(t)) }
  }
  end-section()
}

// ---------------------------------------------------------------- index

// Collapse a sorted list of page numbers into "3, 7-9, 12".
#let page-list(cfg, pages, range-mark) = {
  let out = ()
  let i = 0
  while i < pages.len() {
    let start = pages.at(i)
    let j = i
    while j + 1 < pages.len() and pages.at(j + 1) == pages.at(j) + 1 { j += 1 }
    let end = pages.at(j)
    if end == start { out.push(fmt-number(cfg, start)) }
    else if end == start + 1 { out.push(fmt-number(cfg, start)); out.push(fmt-number(cfg, end)) }
    else { out.push(fmt-number(cfg, start) + range-mark + fmt-number(cfg, end)) }
    i = j + 1
  }
  out.join(", ")
}

#let index-section(cfg, sec) = {
  begin-section(cfg, sec, style: "opener", recto: sec.at("recto", default: false))
  enter-zone(sec)
  st-section.update(sec.title)
  toc-mark(sec)
  bookmark(cfg, sec.title)
  opener-heading(cfg, sec + (label: none, subtitle: ""))
  context {
    let marks = query(<bs-idx>)
    // term -> (pages, subs: sub -> pages). Only body and back matter pages are indexed.
    let entries = (:)
    for m in marks {
      let loc = m.location()
      if st-zone.at(loc) == "front" { continue }
      let n = counter(page).at(loc).first()
      let term = m.value.term
      let sub = m.value.sub
      let e = entries.at(term, default: (pages: (), subs: (:)))
      if sub == none {
        if not e.pages.contains(n) { e.pages.push(n) }
      } else {
        let sp = e.subs.at(sub, default: ())
        if not sp.contains(n) { sp.push(n) }
        e.subs.insert(sub, sp)
      }
      entries.insert(term, e)
    }
    let terms = entries.keys().sorted(key: k => lower(k))
    set text(size: 0.88em, number-type: "lining")
    set par(first-line-indent: 0pt, hanging-indent: 1.2em, justify: false, leading: 0.5em, spacing: 0.5em)
    columns(2, gutter: 1.6em, {
      let last-initial = ""
      for term in terms {
        let e = entries.at(term)
        let initial = upper(term.clusters().first())
        if initial != last-initial and last-initial != "" { v(0.8em, weak: true) }
        last-initial = initial
        par({
          term
          if e.pages.len() > 0 { ", " + page-list(cfg, e.pages.sorted(), sec.data.rangeMark) }
        })
        for sub in e.subs.keys().sorted(key: k => lower(k)) {
          par(hanging-indent: 2.4em, h(1.2em) + sub + ", " + page-list(cfg, e.subs.at(sub).sorted(), sec.data.rangeMark))
        }
      }
    })
  }
  end-section()
}

// ---------------------------------------------------------------- dispatcher

#let render-section(cfg, sec) = {
  let k = sec.kind
  if k == "half-title" { half-title(cfg, sec) }
  else if k == "title-page" { title-page(cfg, sec) }
  else if k == "copyright" { copyright-page(cfg, sec) }
  else if k == "dedication" { dedication(cfg, sec) }
  else if k == "epigraph" { epigraph(cfg, sec) }
  else if k == "toc" { contents(cfg, sec) }
  else if k == "part" { part-page(cfg, sec) }
  else if k == "also-by" { also-by(cfg, sec) }
  else if k == "index" { index-section(cfg, sec) }
  else { text-section(cfg, sec) }
}
