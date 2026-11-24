#import "options-lib.typ": *
#import "options2-lib.typ": OPTIONS2
#import "options3-lib.typ": OPTIONS3
#let SET = sys.inputs.at("set", default: "1")
#let LIST = if SET == "3" { OPTIONS3 } else if SET == "2" { OPTIONS2 } else { OPTIONS }
#let FIRST = if SET == "3" { 16 } else if SET == "2" { 6 } else { 1 }
#set page(width: 300mm, height: auto, margin: 10mm, fill: white)
#set text(font: "Source Sans 3", size: 10pt)
#for (i, o) in LIST.enumerate() {
  block(breakable: false, below: 6mm, grid(columns: (12mm, 1.3fr, 1fr), gutter: 5mm, align: horizon,
    text(size: 26pt, weight: "bold", fill: rgb("#bbbbbb"), str(i + FIRST)),
    rect(width: 100%, height: 40mm, stroke: 0.5pt + rgb("#e5e5e5"), align(center + horizon, lockup(o, 20mm, on-light(o)))),
    rect(width: 100%, height: 40mm, fill: o.colours.a, align(center + horizon, lockup(o, 15mm, on-dark(o)))),
  ))
}
