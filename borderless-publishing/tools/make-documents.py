#!/usr/bin/env python3
"""
Builds a Word file (.docx) on the Borderless letterhead from every Markdown
document in the kit (folders 02 to 05; README files are skipped).

    python3 tools/make-documents.py

Understands the small part of Markdown the kit uses: headings, paragraphs,
lists, check boxes, tables, bold, italic, notes (lines starting with ">")
and "---" for a new page. Needs python-docx (pip install python-docx).
"""
import json
import os
import re
import sys

try:
    from docx import Document
    from docx.enum.section import WD_SECTION
    from docx.enum.table import WD_TABLE_ALIGNMENT
    from docx.enum.text import WD_BREAK, WD_PARAGRAPH_ALIGNMENT
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn
    from docx.shared import Mm, Pt, RGBColor
except ImportError:
    sys.exit('Please install python-docx first:  pip install python-docx')

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FOLDERS = ['02-agreements', '03-business', '04-authors', '05-marketing']
LOGO = os.path.join(ROOT, '01-brand', 'stationery', 'letterhead-logo.png')
DETAILS = json.load(open(os.path.join(ROOT, '01-brand', 'source', 'brand-details.json'), encoding='utf-8'))
NAVY = RGBColor(0x14, 0x21, 0x3D)
GOLD = RGBColor(0xC8, 0x96, 0x3E)
GREY = RGBColor(0x55, 0x55, 0x55)
FONT = 'Garamond'  # Comes with Microsoft Office on Windows and Mac; Word substitutes a similar serif elsewhere.


def shade(paragraph_or_cell, hex_fill):
    """Background colour for a paragraph or a table cell."""
    el = paragraph_or_cell._p if hasattr(paragraph_or_cell, '_p') else paragraph_or_cell._tc
    props = el.get_or_add_pPr() if hasattr(el, 'get_or_add_pPr') else el.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), hex_fill)
    props.append(shd)


def add_inline(paragraph, text, base_italic=False, colour=None, size=None):
    """**bold**, *italic* and `code` inside a line."""
    for part in re.split(r'(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)', text):
        if not part:
            continue
        bold = part.startswith('**') and part.endswith('**')
        italic = not bold and part.startswith('*') and part.endswith('*') and len(part) > 2
        code = part.startswith('`') and part.endswith('`')
        content = part[2:-2] if bold else part[1:-1] if (italic or code) else part
        run = paragraph.add_run(content)
        run.bold = bold or None
        run.italic = (italic or base_italic) or None
        if code:
            run.font.name = 'Consolas'
        if colour:
            run.font.color.rgb = colour
        if size:
            run.font.size = size


def page_number_field(paragraph):
    run = paragraph.add_run()
    for kind, text in (('begin', None), (None, 'PAGE'), ('end', None)):
        if kind:
            el = OxmlElement('w:fldChar')
            el.set(qn('w:fldCharType'), kind)
        else:
            el = OxmlElement('w:instrText')
            el.set(qn('xml:space'), 'preserve')
            el.text = text
        run._r.append(el)
    run.font.size = Pt(8.5)
    run.font.color.rgb = GREY


def new_document(title):
    doc = Document()
    sec = doc.sections[0]
    sec.page_width, sec.page_height = Mm(210), Mm(297)
    sec.left_margin = sec.right_margin = Mm(25)
    sec.top_margin, sec.bottom_margin = Mm(32), Mm(22)
    sec.header_distance, sec.footer_distance = Mm(12), Mm(10)

    normal = doc.styles['Normal']
    normal.font.name = FONT
    normal.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
    normal.font.size = Pt(11.5)
    normal.paragraph_format.space_after = Pt(6)
    normal.paragraph_format.line_spacing = 1.12
    for name, size, colour in (('Title', 22, NAVY), ('Heading 1', 14, NAVY), ('Heading 2', 12, NAVY)):
        st = doc.styles[name]
        st.font.name = FONT
        st.font.size = Pt(size)
        st.font.color.rgb = colour
        st.font.bold = name != 'Title'
        st.element.rPr.rFonts.set(qn('w:eastAsia'), FONT)
        st.element.rPr.rFonts.set(qn('w:ascii'), FONT)
        st.element.rPr.rFonts.set(qn('w:hAnsi'), FONT)
        st.paragraph_format.space_before = Pt(14 if name != 'Title' else 0)
        st.paragraph_format.space_after = Pt(6)
        st.paragraph_format.keep_with_next = True

    # Letterhead: the logo at the top, the business details and page number at the foot.
    header = sec.header.paragraphs[0]
    if os.path.exists(LOGO):
        header.add_run().add_picture(LOGO, width=Mm(58))
    footer = sec.footer.paragraphs[0]
    bits = ['Borderless Publishing', DETAILS.get('city', '')]
    if DETAILS.get('abn'):
        bits.append('ABN ' + DETAILS['abn'])
    for key in ('email', 'website'):
        if DETAILS.get(key):
            bits.append(DETAILS[key])
    run = footer.add_run('   |   '.join(b for b in bits if b) + '        Page ')
    run.font.size = Pt(8.5)
    run.font.color.rgb = GREY
    page_number_field(footer)
    doc.core_properties.title = title
    doc.core_properties.author = 'Borderless Publishing'
    return doc


