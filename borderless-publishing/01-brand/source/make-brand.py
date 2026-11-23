#!/usr/bin/env python3
"""
Builds every brand file of Borderless Publishing from logo-lib.typ:
logo versions (SVG, PNG, print PDF), the business card, social media images.

    python3 make-brand.py

Needs the Typst program that comes with Borderless Studio (or any Typst 0.13+
on the PATH) and the EB Garamond font files.
"""
import json
import os
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BRAND = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(BRAND))
TYPST = os.path.join(ROOT, 'borderless-studio', 'tools', 'typst', 'typst')
if not os.path.exists(TYPST):
    TYPST = shutil.which('typst') or sys.exit('Typst was not found. Run "npm run fetch-tools" in borderless-studio, or install Typst.')
FONTS = os.path.join(ROOT, 'borderless-studio', 'resources', 'fonts')
DETAILS = json.load(open(os.path.join(HERE, 'brand-details.json'), encoding='utf-8'))

# Print colours. Screen colours are in logo-lib.typ. The ink mixes are close
# equivalents for coated paper; ask your printer for a proof before a large run.
PRINT = {'navy': 'cmyk(100%, 82%, 35%, 45%)', 'gold': 'cmyk(18%, 40%, 85%, 5%)', 'paper': 'cmyk(2%, 3%, 8%, 0%)'}


def run(main, out, fmt, ppi=None):
    path = os.path.join(HERE, '_build.typ')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(main)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    args = [TYPST, 'compile', '--ignore-system-fonts', '--root', HERE,
            '--font-path', os.path.join(FONTS, 'EBGaramond'), '--font-path', os.path.join(FONTS, 'SourceSans3'), '--format', fmt]
    if ppi:
        args += ['--ppi', str(ppi)]
    subprocess.run(args + [path, out], check=True)
    os.remove(path)


def page(body, colours='screen', fill='none'):
    c = PRINT if colours == 'print' else {'navy': 'navy', 'gold': 'gold', 'paper': 'paper'}
    return (
        '#import "logo-lib.typ": *\n'
        f'#let NAVY = {c["navy"]}\n#let GOLD = {c["gold"]}\n#let PAPER = {c["paper"]}\n'
        f'#set page(width: auto, height: auto, margin: 1pt, fill: {fill})\n'
        # A plain call such as horizontal(...) must be marked as code with a hash.
        + (body if body.lstrip().startswith('#') else '#' + body) + '\n'
    )


# name: (Typst body, colours on a light background?)
LOGOS = {
    'logo-horizontal':          'horizontal(30mm, ink: NAVY, page: NAVY, lines: GOLD, accent: GOLD)',
    'logo-horizontal-black':    'horizontal(30mm, ink: black, page: black, lines: black, accent: black)',
    'logo-horizontal-white':    'horizontal(30mm, ink: white, page: white, lines: white, accent: white)',
    'logo-horizontal-reversed': 'horizontal(30mm, ink: PAPER, page: PAPER, lines: GOLD, accent: GOLD)',
    'logo-stacked':             'stacked(80mm, ink: NAVY, page: NAVY, lines: GOLD, accent: GOLD)',
    'logo-stacked-black':       'stacked(80mm, ink: black, page: black, lines: black, accent: black)',
    'logo-stacked-white':       'stacked(80mm, ink: white, page: white, lines: white, accent: white)',
    'logo-stacked-reversed':    'stacked(80mm, ink: PAPER, page: PAPER, lines: GOLD, accent: GOLD)',
    'mark':                     'mark(40mm, page: NAVY, lines: GOLD)',
    'mark-black':               'mark(40mm, page: black, lines: black)',
    'mark-white':               'mark(40mm, page: white, lines: white)',
    'mark-reversed':            'mark(40mm, page: PAPER, lines: GOLD)',
    'wordmark':                 'wordmark(12mm, ink: NAVY, accent: GOLD)',
    'wordmark-black':           'wordmark(12mm, ink: black, accent: black)',
}

logo_dir = os.path.join(BRAND, 'logo')
for name, body in LOGOS.items():
    run(page(body), os.path.join(logo_dir, 'svg', name + '.svg'), 'svg')
    run(page(body), os.path.join(logo_dir, 'png', name + '.png'), 'png', ppi=600)
    # Print PDFs: ink colours, and black as pure black ink.
    print_body = body.replace('black', 'cmyk(0%, 0%, 0%, 100%)')
    run(page(print_body, colours='print'), os.path.join(logo_dir, 'pdf-print', name + '.pdf'), 'pdf')

