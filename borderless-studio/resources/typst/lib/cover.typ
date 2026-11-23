// Borderless Studio: cover layout.
//
// A cover is one page holding back cover, spine and front cover (and the two
// flaps of a dust jacket). Everything arrives as data in cover.json: sizes in
// inches from the top left corner of the file, colours as ink percentages
// (print) or screen values (ebook cover and previews), and the texts.
//
// Nothing here uses transparency, so the print file can become PDF/X-1a.

#let col(spec, v) = if spec.mode == "cmyk" {
  cmyk(v.at(0) * 1%, v.at(1) * 1%, v.at(2) * 1%, v.at(3) * 1%)
} else {
  rgb(int(v.at(0)), int(v.at(1)), int(v.at(2)))
}
#let black(spec) = if spec.mode == "cmyk" { cmyk(0%, 0%, 0%, 100%) } else { rgb(0, 0, 0) }
#let white(spec) = if spec.mode == "cmyk" { cmyk(0%, 0%, 0%, 0%) } else { rgb(255, 255, 255) }

// Place something with its top left corner at a position given in inches.
#let at(x, y, body) = place(top + left, dx: x * 1in, dy: y * 1in, body)
#let fill-rect(r, c) = at(r.x, r.y, rect(width: r.w * 1in, height: r.h * 1in, fill: c, stroke: none))
#let picture(r, path) = at(r.x, r.y, box(width: r.w * 1in, height: r.h * 1in, clip: true,
  image("/" + path, width: 100%, height: 100%, fit: "cover")))

// Inline formatting of the short texts on a cover.
#let inl(items) = {
  for n in items {
    if n.t == "text" { n.v }
    else if n.t == "em" { emph(inl(n.c)) }
    else if n.t == "strong" { strong(inl(n.c)) }
    else if n.t == "br" { linebreak() }
    else if n.at("c", default: none) != none { inl(n.c) }
  }
}
// The gap is measured from the last baseline to the next line's capitals, so it includes the normal line gap.
#let paragraphs(list, gap: 1.3em) = stack(dir: ttb, spacing: gap, ..list.map(p => block(width: 100%, inl(p))))

// The largest type size (between min and max) at which `make(size)` fits the box.
#let fit(width, height, max, min, make) = context {
  let size = max
  let n = 0
  while size > min and n < 80 {
    let m = measure(width: width, make(size))
    if m.height <= height and m.width <= width + 0.01pt { break }
    size = size * 0.96
    n += 1
  }
  make(size)
}

// The widest single word of a title must fit the line: titles are never hyphenated.
#let title-size(words, font, weight, width, max, min) = {
  let size = max
  let n = 0
  while size > min and n < 80 {
    let widest = calc.max(..words.map(w => measure(text(font: font, weight: weight, size: size, w)).width))
    if widest <= width { break }
    size = size * 0.96
    n += 1
  }
  size
}

#let title-text(spec, s) = {
  let c = spec.fonts.titleCase
  if c == "upper" { text(tracking: 0.04em, upper(s)) }
  else if c == "small-caps" { text(tracking: 0.05em, smallcaps(s)) }
  else { s }
}

// ---- Front cover -------------------------------------------------------

#let front-title-block(spec, width, height, align-to, max-size) = {
  let f = spec.front
  let font = spec.fonts.title
  let weight = if spec.fonts.titleWeight == "bold" { "bold" } else { "regular" }
  let colour = col(spec, spec.colors.text)
  context {
    let cap = title-size(f.title.split(" "), font, weight, width, max-size, 14pt)
    fit(width, height, cap, 12pt, size => block(width: width, {
      set align(align-to)
      set par(leading: 0.28em, justify: false)
      set text(font: font, fill: colour, hyphenate: false, lang: spec.lang)
      text(size: size, weight: weight, title-text(spec, f.title))
      if f.subtitle != "" {
        v(size * 0.42, weak: false)
        text(size: calc.max(9pt, size * 0.36), style: "italic", f.subtitle)
      }
    }))
  }
}

#let front-author(spec, width, size) = block(width: width, {
  set text(font: spec.fonts.title, fill: col(spec, spec.colors.text), size: size, hyphenate: false, tracking: 0.06em)
  upper(spec.front.author)
})

