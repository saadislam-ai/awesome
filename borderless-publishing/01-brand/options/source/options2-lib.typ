// Ten more directions: a book and a globe together, borrowing from options 1
// (Open Pages: navy, gold, EB Garamond) and 4 (Open B: serif letter, open frame,
// ink and vermilion).
#import "options-lib.typ": P, arc-points, arc, line-at, poly, open-pages-mark

#let NAVY = (a: rgb("#14213d"), b: rgb("#c8963e"), c: rgb("#f7f3ea"))
#let INK = (a: rgb("#1b1b1b"), b: rgb("#c4452c"), c: rgb("#faf6ef"))
#let NAVY-RED = (a: rgb("#14213d"), b: rgb("#c4452c"), c: rgb("#f7f3ea"))
#let GARAMOND = (font: "EB Garamond", top: "BORDERLESS", bottom: "PUBLISHING",
  top-style: (weight: "medium", tracking: 0.11em), bottom-style: (weight: "medium", tracking: 0.62em, size: 0.46))
#let BASKERVILLE = (font: "Libre Baskerville", top: "BORDERLESS", bottom: "PUBLISHING",
  top-style: (weight: "bold", tracking: 0.08em), bottom-style: (weight: "regular", tracking: 0.5em, size: 0.42))

// Show only the part of `body` (drawn in the 100 x 100 box) that falls inside a rectangle.
#let clip-to(u, x, y, w, h, body) = place(top + left, dx: x * u, dy: y * u,
  box(width: w * u, height: h * u, clip: true, place(top + left, dx: -x * u, dy: -y * u, box(width: 100 * u, height: 100 * u, body))))
#let ring(u, cx, cy, r, paint, w) = place(top + left, dx: (cx - r) * u, dy: (cy - r) * u, circle(radius: r * u, stroke: w * u + paint))
#let disc(u, cx, cy, r, paint) = place(top + left, dx: (cx - r) * u, dy: (cy - r) * u, circle(radius: r * u, fill: paint))
#let oval(u, cx, cy, rx, ry, paint, w) = place(top + left, dx: (cx - rx) * u, dy: (cy - ry) * u, ellipse(width: 2 * rx * u, height: 2 * ry * u, stroke: w * u + paint))
// Meridians and parallels of a globe, without its outline.
#let grid(u, cx, cy, r, paint, w, mer: (0.42, 0.78), par: (-0.55, 0, 0.55)) = {
  line-at(u, cx, cy - r, cx, cy + r, paint, w)
  for k in mer { oval(u, cx, cy, r * k, r, paint, w) }
  for f in par { let dy = f * r; let half = calc.sqrt(r * r - dy * dy); line-at(u, cx - half, cy + dy, cx + half, cy + dy, paint, w) }
}
#let half-disc(u, cx, cy, r, side, paint) = poly(u,
  arc-points(1, cx, cy, r, if side == "left" { 90 } else { -90 }, if side == "left" { 270 } else { 90 }).map(p => (p.at(0) / 1pt * 1, p.at(1) / 1pt * 1)), paint)

// 6. Globe Pages: a globe split down the middle into the two pages of an open book.
#let globe-pages(s, c) = { let u = s / 100; box(width: s, height: s, {
  let pts(cx, a, b) = arc-points(u, cx, 50, 42, a, b)
  place(top + left, polygon(fill: c.a, ..pts(47, 90, 270)))
  place(top + left, polygon(fill: c.b, ..pts(53, -90, 90)))
  for dy in (-21, 0, 21) {
    let half = calc.sqrt(42 * 42 - dy * dy)
    line-at(u, 47 - half + 5, 50 + dy, 42, 50 + dy, c.c, 3.2)
    line-at(u, 58, 50 + dy, 53 + half - 5, 50 + dy, c.c, 3.2)
  }
  clip-to(u, 0, 0, 47, 100, oval(u, 47, 50, 20, 42, c.c, 3.2))
  clip-to(u, 53, 0, 47, 100, oval(u, 53, 50, 20, 42, c.c, 3.2))
})}

