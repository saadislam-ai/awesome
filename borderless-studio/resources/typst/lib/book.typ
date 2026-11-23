// Borderless Studio: entry point for book interiors.
//
// Usage (the app writes these two lines into main.typ):
//
//   #import "lib/book.typ": render-book
//   #render-book(json("build.json"))
//
// build.json has two keys: "cfg" (page geometry, design, fonts, strings) and
// "sections" (the whole book as data, in reading order).

#import "core.typ": *
#import "blocks.typ": *
#import "page.typ": *
#import "sections.typ": *

#let render-book(data) = {
  let cfg = data.cfg
  let d = cfg.design
  let pg = cfg.page
  let fs = d.fontSizePt * 1pt
  let lead = cfg.pitchPt * 1pt - fs

  set document(
    title: cfg.meta.title,
    author: cfg.meta.authors,
    keywords: cfg.meta.at("keywords", default: ()),
    description: cfg.meta.at("description", default: none),
  )

  set page(
    width: pg.widthPt * 1pt,
    height: pg.heightPt * 1pt,
    margin: (
      inside: pg.margins.insidePt * 1pt,
      outside: pg.margins.outsidePt * 1pt,
      top: pg.margins.topPt * 1pt,
      bottom: pg.margins.bottomPt * 1pt,
    ),
    bleed: if pg.bleedPt > 0 {
      (outside: pg.bleedPt * 1pt, top: pg.bleedPt * 1pt, bottom: pg.bleedPt * 1pt, inside: 0pt)
    } else { 0pt },
    header: running-head(cfg),
    footer: running-foot(cfg),
    header-ascent: pg.headerGapPt * 1pt,
    footer-descent: pg.footerGapPt * 1pt,
    foreground: if cfg.at("watermark", default: none) != none {
      // Advance reader copies carry a pale diagonal mark on every page.
      place(center + horizon, rotate(-52deg, text(size: 34pt, font: cfg.fonts.sans, weight: "bold",
        fill: tint(13%), tracking: 0.08em, upper(cfg.watermark))))
    } else { none },
  )

  set text(
    font: cfg.fonts.body,
    size: fs,
    lang: cfg.meta.lang,
    region: cfg.meta.at("region", default: none),
    fill: ink,
    hyphenate: d.hyphenate,
    number-type: if d.oldstyleFigures and cfg.fontCaps.body.onum { "old-style" } else { "lining" },
    // Fixed line box (1 em tall) so that every line has the same height
    // whatever glyphs it contains. This is what makes the baseline grid work.
    top-edge: 0.8em,
    bottom-edge: -0.2em,
    costs: (
      hyphenation: if d.hyphenAvoidance == "high" { 320% } else if d.hyphenAvoidance == "low" { 60% } else { 140% },
      runt: 160%,
      widow: if d.widowOrphanControl { 100% } else { 0% },
      orphan: if d.widowOrphanControl { 100% } else { 0% },
    ),
    fallback: true,
  )

  set par(
    justify: d.justify,
    linebreaks: "optimized",
    leading: lead,
    spacing: if d.paragraphStyle == "spaced" { lead + cfg.pitchPt * 1pt } else { lead },
    // Indents are applied explicitly by the block renderer (see blocks.typ).
    first-line-indent: 0pt,
    // Let the typesetter adjust letter spacing by a hair as well as word
    // spacing. This removes most "rivers" and loose lines in justified text.
    justification-limits: (
      spacing: (min: 78%, max: 140%),
      tracking: (min: -0.012em, max: 0.018em),
    ),
  )

  set block(spacing: lead)
  set strong(delta: 300)
  set list(spacing: lead)
  set enum(spacing: lead)

  // Footnotes: a short hairline, smaller type, numbering restarts per chapter.
  set footnote.entry(
    separator: line(length: 18%, stroke: 0.4pt + ink),
    clearance: cfg.pitchPt * 1pt,
    gap: 0.45em,
    indent: 0pt,
  )
  show footnote.entry: it => {
    set text(size: 0.82em, top-edge: 0.8em, bottom-edge: -0.2em)
    set par(leading: 0.38em, spacing: 0.38em, first-line-indent: 0pt, hanging-indent: 0pt)
    it
  }
  show raw: set text(font: cfg.fonts.mono)
  show link: it => it.body

  for sec in data.sections {
    render-section(cfg, sec)
  }
}
