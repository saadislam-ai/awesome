// Options 16 to 23: detailed book silhouettes with a real globe. The artwork is
// drawn by make-marks3.mjs from Natural Earth land shapes (public domain) and
// coloured here, so every mark works in the light, dark and one colour schemes.

#let disc(u, cx, cy, r, paint) = place(top + left, dx: (cx - r) * u, dy: (cy - r) * u, circle(radius: r * u, fill: paint))

#let NAVY = (a: rgb("#14213d"), b: rgb("#c8963e"), c: rgb("#f7f3ea"))
#let INK = (a: rgb("#1b1b1b"), b: rgb("#c4452c"), c: rgb("#faf6ef"))
#let GARAMOND = (font: "EB Garamond", top: "BORDERLESS", bottom: "PUBLISHING",
  top-style: (weight: "medium", tracking: 0.11em), bottom-style: (weight: "medium", tracking: 0.62em, size: 0.46))
#let BASKERVILLE = (font: "Libre Baskerville", top: "BORDERLESS", bottom: "PUBLISHING",
  top-style: (weight: "bold", tracking: 0.08em), bottom-style: (weight: "regular", tracking: 0.5em, size: 0.42))

// One mark from marks3/, in the colours of a scheme (a: main, b: accent, c: paper).
// In one colour printing (main and accent the same) the paper parts stay white, so the detail still shows.
#let art(name) = (s, c) => { let paper = if c.a == c.b { white } else { c.c }; box(width: s, height: s, image(
  bytes(read("marks3/" + name + ".svg").replace("#AAAAAA", c.a.to-hex()).replace("#BBBBBB", c.b.to-hex()).replace("#CCCCCC", paper.to-hex())),
  format: "svg", width: s, height: s)) }

// The seal carries the name around its ring, set in type rather than drawn.
#let atlas-seal(s, c) = { let u = s / 100; box(width: s, height: s, {
  place(top + left, (art("20-atlas-seal"))(s, c))
  // Letters in the paper colour on the ring; on a dark background (where paper and accent are both gold) in navy.
  let ink = if c.c == c.b { NAVY.a } else { c.c }
  let letter(ch, a, turn, size) = {
    let x = 50 + 41.3 * calc.cos(a * 1deg)
    let y = 50 - 41.3 * calc.sin(a * 1deg)
    place(top + left, dx: (x - 6) * u, dy: (y - 6) * u, box(width: 12 * u, height: 12 * u,
      align(center + horizon, rotate(turn * 1deg, text(font: "EB Garamond", size: size * u, weight: "bold", fill: ink, ch)))))
  }
  let top-text = "BORDERLESS PUBLISHING".clusters()
  let span = 206
  for (k, ch) in top-text.enumerate() {
    let a = 90 + span / 2 - k * span / (top-text.len() - 1)
    letter(ch, a, 90 - a, 8.2)
  }
  let bottom-text = "SYDNEY".clusters()
  let span2 = 56
  for (k, ch) in bottom-text.enumerate() {
    let a = 270 - span2 / 2 + k * span2 / (bottom-text.len() - 1)
    letter(ch, a, 270 - a, 8.2)
  }
  for a in (90 + span / 2 + 19, 90 - span / 2 - 19) { disc(u, 50 + 41.3 * calc.cos(a * 1deg), 50 - 41.3 * calc.sin(a * 1deg), 1.7, c.b) }
})}

#let OPTIONS3 = (
  (id: "atlas-rising", name: "Atlas Rising", mark: art("16-atlas-rising"), colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "A real globe, with Africa, Asia and Australia, rising out of the gutter of an open book drawn with its cover boards and the stack of its pages.", tagline: "A world in every book."),
  (id: "turning-world", name: "Turning World", mark: art("17-turning-world"), colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "The globe is a book: its right half lifts away as a page being turned, with the other side of the world showing through the paper.", tagline: "Turn the page, cross the world."),
  (id: "window-book", name: "Window Book", mark: art("18-window-book"), colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..BASKERVILLE,
    idea: "A standing hardcover with raised bands on its spine and a round window cut in the cover, opening onto the world.", tagline: "Every book is a window."),
  (id: "globe-on-books", name: "Globe on Books", mark: art("19-globe-on-books"), colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "A desk globe on its gold stand, resting on a stack of three books: the study of a publisher who reads the whole world.", tagline: "Stories for the whole world."),
  (id: "atlas-seal", name: "Atlas Seal", mark: atlas-seal, colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "A press seal: the real globe on an open book, with the name set around the ring. For title pages, stamps and the website footer; options 16 or 19 at small sizes.", tagline: "Published in Sydney, read everywhere."),
  (id: "atlas-spread", name: "Atlas Spread", mark: art("21-atlas-spread"), colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "An open atlas: the map of the world runs across both pages, over the gutter, with a ribbon bookmark hanging below.", tagline: "Books without borders."),
  (id: "bookmark-earth", name: "Bookmark Earth", mark: art("22-bookmark-earth"), colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..BASKERVILLE,
    idea: "A closed hardcover with the globe stamped in gold on its cover, a ruled frame, its pages showing at the edge and a gold ribbon bookmark.", tagline: "Bookmark the world."),
  (id: "world-inside-a-book", name: "World Inside a Book", mark: art("23-world-inside-a-book"), colours: NAVY, names: ("Delta navy", "River gold", "Paper"), ..GARAMOND,
    idea: "The silhouette of an open book filled with the globe: the whole world fits inside a book. Pages fan out underneath.", tagline: "The world, between two covers."),
)
