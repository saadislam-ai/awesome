// Borderless Studio: shared building blocks for the book interior.
//
// The whole book arrives as data (build.json). Nothing in the manuscript is
// ever pasted into Typst source, so no character an author types can break
// the build or be misread as Typst markup.
//
// Colour: everything is drawn in pure black ink, cmyk(0, 0, 0, 100). That is
// what print on demand presses expect for text, and it lets the app produce
// PDF/X files without any colour conversion of the text.

#let ink = cmyk(0%, 0%, 0%, 100%)
#let tint(p) = cmyk(0%, 0%, 0%, p)

// The active configuration (the "cfg" object from build.json plus derived
// lengths). Stored in a state so deeply nested helpers can read it.
#let bs-cfg = state("bs-cfg", none)

// ---------------------------------------------------------------- lengths

// One line of body text, baseline to baseline.
#let pitch(cfg) = cfg.pitchPt * 1pt
#let body-size(cfg) = cfg.design.fontSizePt * 1pt
// Gap between the bottom edge of one line box and the top edge of the next.
#let leading(cfg) = pitch(cfg) - body-size(cfg)

// Height of a block that takes the place of exactly `n` lines of body text.
// With the standard gap above and below, the text after it is back on the
// baseline grid.
#let lines-height(cfg, n) = (n - 1) * pitch(cfg) + body-size(cfg)

// Vertical space of `n` empty lines (in addition to the normal gap).
#let line-space(cfg, n) = v(n * pitch(cfg), weak: false)

// ---------------------------------------------------------------- small caps

// Real small capitals when the font has them, otherwise scaled capitals.
#let fake-sc(body) = {
  show regex("\p{Ll}+"): m => text(size: 0.8em, tracking: 0.04em, upper(m))
  body
}

#let sc(cfg, body, which: "body") = {
  let has = cfg.fontCaps.at(which, default: (smcp: false)).smcp
  if has { smallcaps(body) } else { fake-sc(body) }
}

// Letter spaced capitals for running heads and labels.
#let spaced-caps(body, tracking: 0.08em) = text(tracking: tracking, upper(body))

// ---------------------------------------------------------------- numbers

// Page numbers in the digits of the book's language. Roman numerals are only
// used where the script has them (cfg.romanFolios); other books number the
// front matter with their own digits.
#let native-digits(cfg, n) = {
  let chars = cfg.at("digitChars", default: none)
  if chars == none or cfg.at("digits", default: "latin") == "latin" { str(n) }
  else { str(n).clusters().map(c => chars.at(int(c))).join() }
}

#let fmt-number(cfg, n, style: "arabic") = {
  let roman = cfg.at("romanFolios", default: true)
  if style == "roman" and roman { numbering("i", n) }
  else if style == "roman-upper" and roman { numbering("I", n) }
  else { native-digits(cfg, n) }
}

// Letter spacing breaks the joins of Arabic, Bangla and Devanagari letters.
// Inside a cursive book every tracked text is set back to normal spacing.
#let untracked(cfg, body) = {
  if cfg.meta.at("cursive", default: false) {
    show regex("[\p{Arabic}\p{Bengali}\p{Devanagari}\p{Inherited}\u{0640}\u{200C}\u{200D}]+"): it => text(tracking: 0pt, it)
    body
  } else { body }
}

// The text direction of the book, for page furniture that is placed outside the text flow.
#let book-dir(cfg) = if cfg.meta.at("dir", default: "ltr") == "rtl" { rtl } else { ltr }

// ---------------------------------------------------------------- grid fitting

// Wrap content in a block whose height is a whole number of lines, so that
// headings, figures and ornaments do not push the following text off the
// baseline grid. `min-lines` reserves at least that many lines.
#let on-grid(cfg, body, min-lines: 1, valign: horizon, sticky: false, extra-lines: 0) = {
  if not cfg.design.baselineGrid {
    block(width: 100%, sticky: sticky, above: pitch(cfg), below: pitch(cfg), body)
  } else {
    layout(size => {
      let natural = measure(block(width: size.width, body)).height
      let p = pitch(cfg)
      let fs = body-size(cfg)
      let n = calc.max(min-lines, calc.ceil((natural - fs) / p - 0.02) + 1) + extra-lines
      block(width: 100%, height: lines-height(cfg, n), sticky: sticky, breakable: false, align(valign, body))
    })
  }
}

