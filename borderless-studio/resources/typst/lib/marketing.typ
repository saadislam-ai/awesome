// Borderless Studio: marketing pieces.
//
// render-sheet: a one page sheet about the book for bookshops, libraries and
// reviewers. render-card: a picture with a quotation, for social media.
// Every text, colour and size arrives as data; nothing here belongs to one
// particular book.

#let grey = rgb("#5f5f5f")

#let render-sheet(d) = {
  set page(paper: d.paper, margin: (x: 18mm, top: 16mm, bottom: 18mm))
  set text(font: d.fonts, size: 10.5pt, lang: d.lang, fill: rgb("#1c1c1c"))
  set par(leading: 0.62em, justify: false, spacing: 0.9em)
  let accent = rgb(d.accent)
  let head(t) = { text(size: 8.5pt, tracking: 0.09em, weight: "bold", fill: accent, upper(t)); v(-1.5mm) }
  let top = {
    text(size: 8.5pt, tracking: 0.09em, fill: accent, weight: "bold", upper(d.kicker))
    v(1mm)
    text(size: 25pt, weight: "bold", d.title)
    if d.subtitle != "" { v(-3mm); text(size: 13pt, style: "italic", d.subtitle) }
    v(-2mm)
    text(size: 13pt, d.author)
    v(2mm)
    for p in d.description { par(p) }
  }
  if d.cover != none {
    grid(columns: (58mm, 1fr), column-gutter: 9mm, image("/" + d.cover, width: 58mm), top)
  } else { top }
  v(4mm)
  line(length: 100%, stroke: 0.7pt + accent)
  v(2mm)
  grid(columns: (1fr, 1fr), column-gutter: 10mm,
    {
      head(d.labels.details)
      grid(columns: (auto, 1fr), column-gutter: 4mm, row-gutter: 2.4mm,
        ..d.details.map(r => (text(fill: grey, r.at(0)), r.at(1))).flatten())
      if d.quote != "" {
        v(4mm)
        block(inset: (left: 4mm), stroke: (left: 1.5pt + accent), text(style: "italic", d.quote))
      }
    },
    {
      if d.bio != "" { head(d.labels.author); par(d.bio); v(2mm) }
      head(d.labels.order)
      for l in d.order { par(l) }
    },
  )
  if d.editions.len() > 0 {
    v(4mm)
    head(d.labels.editions)
    v(1mm)
    table(columns: (1.5fr, 1.7fr, 1.1fr, 0.7fr, 1fr), inset: (x: 2pt, y: 3.4pt),
      stroke: (x, y) => if y == 0 { (bottom: 0.5pt + grey) } else { (bottom: 0.25pt + rgb("#cfcfcf")) },
      ..d.edition-head.map(h => text(size: 8.5pt, fill: grey, h)),
      ..d.editions.map(e => (e.name, e.isbn, e.size, e.pages, e.price)).flatten())
  }
  place(bottom + left, dy: 9mm, text(size: 8.5pt, fill: grey, d.footer))
}

#let render-card(d) = {
  set page(width: d.width * 1pt, height: d.height * 1pt, margin: 0pt, fill: rgb(d.background))
  set text(font: d.fonts, fill: rgb(d.text), lang: d.lang)
  let side = calc.min(d.width, d.height) * 1pt
  let pad = side * 0.09
  // The longer the quotation, the smaller it is set, so it always fits the picture.
  let size = if d.chars < 70 { side * 0.078 } else if d.chars < 140 { side * 0.062 } else if d.chars < 230 { side * 0.05 } else { side * 0.041 }
  let foot = side * 0.2
  place(top + left, dx: pad, dy: pad * 0.55, text(size: side * 0.2, weight: "bold", fill: rgb(d.accent), d.mark))
  place(top + left, dx: pad, dy: pad + side * 0.1,
    block(width: d.width * 1pt - 2 * pad, height: d.height * 1pt - 2 * pad - side * 0.1 - foot, {
      set par(leading: 0.5em, justify: false)
      align(horizon, text(size: size, style: if d.italic { "italic" } else { "normal" }, d.quote))
    }))
  place(bottom + left, dx: pad, dy: -pad, block(width: d.width * 1pt - 2 * pad - (if d.cover != none { foot * 0.8 } else { 0pt }), {
    set par(leading: 0.45em)
    text(size: side * 0.036, weight: "bold", d.title)
    linebreak()
    text(size: side * 0.031, fill: rgb(d.accent), d.author)
  }))
  if d.cover != none { place(bottom + right, dx: -pad, dy: -pad, image("/" + d.cover, height: foot)) }
}