// 7. Open Pages Globe: option 1, with the solid page now a hemisphere; the other half is only lines running on.
#let open-pages-globe(s, c) = { let u = s / 100; box(width: s, height: s, {
  place(top + left, polygon(fill: c.a, ..arc-points(u, 48, 50, 44, 90, 270)))
  clip-to(u, 0, 0, 48, 100, { oval(u, 48, 50, 22, 44, c.c, 3) ; for dy in (-22, 0, 22) { let h = calc.sqrt(44 * 44 - dy * dy); line-at(u, 48 - h, 50 + dy, 48, 50 + dy, c.c, 3) } })
  for (dy, len) in ((-27, 30), (-9, 40), (9, 44), (27, 34)) { line-at(u, 56, 50 + dy, 56 + len, 50 + dy, c.b, 7) }
})}

// 8. Rising World: a globe rising out of an open book.
#let rising-world(s, c) = { let u = s / 100; box(width: s, height: s, {
  ring(u, 50, 40, 27, c.b, 5)
  clip-to(u, 0, 0, 100, 100, grid(u, 50, 40, 27, c.b, 3, mer: (0.45,), par: (-0.45, 0.2)))
  place(top + left, curve(fill: c.a, stroke: none, curve.move(P(u, 48, 62)), curve.quad(P(u, 28, 52), P(u, 4, 56)),
    curve.line(P(u, 4, 86)), curve.quad(P(u, 28, 82), P(u, 48, 94)), curve.close()))
  place(top + left, curve(fill: c.a, stroke: none, curve.move(P(u, 52, 62)), curve.quad(P(u, 72, 52), P(u, 96, 56)),
    curve.line(P(u, 96, 86)), curve.quad(P(u, 72, 82), P(u, 52, 94)), curve.close()))
})}

// 9. Open Frame Globe: option 4's frame, open on one side, with a globe whose lines run out through the opening.
#let open-frame-globe(s, c) = { let u = s / 100; box(width: s, height: s, {
  line-at(u, 6, 6, 66, 6, c.b, 6); line-at(u, 6, 6, 6, 94, c.b, 6); line-at(u, 6, 94, 66, 94, c.b, 6)
  ring(u, 44, 50, 28, c.a, 5)
  line-at(u, 44, 22, 44, 78, c.a, 3.5)
  oval(u, 44, 50, 13, 28, c.a, 3.5)
  for dy in (-14, 0, 14) { let h = calc.sqrt(28 * 28 - dy * dy); line-at(u, 44 - h, 50 + dy, 97, 50 + dy, c.a, 3.5) }
})}

// 10. Globe B: the serif B of option 4 inside a globe that is open on one side.
#let globe-b(s, c) = { let u = s / 100; box(width: s, height: s, {
  arc(u, 50, 50, 44, 28, 332, c.b, 5.5)
  line-at(u, 86, 42, 98, 42, c.b, 5.5); line-at(u, 86, 58, 98, 58, c.b, 5.5)
  place(top + left, dx: 15 * u, dy: 18 * u, box(width: 70 * u, height: 64 * u,
    align(center + horizon, text(font: "Libre Baskerville", weight: "bold", size: 78 * u, fill: c.a, top-edge: "cap-height", bottom-edge: "baseline", "B"))))
})}

// 11. Orbit: an open book with a world's orbit around it.
#let orbit(s, c) = { let u = s / 100; box(width: s, height: s, {
  // The orbit is drawn whole behind the book, then its front half again over the book.
  let ringed = place(top + left, dx: 2 * u, dy: 44 * u, rotate(-10deg, ellipse(width: 96 * u, height: 26 * u, stroke: 3.6 * u + c.b)))
  ringed
  place(top + left, curve(fill: c.a, stroke: none, curve.move(P(u, 48, 30)), curve.quad(P(u, 30, 20), P(u, 12, 24)),
    curve.line(P(u, 12, 76)), curve.quad(P(u, 30, 72), P(u, 48, 84)), curve.close()))
  place(top + left, curve(fill: c.a, stroke: none, curve.move(P(u, 52, 30)), curve.quad(P(u, 70, 20), P(u, 88, 24)),
    curve.line(P(u, 88, 76)), curve.quad(P(u, 70, 72), P(u, 52, 84)), curve.close()))
  clip-to(u, 0, 58, 100, 42, ringed)
  disc(u, 92, 46, 4.5, c.b)
})}