#let front-classic(spec) = {
  let p = spec.panels
  let s = p.safeFront
  let w = s.w * 1in
  let h = s.h * 1in
  let art = spec.art
  let top-art = art.front != none and art.frontMode == "top"
  if art.front != none {
    if top-art {
      // Picture in the upper part, running off the top and outer edges.
      let b = p.frontBleed
      picture((x: b.x, y: b.y, w: b.w, h: (s.y - b.y) + s.h * 0.52), art.front)
    } else {
      picture(p.frontBleed, art.front)
    }
  }
  let title-top = if top-art { 0.58 } else { 0.12 }
  let title-h = if top-art { 0.26 } else { 0.5 }
  at(s.x, s.y + s.h * title-top, box(width: w, height: h * title-h, {
    set align(center + (if top-art { top } else { horizon }))
    front-title-block(spec, w, h * title-h, center, w * 0.19)
  }))
  // A short rule between title and author.
  at(s.x + s.w * 0.4, s.y + s.h * 0.86, line(length: w * 0.2, stroke: 0.8pt + col(spec, spec.colors.accent)))
  at(s.x, s.y + s.h * 0.9, box(width: w, height: h * 0.1, align(center + horizon, front-author(spec, w, calc.max(10pt, w * 0.052)))))
  if spec.front.tagline != "" {
    at(s.x, s.y + s.h * 0.025, box(width: w, align(center, text(font: spec.fonts.title, style: "italic", size: calc.max(8.5pt, w * 0.036), fill: col(spec, spec.colors.text), spec.front.tagline))))
  }
}

#let front-band(spec) = {
  let p = spec.panels
  let s = p.safeFront
  let b = p.frontBleed
  let w = s.w * 1in
  if spec.art.front != none { picture(b, spec.art.front) }
  // The band runs from the spine fold to the outer edge of the file.
  let band-y = s.y + s.h * 0.56
  let band-h = s.h * 0.3
  fill-rect((x: p.front.x, y: band-y, w: (b.x + b.w) - p.front.x, h: band-h), col(spec, spec.colors.band))
  at(s.x, band-y, box(width: w, height: band-h * 1in, inset: (y: band-h * 0.1in), {
    set align(center + horizon)
    front-title-block(spec, w, band-h * 0.8in, center, w * 0.16)
  }))
  at(s.x, s.y + s.h * 0.9, box(width: w, height: s.h * 0.1in, align(center + horizon, front-author(spec, w, calc.max(10pt, w * 0.052)))))
  if spec.front.tagline != "" {
    at(s.x, s.y + s.h * 0.025, box(width: w, align(center, text(font: spec.fonts.title, style: "italic", size: calc.max(8.5pt, w * 0.036), fill: col(spec, spec.colors.text), spec.front.tagline))))
  }
}

#let front-minimal(spec) = {
  let p = spec.panels
  let s = p.safeFront
  let w = s.w * 1in
  let h = s.h * 1in
  if spec.art.front != none { picture(p.frontBleed, spec.art.front) }
  let inset-x = s.w * 0.06
  let tw = w * 0.88
  at(s.x + inset-x, s.y + s.h * 0.1, box(width: tw, {
    set text(font: spec.fonts.title, fill: col(spec, spec.colors.accent), size: calc.max(10pt, w * 0.048), tracking: 0.08em, hyphenate: false)
    upper(spec.front.author)
  }))
  at(s.x + inset-x, s.y + s.h * 0.22, line(length: w * 0.14, stroke: 1.2pt + col(spec, spec.colors.accent)))
  at(s.x + inset-x, s.y + s.h * 0.27, box(width: tw, height: h * 0.55, front-title-block(spec, tw, h * 0.55, left, w * 0.22)))
  if spec.front.tagline != "" {
    at(s.x + inset-x, s.y + s.h * 0.92, box(width: tw, text(font: spec.fonts.title, style: "italic", size: calc.max(8.5pt, w * 0.036), fill: col(spec, spec.colors.text), spec.front.tagline)))
  }
}

#let front(spec) = {
  if spec.layout == "band" { front-band(spec) }
  else if spec.layout == "minimal" { front-minimal(spec) }
  else { front-classic(spec) }
}

// ---- Spine ---------------------------------------------------------------