def add_table(doc, rows):
    cells = [[c.strip() for c in r.strip().strip('|').split('|')] for r in rows if not re.match(r'^\|\s*-', r)]
    width = max(len(r) for r in cells)
    table = doc.add_table(rows=len(cells), cols=width)
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, row in enumerate(cells):
        header = i == 0 and any(row)
        for j in range(width):
            text = row[j] if j < len(row) else ''
            cell = table.cell(i, j)
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            add_inline(p, text, colour=RGBColor(0xFF, 0xFF, 0xFF) if header else None, size=Pt(10.5))
            if header:
                for r in p.runs:
                    r.bold = True
                shade(cell, '14213D')
    doc.add_paragraph()


def convert(md_path):
    lines = open(md_path, encoding='utf-8').read().splitlines()
    title = next((l[2:].strip() for l in lines if l.startswith('# ')), os.path.basename(md_path))
    doc = new_document(title)
    i = 0
    while i < len(lines):
        line = lines[i].rstrip()
        if not line.strip():
            i += 1
            continue
        if line.startswith('|'):
            block = []
            while i < len(lines) and lines[i].startswith('|'):
                block.append(lines[i])
                i += 1
            add_table(doc, block)
            continue
        if line.strip() == '---':
            doc.add_paragraph().add_run().add_break(WD_BREAK.PAGE)
        elif line.startswith('# '):
            doc.add_paragraph(line[2:].strip(), style='Title')
        elif line.startswith('## '):
            doc.add_paragraph(line[3:].strip(), style='Heading 1')
        elif line.startswith('### '):
            doc.add_paragraph(line[4:].strip(), style='Heading 2')
        elif line.startswith('> '):
            # A note for the publisher: shaded, to be removed before sending.
            p = doc.add_paragraph()
            add_inline(p, line[2:].strip(), base_italic=True, colour=GREY, size=Pt(10.5))
            shade(p, 'F3EEE2')
        elif line.startswith('    '):
            p = doc.add_paragraph()
            run = p.add_run(line.strip())
            run.font.name = 'Consolas'
            run.font.size = Pt(10)
        elif re.match(r'^- \[[ x]\] ', line):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Mm(7)
            p.paragraph_format.first_line_indent = Mm(-7)
            p.add_run('☐ ')
            add_inline(p, line[6:])
        elif line.startswith('- '):
            p = doc.add_paragraph(style='List Bullet')
            add_inline(p, line[2:])
        elif re.match(r'^\([a-z]\) ', line):
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Mm(16)
            p.paragraph_format.first_line_indent = Mm(-7)
            add_inline(p, line)
        elif re.match(r'^\d+\.\d+ ', line):
            # A numbered clause: the number in bold, the text hanging.
            num, rest = line.split(' ', 1)
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Mm(9)
            p.paragraph_format.first_line_indent = Mm(-9)
            p.add_run(num + '\t').bold = True
            add_inline(p, rest)
        elif re.match(r'^\d+\. ', line):
            num, rest = line.split(' ', 1)
            p = doc.add_paragraph()
            p.paragraph_format.left_indent = Mm(7)
            p.paragraph_format.first_line_indent = Mm(-7)
            p.add_run(num + '\t')
            add_inline(p, rest)
        else:
            p = doc.add_paragraph()
            add_inline(p, line.strip())
        i += 1
    out = os.path.splitext(md_path)[0] + '.docx'
    doc.save(out)
    return out


def main():
    made = []
    for folder in FOLDERS:
        for name in sorted(os.listdir(os.path.join(ROOT, folder))):
            if name.endswith('.md') and name.lower() != 'readme.md':
                made.append(convert(os.path.join(ROOT, folder, name)))
    print(f'{len(made)} Word files written.')


if __name__ == '__main__':
    main()
