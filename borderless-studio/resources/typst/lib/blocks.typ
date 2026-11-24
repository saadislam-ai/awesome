// Borderless Studio: block level rendering (paragraphs, headings, lists,
// quotes, figures, tables, call-outs, verse) and the chapter opening
// paragraph with drop capital and small capital lead-in.

#import "core.typ": *

// Gap that equals one empty line between two lines of text.
#let blank-gap(cfg) = pitch(cfg) + leading(cfg)

// ---------------------------------------------------------------- opening paragraph

// Join words (each word is a list of inline items) with normal spaces.
// The first `sc-count` words are set in small capitals.
#let join-words(cfg, words, rb, sc-count: 0, break-after: none) = {
  for (i, w) in words.enumerate() {
    if i > 0 { [ ] }
    let c = render-inlines(cfg, w, rb: rb)
    if i < sc-count { sc(cfg, c) } else { c }
    if break-after != none and i + 1 == break-after and i + 1 < words.len() { linebreak(justify: true) }
  }
}

// Largest k (0 to words.len()) for which `fits(k)` is true; fits must be monotonic.
#let max-fitting(count, fits) = {
  let lo = 0
  let hi = count
  while lo < hi {
    let mid = calc.ceil((lo + hi) / 2)
    if fits(mid) { lo = mid } else { hi = mid - 1 }
  }
  lo
}

#let opening-par(cfg, b, rb) = {
  let o = b.open
  let words = o.words
  let fixed-sc = o.at("scWords", default: 0)
  let sc-line = o.at("scLine", default: false)
  let cap = o.at("cap", default: none)
  let fs = body-size(cfg)
  let p = pitch(cfg)

  if cap == none {
    if not sc-line {
      par(join-words(cfg, words, rb, sc-count: fixed-sc))
    } else {
      layout(size => {
        // How many small capital words fit on the first line.
        let k = max-fitting(words.len(), k => measure(block(width: size.width,
          par(first-line-indent: 0pt, justify: false, join-words(cfg, words.slice(0, k), none, sc-count: k)))).height <= fs + 0.5pt)
        par(first-line-indent: 0pt, join-words(cfg, words, rb, sc-count: k, break-after: if k > 0 and k < words.len() { k } else { none }))
      })
    }
    return
  }

  // Drop capital: the letter spans `n` lines, the first lines of the
  // paragraph run beside it, and the rest continues at full width.
  let n = o.at("capLines", default: 3)
  layout(size => {
    let cap-target = (n - 1) * p + cfg.capHeightEm * fs
    let cap-size = cap-target / cfg.headingCapHeightEm
    let cap-box = text(font: cfg.fonts.heading, size: cap-size, top-edge: "cap-height", bottom-edge: "baseline",
      number-type: "lining", hyphenate: false, cap)
    let cap-w = measure(cap-box).width
    let gap = 0.14 * fs
    let side = size.width - cap-w - gap
    // Letters such as J and Q hang below the baseline. Give them one more
    // indented line so the tail never collides with the text underneath.
    let full = measure(text(font: cfg.fonts.heading, size: cap-size, top-edge: "cap-height", bottom-edge: "bounds", cap)).height
    let hangs = full - measure(cap-box).height > 0.06 * cap-size
    let side-lines = if hangs { n + 1 } else { n }
    let side-height = lines-height(cfg, side-lines)
    let k1 = if sc-line {
      max-fitting(words.len(), k => measure(block(width: side,
        par(first-line-indent: 0pt, justify: false, join-words(cfg, words.slice(0, k), none, sc-count: k)))).height <= fs + 0.5pt)
    } else { fixed-sc }
    let brk = if sc-line and k1 > 0 { k1 } else { none }
    let first-part(k) = par(first-line-indent: 0pt,
      join-words(cfg, words.slice(0, k), none, sc-count: k1, break-after: if brk != none and brk < k { brk } else { none }))
    let k = max-fitting(words.len(), k => measure(block(width: side, first-part(k))).height <= side-height + 0.5pt)
    let has-rest = k < words.len()
    block(width: 100%, height: side-height, breakable: false, {
      place(top + left, dy: (0.8 - cfg.capHeightEm) * fs, cap-box)
      place(top + left, dx: cap-w + gap, block(width: side, par(first-line-indent: 0pt, {
        join-words(cfg, words.slice(0, k), rb, sc-count: k1, break-after: if brk != none and brk < k { brk } else { none })
        if has-rest { linebreak(justify: true) }
      })))
    })
    if has-rest {
      par(first-line-indent: 0pt, join-words(cfg, words.slice(k), rb))
    }
  })
}

// ---------------------------------------------------------------- headings inside chapters

