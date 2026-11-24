// Five brand directions for Borderless Publishing, drawn as data.
// Each option has a mark (in a 100 x 100 box), a wordmark, colours and a tagline.

#let P(u, x, y) = (x * u, y * u)

// A circular arc as a smooth line, from angle a to b (degrees, 0 = right, counter-clockwise).
#let arc-points(u, cx, cy, r, a, b, n: 48) = range(n + 1).map(i => {
  let t = (a + (b - a) * i / n) * 1deg
  P(u, cx + r * calc.cos(t), cy - r * calc.sin(t))
})
#let arc(u, cx, cy, r, a, b, paint, w) = place(top + left, curve(
  stroke: (paint: paint, thickness: w * u, cap: "round"),
  curve.move(arc-points(u, cx, cy, r, a, b).first()),
  ..arc-points(u, cx, cy, r, a, b).slice(1).map(p => curve.line(p)),
))
#let line-at(u, x1, y1, x2, y2, paint, w) = place(top + left, curve(
  stroke: (paint: paint, thickness: w * u, cap: "round"), curve.move(P(u, x1, y1)), curve.line(P(u, x2, y2))))
#let poly(u, pts, fill) = place(top + left, polygon(fill: fill, stroke: none, ..pts.map(p => P(u, p.at(0), p.at(1)))))

// ---------------------------------------------------------------- 1. Open Pages
#let open-pages-mark(s, c) = { let u = s / 100; box(width: s, height: s, {
  place(top + left, curve(fill: c.a, stroke: none,
    curve.move(P(u, 46, 28)), curve.quad(P(u, 26, 15), P(u, 3, 18)), curve.line(P(u, 3, 78)),
    curve.quad(P(u, 26, 75), P(u, 46, 88)), curve.close()))
  for (y, len) in ((32, 30), (46, 36), (60, 42), (74, 48)) {
    place(top + left, curve(stroke: (paint: c.b, thickness: 7 * u, cap: "round"),
      curve.move(P(u, 54, y)), curve.quad(P(u, 54 + len * 0.35, y - 9), P(u, 54 + len - 6, y - 10))))
  }
})}

// ---------------------------------------------------------------- 2. Horizon
// An open circle (a horizon with a gap where the world goes on), a rising sun, water running out through the gap.
#let horizon-mark(s, c) = { let u = s / 100; box(width: s, height: s, {
  arc(u, 46, 50, 38, 32, 328, c.a, 7)
  place(top + left, dx: 33 * u, dy: 20 * u, circle(radius: 13 * u, fill: c.b))
  line-at(u, 18, 56, 98, 56, c.a, 6.5)
  line-at(u, 24, 68, 92, 68, c.a, 6.5)
  line-at(u, 34, 80, 84, 80, c.a, 6.5)
})}

// ---------------------------------------------------------------- 3. Bridge
// Fanned pages that form a bridge between two shores: two languages, two countries.
#let bridge-mark(s, c) = { let u = s / 100; box(width: s, height: s, {
  for (r, paint) in ((45, c.a), (34, c.b), (23, c.a)) { arc(u, 50, 80, r, 0, 180, paint, 7) }
  line-at(u, 2, 92, 98, 92, c.a, 7)
})}

// ---------------------------------------------------------------- 4. Open B
// A classic serif B in a frame that has no right side: the edge is left open.
#let open-b-mark(s, c, font: "Libre Baskerville") = { let u = s / 100; box(width: s, height: s, {
  line-at(u, 6, 6, 70, 6, c.b, 6)
  line-at(u, 6, 6, 6, 94, c.b, 6)
  line-at(u, 6, 94, 70, 94, c.b, 6)
  place(top + left, dx: 18 * u, dy: 13 * u, box(width: 70 * u, height: 74 * u,
    align(center + horizon, text(font: font, weight: "bold", size: 92 * u, fill: c.a, top-edge: "cap-height", bottom-edge: "baseline", "B"))))
})}

// ---------------------------------------------------------------- 5. Paper Boat
// A boat folded from a page, as children fold them in the monsoon, on water that runs past the edge.
#let paper-boat-mark(s, c) = { let u = s / 100; box(width: s, height: s, {
  poly(u, ((22, 60), (50, 14), (50, 60)), c.b)
  poly(u, ((50, 14), (78, 60), (50, 60)), c.c)
  poly(u, ((6, 60), (94, 60), (76, 80), (24, 80)), c.a)
  place(top + left, curve(stroke: (paint: c.a, thickness: 5 * u, cap: "round"),
    curve.move(P(u, 2, 91)), curve.quad(P(u, 14, 85), P(u, 26, 91)), curve.quad(P(u, 38, 97), P(u, 50, 91)),
    curve.quad(P(u, 62, 85), P(u, 74, 91)), curve.quad(P(u, 86, 97), P(u, 98, 91))))
})}