#let spine(spec) = {
  let sp = spec.spine
  if not sp.textAllowed or spec.panels.safeSpine == none { return }
  let s = spec.panels.safeSpine
  let long = s.h * 1in
  let across = s.w * 1in
  // Capital letters fill about two thirds of the type size; they are centred across the spine.
  let size = calc.min(15pt, across * 1.05)
  if size < 5pt { return }
  let colour = col(spec, spec.colors.backText)
  let cell(body, where) = align(where + horizon, body)
  // Spine text reads from the top of the book to the bottom (the convention for English language books).
  at(s.x, s.y, rotate(90deg, reflow: true, box(width: long, height: across, inset: (x: calc.min(0.2in, long * 0.03)), {
    set text(font: spec.fonts.title, size: size, fill: colour, top-edge: "cap-height", bottom-edge: "baseline", hyphenate: false)
    grid(columns: (1fr, auto, 1fr), column-gutter: size, rows: across,
      cell(text(size: size * 0.8, tracking: 0.05em, upper(sp.author)), left),
      cell(title-text(spec, sp.title), center),
      cell(text(size: size * 0.7, tracking: 0.05em, upper(sp.imprint)), right),
    )
  })))
}

// ---- Back cover ------------------------------------------------------------

#let back(spec) = {
  let p = spec.panels
  let s = p.safeBack
  let b = spec.back
  let colour = col(spec, spec.colors.backText)
  let w = s.w * 1in
  // The text ends above the barcode area (or above the imprint line when there is no barcode).
  let floor = if spec.barcode != none { spec.barcode.box.y - 0.2 } else { s.y + s.h - 0.45 }
  let text-h = calc.max(0.5, floor - s.y) * 1in
  let inset-x = s.w * 0.04
  let tw = w - 2 * inset-x * 1in
  let body(size) = block(width: tw, {
    set text(font: spec.fonts.body, size: size, fill: colour, lang: spec.lang, hyphenate: b.align == "justify")
    set par(leading: 0.62em, justify: b.align == "justify")
    if b.headline != "" {
      block(spacing: 0pt, text(size: size * 1.45, style: "italic", hyphenate: false, b.headline))
      v(size * 1.1, weak: false)
    }
    paragraphs(b.blurb)
    if b.bio.len() > 0 {
      v(size * 1.5, weak: false)
      line(length: tw * 0.12, stroke: 0.6pt + col(spec, spec.colors.accent))
      v(size * 0.9, weak: false)
      set text(size: size * 0.9)
      paragraphs(b.bio)
    }
  })
  if b.blurb.len() > 0 or b.headline != "" or b.bio.len() > 0 {
    at(s.x + inset-x, s.y + s.h * 0.03, box(width: tw, height: text-h, fit(tw, text-h * 0.96, 11.5pt, 7.5pt, body)))
  }
  // Imprint and website at the bottom left, level with the barcode.
  let lines = (b.imprint, b.website).filter(x => x != "")
  if lines.len() > 0 {
    let foot-w = if spec.barcode != none { calc.max(0.6, spec.barcode.box.x - 0.2 - (s.x + inset-x)) * 1in } else { tw }
    // The last line stands level with the bottom of the barcode.
    let foot-bottom = if spec.barcode != none { spec.barcode.box.y + spec.barcode.box.h } else { s.y + s.h - 0.1 }
    at(s.x + inset-x, s.y, box(width: foot-w, height: (foot-bottom - s.y) * 1in, align(bottom + left, {
      set text(font: spec.fonts.body, size: 8.5pt, fill: colour, hyphenate: false)
      set par(leading: 0.5em)
      text(tracking: 0.08em, size: 8pt, upper(b.imprint))
      if b.website != "" { linebreak(); text(size: 7.5pt, b.website) }
    })))
  }
}

// ---- Barcode ---------------------------------------------------------------

#let barcode(spec) = {
  let bc = spec.barcode
  if bc == none { return }
  if bc.placeholder {
    // The platform prints its own barcode here; the area only needs to be free of text and important art.
    return
  }
  fill-rect(bc.box, white(spec))
  for r in bc.bars {
    at(r.at(0), r.at(1), rect(width: r.at(2) * 1in, height: r.at(3) * 1in, fill: black(spec), stroke: none))
  }
  for t in bc.texts {
    let body = text(font: spec.fonts.sans, size: t.s * 1pt, fill: black(spec), top-edge: "cap-height", bottom-edge: "baseline", number-type: "lining", number-width: "tabular", t.t)
    context {
      let m = measure(body)
      let dx = if t.a == "middle" { t.x * 1in - m.width / 2 } else { t.x * 1in }
      place(top + left, dx: dx, dy: t.y * 1in - m.height, body)
    }
  }
}

// ---- Dust jacket flaps -------------------------------------------------------

