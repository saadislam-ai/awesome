#import "options-lib.typ": *
#import "options2-lib.typ": OPTIONS2
#import "options3-lib.typ": OPTIONS3
#let SET = sys.inputs.at("set", default: "1")
#let LIST = if SET == "3" { OPTIONS3 } else if SET == "2" { OPTIONS2 } else { OPTIONS }
#let FIRST = if SET == "3" { 16 } else if SET == "2" { 6 } else { 1 }
#set page(paper: "a4", flipped: true, margin: 14mm, fill: white)
#set text(font: "Source Sans 3", size: 10pt, fill: rgb("#222222"))
#let only = sys.inputs.at("only", default: "")

#let swatch(col, name) = stack(dir: ttb, spacing: 2mm,
  rect(width: 34mm, height: 16mm, fill: col, radius: 2pt, stroke: 0.5pt + rgb("#dddddd")),
  text(size: 8.5pt, weight: "semibold", name), text(size: 8pt, fill: rgb("#666666"), upper(col.to-hex())))

#for (i, o) in LIST.enumerate() {
  if only != "" and only != o.id { continue }
  let light = on-light(o)
  let dark = on-dark(o)
  let black-scheme = (mark: (a: black, b: black, c: rgb("#777777")), ink: black, accent: black)
  page[
    #text(size: 9pt, tracking: 0.12em, fill: rgb("#888888"), upper("Option " + str(i + FIRST)))
    #v(-2mm)
    #text(size: 22pt, weight: "semibold", o.name)
    #h(6mm) #text(size: 11pt, fill: rgb("#555555"), o.idea)
    #v(4mm)
    #grid(columns: (1.25fr, 1fr), gutter: 8mm,
      stack(dir: ttb, spacing: 6mm,
        rect(width: 100%, height: 52mm, fill: white, stroke: 0.5pt + rgb("#e5e5e5"), align(center + horizon, lockup(o, 26mm, light))),
        rect(width: 100%, height: 52mm, fill: o.colours.a, align(center + horizon, lockup(o, 26mm, dark))),
        stack(dir: ltr, spacing: 7mm, ..o.names.zip((o.colours.a, o.colours.b, o.colours.c)).map(((n, c)) => swatch(c, n)),
          stack(dir: ttb, spacing: 2mm, text(size: 8.5pt, weight: "semibold", "Typeface"), text(font: o.font, size: 15pt, o.font))),
      ),
      stack(dir: ttb, spacing: 6mm,
        // Business card (front and back) and a book spine, to see the mark at real sizes.
        stack(dir: ltr, spacing: 5mm,
          rect(width: 45mm, height: 27.5mm, fill: o.colours.a, align(center + horizon, stacked(o, 26mm, dark))),
          rect(width: 45mm, height: 27.5mm, fill: white, stroke: 0.5pt + rgb("#dddddd"), inset: 3mm, {
            (o.mark)(5mm, light.mark)
            place(bottom + left, stack(dir: ttb, spacing: 1.2mm,
              text(font: o.font, size: 7pt, weight: "semibold", fill: o.colours.a, "Dr Saad Islam"),
              text(font: o.font, size: 5pt, tracking: 0.15em, fill: o.colours.b, "PUBLISHER"),
              text(font: o.font, size: 5.5pt, fill: o.colours.a, "Sydney, Australia")))
          }),
        ),
        stack(dir: ltr, spacing: 6mm,
          rect(width: 12mm, height: 70mm, fill: rgb("#f1ede4"), stroke: 0.5pt + rgb("#cccccc"), {
            place(top + center, dy: 6mm, rotate(90deg, reflow: true, text(font: "EB Garamond", size: 10pt, fill: rgb("#222222"), "THE SALT ROAD")))
            place(bottom + center, dy: -5mm, (o.mark)(7mm, black-scheme.mark))
          }),
          stack(dir: ttb, spacing: 4mm,
            text(size: 8.5pt, weight: "semibold", "The mark at small sizes"),
            stack(dir: ltr, spacing: 5mm, (o.mark)(18mm, light.mark), (o.mark)(10mm, light.mark), (o.mark)(6mm, light.mark), (o.mark)(10mm, black-scheme.mark)),
            box(fill: o.colours.a, inset: 3mm, radius: 3mm, (o.mark)(12mm, dark.mark)),
            text(size: 8.5pt, weight: "semibold", "Tagline"),
            text(font: o.font, size: 14pt, style: "italic", fill: o.colours.a, o.tagline),
          ),
        ),
        rect(width: 100%, height: 34mm, fill: o.colours.c.lighten(40%), align(center + horizon, stacked(o, 46mm, light))),
      ),
    )
  ]
}