# App icon and avatar: the mark on a navy square.
square = lambda px, pad: (f'#set page(width: {px}pt, height: {px}pt, margin: 0pt, fill: NAVY)\n'
                          f'#place(center + horizon, mark({px * (1 - 2 * pad)}pt, page: PAPER, lines: GOLD))')
for px, name in ((32, 'favicon-32'), (180, 'apple-touch-icon-180'), (512, 'icon-512')):
    run(page(square(px, 0.14)), os.path.join(logo_dir, 'png', name + '.png'), 'png', ppi=72)
run(page(square(512, 0.14)), os.path.join(logo_dir, 'svg', 'icon.svg'), 'svg')

# Social media images (sizes in pixels; one point is one pixel at 72 ppi).
tag = json.dumps(DETAILS.get('tagline', ''))
social = os.path.join(BRAND, 'social')
run(page('#set page(width: 1080pt, height: 1080pt, margin: 0pt, fill: NAVY)\n'
         '#place(center + horizon, mark(600pt, page: PAPER, lines: GOLD))'), os.path.join(social, 'avatar-1080.png'), 'png', ppi=72)
for w, h, name in ((1500, 500, 'banner-1500x500'), (1200, 630, 'link-preview-1200x630'), (1584, 396, 'linkedin-banner-1584x396')):
    run(page(f'#set page(width: {w}pt, height: {h}pt, margin: 0pt, fill: NAVY)\n'
             f'#place(center + horizon, stack(dir: ttb, spacing: {h * 0.09}pt,\n'
             f'  align(center, horizontal({h * 0.3}pt, ink: PAPER, page: PAPER, lines: GOLD, accent: GOLD)),\n'
             f'  align(center, text(font: "EB Garamond", style: "italic", size: {h * 0.075}pt, fill: PAPER, {tag}))))'),
        os.path.join(social, name + '.png'), 'png', ppi=72)

# Business card: Australian size 90 x 55 mm, with 3 mm bleed on every side (96 x 61 mm).
lines = [DETAILS.get(k, '') for k in ('email', 'phone', 'website')]
contact = '(' + ''.join(json.dumps(x) + ', ' for x in lines if x) + ')'
card = f'''
#set page(width: 96mm, height: 61mm, margin: 0pt)
#set text(font: "EB Garamond")
// Front: the stacked logo on navy, to the edge of the bleed.
#page(fill: NAVY, place(center + horizon, stacked(46mm, ink: PAPER, page: PAPER, lines: GOLD, accent: GOLD)))
// Back: who you are and how to reach you. Text keeps 5 mm inside the trim (8 mm from the file edge).
#page(fill: PAPER, {{
  place(top + left, dx: 9mm, dy: 9mm, mark(9mm, page: NAVY, lines: GOLD))
  place(bottom + left, dx: 9mm, dy: -9mm, stack(dir: ttb, spacing: 2.2mm,
    text(size: 11.5pt, weight: "medium", fill: NAVY, {json.dumps(DETAILS.get("name", ""))}),
    text(size: 7.5pt, tracking: 0.18em, fill: GOLD, upper({json.dumps(DETAILS.get("role", ""))})),
    v(1.2mm),
    ..{contact}.map(l => text(size: 8.5pt, fill: NAVY, l)),
    text(size: 8.5pt, fill: NAVY, {json.dumps(DETAILS.get("city", ""))}),
  ))
  place(bottom + right, dx: -9mm, dy: -9mm, text(size: 7.5pt, style: "italic", fill: NAVY, {tag}))
}})
'''
stationery = os.path.join(BRAND, 'stationery')
run(page(card, colours='print'), os.path.join(stationery, 'business-card-print.pdf'), 'pdf')
run(page(card), os.path.join(stationery, 'business-card-preview-{p}.png'), 'png', ppi=200)
# The letterhead picture used by the Word documents.
run(page('horizontal(16mm, ink: NAVY, page: NAVY, lines: GOLD, accent: GOLD)'), os.path.join(stationery, 'letterhead-logo.png'), 'png', ppi=600)
print('Brand files written to', BRAND)