#let flap(spec, r, paras) = {
  if r == none or paras.len() == 0 { return }
  let w = r.w * 1in
  let h = r.h * 1in
  at(r.x, r.y, box(width: w, height: h, inset: (x: w * 0.08, y: h * 0.04),
    fit(w * 0.84, h * 0.9, 10.5pt, 7.5pt, size => block(width: w * 0.84, {
      set text(font: spec.fonts.body, size: size, fill: col(spec, spec.colors.backText), lang: spec.lang)
      set par(leading: 0.62em, justify: true)
      paragraphs(paras)
    }))))
}

// ---- Guides (previews only, never in an exported file) -------------------------

#let guides(spec) = {
  let p = spec.panels
  let outline(r, stroke) = at(r.x, r.y, rect(width: r.w * 1in, height: r.h * 1in, fill: none, stroke: stroke))
  let shade(r, c) = at(r.x, r.y, rect(width: r.w * 1in, height: r.h * 1in, fill: c, stroke: none))
  let red = rgb(220, 40, 60)
  // Bleed or wrap: everything outside the trim lines is cut off or folded away.
  let t = p.trim
  let a = spec.full
  let H = spec.page.h
  let veil = rgb(220, 40, 60, 38)
  shade((x: a.x, y: a.y, w: a.w, h: t.y - a.y), veil)
  shade((x: a.x, y: t.y + t.h, w: a.w, h: a.y + a.h - t.y - t.h), veil)
  shade((x: a.x, y: t.y, w: t.x - a.x, h: t.h), veil)
  shade((x: t.x + t.w, y: t.y, w: a.x + a.w - t.x - t.w, h: t.h), veil)
  outline(t, 0.7pt + red)
  // On a template sheet, show the edge of the sheet and of the cover area.
  if a.w < spec.page.w - 0.01 or a.h < spec.page.h - 0.01 {
    outline(a, (paint: rgb(120, 120, 120), thickness: 0.5pt, dash: "dotted"))
    outline((x: 0, y: 0, w: spec.page.w, h: spec.page.h), 0.5pt + rgb(170, 170, 170))
  }
  for h in p.hinges { shade(h, rgb(240, 150, 0, 60)) }
  for r in (p.safeBack, p.safeFront, p.safeSpine, p.safeBackFlap, p.safeFrontFlap) {
    if r != none { outline(r, (paint: rgb(0, 150, 90), thickness: 0.6pt, dash: "dashed")) }
  }
  // Fold lines at both sides of the spine, and at the flaps of a jacket.
  let fold(x) = at(x, a.y, line(start: (0pt, 0pt), end: (0pt, a.h * 1in), stroke: (paint: rgb(0, 120, 220), thickness: 0.6pt, dash: "dash-dotted")))
  fold(p.spine.x)
  fold(p.spine.x + p.spine.w)
  if p.backFlap != none { fold(p.backFlap.x + p.backFlap.w); fold(p.back.x) }
  if p.frontFlap != none { fold(p.frontFlap.x); fold(p.front.x + p.front.w) }
  if spec.barcode != none { outline(spec.barcode.box, 0.6pt + rgb(240, 120, 0)) }
}

// ---- The page ------------------------------------------------------------------

#let render-cover(spec) = {
  set document(title: spec.meta.title, author: spec.meta.author)
  set page(width: spec.page.w * 1in, height: spec.page.h * 1in, margin: 0pt, fill: none)
  set text(font: spec.fonts.body, lang: spec.lang, fill: col(spec, spec.colors.text))
  set par(spacing: 0pt)
  let p = spec.panels
  // The cover area: the whole page, or the middle of a platform's template sheet (the rest stays white).
  let full = spec.full
  fill-rect(full, col(spec, spec.colors.background))
  if spec.only == "front" {
    front(spec)
  } else {
    // Back cover, spine and flaps share the second background colour.
    let spine-right = p.spine.x + p.spine.w
    fill-rect((x: full.x, y: full.y, w: spine-right - full.x, h: full.h), col(spec, spec.colors.backBackground))
    if p.frontFlap != none {
      let fx = p.front.x + p.front.w
      fill-rect((x: fx, y: full.y, w: full.x + full.w - fx, h: full.h), col(spec, spec.colors.backBackground))
    }
    if spec.art.wrap != none {
      picture(full, spec.art.wrap)
    }
    if not spec.art.wrapOnly {
      front(spec)
      spine(spec)
      back(spec)
      flap(spec, p.safeFrontFlap, spec.flaps.front)
      flap(spec, p.safeBackFlap, spec.flaps.back)
    }
    barcode(spec)
  }
  if spec.guides { guides(spec) }
}
