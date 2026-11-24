#!/usr/bin/env python3
"""
Builds 03-business/05-money-tracker.xlsx: a sales log, costs, a royalty
statement per author and period, and a yearly summary, with formulas.

    python3 tools/make-money-tracker.py

Running it again replaces the file, so copy your filled in tracker
elsewhere first. Needs openpyxl (pip install openpyxl).
"""
import os
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '03-business', '05-money-tracker.xlsx')
NAVY = '14213D'
head = Font(bold=True, color='FFFFFF')
headfill = PatternFill('solid', fgColor=NAVY)
inputfill = PatternFill('solid', fgColor='FFF8E5')
title = Font(bold=True, size=16, color=NAVY)
note = Font(italic=True, color='666666')
money = '"$"#,##0.00'


def header(ws, cols, widths):
    for i, (c, w) in enumerate(zip(cols, widths), 1):
        cell = ws.cell(row=1, column=i, value=c)
        cell.font, cell.fill = head, headfill
        cell.alignment = Alignment(wrap_text=True, vertical='center')
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = 'A2'


wb = Workbook()
ws = wb.active
ws.title = 'How to use'
for i, (t, f) in enumerate([
    ('Borderless Publishing: money tracker', title), ('', None),
    ('1. Sales log: one row for each payout line from a platform report (KDP, IngramSpark, Draft2Digital) or each direct sale. Fill in the yellow cells.', None),
    ('   "Net receipts" is what you actually received for that line, in AUD, after the platform share and the printing cost, without GST.', None),
    ('2. Costs: every direct cost of publishing, with the title it belongs to (or "General").', None),
    ("3. Royalty statement: type the author and the period; it adds up that author's lines from the Sales log. Print it or save it as PDF and send it with the payment.", None),
    ("4. Year summary: what the books earned each year, what authors received, the costs, and the publisher's share.", None),
    ('', None),
    ("Royalty rate: the author's share of net receipts follows from the two margins in Schedule 1 of the author's agreement: Author's Margin / (Author's Margin + Publisher's Margin), or all of it when both are nothing. Type the two margins for each author in D2 and D3 of the Royalty statement sheet.", note),
    ('Keep platform reports and receipts for five years. This file is a summary, not a replacement for them.', note),
], 1):
    c = ws.cell(row=i, column=1, value=t)
    if f:
        c.font = f
ws.column_dimensions['A'].width = 130

sl = wb.create_sheet('Sales log')
header(sl, ['Date received', 'Period (e.g. 2027 H1)', 'Author', 'Title', 'Format', 'Platform', 'Market', 'Copies', 'Net receipts (AUD)', 'Notes'],
       [14, 18, 20, 30, 14, 16, 12, 9, 18, 30])
for r, row in enumerate([
    ('2027-08-15', '2027 H1', 'Dr Saad Islam', 'The Salt Road', 'Paperback', 'Amazon KDP', 'AU', 12, 14.40, 'Example row: replace or delete'),
    ('2027-08-20', '2027 H1', 'Dr Saad Islam', 'The Salt Road', 'Ebook', 'Draft2Digital', 'US', 30, 19.50, 'Example row'),
], 2):
    for c, v in enumerate(row, 1):
        sl.cell(row=r, column=c, value=v)
for r in range(2, 502):
    for c in range(1, 11):
        sl.cell(row=r, column=c).fill = inputfill
    sl.cell(row=r, column=9).number_format = money
dv = DataValidation(type='list', formula1='"Paperback,Hardcover,Large print,Ebook,Audiobook,Direct sale,Licence"', allow_blank=True)
sl.add_data_validation(dv)
dv.add('E2:E501')
dv = DataValidation(type='list', formula1='"Amazon KDP,IngramSpark,Draft2Digital,Direct,Other"', allow_blank=True)
sl.add_data_validation(dv)
dv.add('F2:F501')

co = wb.create_sheet('Costs')
header(co, ['Date', 'Year', 'Title (or General)', 'What', 'Paid to', 'Amount (AUD)', 'Receipt kept?'], [14, 8, 30, 36, 24, 16, 14])
co.append(['2027-02-01', 2027, 'The Salt Road', 'Proof copies and postage', 'IngramSpark', 38.50, 'Yes'])
for r in range(2, 302):
    for c in range(1, 8):
        co.cell(row=r, column=c).fill = inputfill
    co.cell(row=r, column=6).number_format = money

rs = wb.create_sheet('Royalty statement')
rs.column_dimensions['A'].width = 34
for col in 'BCD':
    rs.column_dimensions[col].width = 26