// 12. Bookmark Globe: a globe with a book's ribbon bookmark hanging through it.
#let bookmark-globe(s, c) = { let u = s / 100; box(width: s, height: s, {
  ring(u, 46, 50, 40, c.a, 5)
  grid(u, 46, 50, 40, c.a, 3, mer: (0.45,), par: (-0.5, 0, 0.5))
  poly(u, ((62, 2), (76, 2), (76, 98), (69, 90), (62, 98)), c.b)
})}

// 13. Colophon Seal: a round press mark with the name around a globe and an open book.
#let colophon-seal(s, c) = { let u = s / 100; box(width: s, height: s, {
  ring(u, 50, 50, 47, c.b, 2.6)
  ring(u, 50, 50, 33, c.b, 1.6)
  // Text along a circle: the name over the top, reading clockwise; the place along the bottom, upright.
  let letter(ch, a, turn, size) = {
    let x = 50 + 40 * calc.cos(a * 1deg)
    let y = 50 - 40 * calc.sin(a * 1deg)
    place(top + left, dx: (x - 6) * u, dy: (y - 6) * u, box(width: 12 * u, height: 12 * u,
      align(center + horizon, rotate(turn * 1deg, text(font: "Libre Baskerville", size: size * u, weight: "bold", fill: c.a, ch)))))
  }
  let top-text = "BORDERLESS PUBLISHING".clusters()
  let span = 216
  for (k, ch) in top-text.enumerate() {
    let a = 90 + span / 2 - k * span / (top-text.len() - 1)
    letter(ch, a, 90 - a, 7.4)
  }
  let bottom-text = "SYDNEY".clusters()
  let span2 = 62
  for (k, ch) in bottom-text.enumerate() {
    let a = 270 - span2 / 2 + k * span2 / (bottom-text.len() - 1)
    letter(ch, a, 270 - a, 7.4)
  }
  for a in (90 + span / 2 + 18, 90 - span / 2 - 18) { disc(u, 50 + 40 * calc.cos(a * 1deg), 50 - 40 * calc.sin(a * 1deg), 1.8, c.b) }
  ring(u, 50, 44, 17, c.a, 2.6)
  grid(u, 50, 44, 17, c.a, 1.8, mer: (0.45,), par: (-0.45, 0.2))
  place(top + left, curve(fill: c.a, stroke: none, curve.move(P(u, 49, 57)), curve.quad(P(u, 40, 52), P(u, 28, 55)),
    curve.line(P(u, 28, 70)), curve.quad(P(u, 40, 68), P(u, 49, 73)), curve.close()))
  place(top + left, curve(fill: c.a, stroke: none, curve.move(P(u, 51, 57)), curve.quad(P(u, 60, 52), P(u, 72, 55)),
    curve.line(P(u, 72, 70)), curve.quad(P(u, 60, 68), P(u, 51, 73)), curve.close()))
})}

// 14. Borderless Grid: a globe drawn with no outline at all, resting on an open book.
#let borderless-grid(s, c) = { let u = s / 100; box(width: s, height: s, {
  grid(u, 50, 42, 38, c.a, 3.4, mer: (0.4, 0.76), par: (-0.7, -0.35, 0, 0.35))
  place(top + left, curve(fill: c.b, stroke: none, curve.move(P(u, 49, 70)), curve.quad(P(u, 32, 62), P(u, 12, 66)),
    curve.line(P(u, 12, 88)), curve.quad(P(u, 32, 85), P(u, 49, 95)), curve.close()))
  place(top + left, curve(fill: c.b, stroke: none, curve.move(P(u, 51, 70)), curve.quad(P(u, 68, 62), P(u, 88, 66)),
    curve.line(P(u, 88, 88)), curve.quad(P(u, 68, 85), P(u, 51, 95)), curve.close()))
})}

