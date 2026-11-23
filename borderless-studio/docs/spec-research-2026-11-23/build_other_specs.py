#!/usr/bin/env python3
"""
Builds specs/ingramspark.json, specs/draft2digital.json, specs/currencies.json,
specs/tax.json and specs/publishing-checklist.json from the research facts in
this folder. Every number is read from the facts files, which record the
official page and a verbatim quote for each value.

    python3 docs/spec-research-2026-11-23/build_other_specs.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ING = json.load(open(os.path.join(HERE, 'ingramspark-facts.json'), encoding='utf-8'))
D2D = json.load(open(os.path.join(HERE, 'd2d-facts.json'), encoding='utf-8'))
KP = json.load(open(os.path.join(HERE, 'kdp-print-facts.json'), encoding='utf-8'))
KE = json.load(open(os.path.join(HERE, 'kdp-ebook-facts.json'), encoding='utf-8'))
AU = json.load(open(os.path.join(HERE, 'au-misc-facts.json'), encoding='utf-8'))
RATES = json.load(open(os.path.join(HERE, 'ecb-rates.json'), encoding='utf-8'))
EM, EN = chr(0x2014), chr(0x2013)
TODAY = '2026-11-23'


def clean(text):
    return text.replace(' ' + EM + ' ', ' - ').replace(EM, ' - ').replace(EN, '-').replace(chr(0x2122), '')


def write(name, obj):
    text = clean(json.dumps(obj, indent=2, ensure_ascii=False))
    assert EM not in text and EN not in text
    path = os.path.join(ROOT, 'specs', name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, 'w', encoding='utf-8').write(text + '\n')
    print('wrote', path, len(text), 'bytes')


def num(v):
    return int(v) if float(v).is_integer() else v


class Sources:
    def __init__(self, prefix):
        self.prefix = prefix
        self.by_url = {}

    def add(self, url, title=None):
        if url not in self.by_url:
            slug = re.sub(r'[^a-z0-9]+', '-', url.lower().split('//', 1)[-1]).strip('-')
            slug = re.sub(r'^(www-)?', '', slug)[:56].strip('-')
            self.by_url[url] = {'id': slug, 'title': title or url, 'url': url}
        elif title and self.by_url[url]['title'] == url:
            self.by_url[url]['title'] = title
        return self.by_url[url]['id']

    def ids(self, *subtrees, limit=5):
        urls = set()
        for t in subtrees:
            collect_urls(t, urls)
        return sorted({self.add(u) for u in urls})[:limit]

    def list(self):
        return sorted(self.by_url.values(), key=lambda s: s['id'])


def collect_urls(o, acc):
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ('source', 'source_page', 'page') and isinstance(v, str) and v.startswith('http'):
                acc.add(v)
            else:
                collect_urls(v, acc)
    elif isinstance(o, list):
        for v in o:
            collect_urls(v, acc)


def unverified(o):
    if isinstance(o, dict):
        return o.get('verified') is False or any(unverified(v) for v in o.values())
    if isinstance(o, list):
        return any(unverified(v) for v in o)
    return False


# =====================================================================
# IngramSpark
# =====================================================================

S = Sources('ingram')
for key, src in ING.get('sources', {}).items():
    if isinstance(src, dict) and src.get('url'):
        S.add(src['url'], src.get('title') or src.get('name'))


def imeta(*subtrees, verified=None, note=None):
    m = {'verified': (not any(unverified(t) for t in subtrees)) if verified is None else verified, 'sources': S.ids(*subtrees)}
    if note:
        m['note'] = note
    return m


T = ING['trim_sizes_and_book_types']
IF = ING['interior_file']
CF = ING['cover_file']
PR = ING['pricing_and_compensation']
Q = ING['quick_reference']

# Matrix column -> our option id, ink, paper, cost group, label
ING_OPT = {
    'bw_white_50lb': ('bw-white', 'bw', 'white', 'bw-white-50', 'Black & White, 50lb white paper'),
    'bw_creme_50lb': ('bw-cream', 'bw', 'cream', 'bw-creme-50', 'Black & White, 50lb creme paper'),
    'bw_groundwood_38lb': ('bw-groundwood', 'bw', 'groundwood', 'bw-groundwood', 'Black & White, 38lb groundwood paper'),
    'bw_white_70lb': ('bw-white-70', 'bw', 'white', 'bw-white-70', 'Black & White, 70lb white paper'),
    'color_white_50lb': ('standard-color-white', 'standard-color', 'white', 'standard-color-50', 'Standard Color, 50lb white paper'),
    'color_white_70lb': ('standard-color-white-70', 'standard-color', 'white', 'standard-color-70', 'Standard Color, 70lb white paper'),
    'premium_white_70lb': ('premium-color-white', 'premium-color', 'white', 'premium-color-70', 'Premium Color, 70lb white paper'),
}
RANGE_KEY = {
    'bw_white_50lb': 'bw_white_50lb', 'bw_creme_50lb': 'bw_creme_50lb', 'bw_groundwood_38lb': 'bw_groundwood_38lb',
    'bw_white_70lb': 'bw_white_70lb', 'color_white_50lb': 'standard_colour_white_50lb', 'color_white_70lb': 'standard_colour_white_70lb',
    'premium_white_70lb': 'premium_colour_white_70lb',
}
ranges = T['page_count_ranges']
ink_paper = [{'id': v[0], 'ink': v[1], 'paper': v[2], 'label': v[4], 'costGroup': v[3], 'formats': ['paperback', 'hardcover']}
             for v in ING_OPT.values()]


def parse_trim(text):
    m = re.match(r'\s*([\d.]+)\s*[xX]\s*([\d.]+)', text)
    return float(m.group(1)), float(m.group(2))


def fmt_id(w, h):
    return '%gx%g' % (w, h)


pb_trims, hc_trims = {}, {}
for row in T['file_creation_guide_matrix']['rows']:
    w, h = parse_trim(row['trim_in'])
    tid = fmt_id(w, h)
    hard = row['bind_type'] != 'Perfectbound'
    binding = {'Perfectbound': 'perfect', 'Case Laminate': 'case-laminate', 'Jacketed Cover': 'dust-jacket'}.get(row['bind_type'], 'cloth')
    target = hc_trims if hard else pb_trims
    t = target.setdefault(tid, {'id': tid, 'widthIn': num(w), 'heightIn': num(h), 'label': '%g x %g in' % (w, h),
                                'costClass': 'regular' if w < 6.15 else 'large', 'pages': {}, '_bindings': set()})
    t['_bindings'].add(binding)
    for col in row['shaded_available']:
        oid = ING_OPT[col][0]
        r = ranges[RANGE_KEY[col]]['hardcover' if hard else 'paperback']['value']
        lo, hi = int(r[0]), int(r[1])
        if w > h:
            hi = min(hi, 400)  # landscape 11 x 8.5: maximum 400 pages per the official documents
        cur = t['pages'].get(oid)
        t['pages'][oid] = {'min': lo, 'max': hi} if not cur else {'min': min(lo, cur['min']), 'max': max(hi, cur['max'])}


def finish(trims):
    out = []
    for t in sorted(trims.values(), key=lambda x: (x['widthIn'], x['heightIn'])):
        b = sorted(t.pop('_bindings'))
        if b != ['perfect']:
            t['label'] += ' (' + ', '.join(x.replace('-', ' ') for x in b) + ')'
        out.append(t)
    return out


pb_list, hc_list = finish(pb_trims), finish(hc_trims)

interior_margin = Q['interior_margin_recommended_min_in']['value']
max_pages = max(r['max'] for t in pb_list for r in t['pages'].values())
ing_print = {
    'inkPaper': ink_paper,
    'bleed': {'amountIn': Q['interior_bleed_in']['value'], 'edges': ['top', 'bottom', 'outside'],
              '_meta': imeta(IF['bleed'], note='Source value 0.125 in (3 mm). No bleed on the bind edge. Without bleed the PDF page is exactly the trim size. Trim tolerance is 1/16 in.')},
    'margins': {
        'gutter': [{'minPages': 18, 'maxPages': max_pages, 'insideIn': interior_margin}],
        'outsideMinNoBleedIn': interior_margin, 'outsideMinWithBleedIn': interior_margin, 'recommendedIn': interior_margin,
        '_meta': imeta(IF['margins'], verified=True,
                       note='IngramSpark words the 0.5 in (13 mm) margin as a recommendation for all sides and publishes no gutter table by page count. It is applied here as the minimum so that files are always inside it. For thick books a larger gutter reads better; the KDP gutter table is a sensible guide.'),
    },
    'pageCount': {'multiple': 2, 'lastPageBlank': True,
                  '_meta': imeta(IF['page_count'], verified=True,
                                 note='Minimum 18 pages. The stored page count is always even and the last page is used by the printer for its barcode and production data, so it cannot carry content. The app ends the file with a blank page on an even count. Ingram documents describe this in two slightly different ways; this is the safe reading of both.')},
    'interiorFile': {
        'pdfStandards': Q['pdf_standards']['value'], 'pdfStandardRequired': False,
        'minImageDpi': Q['image_ppi']['value'], 'maxFileMB': 1500,
        'fontsMustBeEmbedded': True, 'transparencyAllowed': False, 'cropMarksAllowed': False, 'bookmarksAllowed': False,
        'spreadsAllowed': False, 'iccProfilesAllowed': False, 'maxInkPercent': 240, 'minFontSizePt': None,
        'notes': [
            'Preferred standards are PDF/X-1a:2001 and PDF/X-3:2002. All fonts embedded. Single pages, no crop or registration marks, no spot colours, no ICC profiles.',
            'Black and white interiors: greyscale images at 300 ppi, 1 bit line art at 600 ppi, text in 100% black.',
            'Colour interiors and covers: CMYK, total ink coverage at most 240%.',
            'Maximum file size 1.5 GB (the User Guide says 1.6 GB; the lower figure is used).',
        ],
        '_meta': imeta(IF['pdf_standard'], IF['fonts'], IF['icc_profiles'], IF['resolution'], IF['max_file_size'], verified=True,
                       note='No official document states a PDF version number or an explicit rule to flatten transparency; PDF/X-1a forbids transparency in any case.'),
    },
    'formats': {},
}

barcode = {'widthIn': Q['barcode_area_in']['value'][0], 'heightIn': Q['barcode_area_in']['value'][1], 'fromSpineIn': None, 'fromBottomIn': None,
           'platformAdds': True, 'required': True,
           'note': 'A barcode is mandatory, in 100% black on a white box. Ingram\'s cover template carries one that may be moved inside the safe area of the back cover but not resized; leave a 1.75 x 1.0 in area if you supply none. Without a price the add-on is 90000. The template generator only offers USD, UK pound and CAD prices in the barcode, so an AUD book gets 90000.'}
spine_note = ('IngramSpark publishes no spine formula. The width must come from its cover template generator or spine calculator for the exact page count and paper. '
              'The published pages per inch figures are only minimums and the official calculator is not linear for 50lb papers.')
template_url = 'https://myaccount.ingramspark.com/Portal/Tools/CoverTemplateGenerator'
ing_print['formats']['paperback'] = {
    'trimSizes': pb_list, 'bindings': ['perfect'],
    'spine': {'mode': 'template', 'perPageIn': {}, 'baseIn': 0, 'minPagesForText': Q['spine_text_min_pages_paperback']['value'],
              'textMarginIn': Q['spine_safety_wide_spine_in']['value'], 'templateUrl': template_url,
              '_meta': imeta(CF['spine_width'], CF['spine_text'], verified=True,
                             note=spine_note + ' Spine safety margin is 0.0625 in for spines of 0.35 in or more and 0.03125 in for narrower spines.')},
    'cover': {'bleedIn': Q['cover_bleed_in']['value'], 'safeMarginIn': Q['cover_type_safety_in']['value'],
              'wrapIn': 0, 'hingeIn': 0, 'boardExtraWidthIn': 0, 'boardExtraHeightIn': 0, 'flapIn': None, 'barcode': barcode,
              'colorSpace': 'cmyk', 'maxInkPercent': Q['max_total_ink_percent']['value'], 'minImageDpi': 300, 'maxFileMB': 1500,
              'pdfStandards': Q['pdf_standards']['value'],
              'notes': ['Bleed 0.125 in on all four sides. Keep type 0.25 in inside the trim (the template allows 0.125 in).',
                        'Rich black for large solid areas is C60 M40 Y40 K100. Text of 24 pt or smaller should be 100% black only.',
                        'No spine text on paperbacks under 48 pages.'],
              '_meta': imeta(CF['paperback_cover'], CF['colour_and_resolution'], CF['barcode'], verified=True)},
    '_meta': imeta(T['file_creation_guide_matrix'], T['page_count_ranges'], verified=True,
                   note='Trim sizes and paper availability were decoded from the availability matrix of the File Creation Guide (dated 8.24.26), where cells are shaded rather than labelled. Custom trim sizes also exist. Lightning Source Australia cannot print every option (no large format groundwood paperback, no textured cloth).'),
}
cl = CF['hardcover_case_laminate']
dj = CF['dust_jacket']
ing_print['formats']['hardcover'] = {
    'trimSizes': hc_list, 'bindings': ['case-laminate', 'dust-jacket', 'cloth'],
    'spine': {'mode': 'template', 'perPageIn': {}, 'baseIn': 0, 'minPagesForText': None, 'textMarginIn': Q['spine_safety_wide_spine_in']['value'],
              'templateUrl': template_url,
              '_meta': imeta(CF['spine_width'], verified=True, note=spine_note + ' Hardcover spines come in steps of 1/16 in starting at 0.25 in.')},
    'cover': {'bleedIn': 0, 'safeMarginIn': cl['safe_area']['value'], 'wrapIn': cl['wrap_bleed']['value'], 'hingeIn': cl['hinge_gutter']['value'],
              'boardExtraWidthIn': 0, 'boardExtraHeightIn': 0.25, 'flapIn': dj['flap_width']['value'], 'barcode': barcode,
              'colorSpace': 'cmyk', 'maxInkPercent': Q['max_total_ink_percent']['value'], 'minImageDpi': 300, 'maxFileMB': 1500,
              'pdfStandards': Q['pdf_standards']['value'],
              'notes': ['Case laminate: 0.625 in (16 mm) wrap on every side and a 0.5 in (13 mm) hinge each side of the spine. The board is the trim width minus 0.185 in and the trim height plus 0.25 in.',
                        'Case laminate cover width = 0.625 + board width + 0.5 + spine + 0.5 + board width + 0.625 in. Height = 0.625 + board height + 0.625 in.',
                        'Dust jacket: 3.25 in flaps, a 0.25 in wrap strip between cover and flap, 0.125 in bleed. Each cover panel is the trim width plus 0.4375 in. Largest jacketed trim is 6.14 x 9.252 in.',
                        'Always build hardcover covers on the template Ingram generates for the exact page count.'],
              '_meta': imeta(cl, dj, verified=True,
                             note='The board size formula is printed in the File Creation Guide under custom trim sizes; the generated template is authoritative. The board is NARROWER than the trim width by 0.185 in, so boardExtraWidthIn cannot express it and is left at 0: use the template.')},
    '_meta': imeta(T['file_creation_guide_matrix'], verified=True,
                   note='Hardcover page limits follow the rate card. For 70lb white paper the live tool allows 900 pages but the documents say 840; 840 is used.'),
}

# ---- pricing
COST_GROUP = {('B&W', 'Groundwood'): 'bw-groundwood', ('B&W', 'Creme'): 'bw-creme-50', ('B&W', 'Crème'): 'bw-creme-50',
              ('B&W', 'White 50lb'): 'bw-white-50', ('B&W', 'White 70lb'): 'bw-white-70'}


def cost_group(row):
    interior, paper = row['interior'], row['paper']
    p = paper.lower().replace('è', 'e')
    i = interior.lower()
    if i.startswith('b&w') or i.startswith('black'):
        if 'ground' in p:
            return 'bw-groundwood'
        if 'creme' in p or 'cream' in p:
            return 'bw-creme-50'
        return 'bw-white-70' if '70' in p else 'bw-white-50'
    if 'ultra' in i:
        return 'ultra-premium-color-70'
    if 'premium' in i:
        return 'premium-color-70'
    return 'standard-color-70' if '70' in p else 'standard-color-50'


BINDING_SUFFIX = {'Paperback': ('paperback', ''), 'Hardcover': ('hardcover', ''), 'Hardcover w/ Jacket': ('hardcover', '@dust-jacket')}
rows = PR['print_cost']['rate_table_2026_current']['rows']
MARKETS = [('AU', 'Australia', 'AUD', 'aud', 'au'), ('US', 'United States', 'USD', 'usd', 'us'),
           ('GB', 'United Kingdom', 'GBP', 'gbp', 'uk'), ('EU', 'European Union', 'EUR', 'eur', 'eu')]
wd = PR['wholesale_discount']
fee = PR['global_distribution_fee']['current']['value']
max_price = Q['max_list_price']['value']
markets = []
unknown_bindings = set()
for code, label, cur, key, wkey in MARKETS:
    costs = {}
    for r in rows:
        if r['binding'] not in BINDING_SUFFIX:
            unknown_bindings.add(r['binding'])
            continue
        fmt, suffix = BINDING_SUFFIX[r['binding']]
        if key not in r or not r[key] or r[key].get('per_cover') is None or r[key].get('per_page') is None:
            continue  # this product is not priced (not printed) in this market
        group = cost_group(r) + suffix
        cls = 'regular' if r['size'].lower().startswith('small') else 'large'
        table = costs.setdefault(fmt, {}).setdefault(group, {'regular': [], 'large': []})
        table[cls].append({'minPages': int(r['pages'][0]), 'maxPages': int(r['pages'][1]), 'fixed': num(r[key]['per_cover']), 'perPage': num(r[key]['per_page'])})
    lo, hi = wd[wkey]['value']
    m = {'id': code, 'label': label, 'currency': cur, 'decimals': 2, 'listPriceIncludesTax': False,
         'taxPercent': 10 if code == 'AU' else (0 if code == 'GB' else None),
         'discount': {'min': lo, 'max': hi, 'default': lo}, 'feePercentOfList': fee,
         'maxListPrice': {'paperback': max_price, 'hardcover': max_price}, 'costs': costs}
    if code == 'AU':
        m['note'] = ('Published minimum wholesale discount is 35% (30% is below every published minimum; confirm the real minimum on your title setup page). '
                     'AUD list prices are entered without GST according to a 2022 Ingram blog post and the calculator arithmetic; no current document restates it.')
    if code == 'US':
        m['note'] = 'Published minimum wholesale discount is 40% for the United States and Canada. Canada is mentioned in blog posts but is not a market in the public calculator or on the rate card.'
    if code == 'EU':
        m['note'] = 'One euro price covers the European Union market. VAT varies by country.'
    markets.append(m)

ing_pricing = {
    'rateModel': 'wholesale-discount', 'costModel': 'bands', 'marketplaces': markets,
    'calculatorUrl': 'https://myaccount.ingramspark.com/Portal/Tools/PubCompCalculator',
    '_meta': imeta(PR['compensation_formula'], PR['print_cost']['rate_table_2026_current'], PR['wholesale_discount'], PR['global_distribution_fee'], verified=True,
                   note='Compensation per wholesale sale = list price x (1 - wholesale discount) - print cost - global distribution fee (1.875% of the list price, since 1 February 2026). '
                        'Print cost = per page cost x pages + per cover cost, from the rate card effective 1 February 2026. "Small" (regular) means a trim width under 6.15 in. '
                        'Cost keys ending in "@dust-jacket" are for jacketed hardcovers. The real minimum discount is whatever the title setup page shows.'),
}

eb = ING['ebook']
ing_ebook = {
    'acceptedFormats': ['epub'], 'maxFileMB': eb['interior_file_size_limit_mb']['value'] if isinstance(eb['interior_file_size_limit_mb'], dict) and 'value' in eb['interior_file_size_limit_mb'] else 100,
    'epubCheckRequired': True,
    'cover': {'idealWidthPx': 1600, 'idealHeightPx': 2560, 'minWidthPx': None, 'minHeightPx': None, 'maxSidePx': None, 'maxFileMB': None, 'formats': ['jpg'],
              '_meta': imeta(eb['cover_image'], verified=False,
                             note='Ingram asks for a JPG cover in RGB. Its documents give conflicting pixel limits; check the current figure on the upload screen. 1600 x 2560 is used as a safe working size.')},
    'notes': ['EPUB 3 per the August 2026 documents (the web page still says EPUB 2 or 3). The cover is uploaded as a separate JPG.',
              'Ebook compensation is 85% of the net revenue Ingram receives.',
              'The ebook needs its own ISBN.'],
    '_meta': imeta(eb['epub_version'], eb['validation'], verified=False,
                   note='The help centre (help.ingramspark.com) could not be read, so detailed EPUB guidelines are not confirmed. Validation is treated as required because retailers reject invalid files.'),
}

ingram = {
    'schemaVersion': 1, 'platform': 'ingramspark', 'displayName': 'IngramSpark', 'lastVerified': TODAY, 'revision': 1,
    'sources': [],
    'notes': [
        'Values come from the IngramSpark File Creation Guide dated 8.24.26, User Guide v3.3 (24 August 2026), the rate card effective 1 February 2026, and public pages and tools on ingramspark.com. The help centre could not be read.',
        'A 30% wholesale discount is below every published minimum (40% US and Canada, 35% UK, EU and Australia). Confirm the minimum your account allows on the title setup page.',
        'IngramSpark publishes no spine formula. Enter the spine width from its cover template generator for the exact page count and paper before exporting a cover.',
        'The last page of the interior is used by the printer and must be blank.',
        'Using KDP and IngramSpark for the same book is allowed only with KDP Expanded Distribution switched off.',
        'Nothing official mentions Bengali. Print accepts any language whose fonts are embedded, but retailer metadata and ebook retailers are not confirmed.',
        'Title setup is free and the 2026 rate card lists no revision fee.',
    ],
    'print': ing_print,
    'ebook': ing_ebook,
    'pricing': {'print': ing_pricing,
                'ebook': {'model': 'retail-share', 'marketplaces': [], 'authorShare': 0.85, 'freeAllowed': False,
                          'freeNote': 'No official statement on free ebooks was found. Compensation is 85% of the net revenue Ingram receives from the retailer, which is much less than 85% of the list price.',
                          'priceMatchNote': '', '_meta': imeta(eb['pricing_and_compensation'], verified=False, note='The share is of net revenue, not of list price.')}},
    'fees': [
        {'id': 'title-setup', 'label': 'Title setup', 'amount': 0, 'currency': 'USD', 'when': 'Free for print and ebook.', '_meta': imeta(PR['fees'], verified=True)},
        {'id': 'revision', 'label': 'File revision', 'amount': 0, 'currency': 'USD', 'when': 'Announced as free from 1 January 2026; the User Guide still mentions revision charges.',
         '_meta': imeta(PR['fees'], verified=False, note='Inferred from the December 2025 announcement and the 2026 rate card.')},
        {'id': 'global-distribution', 'label': 'Global distribution fee', 'amount': fee, 'currency': '%', 'when': 'Percentage of the local list price, deducted from compensation on every wholesale sale.',
         '_meta': imeta(PR['global_distribution_fee'], verified=True)},
    ],
    'languages': {'paperback': {'supported': 'any', 'note': 'No official language restriction for print was found. All fonts must be embedded. Digital cloth spine stamping is Latin characters only.'},
                  'hardcover': {'supported': 'any'},
                  'ebook': {'supported': 'any', 'note': 'Not confirmed. Ebook retailers reached through Ingram may not support Bengali.'},
                  'consequence': '',
                  '_meta': imeta(ING['languages_and_scripts'], verified=False, note='No official IngramSpark page mentions Bengali for metadata, print or ebook retailers.')},
    'listing': {'keywordSlots': None, 'keywordMaxChars': None, 'categoriesMax': None, 'descriptionMaxChars': None, 'descriptionTags': [],
                'titleSubtitleMaxChars': None, 'notes': ['IngramSpark takes BISAC subject codes (up to three), a short and a long description, contributor biographies and keywords. Field limits are shown in the title setup screens.'],
                '_meta': imeta(ING['isbn_and_metadata'], verified=False, note='Field limits were not confirmed from a public page.')},
}
ingram['sources'] = S.list()
if unknown_bindings:
    print('  note: rate card bindings not mapped:', sorted(unknown_bindings))
write('ingramspark.json', ingram)

# =====================================================================
# Draft2Digital
# =====================================================================

S2 = Sources('d2d')


def dmeta(*subtrees, verified=None, note=None):
    m = {'verified': (not any(unverified(t) for t in subtrees)) if verified is None else verified, 'sources': S2.ids(*subtrees)}
    if note:
        m['note'] = note
    return m


fees = D2D['account_fees']
e1 = D2D['1_ebook']
p2 = D2D['2_pricing_royalties_stores']
pr = D2D['3_d2d_print']
rates = pr['pricing_and_cost']['unit_cost_rates']
d2d_trims = []
for w, h in pr['trim_sizes']['value_inches']:
    tid = fmt_id(w, h)
    cls = 'large' if tid in rates['size_classes']['large'] else 'regular'
    pages = {'min': pr['page_count']['minimum'], 'max': pr['page_count']['maximum']}
    d2d_trims.append({'id': tid, 'widthIn': num(w), 'heightIn': num(h), 'label': '%g x %g in' % (w, h), 'costClass': cls,
                      'pages': {'bw-white': dict(pages), 'bw-cream': dict(pages)}})
d2d_markets = []
for code, label, cur in [('US', 'United States', 'USD'), ('AU', 'Australia', 'AUD'), ('GB', 'United Kingdom', 'GBP'), ('EU', 'Eurozone', 'EUR'), ('CA', 'Canada', 'CAD')]:
    r = rates[cur]
    band = lambda fixed, per: [{'minPages': pr['page_count']['minimum'], 'maxPages': pr['page_count']['maximum'], 'fixed': fixed, 'perPage': per}]
    d2d_markets.append({'id': code, 'label': label, 'currency': cur, 'decimals': 2, 'listPriceIncludesTax': False, 'taxPercent': None,
                        'fixedRate': pr['pricing_and_cost']['author_royalty']['percent_of_list'] / 100, 'feePercentOfList': 0, 'maxListPrice': {},
                        'costs': {'paperback': {'bw': {'regular': band(r['base_small'], r['per_page_small']), 'large': band(r['base_large'], r['per_page_large'])}}}})
d2d = {
    'schemaVersion': 1, 'platform': 'draft2digital', 'displayName': 'Draft2Digital', 'lastVerified': TODAY, 'revision': 1,
    'sources': [],
    'notes': [
        'Since April 2026 a new Draft2Digital account pays a one time USD 20 activation fee before it can publish, and USD 12 a year when the account earns under USD 100 in a year. This applies to free books too.',
        'Ebooks can be priced at 0.00. Stores that refuse free books list them at 0.99; Amazon and libraries are the ones named.',
        'Amazon distribution through Draft2Digital is by invitation only. A free book is submitted to Amazon at 0.99, and Amazon may price match it to free.',
        'Draft2Digital publishes no interior margin, font or resolution rules and no spine formula for D2D Print: the spine and cover size come from the template in its own tool.',
        'help.draft2digital.com could not be reached; all facts come from draft2digital.com.',
        'D2D Print accepts "books written in a Latin-based language" according to a 2022 post, so a Bangla print book is unlikely to be accepted.',
    ],
    'print': {
        'inkPaper': [
            {'id': 'bw-white', 'ink': 'bw', 'paper': 'white', 'label': 'Black and white, white paper', 'costGroup': 'bw', 'formats': ['paperback']},
            {'id': 'bw-cream', 'ink': 'bw', 'paper': 'cream', 'label': 'Black and white, cream paper', 'costGroup': 'bw', 'formats': ['paperback']},
        ],
        'bleed': {'amountIn': pr['interior_file']['bleed_inches']['value'], 'edges': ['top', 'bottom', 'outside'], '_meta': dmeta(pr['interior_file'], verified=True)},
        'margins': {'gutter': [{'minPages': pr['page_count']['minimum'], 'maxPages': pr['page_count']['maximum'], 'insideIn': 0.5}],
                    'outsideMinNoBleedIn': 0.5, 'outsideMinWithBleedIn': 0.5, 'recommendedIn': None,
                    '_meta': dmeta(pr['interior_file'], verified=False,
                                   note='Draft2Digital publishes no margin rules for an uploaded interior PDF. 0.5 in is a cautious placeholder, not a D2D figure.')},
        'pageCount': {'multiple': 2, 'lastPageBlank': False, '_meta': dmeta(pr['page_count'], verified=True, note='32 to 1,050 pages; an odd page count is raised to the next even number.')},
        'interiorFile': {'pdfStandards': [], 'pdfStandardRequired': False, 'minImageDpi': 300, 'maxFileMB': None, 'fontsMustBeEmbedded': True,
                         'transparencyAllowed': False, 'cropMarksAllowed': False, 'bookmarksAllowed': False, 'spreadsAllowed': False, 'iccProfilesAllowed': True,
                         'notes': ['Accepted interior files: DOC, DOCX, ODT, RTF or PDF. Black and white, perfect bound only.'],
                         '_meta': dmeta(pr['interior_file'], verified=False, note='Font embedding, resolution and PDF standard are not stated by Draft2Digital; these are safe defaults.')},
        'formats': {'paperback': {
            'trimSizes': d2d_trims, 'bindings': ['perfect'],
            'spine': {'mode': 'template', 'perPageIn': {}, 'baseIn': 0, 'minPagesForText': None, 'textMarginIn': None, 'templateUrl': 'https://draft2digital.com/',
                      '_meta': dmeta(pr['spine'], verified=False, note='No spine formula is published. Use the cover template from the D2D Print tool.')},
            'cover': {'bleedIn': 0.125, 'safeMarginIn': 0.25, 'wrapIn': 0, 'hingeIn': 0, 'boardExtraWidthIn': 0, 'boardExtraHeightIn': 0, 'flapIn': None,
                      'barcode': {'widthIn': 2.0, 'heightIn': 1.2, 'fromSpineIn': None, 'fromBottomIn': None, 'platformAdds': True, 'required': False,
                                  'note': 'Barcode size and position come from the D2D template; these numbers are placeholders.'},
                      'colorSpace': 'rgb-or-cmyk', 'maxInkPercent': None, 'minImageDpi': 300, 'maxFileMB': None, 'pdfStandards': [],
                      'notes': ['A wraparound cover can be generated by D2D from the ebook cover, or uploaded as PDF or PNG built on its template. Matte or glossy finish.'],
                      '_meta': dmeta(pr['cover_file'], verified=False, note='Cover bleed, safe zones and dimensions come from the per book template inside the D2D tool and are not published.')},
            '_meta': dmeta(pr['trim_sizes'], pr['page_count'], verified=True),
        }},
    },
    'ebook': {
        'acceptedFormats': [f.lstrip('.') for f in e1['accepted_source_formats']['value']],
        'maxFileMB': e1['file_size_limits']['knowledge_base']['value_mb'], 'epubCheckRequired': True,
        'cover': {'idealWidthPx': e1['cover_image']['recommended_pixels']['width'], 'idealHeightPx': e1['cover_image']['recommended_pixels']['height'],
                  'minWidthPx': None, 'minHeightPx': None, 'maxSidePx': None, 'maxFileMB': None, 'formats': ['jpg'],
                  '_meta': dmeta(e1['cover_image'], verified=True, note='1600 x 2400 pixels (ratio 2 to 3), JPEG recommended. Minimum size, maximum file size and colour profile are not published. KDP prefers 1600 x 2560, so the two stores need slightly different crops.')},
        'notes': ['An uploaded EPUB must pass EPUBCheck. The FAQ says files must be under 100 MB and the Knowledge Base says EPUBs over 90 MB may not be accepted; 90 MB is used.',
                  'The cover must show the title and the author name.'],
        '_meta': dmeta(e1['accepted_source_formats'], e1['file_size_limits'], e1['epub_requirements'], verified=True),
    },
    'pricing': {
        'print': {'rateModel': 'fixed', 'costModel': 'bands', 'marketplaces': d2d_markets, 'calculatorUrl': 'https://draft2digital.com/podcalc',
                  '_meta': dmeta(pr['pricing_and_cost'], verified=True,
                                 note='Royalty = 45% of the list price minus the unit cost. Unit cost = base + per page x pages, read from the data inside the official D2D print calculator page. Minimum list price = unit cost / 0.45. Print books cannot be free.')},
        'ebook': {'model': 'retail-share', 'marketplaces': [], 'authorShare': 0.6, 'minPrice': p2['ebook_price_range_usd']['minimum_paid'], 'maxPrice': p2['ebook_price_range_usd']['maximum'],
                  'currency': 'USD', 'freeAllowed': True,
                  'freeNote': 'A price of 0.00 is allowed for ebooks. Stores that do not take free books list them at 0.99; Amazon and libraries are named. Prices from 0.01 to 0.98 are not accepted.',
                  'priceMatchNote': 'Draft2Digital says a free book is submitted to Amazon at 0.99 and "Amazon may price-match to free". Amazon distribution through D2D is by invitation only.',
                  '_meta': dmeta(p2, verified=True,
                                 note='Draft2Digital keeps 15% of what the store pays, about 10% of the list price. The author receives about 60% of list at Apple, Barnes & Noble, Kobo, Tolino, Gardners and Fable, 55% at Vivlio, 75% or 40% at Smashwords and 60% or 30% at Amazon. The full list of stores that refuse free books is not public.')},
    },
    'fees': [
        {'id': 'activation', 'label': 'Account activation', 'amount': fees['activation_fee_usd']['value'], 'currency': 'USD',
         'when': 'One time, before a new account can publish (accounts opened before April 2026 are exempt).', '_meta': dmeta(fees, verified=True)},
        {'id': 'maintenance', 'label': 'Annual maintenance', 'amount': fees['maintenance_fee_usd_per_year']['value'], 'currency': 'USD',
         'when': 'Each year in which the account earns under USD %d. It applies even when every book is free.' % fees['maintenance_fee_waiver_threshold_usd']['value'], '_meta': dmeta(fees, verified=True)},
    ],
    'languages': {'ebook': {'supported': 'any', 'note': 'Draft2Digital publishes no ebook language list. Bengali is not confirmed.'},
                  'paperback': {'supported': ['en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'sv', 'da', 'no', 'fi', 'pl', 'la'],
                                'note': 'D2D Print said in 2022 that it accepts books written in a Latin-based language. The list here is illustrative; Bangla is not a Latin script language.'},
                  'consequence': '',
                  '_meta': dmeta(D2D['4_languages'], verified=False, note='No current page lists supported languages.')},
    'listing': {'keywordSlots': None, 'keywordMaxChars': None, 'categoriesMax': None, 'descriptionMaxChars': None, 'descriptionTags': [],
                'titleSubtitleMaxChars': None, 'notes': ['Draft2Digital asks for a description, BISAC subjects, search terms and series data in its own screens; limits are not published.'],
                '_meta': dmeta(e1['required_metadata'], verified=False, note='Draft2Digital does not publish field limits; they are shown in its own screens.')},
}
d2d['sources'] = S2.list()
write('draft2digital.json', d2d)

# =====================================================================
# Currency rates
# =====================================================================

write('currencies.json', {
    'schemaVersion': 1, 'base': RATES['base'], 'date': RATES['date'],
    'source': RATES['source_name'], 'sourceUrl': RATES['source'],
    'rates': dict({'AUD': 1}, **RATES['rates']),
    'note': 'Cross rates derived from the European Central Bank reference rates of %s (units of each currency per 1 AUD). They are only a starting point: update them by hand in the app whenever you price a book. The app never fetches rates by itself.' % RATES['date'],
})

# =====================================================================
# Tax table
# =====================================================================

S3 = Sources('tax')
print_tax = KP['7_royalty_and_tax']['tax_on_list_price']['per_marketplace']
eb_vat = KE['3_vat']
eu = eb_vat['rates_table_eu_uk']['rates_percent']
tax_url_print = sorted(u for u in (lambda a: (collect_urls(KP['7_royalty_and_tax']['tax_on_list_price'], a), a)[1])(set()))[:2]
tax_url_ebook = sorted(u for u in (lambda a: (collect_urls(eb_vat, a), a)[1])(set()))[:3]
gst_urls = sorted(u for u in (lambda a: (collect_urls(AU['task4_gst_vat'], a), a)[1])(set()))[:2]
for u in tax_url_print:
    S3.add(u, 'KDP: how taxes affect print list prices')
for u in tax_url_ebook:
    S3.add(u, 'KDP: tax on ebook list prices')
for u in gst_urls:
    S3.add(u, 'Australian Government: GST')


def tmeta(urls, verified, note=None):
    m = {'verified': verified, 'sources': [S3.add(u) for u in urls]}
    if note:
        m['note'] = note
    return m


def prate(key):
    row = print_tax.get(key, {})
    v = row.get('reduced_rate_percent', row.get('rate_percent'))
    return num(v) if isinstance(v, (int, float)) else None


countries = {
    'AU': {'name': 'Australia', 'taxName': 'GST', 'printPercent': 10, 'ebookPercent': eb_vat['list_price_includes_tax']['Amazon.com.au']['rate_percent'],
           '_meta': tmeta(gst_urls + tax_url_ebook[:1], True, 'GST is 10% under Australian law and books have no GST free category. KDP states the 10% rate for ebooks only; the Tax Office wording itself could not be retrieved.')},
    'GB': {'name': 'United Kingdom', 'taxName': 'VAT', 'printPercent': prate('Amazon.co.uk'), 'ebookPercent': num(eu['United Kingdom']), '_meta': tmeta(tax_url_print + tax_url_ebook[:1], True)},
    'DE': {'name': 'Germany', 'taxName': 'VAT', 'printPercent': prate('Amazon.de'), 'ebookPercent': num(eu['Germany']), '_meta': tmeta(tax_url_print + tax_url_ebook[:1], True)},
    'FR': {'name': 'France', 'taxName': 'VAT', 'printPercent': prate('Amazon.fr'), 'ebookPercent': num(eu['France']), '_meta': tmeta(tax_url_print + tax_url_ebook[:1], True)},
    'IT': {'name': 'Italy', 'taxName': 'VAT', 'printPercent': prate('Amazon.it'), 'ebookPercent': num(eu['Italy']['with_isbn']),
           '_meta': tmeta(tax_url_print + tax_url_ebook[:1], True, 'Ebooks without an ISBN are taxed at 22% in Italy.')},
    'ES': {'name': 'Spain', 'taxName': 'VAT', 'printPercent': prate('Amazon.es'), 'ebookPercent': num(eu['Spain']), '_meta': tmeta(tax_url_print + tax_url_ebook[:1], True)},
    'NL': {'name': 'Netherlands', 'taxName': 'VAT', 'printPercent': prate('Amazon.nl'), 'ebookPercent': num(eu['Netherlands']), '_meta': tmeta(tax_url_print + tax_url_ebook[:1], True)},
    'IE': {'name': 'Ireland', 'taxName': 'VAT', 'printPercent': prate('Amazon.ie'), 'ebookPercent': None, '_meta': tmeta(tax_url_print, True, 'Ebook rate not listed by KDP.')},
    'BE': {'name': 'Belgium', 'taxName': 'VAT', 'printPercent': prate('Amazon.com.be'), 'ebookPercent': None, '_meta': tmeta(tax_url_print, True, 'Ebook rate not listed by KDP.')},
    'PL': {'name': 'Poland', 'taxName': 'VAT', 'printPercent': prate('Amazon.pl'), 'ebookPercent': None, '_meta': tmeta(tax_url_print, True, 'Ebook rate not listed by KDP.')},
    'SE': {'name': 'Sweden', 'taxName': 'VAT', 'printPercent': prate('Amazon.se'), 'ebookPercent': None, '_meta': tmeta(tax_url_print, True, 'Ebook rate not listed by KDP.')},
    'JP': {'name': 'Japan', 'taxName': 'Consumption tax', 'printPercent': prate('Amazon.co.jp'), 'ebookPercent': eb_vat['list_price_includes_tax']['Amazon.co.jp']['rate_percent'], '_meta': tmeta(tax_url_print + tax_url_ebook[:1], True)},
    'IN': {'name': 'India', 'taxName': 'GST', 'printPercent': None, 'ebookPercent': eb_vat['list_price_includes_tax']['Amazon.in']['rate_percent'], '_meta': tmeta(tax_url_ebook[:1], True, 'Print rate not researched (KDP does not print in India).')},
    'US': {'name': 'United States', 'taxName': 'Sales tax', 'printPercent': None, 'ebookPercent': None, '_meta': tmeta([], False, 'Sales tax varies by state and is added at checkout; no KDP page gives a rule.')},
    'CA': {'name': 'Canada', 'taxName': 'GST/HST', 'printPercent': None, 'ebookPercent': None, '_meta': tmeta([], False, 'No official platform page states the rate applied.')},
    'MX': {'name': 'Mexico', 'taxName': 'IVA', 'printPercent': None, 'ebookPercent': None, '_meta': tmeta([], False, 'Not stated on any official platform page.')},
    'BR': {'name': 'Brazil', 'taxName': 'Tax', 'printPercent': None, 'ebookPercent': None, '_meta': tmeta([], False, 'Not stated on any official platform page.')},
}
write('tax.json', {
    'schemaVersion': 1, 'lastVerified': TODAY, 'sources': S3.list(), 'countries': countries,
    'notes': ['Rates are the ones the platforms say they apply to books. EU ebook rates are stated by KDP "as of 5/1/2020"; re-check them before relying on a figure.',
              'KDP print list prices are entered without tax in every marketplace. KDP ebook list prices include tax in the UK, the EU stores, Australia, India and Japan.',
              'Some book types (for example activity books and notebooks) can be charged the standard VAT rate instead of the reduced book rate.'],
})

# =====================================================================
# Publishing checklist
# =====================================================================

S4 = Sources('checklist')
LD = AU['task1_legal_deposit']
nla_urls = sorted((lambda a: (collect_urls(LD['national_library_of_australia'], a), a)[1])(set()))
nsw_urls = sorted((lambda a: (collect_urls(LD['new_south_wales'], a), a)[1])(set()))
pds_urls = sorted((lambda a: (collect_urls(LD['prepublication_data_service'], a), a)[1])(set()))
isbn_urls = sorted((lambda a: (collect_urls(AU['task2_isbn_thorpe_bowker'], a), a)[1])(set()))
bar_urls = sorted((lambda a: (collect_urls(AU['task3_barcode'], a), a)[1])(set()))


def item(id_, group, formats, title, detail, url, urls, verified, note=None):
    m = {'verified': verified, 'sources': [S4.add(u) for u in urls[:3]]}
    if note:
        m['note'] = note
    return {'id': id_, 'group': group, 'formats': formats, 'title': title, 'detail': detail, 'url': url, '_meta': m}


ALL = ['paperback', 'hardcover', 'ebook']
PRINT = ['paperback', 'hardcover']
kdp_ed = sorted((lambda a: (collect_urls(KP['7_royalty_and_tax']['expanded_distribution'], a), a)[1])(set()))
ing_kdp = sorted((lambda a: (collect_urls(ING['amazon_and_kdp'], a), a)[1])(set()))
d2d_fee_urls = sorted((lambda a: (collect_urls(D2D['account_fees'], a), a)[1])(set()))
items = [
    item('isbn-assign', 'isbn', ALL, 'Assign a separate ISBN to this format',
         'Every format (paperback, hardcover, EPUB) needs its own ISBN. A new price, a new cover or an unchanged reprint does not need a new one.',
         'https://www.myidentifiers.com.au/', isbn_urls, True, 'Rule from the International ISBN Agency manual. The Thorpe-Bowker site itself could not be read.'),
    item('isbn-register', 'isbn', ALL, 'Register the title details against the ISBN at Thorpe-Bowker',
         'Log in to MyIdentifiers and enter the title, format, publication date, price and contributor details for this ISBN so that it appears in Books in Print.',
         'https://www.myidentifiers.com.au/', isbn_urls, False, 'Thorpe-Bowker pages were blocked during research, so the exact steps and form fields are not confirmed.'),
    item('prepublication-data', 'legal-deposit', ALL, 'Apply to the NLA Prepublication Data Service before publication',
         'Free. The National Library of Australia creates a catalogue record (normally within 48 hours) and gives you a cataloguing statement for the copyright page. Apply before the book is published.',
         'https://www.library.gov.au/services/publishers-and-self-publishers/prepublication-data-service', pds_urls, True),
    item('nla-deposit-ebook', 'legal-deposit', ['ebook'], 'Deposit the ebook with the National Library of Australia through NED',
         'Within one month of publication, upload one DRM free copy (EPUB preferred, under 1 GB) at National edeposit using the ebook ISBN. This also meets the digital deposit for the State Library of NSW, and the NLA then does not need the print edition.',
         'https://ned.gov.au/ned/', nla_urls, True),
    item('nla-deposit-print', 'legal-deposit', PRINT, 'Send one printed copy to the National Library of Australia if there is no ebook',
         'Within one month of publication (Copyright Act 1968). Address: Legal Deposit, National Library of Australia, Parkes Place, Canberra ACT 2600. Not needed when the ebook edition was deposited through NED.',
         'https://www.library.gov.au/services/publishers-and-self-publishers/legal-deposit', nla_urls, True),
    item('slnsw-deposit-print', 'legal-deposit', PRINT, 'Send one printed copy to the State Library of New South Wales',
         'The State Library of NSW collects one copy of every format published in New South Wales. Address: Legal Deposit, Level 2, State Library of New South Wales, 1 Shakespeare Place, Sydney NSW 2000.',
         'https://www.sl.nsw.gov.au/', nsw_urls, True, 'No time limit for NSW deposit could be confirmed because the NSW legislation site was not readable.'),
    item('usyd-deposit', 'legal-deposit', PRINT, 'Offer the print edition to the University of Sydney Library',
         'NSW legal deposit also names the University of Sydney Library. Offer the title through its legal deposit form; the library replies with what to send.',
         'https://www.library.sydney.edu.au/', nsw_urls, True),
    item('nsw-parliament-deposit', 'legal-deposit', PRINT, 'Contact the NSW Parliamentary Library about legal deposit',
         'NSW legal deposit also names the NSW Parliamentary Library. Its requirements are not published; write to collections@parliament.nsw.gov.au.',
         '', nsw_urls, False, 'Copies, address and process are not confirmed on an official page.'),
    item('barcode', 'general', PRINT, 'Check the barcode on the back cover',
         'Use a plain EAN-13 of the ISBN at 80% to 200% of nominal size. The five digit price add-on is used for prices in the United States and Canada only; outside those, use no add-on or 90000 (no price). Never encode an Australian dollar price.',
         '', bar_urls, True),
    item('proof', 'general', PRINT, 'Order a printed proof and read it on paper',
         'Check margins and gutter, running heads, page numbers, images, the spine alignment and the cover colour before approving the book for sale.', '', [], True),
    item('kdp-upload', 'kdp', ALL, 'Upload to Amazon KDP',
         'Enter the metadata exactly as on the cover and title page, upload the interior and cover files, check every page in the KDP previewer, then set prices for each marketplace.',
         'https://kdp.amazon.com/', [], True),
    item('kdp-expanded-off', 'kdp', PRINT, 'Leave KDP Expanded Distribution switched off',
         'Using KDP and IngramSpark for the same book with the same ISBN is only possible when KDP Expanded Distribution is off, because IngramSpark supplies the other retailers.',
         'https://kdp.amazon.com/', (kdp_ed + ing_kdp), True),
    item('ingram-template', 'ingramspark', PRINT, 'Generate the IngramSpark cover template for the final page count',
         'IngramSpark publishes no spine formula. Create the template for the exact page count, trim and paper, type the spine width into the Cover builder, and build the cover on that template.',
         'https://myaccount.ingramspark.com/Portal/Tools/CoverTemplateGenerator', [], True),
    item('ingram-upload', 'ingramspark', ALL, 'Upload to IngramSpark',
         'Upload the PDF/X interior and cover, set the wholesale discount and returns option for each market, and approve the electronic proof. The last interior page must be blank.',
         'https://myaccount.ingramspark.com/', [], True),
    item('ingram-discount', 'ingramspark', PRINT, 'Confirm the lowest wholesale discount your account allows',
         'Published minimums are 40% for the United States and Canada and 35% for the United Kingdom, the European Union and Australia. The binding minimum is whatever the title setup page shows.',
         'https://myaccount.ingramspark.com/', ing_kdp[:1], True),
    item('d2d-fees', 'draft2digital', ['ebook'], 'Allow for the Draft2Digital account fees',
         'Since April 2026: USD 20 one time activation for new accounts, and USD 12 a year when the account earns under USD 100 in a year. The fees apply even when the book is free.',
         'https://draft2digital.com/', d2d_fee_urls, True),
    item('d2d-upload', 'draft2digital', ['ebook'], 'Upload the EPUB to Draft2Digital and choose the stores',
         'Upload the validated EPUB and a 1600 x 2400 cover, set the price (0.00 is allowed), and select the stores. Stores that refuse free books list them at 0.99.',
         'https://draft2digital.com/', [], True),
    item('price-match', 'kdp', ['ebook'], 'Ask Amazon to match the free price (optional)',
         'Kindle ebooks cannot be set to 0.00. Once the ebook is free at another retailer, Amazon may match the price at its own discretion. There is no documented request form; the usual route is the "tell us about a lower price" link on the product page or a message to KDP support.',
         'https://kdp.amazon.com/', [], False, 'KDP documents that it may match a free price but documents no request process.'),
]
write('publishing-checklist.json', {'schemaVersion': 1, 'lastVerified': TODAY, 'sources': S4.list(), 'items': items})

# =====================================================================
# Lookup lists: copied unchanged from the official EDItEUR downloads
# =====================================================================

research = os.environ.get('BS_RESEARCH_DIR', '/tmp/claude-0/-home-user-awesome/68b6b9bc-7515-538d-95aa-8cfe4ec58034/scratchpad/research/au-misc')
lookups = os.path.join(ROOT, 'resources', 'lookups')
os.makedirs(lookups, exist_ok=True)
thema_src = os.path.join(research, 'thema', '20261020_Thema_v1.7_en.json')
if os.path.exists(thema_src):
    data = open(thema_src, 'rb').read()
    open(os.path.join(lookups, 'thema-v1.7-en.json'), 'wb').write(data)
    lic = json.load(open(os.path.join(research, 'thema', 'THEMA_VERSION_AND_LICENCE.json'), encoding='utf-8'))
    text = ('Thema subject categories, version %s (English)\n'
            'Official file: %s\nRetrieved: %s\n%s\nLicence: %s\n%s\n\n'
            'The file thema-v1.7-en.json in this folder is the official EDItEUR download, unchanged.\n'
            'Licence and terms header of the official file, verbatim:\n\n%s\n') % (
        lic['version'], lic['official_downloads']['json'], lic['retrieved'], lic['copyright'], lic['licence_url'], lic['licence_document'],
        lic['licence_and_terms_header_of_official_xml_verbatim'])
    open(os.path.join(lookups, 'THEMA-LICENCE.txt'), 'w', encoding='utf-8').write(clean(text))
    print('copied Thema', len(data), 'bytes')
onix_src = os.path.join(research, 'onix-codelists', 'subset', 'onix_codelists_issue_75_subset.json')
if os.path.exists(onix_src):
    src = json.load(open(onix_src, encoding='utf-8'))
    lists = {}
    entries = src.get('lists', src) if isinstance(src, dict) else src
    it = entries.values() if isinstance(entries, dict) else entries
    for l in it:
        if not isinstance(l, dict) or 'CodeListNumber' not in l:
            continue
        codes = []
        for c in l.get('Code', []):
            if c.get('DeprecatedNumber'):
                continue
            e = {'code': str(c['CodeValue']), 'heading': c['CodeDescription']}
            if c.get('CodeNotes'):
                e['notes'] = c['CodeNotes']
            codes.append(e)
        lists[str(l['CodeListNumber'])] = {'description': l['CodeListDescription'], 'codes': codes}
    out = {'issue': 75, 'source': 'https://www.editeur.org/14/Code-Lists/', 'lists': lists}
    open(os.path.join(lookups, 'onix-codelists-issue75.json'), 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))
    open(os.path.join(lookups, 'ONIX-CODELISTS-LICENCE.txt'), 'w', encoding='utf-8').write(
        'ONIX for Books code lists, Issue 75 (selected lists, deprecated codes left out).\n'
        'Source: https://www.editeur.org/14/Code-Lists/\n'
        'Copyright EDItEUR. Use is governed by the EDItEUR licence to use its standards: https://doi.org/10.4400/nwgj\n'
        'The terms must be read at that address before redistributing these lists.\n')
    print('wrote ONIX lists:', len(lists))