rs['A1'], rs['A1'].font = 'Royalty statement', title
for r, (k, v) in enumerate([('Author', 'Dr Saad Islam'), ('Period', '2027 H1'), ('Royalty rate', 0.5)], 2):
    rs.cell(row=r, column=1, value=k)
    c = rs.cell(row=r, column=2, value=v)
    c.fill = inputfill
rs['B4'].number_format = '0%'
# The author's share follows from the two margins in Schedule 1 of the agreement.
rs['C2'], rs['D2'] = "Author's Margin (AUD)", 0.5
rs['C3'], rs['D3'] = "Publisher's Margin (AUD)", 0.5
for ref in ('D2', 'D3'):
    rs[ref].fill = inputfill
    rs[ref].number_format = money
rs['B4'] = '=IF(D2+D3=0,1,D2/(D2+D3))'
rs['B4'].fill = PatternFill()
rs['C4'] = 'Author share, from the two margins'
rs['A5'], rs['B5'] = 'Statement date', '=TODAY()'
rs['B5'].number_format = 'd mmmm yyyy'
for i, c in enumerate(['Format', 'Copies', 'Net receipts (AUD)', 'Royalty (AUD)'], 1):
    cell = rs.cell(row=7, column=i, value=c)
    cell.font, cell.fill = head, headfill
formats = ['Paperback', 'Hardcover', 'Large print', 'Ebook', 'Audiobook', 'Direct sale', 'Licence']
for i, f in enumerate(formats):
    r = 8 + i
    rs.cell(row=r, column=1, value=f)
    rs.cell(row=r, column=2, value=f"=SUMIFS('Sales log'!$H:$H,'Sales log'!$C:$C,$B$2,'Sales log'!$B:$B,$B$3,'Sales log'!$E:$E,A{r})")
    rs.cell(row=r, column=3, value=f"=SUMIFS('Sales log'!$I:$I,'Sales log'!$C:$C,$B$2,'Sales log'!$B:$B,$B$3,'Sales log'!$E:$E,A{r})").number_format = money
    rs.cell(row=r, column=4, value=f'=ROUND(C{r}*$B$4,2)').number_format = money
tr = 8 + len(formats)
bold = Font(bold=True)
rs.cell(row=tr, column=1, value='Total').font = bold
rs.cell(row=tr, column=2, value=f'=SUM(B8:B{tr - 1})').font = bold
for col in (3, 4):
    c = rs.cell(row=tr, column=col, value=f'=SUM({get_column_letter(col)}8:{get_column_letter(col)}{tr - 1})')
    c.number_format, c.font = money, bold
rows = [('Carried forward from last period (if under $20)', 0, True),
        ('Paid to you this period', f'=IF(D{tr}+D{tr + 2}<20,0,D{tr}+D{tr + 2})', False),
        ('Carried forward to next period', f'=D{tr}+D{tr + 2}-D{tr + 3}', False)]
for k, (label, value, is_input) in enumerate(rows):
    r = tr + 2 + k
    rs.cell(row=r, column=1, value=label).font = bold if k == 1 else Font()
    c = rs.cell(row=r, column=4, value=value)
    c.number_format = money
    if is_input:
        c.fill = inputfill
rs.cell(row=tr + 6, column=1, value="Net receipts are what Borderless Publishing received after each store's share and the printing cost, without GST (Author Publishing Agreement, clause 1). Ask us for the platform reports behind any line.").font = note

ys = wb.create_sheet('Year summary')
header(ys, ['Year', 'Net receipts (AUD)', 'Author royalties', 'Direct costs', "Publisher's share after costs", 'Copies sold'], [8, 18, 16, 14, 22, 12])
for i, y in enumerate(range(2027, 2037)):
    r = 2 + i
    ys.cell(row=r, column=1, value=y)
    period = f"(LEFT('Sales log'!$B$2:$B$501,4)=TEXT(A{r},\"0\"))"
    ys.cell(row=r, column=2, value=f"=SUMPRODUCT(('Sales log'!$I$2:$I$501)*{period})").number_format = money
    ys.cell(row=r, column=3, value=f"=ROUND(B{r}*'Royalty statement'!$B$4,2)").number_format = money
    ys.cell(row=r, column=4, value=f'=SUMIFS(Costs!$F:$F,Costs!$B:$B,A{r})').number_format = money
    ys.cell(row=r, column=5, value=f'=B{r}-C{r}-D{r}').number_format = money
    ys.cell(row=r, column=6, value=f"=SUMPRODUCT(('Sales log'!$H$2:$H$501)*{period})")
ys.cell(row=13, column=1, value='Author royalties here use the standard rate on all receipts. A negative share means costs were higher than receipts that year.').font = note
wb.save(OUT)
print('Written', OUT)