#let section-heading(cfg, b, rb) = {
  let d = cfg.design
  let lvl = b.level
  let size = d.headingSizesPt.at(lvl - 1) * 1pt
  let body = render-inlines(cfg, b.c, rb: rb)
  let style = d.headingStyle
  let styled = {
    set par(justify: false, first-line-indent: 0pt, leading: 0.5em)
    set text(size: size, hyphenate: false, number-type: "lining")
    if style == "sans-bold" { text(font: cfg.fonts.sans, weight: if lvl == 3 { "semibold" } else { "bold" }, body) }
    else if style == "serif-bold" { text(font: cfg.fonts.heading, weight: "bold", body) }
    else if style == "smallcaps" { text(font: cfg.fonts.heading, tracking: 0.04em, sc(cfg, body, which: "heading")) }
    else { text(font: cfg.fonts.heading, style: "italic", body) }
  }
  if cfg.bookmarks {
    place(hide(heading(level: lvl + 1, outlined: false, bookmarked: true, numbering: none, inline-text(b.c))))
  }
  // One empty line above, then the heading on whole lines, kept with the text that follows.
  v(pitch(cfg), weak: true)
  on-grid(cfg, styled, valign: bottom, sticky: true, min-lines: if lvl == 1 { 2 } else { 1 })
}

// ---------------------------------------------------------------- figures

#let figure-block(cfg, b, rb) = {
  let w = b.at("width", default: none)
  let width = if w == none { 100% } else { w * 100% }
  let cap = b.at("caption", default: none)
  let alt = b.at("alt", default: none)
  if b.at("bleed", default: none) == "page" {
    // Full page picture, edge to edge. Needs a format with bleed switched on.
    let bl = cfg.page.bleedPt * 1pt
    page(margin: 0pt, header: none, footer: none, {
      [#metadata("quiet") <bs-quiet>]
      place(top + left, dx: -bl, dy: -bl,
        image("/" + b.src, width: cfg.page.widthPt * 1pt + 2 * bl, height: cfg.page.heightPt * 1pt + 2 * bl, fit: "cover", alt: alt))
    })
    return
  }
  let content = {
    set align(center)
    image("/" + b.src, width: width, alt: alt)
    if cap != none {
      v(0.5 * leading(cfg), weak: true)
      set par(justify: false, first-line-indent: 0pt, leading: 0.5em)
      text(size: 0.86em, style: "italic", render-inlines(cfg, cap, rb: rb))
    }
  }
  v(pitch(cfg), weak: true)
  on-grid(cfg, content, valign: horizon)
  v(pitch(cfg), weak: true)
}

// ---------------------------------------------------------------- tables

#let table-block(cfg, b, rb) = {
  let cols = calc.max(b.head.len(), ..b.rows.map(r => r.len()), 1)
  let aligns = range(cols).map(i => {
    let a = b.align.at(i, default: none)
    if a == "center" { center } else if a == "right" { end } else { start }
  })
  let cell(c) = render-inlines(cfg, c, rb: rb)
  let pad(row) = row + range(cols - row.len()).map(_ => ())
  let content = {
    set text(size: 0.88em, number-type: "lining", number-width: "tabular", hyphenate: false)
    set par(justify: false, first-line-indent: 0pt, leading: 0.45em)
    table(
      columns: range(cols).map(_ => auto),
      align: (x, y) => aligns.at(x) + horizon,
      stroke: none,
      inset: (x: 0.6em, y: 0.42em),
      table.hline(stroke: 0.8pt + ink),
      table.header(..pad(b.head).map(c => text(font: cfg.fonts.sans, weight: "semibold", size: 0.95em, cell(c)))),
      table.hline(stroke: 0.4pt + ink),
      ..b.rows.map(r => pad(r).map(cell)).flatten(),
      table.hline(stroke: 0.8pt + ink),
    )
  }
  let cap = b.at("caption", default: none)
  v(pitch(cfg), weak: true)
  on-grid(cfg, align(center, {
    content
    if cap != none { v(0.3em); text(size: 0.86em, style: "italic", render-inlines(cfg, cap, rb: rb)) }
  }))
  v(pitch(cfg), weak: true)
}

// ---------------------------------------------------------------- call-out boxes

#let callout-block(cfg, b, rb) = {
  let title = b.at("title", default: none)
  let kind = b.at("kind", default: "callout")
  let label = if title != none { render-inlines(cfg, title, rb: rb) } else if kind != "callout" { upper(kind.slice(0, 1)) + kind.slice(1) } else { none }
  let content = block(
    width: 100%,
    inset: (x: 1em, top: 0.75em, bottom: 0.8em),
    fill: tint(7%),
    stroke: (left: 2.2pt + ink),
    {
      if label != none {
        block(below: 0.55em, text(font: cfg.fonts.sans, weight: "bold", size: 0.86em, tracking: 0.03em, label))
      }
      set text(size: 0.94em)
      set par(first-line-indent: 0pt, spacing: 0.75em, leading: 0.52em)
      rb(cfg, b.c, ctx: (in-box: true))
    },
  )
  v(pitch(cfg), weak: true)
  on-grid(cfg, content)
  v(pitch(cfg), weak: true)
}

// ---------------------------------------------------------------- endnotes list