// 15. Globe O: the O of BORDERLESS is a small globe; the globe alone is the mark.
#let globe-o(s, c) = { let u = s / 100; box(width: s, height: s, {
  ring(u, 50, 50, 40, c.a, 10)
  oval(u, 50, 50, 17, 35, c.b, 4.5)
  line-at(u, 15, 50, 85, 50, c.b, 4.5)
})}
#let globe-o-word(size, ink, accent, o) = {
  set par(spacing: 0pt, leading: 0pt)
  let t(s) = text(font: "Libre Baskerville", size: size, weight: "bold", tracking: 0.06em, fill: ink, s)
  let g = box(height: size * 0.78, baseline: 0pt, globe-o(size * 0.84, (a: ink, b: accent, c: accent)))
  stack(dir: ttb, spacing: size * 0.32,
    box({ t("B"); h(size * 0.02); box(move(dy: size * 0.03, g)); h(size * 0.06); t("RDERLESS") }),
    align(center, text(font: "Libre Baskerville", size: size * 0.42, tracking: 0.5em, fill: accent, "PUBLISHING")))
}

#let OPTIONS2 = (
  (id: "globe-pages", name: "Globe Pages", mark: globe-pages, colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "A globe split down the middle into the two pages of an open book: one world, read like a book.", tagline: "Books priced for readers."),
  (id: "open-pages-globe", name: "Open Pages Globe", mark: open-pages-globe, colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "Option 1 grown into a globe: one page is a hemisphere, the other is only lines of text running on past the edge of the world.", tagline: "Stories for the whole world."),
  (id: "rising-world", name: "Rising World", mark: rising-world, colours: INK, names: ("Ink", "Vermilion", "Cream"), ..BASKERVILLE,
    idea: "A globe rising out of an open book like the sun: a book opens a world.", tagline: "A world in every book."),
  (id: "open-frame-globe", name: "Open Frame Globe", mark: open-frame-globe, colours: INK, names: ("Ink", "Vermilion", "Cream"), ..BASKERVILLE,
    idea: "Option 4's frame, open on one side, now holding a globe whose lines run out through the opening.", tagline: "Good books, fairly priced."),
  (id: "globe-b", name: "Globe B", mark: globe-b, colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..BASKERVILLE,
    idea: "Option 4's serif B, inside a globe that is open on one side, with lines leaving through the gap. Navy and gold from option 1.", tagline: "Read the world."),
  (id: "orbit", name: "Orbit", mark: orbit, colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "An open book with a world's orbit around it: books that travel around the world.", tagline: "Books that travel the world."),
  (id: "bookmark-globe", name: "Bookmark Globe", mark: bookmark-globe, colours: NAVY-RED, names: ("Delta navy", "Vermilion", "Paper"), ..GARAMOND,
    idea: "A globe with a book's ribbon bookmark hanging through it: the world, marked like a page you mean to return to.", tagline: "Bookmark the world."),
  (id: "colophon-seal", name: "Colophon Seal", mark: colophon-seal, colours: INK, names: ("Ink", "Vermilion", "Cream"), ..BASKERVILLE,
    idea: "A round press mark in the old tradition: the name around a globe resting on an open book. Best large (title pages, stamps); use the plain globe and book at small sizes.", tagline: "Published in Sydney, read everywhere."),
  (id: "borderless-grid", name: "Borderless Grid", mark: borderless-grid, colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "A globe drawn only with its lines of latitude and longitude, with no outline at all (literally borderless), resting on an open book.", tagline: "A world of readers."),
  (id: "globe-o", name: "Globe O", mark: globe-o, colours: INK, names: ("Ink", "Vermilion", "Cream"), ..BASKERVILLE, word: globe-o-word, solo: true,
    idea: "Type first: the O of BORDERLESS becomes a globe. The globe alone is the mark for spines and icons.", tagline: "Books priced for readers."),
)
