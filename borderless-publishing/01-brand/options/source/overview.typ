#import "options-lib.typ": *
#set page(width: 300mm, height: auto, margin: 10mm, fill: white)
#set text(font: "Source Sans 3", size: 10pt)
#for (i, o) in OPTIONS.enumerate() {
  block(breakable: false, below: 6mm, grid(columns: (12mm, 1.3fr, 1fr), gutter: 5mm, align: horizon,
    text(size: 26pt, weight: "bold", fill: rgb("#bbbbbb"), str(i + 1)),
    rect(width: 100%, height: 40mm, stroke: 0.5pt + rgb("#e5e5e5"), align(center + horizon, lockup(o, 20mm, on-light(o)))),
    rect(width: 100%, height: 40mm, fill: o.colours.a, align(center + horizon, lockup(o, 15mm, on-dark(o)))),
  ))
}