// ---------------------------------------------------------------- the five options
#let OPTIONS = (
  (
    id: "open-pages", name: "Open Pages",
    idea: "An open book whose right page has no edge: its lines of text run on past the page. Words that cross borders. Classic and literary.",
    mark: open-pages-mark,
    colours: (a: rgb("#14213d"), b: rgb("#c8963e"), c: rgb("#f7f3ea")),
    names: ("Delta navy", "River gold", "Paper"),
    font: "EB Garamond", top: "BORDERLESS", bottom: "PUBLISHING",
    top-style: (weight: "medium", tracking: 0.11em), bottom-style: (weight: "medium", tracking: 0.62em, size: 0.46),
    tagline: "Books priced for readers.",
  ),
  (
    id: "horizon", name: "Horizon",
    idea: "An open circle, a rising sun, and water running out through the gap: the world does not stop at the edge. Modern, warm and friendly.",
    mark: horizon-mark,
    colours: (a: rgb("#0f4c5c"), b: rgb("#e2725b"), c: rgb("#f6efe4")),
    names: ("Deep teal", "Sunrise coral", "Sand"),
    font: "Source Sans 3", top: "borderless", bottom: "PUBLISHING",
    top-style: (weight: "semibold", tracking: -0.01em), bottom-style: (weight: "regular", tracking: 0.42em, size: 0.4),
    tagline: "Stories for every horizon.",
  ),
  (
    id: "bridge", name: "Bridge",
    idea: "Fanned pages that form a bridge between two shores: Bangla and English, Bangladesh and Australia. Calm and trustworthy.",
    mark: bridge-mark,
    colours: (a: rgb("#1d4d3b"), b: rgb("#d4a03b"), c: rgb("#f8f4e8")),
    names: ("Delta green", "Ochre", "Cream"),
    font: "Crimson Pro", top: "Borderless", bottom: "Publishing",
    top-style: (weight: "semibold", tracking: 0.01em), bottom-style: (weight: "regular", tracking: 0.06em, size: 0.62, style: "italic"),
    tagline: "Books that bridge two worlds.",
  ),
  (
    id: "open-b", name: "Open B",
    idea: "A classic serif B in a frame left open on one side. Looks like an established literary press; strong on a spine.",
    mark: open-b-mark,
    colours: (a: rgb("#1b1b1b"), b: rgb("#c4452c"), c: rgb("#faf6ef")),
    names: ("Ink", "Vermilion", "Cream"),
    font: "Libre Baskerville", top: "BORDERLESS", bottom: "PUBLISHING",
    top-style: (weight: "bold", tracking: 0.08em), bottom-style: (weight: "regular", tracking: 0.5em, size: 0.42),
    tagline: "Good books, fairly priced.",
  ),
  (
    id: "paper-boat", name: "Paper Boat",
    idea: "A boat folded from a page, as children fold them in the Bangladeshi monsoon, on water that runs past the edge. Story led and gentle.",
    mark: paper-boat-mark,
    colours: (a: rgb("#262a6b"), b: rgb("#f2a541"), c: rgb("#f8c97f")),
    names: ("Monsoon indigo", "Saffron", "Light saffron"),
    font: "EB Garamond", top: "borderless", bottom: "PUBLISHING",
    top-style: (weight: "medium", tracking: 0em, style: "italic"), bottom-style: (weight: "medium", tracking: 0.5em, size: 0.42),
    tagline: "Stories that travel.",
  ),
)

#let wordmark(o, size, ink, accent) = {
  set par(spacing: 0pt, leading: 0pt)
  let ts = o.top-style
  let bs = o.bottom-style
  stack(dir: ttb, spacing: size * 0.3,
    text(font: o.font, size: size, weight: ts.weight, tracking: ts.tracking, style: ts.at("style", default: "normal"), fill: ink, o.top),
    text(font: o.font, size: size * bs.size, weight: bs.weight, tracking: bs.tracking, style: bs.at("style", default: "normal"), fill: accent, o.bottom),
  )
}

// Colours for a light background, and for a dark one (the main colour becomes the background).
#let on-light(o) = (mark: (a: o.colours.a, b: o.colours.b, c: o.colours.c), ink: o.colours.a, accent: o.colours.b)
#let on-dark(o) = {
  let light = if o.id == "paper-boat" { rgb("#fbf7ef") } else { o.colours.c }
  (mark: (a: light, b: o.colours.b, c: if o.id == "paper-boat" { o.colours.c } else { o.colours.b }), ink: light, accent: o.colours.b)
}

#let lockup(o, h, scheme) = stack(dir: ltr, spacing: h * 0.22,
  (o.mark)(h, scheme.mark),
  box(height: h, align(horizon, wordmark(o, h * 0.36, scheme.ink, scheme.accent))))

#let stacked(o, w, scheme) = align(center, stack(dir: ttb, spacing: w * 0.07,
  align(center, (o.mark)(w * 0.4, scheme.mark)),
  align(center, wordmark(o, w * 0.13, scheme.ink, scheme.accent))))