#let notes-block(cfg, b, rb) = {
  set text(size: 0.88em)
  set par(first-line-indent: 0pt, leading: 0.5em, spacing: 0.6em, justify: cfg.design.justify)
  let title = b.at("title", default: none)
  if title != none {
    block(above: blank-gap(cfg), below: 0.8em, sticky: true, text(style: "italic", size: 1.1em, title))
  }
  for item in b.items {
    grid(columns: (2.1em, 1fr), column-gutter: 0.3em, row-gutter: 0pt,
      align(end, fmt-number(cfg, item.n) + "."),
      rb(cfg, item.c, ctx: (in-note: true)),
    )
    v(0.55em, weak: true)
  }
}

// ---------------------------------------------------------------- all blocks

#let render-blocks(cfg, blocks, ctx: (:)) = {
  let in-note = ctx.at("in-note", default: false)
  let in-box = ctx.at("in-box", default: false)
  let plain = in-note or in-box
  let d = cfg.design
  // Indentation is decided here, not by Typst: a paragraph is indented only
  // when it directly follows another paragraph of running text.
  let indent = if d.paragraphStyle == "spaced" or plain { 0pt } else { d.paragraphIndentEm * 1em }
  let prev = none
  for b in blocks {
    let t = b.t
    if t == "p" {
      if in-note {
        // Notes flow inline after the note number.
        if prev == "p" { parbreak() }
        render-inlines(cfg, b.c, rb: none)
      } else if "open" in b and not plain {
        opening-par(cfg, b, render-blocks)
      } else if prev == "p" and indent != 0pt {
        par(first-line-indent: (amount: indent, all: true), render-inlines(cfg, b.c, rb: render-blocks))
      } else {
        par(render-inlines(cfg, b.c, rb: render-blocks))
      }
      prev = "p"
      continue
    }
    prev = t
    if t == "h" {
      section-heading(cfg, b, render-blocks)
    } else if t == "scenebreak" {
      let style = d.sceneBreak.style
      let n = d.sceneBreak.lines
      if style == "space" {
        block(width: 100%, height: lines-height(cfg, n), breakable: false)
      } else {
        // Asterisks sit high in their line box, so nudge them down to look centred.
        let dy = if style in ("asterisks", "three-stars", "asterism") { 0.22em } else { 0pt }
        block(width: 100%, height: lines-height(cfg, n + 1), breakable: false,
          align(center + horizon, move(dy: dy, ornament(cfg, style))))
      }
    } else if t == "quote" {
      block(width: 100%, above: blank-gap(cfg), below: blank-gap(cfg), inset: (left: 1.6em, right: 1.6em),
        render-blocks(cfg, b.c, ctx: ctx))
    } else if t == "list" {
      let items = b.items.map(it => render-blocks(cfg, it, ctx: (in-box: true)))
      block(width: 100%, above: if plain { 0.6em } else { blank-gap(cfg) }, below: if plain { 0.6em } else { blank-gap(cfg) }, {
        set par(first-line-indent: 0pt)
        if b.ordered {
          enum(start: b.start, tight: true, spacing: leading(cfg), indent: 0.6em, body-indent: 0.6em,
            numbering: n => fmt-number(cfg, n) + ".", ..items)
        } else {
          list(tight: true, spacing: leading(cfg), indent: 0.6em, body-indent: 0.6em, marker: ([•], [◦]), ..items)
        }
      })
    } else if t == "table" {
      table-block(cfg, b, render-blocks)
    } else if t == "figure" {
      figure-block(cfg, b, render-blocks)
    } else if t == "callout" {
      callout-block(cfg, b, render-blocks)
    } else if t == "verse" {
      block(width: 100%, above: if plain { 0.6em } else { blank-gap(cfg) }, below: if plain { 0.6em } else { blank-gap(cfg) },
        inset: (left: if d.template == "poetry" { 0pt } else { 1.6em }), {
        set par(justify: false, first-line-indent: 0pt, hanging-indent: 2em)
        for (si, st) in b.stanzas.enumerate() {
          block(width: 100%, breakable: st.len() > 8, above: if si == 0 { 0pt } else { blank-gap(cfg) }, below: 0pt, {
            for (i, ln) in st.enumerate() {
              par(render-inlines(cfg, ln, rb: render-blocks))
            }
          })
        }
      })
    } else if t == "align" {
      block(width: 100%, above: blank-gap(cfg), below: blank-gap(cfg), {
        set align(if b.align == "right" { end } else { center })
        set par(first-line-indent: 0pt, justify: false)
        render-blocks(cfg, b.c, ctx: ctx)
      })
    } else if t == "code" {
      block(width: 100%, above: blank-gap(cfg), below: blank-gap(cfg),
        text(font: cfg.fonts.mono, size: 0.8em, hyphenate: false, raw(b.v, block: true)))
    } else if t == "notes" {
      notes-block(cfg, b, render-blocks)
    } else if t == "pagebreak" {
      pagebreak(weak: true)
    }
  }
}