// ---------------------------------------------------------------- ornaments

// Ornaments are drawn with the bundled EB Garamond (which has fleurons) or
// with plain shapes, so they look the same whatever body font is chosen.
#let ornament(cfg, kind, size: 1em) = {
  set text(fill: ink)
  if kind == "asterisks" {
    text(size: size, tracking: 0.9em, "***")
    h(-0.9em)
  } else if kind == "three-stars" {
    text(size: size, tracking: 0.9em, "***")
    h(-0.9em)
  } else if kind == "asterism" {
    box(baseline: 0.1em, stack(dir: ttb, spacing: -0.28em,
      text(size: size, "*"),
      text(size: size, tracking: 0.25em, "**"),
    ))
  } else if kind == "fleuron" {
    text(font: "EB Garamond", size: size * 1.35, "\u{2766}")
  } else if kind == "diamond" {
    box(rotate(45deg, square(size: size * 0.42, fill: ink)))
  } else if kind == "rule" {
    line(length: 100%, stroke: 0.5pt + ink)
  } else if kind == "short-rule" {
    line(length: 2.2em, stroke: 0.6pt + ink)
  } else if kind == "flourish" {
    // A simple symmetrical swash drawn as two curves around a diamond.
    box(baseline: -0.25em, {
      let w = size * 2.6
      let c = curve(
        stroke: (thickness: 0.6pt, paint: ink, cap: "round"),
        curve.move((0pt, 0pt)),
        curve.cubic((w * 0.3, -size * 0.55), (w * 0.7, size * 0.55), (w, 0pt)),
      )
      stack(dir: ltr, spacing: size * 0.35,
        c,
        box(baseline: -0.2em, rotate(45deg, square(size: size * 0.3, fill: ink))),
        scale(x: -100%, c),
      )
    })
  } else {
    none
  }
}

// ---------------------------------------------------------------- inline content

// `rb` is the block renderer (passed in because footnotes contain blocks and
// Typst functions cannot refer to a function defined later in the file).
#let render-inlines(cfg, items, rb: none) = {
  for n in items {
    let t = n.t
    if t == "text" { n.v }
    else if t == "em" { emph(render-inlines(cfg, n.c, rb: rb)) }
    else if t == "strong" { strong(render-inlines(cfg, n.c, rb: rb)) }
    else if t == "sc" { sc(cfg, render-inlines(cfg, n.c, rb: rb)) }
    else if t == "sup" { super(render-inlines(cfg, n.c, rb: rb)) }
    else if t == "sub" { sub(render-inlines(cfg, n.c, rb: rb)) }
    else if t == "mark" { render-inlines(cfg, n.c, rb: rb) }
    else if t == "code" { text(font: cfg.fonts.mono, size: 0.88em, n.v) }
    else if t == "br" { linebreak() }
    else if t == "link" {
      if cfg.links { link(n.href, render-inlines(cfg, n.c, rb: rb)) }
      else { render-inlines(cfg, n.c, rb: rb) }
    }
    else if t == "fn" {
      if rb != none { footnote(rb(cfg, n.c, ctx: (in-note: true))) }
    }
    else if t == "noteref" { super(typographic: false, size: 0.62em, baseline: -0.42em, fmt-number(cfg, n.n)) }
    else if t == "index" {
      [#metadata((term: n.term, sub: n.at("sub", default: none))) <bs-idx>]
    }
    else if t == "img" {
      box(image("/" + n.src, height: 1em, alt: n.at("alt", default: none)))
    }
  }
}

// Plain text of inline items (used for running heads and bookmarks).
#let inline-text(items) = {
  let out = ""
  for n in items {
    if n.t == "text" or n.t == "code" { out += n.v }
    else if n.t == "br" { out += " " }
    else if "c" in n and n.t != "fn" { out += inline-text(n.c) }
  }
  out
}
