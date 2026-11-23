// Borderless Publishing: the logo, drawn as data so every version comes from one place.
//
// The mark is an open book. The left page is solid; the right page has no
// edge: its lines of text run on past where the page would end. A book whose
// words cross borders.

#let navy = rgb("#14213d")
#let gold = rgb("#c8963e")
#let paper = rgb("#f7f3ea")

// The mark in a box of `s` by `s`. `page` and `lines` are the two colours.
#let mark(s, page: navy, lines: gold) = {
  let u = s / 100
  let p(x, y) = (x * u, y * u)
  box(width: s, height: s, {
    // Left page: from the spine it rises to the outer corner, as an open page does.
    place(top + left, curve(
      fill: page, stroke: none,
      curve.move(p(46, 28)),
      curve.quad(p(26, 15), p(3, 18)),
      curve.line(p(3, 78)),
      curve.quad(p(26, 75), p(46, 88)),
      curve.close(),
    ))
    // Right page: no page at all, only its lines of text, rising from the spine the same way
    // and running on to the right with nothing to stop them.
    for (y, len) in ((32, 30), (46, 36), (60, 42), (74, 48)) {
      place(top + left, curve(
        stroke: (paint: lines, thickness: 7 * u, cap: "round"),
        curve.move(p(54, y)),
        curve.quad(p(54 + len * 0.35, y - 9), p(54 + len - 6, y - 10)),
      ))
    }
  })
}

#let wordmark(size, ink: navy, accent: gold) = {
  set text(font: "EB Garamond", fallback: false)
  set par(spacing: 0pt, leading: 0pt)
  stack(dir: ttb, spacing: size * 0.32,
    text(size: size, weight: "medium", tracking: 0.11em, fill: ink, "BORDERLESS"),
    text(size: size * 0.46, weight: "medium", tracking: 0.62em, fill: accent, "PUBLISHING"),
  )
}

#let horizontal(h, ink: navy, page: navy, lines: gold, accent: gold) = stack(dir: ltr, spacing: h * 0.22,
  mark(h, page: page, lines: lines),
  align(horizon, box(height: h, align(horizon, wordmark(h * 0.36, ink: ink, accent: accent)))),
)

#let stacked(w, ink: navy, page: navy, lines: gold, accent: gold) = align(center, stack(dir: ttb, spacing: w * 0.06,
  align(center, mark(w * 0.42, page: page, lines: lines)),
  align(center, wordmark(w * 0.13, ink: ink, accent: accent)),
))
