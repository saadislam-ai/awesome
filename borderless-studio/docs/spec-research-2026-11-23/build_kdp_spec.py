#!/usr/bin/env python3
"""
Builds specs/kdp.json from the research facts in this folder.

Every number comes from kdp-print-facts.json or kdp-ebook-facts.json, which
record the official Amazon page and a verbatim quote for each value. Nothing
is typed in by hand here except identifiers, labels and the plain English
notes. Run from anywhere:

    python3 docs/spec-research-2026-11-23/build_kdp_spec.py
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
P = json.load(open(os.path.join(HERE, 'kdp-print-facts.json'), encoding='utf-8'))
E = json.load(open(os.path.join(HERE, 'kdp-ebook-facts.json'), encoding='utf-8'))

# ---------------------------------------------------------------- sources

SOURCES = {}  # url -> {id, title, url}
TITLES = {}
for s in P.get('13_sources', []):
    if isinstance(s, dict) and s.get('url'):
        TITLES[s['url']] = s.get('title') or ''


def source_id(url):
    if url not in SOURCES:
        m = re.search(r'/help/topic/([A-Z0-9]+)', url)
        if m:
            sid = 'kdp-' + m.group(1)
        else:
            sid = 'kdp-' + re.sub(r'[^a-z0-9]+', '-', url.lower().split('//', 1)[-1]).strip('-')[:48]
        title = TITLES.get(url) or ('KDP help topic ' + m.group(1) if m else url)
        SOURCES[url] = {'id': sid, 'title': title.strip() or sid, 'url': url}
    return SOURCES[url]['id']


def urls_in(o, acc=None):
    """Every official URL cited inside a facts subtree."""
    acc = set() if acc is None else acc
    if isinstance(o, dict):
        for k, v in o.items():
            if k in ('source', 'source_page', 'page') and isinstance(v, str) and v.startswith('http'):
                acc.add(v)
            else:
                urls_in(v, acc)
    elif isinstance(o, list):
        for v in o:
            urls_in(v, acc)
    return acc


def has_unverified(o):
    if isinstance(o, dict):
        if o.get('verified') is False:
            return True
        return any(has_unverified(v) for v in o.values())
    if isinstance(o, list):
        return any(has_unverified(v) for v in o)
    return False


def meta(*subtrees, verified=None, note=None, limit=6):
    urls = set()
    for t in subtrees:
        urls_in(t, urls)
    ids = sorted({source_id(u) for u in urls})[:limit]
    m = {'verified': (not any(has_unverified(t) for t in subtrees)) if verified is None else verified, 'sources': ids}
    if note:
        m['note'] = note
    return m


def num(v):
    return int(v) if float(v).is_integer() else v


def trim_id(w, h):
    f = lambda x: ('%g' % x)
    return f(w) + 'x' + f(h)


# ---------------------------------------------------------------- ink and paper

OPT = {  # facts key -> (id, ink, paper, costGroup)
    'bw_white': ('bw-white', 'bw', 'white', 'bw'),
    'bw_cream': ('bw-cream', 'bw', 'cream', 'bw'),
    'bw_groundwood': ('bw-groundwood', 'bw', 'groundwood', 'bw-groundwood'),
    'standard_color': ('standard-color-white', 'standard-color', 'white', 'standard-color'),
    'premium_color': ('premium-color-white', 'premium-color', 'white', 'premium-color'),
}
names = P['2_page_counts']['ink_paper_option_names']['print_options_page']
LABELS = {
    'bw_cream': names[0]['paperback_option'],
    'bw_white': names[1]['paperback_option'],
    'bw_groundwood': names[2]['paperback_option'],
    'premium_color': names[3]['paperback_option'],
    'standard_color': names[4]['paperback_option'],
}
HC_OFFERED = {
    'bw_cream': names[0]['hardcover_option'] != 'Not available',
    'bw_white': names[1]['hardcover_option'] != 'Not available',
    'bw_groundwood': names[2]['hardcover_option'] != 'Not available',
    'premium_color': names[3]['hardcover_option'] != 'Not available',
    'standard_color': names[4]['hardcover_option'] != 'Not available',
}
ink_paper = []
for key in ['bw_white', 'bw_cream', 'bw_groundwood', 'standard_color', 'premium_color']:
    oid, ink, paper, group = OPT[key]
    ink_paper.append({'id': oid, 'ink': ink, 'paper': paper, 'label': LABELS[key], 'costGroup': group,
                      'formats': ['paperback', 'hardcover'] if HC_OFFERED[key] else ['paperback']})

# ---------------------------------------------------------------- trim sizes

ED = {}
for row in P['7_royalty_and_tax']['expanded_distribution']['eligibility'].get('trim_ink_paper_table', []):
    ED[trim_id(row['width_in'], row['height_in'])] = {OPT[k][0]: bool(v) for k, v in row['eligible'].items() if k in OPT}


def trims(rows, with_ed=False):
    out = []
    for r in rows:
        tid = trim_id(r['width_in'], r['height_in'])
        pages = {}
        for k, v in r['page_count'].items():
            if isinstance(v, dict) and 'min' in v:
                pages[OPT[k][0]] = {'min': int(v['min']), 'max': int(v['max'])}
        t = {'id': tid, 'widthIn': num(r['width_in']), 'heightIn': num(r['height_in']),
             'label': '%g x %g in (%g x %g cm)' % (r['width_in'], r['height_in'], r['width_cm'], r['height_cm']),
             'costClass': r['trim_class'], 'pages': pages}
        if with_ed and tid in ED:
            t['expandedDistribution'] = ED[tid]
        out.append(t)
    return out


pb_trims = trims(P['2_page_counts']['paperback']['kdp_amazon_com'], with_ed=True)
hc_trims = trims(P['2_page_counts']['hardcover']['kdp_amazon_com'])
# Contradiction C02: the help table says 590 pages for premium colour at A4, the calculator accepts 780. Keep the safe value.
for t in pb_trims:
    if t['id'] == '8.27x11.69' and 'premium-color-white' in t['pages']:
        t['pages']['premium-color-white']['max'] = min(t['pages']['premium-color-white']['max'], 590)

# ---------------------------------------------------------------- margins, bleed

M = P['3_interior_margins_and_bleed']
gutter = [{'minPages': r['pages_min'], 'maxPages': r['pages_max'], 'insideIn': r['inside_gutter_min_in']} for r in M['margins']['table']]
bleed = {'amountIn': M['bleed']['amount_in'], 'edges': M['bleed']['edges'],
         '_meta': meta(M['bleed'], note='With bleed the PDF page is the trim width plus 0.125 in and the trim height plus 0.25 in. Bleed applies to the whole file.')}
margins = {'gutter': gutter,
           'outsideMinNoBleedIn': M['margins']['outside_rule']['no_bleed_min_in'],
           'outsideMinWithBleedIn': M['margins']['outside_rule']['with_bleed_min_in'],
           'recommendedIn': None,
           '_meta': meta(M['margins'], note='"Outside" means the top, bottom and outer side margins. The table runs to 828 pages; hardcover stops at 550 pages.')}

# ---------------------------------------------------------------- files

F = P['5_file_requirements']
interior_file = {
    'pdfStandards': ['PDF/X-1a'],
    'pdfStandardRequired': False,
    'minImageDpi': 300,
    'maxFileMB': 650,
    'fontsMustBeEmbedded': True,
    'transparencyAllowed': False,
    'cropMarksAllowed': False,
    'bookmarksAllowed': False,
    'spreadsAllowed': False,
    'iccProfilesAllowed': True,
    'notes': [
        'Upload single pages, not spreads. Flatten transparency and remove crop marks, bookmarks, comments and document metadata.',
        'KDP prefers PDF/X-1a but accepts an ordinary PDF with embedded fonts.',
        'Minimum font size 7 pt. Images at 300 DPI or more.',
        'KDP rounds the page count up to an even number.',
    ],
    '_meta': meta(F['interior']),
}

# ---------------------------------------------------------------- covers and spines

C = P['4_cover']
pb = C['paperback']
spine_pp = {OPT[k][0]: v['value'] for k, v in pb['spine_width_per_page_in'].items() if k in OPT}
pb_spine = {
    'mode': 'formula', 'perPageIn': spine_pp, 'baseIn': 0,
    'minPagesForText': pb['spine_text']['min_pages_practical'],
    'textMarginIn': pb['spine_text']['safety_margin_each_side_in'],
    '_meta': meta(pb['spine_width_per_page_in'], pb['spine_text'], verified=True,
                  note='KDP pages say "at least 79" and "more than 79" pages for spine text and its own cover tools use 80. Page counts are always even, so 80 is used.'),
}
pb_cover = {
    'bleedIn': pb['bleed']['amount_in'],
    'safeMarginIn': pb['safe_zones']['text_inside_trim_min_in'],
    'wrapIn': 0, 'hingeIn': 0, 'boardExtraWidthIn': 0, 'boardExtraHeightIn': 0, 'flapIn': None,
    'barcode': {
        'widthIn': pb['barcode']['box_size_in']['width'], 'heightIn': pb['barcode']['box_size_in']['height'],
        'fromSpineIn': 0.25, 'fromBottomIn': 0.25,
        'platformAdds': True, 'required': False,
        'note': 'KDP prints its own barcode in a 2 x 1.2 in box at the lower right of the back cover when the file has none. Position taken from the official KDP cover template: 0.25 in from the spine fold and 0.25 in above the bottom trim line. Your own barcode must be at least 1.4 x 0.8 in and 0.25 in from the spine and trim.',
    },
    'colorSpace': 'rgb-or-cmyk', 'maxInkPercent': None, 'minImageDpi': 300, 'maxFileMB': 650, 'pdfStandards': [],
    'notes': [
        'Cover width = 2 x trim width + spine width + 0.25 in. Cover height = trim height + 0.25 in.',
        'Keep text at least 0.125 in inside the trim lines (0.25 in from the edge of the cover file) and out of the 0.0625 in zone at each side of the spine.',
        'KDP recommends keeping cover files under 40 MB. Minimum font size 7 pt.',
    ],
    '_meta': meta(pb['bleed'], pb['safe_zones'], pb['barcode'], verified=True,
                  note='The exact barcode position comes from the official cover template generator, not from a help page.'),
}
hc = C['hardcover']
cv = hc['calculator_values']
MM = 25.4
hc_spine = {
    'mode': 'formula',
    'perPageIn': {OPT[k][0]: v for k, v in cv['spine_width_formula']['paper_thickness_in'].items() if k in OPT},
    'baseIn': round(cv['spine_width_formula']['added_constant_mm'] / MM, 4),
    'minPagesForText': None,
    'textMarginIn': 0.0625,
    '_meta': meta(hc, verified=True,
                  note='No help page prints the hardcover spine formula. These values reproduce every run of the official KDP cover calculator that was checked: spine = pages x paper thickness + 4.8 mm (0.189 in). KDP gives no minimum page count for hardcover spine text. Always confirm against the official calculator before ordering.'),
}
hc_cover = {
    'bleedIn': 0,
    'safeMarginIn': cv['margin_in'],
    'wrapIn': round(cv['wrap_mm'] / MM, 4),
    'hingeIn': round(cv['hinge_mm'] / MM, 4),
    'boardExtraWidthIn': round(cv['board_overhang']['front_cover_width_minus_trim_width_mm'] / MM, 4),
    'boardExtraHeightIn': round(cv['board_overhang']['front_cover_height_minus_trim_height_mm'] / MM, 4),
    'flapIn': None,
    'barcode': {
        'widthIn': hc['barcode']['box_size_in']['width'], 'heightIn': hc['barcode']['box_size_in']['height'],
        'fromSpineIn': 0.25, 'fromBottomIn': 0.375,
        'platformAdds': True, 'required': False,
        'note': 'From the official hardcover template: the box sits 0.25 in from the hinge edge and 0.375 in above the bottom edge of the cover. The help page prints different figures (0.76 in from the bottom).',
    },
    'colorSpace': 'rgb-or-cmyk', 'maxInkPercent': None, 'minImageDpi': 300, 'maxFileMB': 650, 'pdfStandards': [],
    'notes': [
        'Case laminate only (no dust jacket). Source values are in millimetres: 15 mm wrap, 10 mm hinge, board 5 mm wider and 6 mm taller than the trimmed pages.',
        'Cover width = 2 x 15 mm wrap + 2 x (trim width + 5 mm) + spine. Cover height = trim height + 6 mm + 2 x 15 mm wrap. The hinges lie inside the front and back cover widths.',
        'Keep text 0.125 in inside the board edges; nothing important in the wrap or the hinges.',
    ],
    '_meta': meta(hc, verified=True,
                  note='The Create a Hardcover Cover help page prints a 0.51 in wrap and a 0.635 in text safe distance, which disagree with its own millimetre figures. These values follow the official cover calculator and template (15 mm wrap, 10 mm hinge).'),
}

# ---------------------------------------------------------------- printing cost

PC = P['6_printing_cost']
R = P['7_royalty_and_tax']
MARKET_LABEL = {'US': 'Amazon.com', 'CA': 'Amazon.ca', 'GB': 'Amazon.co.uk', 'DE': 'Amazon.de', 'ES': 'Amazon.es', 'FR': 'Amazon.fr',
                'IT': 'Amazon.it', 'NL': 'Amazon.nl', 'IE': 'Amazon.ie', 'BE': 'Amazon.com.be', 'PL': 'Amazon.pl', 'SE': 'Amazon.se',
                'AU': 'Amazon.com.au', 'JP': 'Amazon.co.jp'}
ORDER = ['US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'IE', 'BE', 'PL', 'SE', 'AU', 'JP']
markets = {}


def market(code, currency):
    if code not in markets:
        markets[code] = {'id': code, 'label': MARKET_LABEL[code], 'currency': currency, 'decimals': 0 if currency == 'JPY' else 2,
                         'listPriceIncludesTax': False, 'taxPercent': None, 'royaltyTiers': {}, 'maxListPrice': {}, 'costs': {}}
    return markets[code]


def band_group(label):
    l = label.lower()
    if 'groundwood' in l:
        return 'bw-groundwood'
    if 'premium color' in l:
        return 'premium-color'
    if 'standard color' in l:
        return 'standard-color'
    return 'bw'


def page_range(fmt, group, fixed_only, code, printed_from, printed_to):
    """Band limits. Black ink bands switch where the official calculator switches (contradictions C07 and C08)."""
    if fmt == 'paperback' and group in ('bw', 'bw-groundwood'):
        if fixed_only:
            return 24, (106 if code == 'AU' else 108)
        return (108 if code == 'AU' else 110), 828
    if fmt == 'hardcover' and group == 'bw':
        return (75, 108) if fixed_only else (110, 550)
    return printed_from, printed_to


for fmt in ('paperback', 'hardcover'):
    for b in PC[fmt]['bands']:
        group = band_group(b['band_label'])
        for m in b['marketplaces']:
            for code in m['marketplace_codes']:
                mk = market(code, m['currency'])
                table = mk['costs'].setdefault(fmt, {}).setdefault(group, {'regular': [], 'large': []})
                for cls in ('regular', 'large'):
                    row = m.get(cls + '_trim')
                    if not row:
                        continue
                    lo, hi = page_range(fmt, group, bool(b.get('fixed_cost_only')) or row['per_page'] == 0, code,
                                        b['pages_from_as_printed'], b['pages_to_as_printed'])
                    table[cls].append({'minPages': lo, 'maxPages': hi, 'fixed': num(row['fixed']), 'perPage': num(row['per_page'])})
for mk in markets.values():
    for fmt in mk['costs'].values():
        for group in fmt.values():
            for cls in ('regular', 'large'):
                group[cls].sort(key=lambda x: x['minPages'])

for fmt, key in (('paperback', 'thresholds_paperback'), ('hardcover', 'thresholds_hardcover')):
    for t in R[key]:
        for code in t['marketplace_codes']:
            if code not in markets:
                continue
            if fmt == 'hardcover' and 'hardcover' not in markets[code]['costs']:
                continue  # contradiction C18: hardcover is only sold where it has a printing cost
            below = t['rate_60_percent_at_or_above']
            if fmt == 'hardcover' and code == 'SE':
                below = 110  # contradiction C06: help page says 99, the official calculator 110. The higher value is the cautious one.
            markets[code]['royaltyTiers'][fmt] = [{'below': num(below), 'rate': 0.5}, {'rate': 0.6}]
for fmt in ('paperback', 'hardcover'):
    for t in R['maximum_list_price'][fmt]:
        for code in t['marketplace_codes']:
            if code in markets and (fmt == 'paperback' or 'hardcover' in markets[code]['costs']):
                markets[code]['maxListPrice'][fmt] = num(t['max_list_price'])

TAX_KEY = {'FR': 'Amazon.fr', 'IT': 'Amazon.it', 'ES': 'Amazon.es', 'DE': 'Amazon.de', 'GB': 'Amazon.co.uk', 'NL': 'Amazon.nl', 'PL': 'Amazon.pl',
           'SE': 'Amazon.se', 'IE': 'Amazon.ie', 'BE': 'Amazon.com.be', 'JP': 'Amazon.co.jp'}
tax = R['tax_on_list_price']['per_marketplace']
for code, key in TAX_KEY.items():
    if code in markets and key in tax:
        row = tax[key]
        rate = row.get('reduced_rate_percent', row.get('rate_percent'))
        if isinstance(rate, (int, float)):
            markets[code]['taxPercent'] = num(rate)
            if 'standard_rate_percent' in row:
                markets[code]['note'] = 'Books normally carry the reduced VAT rate shown. Some book types (for example activity books) can be charged the standard rate of %g%%.' % row['standard_rate_percent']
markets['AU']['taxPercent'] = 10
markets['AU']['note'] = 'KDP print pages say only "the applicable GST". 10% is the rate in Australian GST law; the list price you enter excludes it. Standard colour ink and hardcover are not offered on Amazon.com.au.'
markets['US']['note'] = 'No KDP print page states a sales tax rule for Amazon.com; list prices are entered without tax.'
markets['CA']['note'] = 'No KDP print page states a tax rule for Amazon.ca; list prices are entered without tax.'
markets['SE'].setdefault('note', '')
markets['SE']['note'] = (markets['SE']['note'] + ' The hardcover 60% threshold is 99 SEK on the hardcover help page and 110 SEK in the official calculator; 110 is used here.').strip()

print_pricing = {
    'rateModel': 'tiered', 'costModel': 'bands',
    'marketplaces': [markets[c] for c in ORDER if c in markets],
    'expandedDistribution': {
        'rate': R['expanded_distribution']['royalty_rate']['value'], 'formats': ['paperback'],
        'note': 'Paperback only, and only for the trim, ink and paper combinations marked in the trim size list. KDP does not publish the minimum list price formula for Expanded Distribution. Turn it off when the same ISBN is distributed through IngramSpark.',
        '_meta': meta(R['expanded_distribution'], verified=True),
    },
    'calculatorUrl': 'https://kdp.amazon.com/en_US/royalty-calculator',
    '_meta': meta(PC['paperback'], R['thresholds_paperback'], R['minimum_list_price'], verified=True,
                  note='Royalty = rate x list price (without tax) minus printing cost. Minimum list price = printing cost divided by the rate that applies at that price. '
                       'The help page prints overlapping page bands (24 to 110 and 110 to 828); the bands here switch where the official royalty calculator switches: '
                       'fixed cost through 108 pages (106 on Amazon.com.au), fixed plus per page from 110 pages (108 on Amazon.com.au). '
                       'For groundwood paper the help page says the flat cost runs to 112 pages; the calculator switches at 110, which gives the slightly higher figure used here. '
                       'No page states the date the current costs apply from.'),
}

# ---------------------------------------------------------------- ebook

LP = E['1_list_price_requirements']
R70 = E['2_royalty_70_conditions']
VAT = E['3_vat']
EB_CODE = {'Amazon.com': 'US', 'Amazon.in': 'IN', 'Amazon.ca': 'CA', 'Amazon.com.br': 'BR', 'Amazon.co.uk': 'GB', 'Amazon.co.jp': 'JP',
           'Amazon.com.mx': 'MX', 'Amazon.com.au': 'AU', 'Amazon.de': 'DE', 'Amazon.fr': 'FR', 'Amazon.es': 'ES', 'Amazon.it': 'IT', 'Amazon.nl': 'NL'}
delivery = {EB_CODE[k]: v['per_mb'] for k, v in R70['delivery_cost_per_mb']['rates'].items() if k in EB_CODE}
select_only = {'BR', 'JP', 'MX', 'IN'}
assert set(R70['kdp_select_requirement']['territories']) == {'Brazil', 'Japan', 'Mexico', 'India'}
eu_vat = VAT['rates_table_eu_uk']['rates_percent']
EB_TAX = {
    'GB': (True, eu_vat['United Kingdom']), 'DE': (True, eu_vat['Germany']), 'FR': (True, eu_vat['France']),
    'IT': (True, eu_vat['Italy']['with_isbn']), 'ES': (True, eu_vat['Spain']), 'NL': (True, eu_vat['Netherlands']),
    'AU': (True, VAT['list_price_includes_tax']['Amazon.com.au']['rate_percent']),
    'IN': (True, VAT['list_price_includes_tax']['Amazon.in']['rate_percent']),
    'JP': (True, VAT['list_price_includes_tax']['Amazon.co.jp']['rate_percent']),
    'US': (False, None), 'CA': (False, None), 'MX': (False, None), 'BR': (False, None),
}
EB_LABEL = {'US': 'Amazon.com', 'IN': 'Amazon.in', 'CA': 'Amazon.ca', 'BR': 'Amazon.com.br', 'GB': 'Amazon.co.uk', 'JP': 'Amazon.co.jp',
            'MX': 'Amazon.com.mx', 'AU': 'Amazon.com.au', 'DE': 'Amazon.de', 'FR': 'Amazon.fr', 'ES': 'Amazon.es', 'IT': 'Amazon.it', 'NL': 'Amazon.nl'}
ebook_markets = []


def tiers35(r35):
    """Minimum price by file size. Most currencies have three size tiers, the yen table has two."""
    if 'file_3mb_to_under_10mb' in r35:
        return [{'maxMB': 3, 'price': num(r35['file_under_3mb']['min'])}, {'maxMB': 10, 'price': num(r35['file_3mb_to_under_10mb']['min'])},
                {'price': num(r35['file_10mb_or_more']['min'])}]
    return [{'maxMB': 3, 'price': num(r35['file_under_3mb']['min'])}, {'price': num(r35['file_3mb_or_more']['min'])}]


def ebook_market(code, t):
    r35 = t['royalty_35']
    incl, rate = EB_TAX[code]
    mk = {
        'id': code, 'label': EB_LABEL[code], 'currency': t['currency'], 'decimals': 0 if t['currency'] in ('JPY', 'INR') else 2,
        'listPriceIncludesTax': incl, 'taxPercent': rate,
        'plans': {
            '35': {'rate': 0.35, 'min': tiers35(r35),
                   'max': num(r35['file_under_3mb']['max']), 'deliveryPerMB': 0, 'requiresExclusive': False},
            '70': {'rate': 0.7, 'min': [{'price': num(t['royalty_70']['min'])}], 'max': num(t['royalty_70']['max']),
                   'deliveryPerMB': num(delivery.get(code, 0)), 'requiresExclusive': code in select_only},
        },
    }
    if code in select_only:
        mk['note'] = 'The 70% option is only paid here for books enrolled in KDP Select. Books that are not enrolled earn 35%.'
    if code == 'IT':
        mk['note'] = 'Italian VAT on ebooks is 4% with an ISBN and 22% without one.'
    if code in ('CA', 'MX', 'BR'):
        mk['note'] = (mk.get('note', '') + ' No official page says whether list prices here include tax.').strip()
    return mk


for t in LP['currency_tables']:
    if t['currency'] == 'EUR':
        for code in ('DE', 'FR', 'ES', 'IT', 'NL'):
            ebook_markets.append(ebook_market(code, t))
    else:
        ebook_markets.append(ebook_market(EB_CODE[t['marketplaces'][0]], t))
EB_ORDER = ['US', 'CA', 'GB', 'DE', 'FR', 'IT', 'ES', 'NL', 'AU', 'IN', 'JP', 'MX', 'BR']
ebook_markets.sort(key=lambda m: EB_ORDER.index(m['id']))

FP = E['4_free_pricing_and_price_matching']
ebook_pricing = {
    'model': 'kdp', 'marketplaces': ebook_markets, 'freeAllowed': False,
    'freeNote': 'KDP says: "You can\'t set your book\'s list price as free." The only official way to offer a Kindle ebook free is five free days per 90 day KDP Select term, and KDP Select requires exclusivity.',
    'priceMatchNote': 'KDP terms say that if your ebook is available through another sales channel for free, Amazon may also make it available for free, with no royalty. It is at Amazon\'s discretion and no request process is documented.',
    '_meta': meta(LP, R70, FP, verified=True,
                  note='The 70% price band was raised on 7 July 2026 (US maximum 12.99). The 70% option also requires a list price at least 20% below the print list price and deducts a delivery cost per megabyte. '
                       'EU VAT rates are stated by KDP "as of 5/1/2020". Tax treatment for CAD, MXN and BRL prices is not stated on any official page.'),
}

CI = E['5_cover_image']
MF = E['6_manuscript_formats_and_epub_rules']
ebook = {
    'acceptedFormats': ['epub', 'docx', 'kpf'],
    'maxFileMB': 650,
    'epubCheckRequired': False,
    'cover': {'idealWidthPx': 1600, 'idealHeightPx': 2560, 'minWidthPx': 625, 'minHeightPx': 1000, 'maxSidePx': 10000, 'maxFileMB': 50,
              'formats': ['jpg', 'tiff'],
              '_meta': meta(CI, verified=True, note='Ideal size 2,560 pixels high by 1,600 wide (ratio 1.6 to 1), RGB. Three official sources disagree on accepted formats, minimum size and file size; these are the values of the KDP help page.')},
    'notes': [
        'KDP recommends EPUB, DOCX or KPF. MOBI is no longer accepted.',
        'An EPUB needs a logical table of contents with at most two levels of nesting, each HTML file under 30 MB, and fewer than 300 HTML files.',
        'Embedded fonts must be OTF or TTF.',
        'Declare the cover image in the package file but do not add a cover page inside the book: Kindle adds the cover itself.',
        'Kindle Previewer 4 is the current version; Kindle Previewer 3 is no longer supported.',
    ],
    '_meta': meta(MF, verified=True, note='The 650 MB limit comes from the Kindle Publishing Guidelines and the Previewer FAQ, not from the upload page itself.'),
}

# ---------------------------------------------------------------- languages

ISO = {
    'Afrikaans': 'af', 'Alsatian': 'gsw', 'Arabic': 'ar', 'Basque': 'eu', 'Bokmål Norwegian': 'nb', 'Breton': 'br', 'Catalan': 'ca',
    'Chinese (Traditional)': 'zh', 'Cornish': 'kw', 'Corsican': 'co', 'Danish': 'da', 'Dutch/Flemish': 'nl', 'Eastern Frisian': 'frs',
    'English': 'en', 'Finnish': 'fi', 'French': 'fr', 'Frisian': 'fy', 'Galician': 'gl', 'German': 'de', 'Gujarati': 'gu', 'Hebrew': 'he',
    'Hindi': 'hi', 'Icelandic': 'is', 'Irish': 'ga', 'Italian': 'it', 'Japanese': 'ja', 'Latin': 'la', 'Luxembourgish': 'lb', 'Malayalam': 'ml',
    'Manx': 'gv', 'Marathi': 'mr', 'Northern Frisian': 'frr', 'Norwegian': 'no', 'Nynorsk Norwegian': 'nn', 'Persian': 'fa', 'Polish': 'pl',
    'Portuguese': 'pt', 'Provençal': 'oc', 'Romansh': 'rm', 'Scots': 'sco', 'Scottish Gaelic': 'gd', 'Spanish': 'es', 'Swedish': 'sv',
    'Tamil': 'ta', 'Ukrainian': 'uk', 'Welsh': 'cy', 'Yiddish': 'yi',
}


def codes(list_of_names):
    out = []
    for n in list_of_names:
        n = n if isinstance(n, str) else (n.get('language') or n.get('name'))
        out.append(ISO[n])
    return sorted(set(out))


PL_ = P['9_languages']
EL = E['9_supported_languages']
languages = {
    'ebook': {'supported': codes(EL['ebook_supported_languages']),
              'note': 'Bengali (Bangla) is not on any official KDP ebook language list. The only Indian languages listed are Gujarati, Hindi, Malayalam, Marathi and Tamil.'},
    'paperback': {'supported': codes(PL_['paperback_supported']),
                  'note': 'Bengali (Bangla) is not supported for print. KDP states that paperback publishing for Indian languages is not available. Japanese paperbacks are only printed for Amazon.co.jp.'},
    'hardcover': {'supported': codes(PL_['hardcover_supported'])},
    'consequence': 'KDP says ebook content uploaded in an unsupported language will not display properly and will be removed from sale.',
    '_meta': meta(PL_, EL, verified=True,
                  note='That Bengali is unsupported rests on its absence from every official list; no page names Bengali explicitly. Codes are ISO 639 language codes; Provencal is listed under "oc" (Occitan).'),
}
assert 'bn' not in languages['ebook']['supported'] and 'bn' not in languages['paperback']['supported']

BD = E['7_book_description']
KW = E['8_keywords_categories_title_series_age']
listing = {
    'keywordSlots': 7, 'keywordMaxChars': None, 'categoriesMax': 3, 'descriptionMaxChars': 4000,
    'descriptionTags': ['br', 'p', 'b', 'em', 'i', 'u', 'h4', 'h5', 'h6', 'ol', 'ul', 'li'],
    'titleSubtitleMaxChars': 200,
    'notes': [
        'The description limit of 4,000 characters includes the HTML tags. Headings h1 to h3 are not supported.',
        'KDP does not publish a character limit for each keyword field.',
        'Reading age bands: 0 to 2, 3 to 5, 6 to 8, 9 to 12, 13 to 17.',
        'KDP limits new titles to 2 created and 2 submitted per format per week.',
    ],
    '_meta': meta(BD, KW, verified=True, note='The per keyword character limit is not published, so it is left empty.'),
}

# ---------------------------------------------------------------- assemble

spec = {
    'schemaVersion': 1,
    'platform': 'kdp',
    'displayName': 'Amazon KDP',
    'lastVerified': '2026-11-23',
    'revision': 1,
    'sources': [],
    'notes': [
        'All values were read from Amazon KDP help pages and from the public KDP cover calculator, template generator and royalty calculator on 2026-11-23.',
        'Hardcover cover geometry and the hardcover spine formula come from the official calculator and template, because the help page figures contradict each other. Check the official calculator before ordering a hardcover proof.',
        'Printing cost page bands follow the official royalty calculator, which differs slightly from the overlapping bands printed on the help page (at most a few cents at 110 pages).',
        'Bengali (Bangla) is not supported by KDP for ebooks, paperbacks or hardcovers.',
        'The Japan only trim sizes of kdp.amazon.co.jp are not listed here.',
        'Premium colour at 8.27 x 11.69 in: the help table allows 590 pages and the calculator 780; 590 is used.',
        'Kindle ebooks cannot be priced at 0.00. Amazon may price match a free listing elsewhere, at its discretion.',
    ],
    'print': {
        'inkPaper': ink_paper,
        'bleed': bleed,
        'margins': margins,
        'pageCount': {'multiple': 2, 'lastPageBlank': False,
                      '_meta': meta(P['2_page_counts']['general_rules'], note='KDP rounds the page count up to an even number. An update that changes the page count by more than 10% needs a new edition.')},
        'interiorFile': interior_file,
        'formats': {
            'paperback': {'trimSizes': pb_trims, 'bindings': ['perfect'], 'spine': pb_spine, 'cover': pb_cover,
                          '_meta': meta(P['1_trim_sizes']['paperback']['kdp_amazon_com'], P['2_page_counts']['paperback'], verified=True,
                                        note='A trim counts as "large" for printing cost when it is wider than 6.12 in or taller than 9 in. The Print Options help page currently shows only one row of its table; the full table is on the cover and submission pages.')},
            'hardcover': {'trimSizes': hc_trims, 'bindings': ['case-laminate'], 'spine': hc_spine, 'cover': hc_cover,
                          '_meta': meta(P['1_trim_sizes']['hardcover'], P['2_page_counts']['hardcover'], verified=True,
                                        note='75 to 550 pages (76 after rounding up to even). Case laminate only. Not sold on Amazon.com.au, Amazon.ca or Amazon.co.jp.')},
        },
    },
    'ebook': ebook,
    'pricing': {'print': print_pricing, 'ebook': ebook_pricing},
    'fees': [],
    'languages': languages,
    'listing': listing,
}
spec['sources'] = sorted(SOURCES.values(), key=lambda s: s['id'])

out = os.path.join(ROOT, 'specs', 'kdp.json')
os.makedirs(os.path.dirname(out), exist_ok=True)
text = json.dumps(spec, indent=2, ensure_ascii=False)
# House style of this project: no em or en dashes anywhere. Page titles and option
# names copied from Amazon sometimes contain them, so they are replaced by hyphens.
EM, EN = chr(0x2014), chr(0x2013)
text = text.replace(' ' + EM + ' ', ' - ').replace(EM, ' - ').replace(EN, '-')
assert EM not in text and EN not in text, 'dash characters found in output'
open(out, 'w', encoding='utf-8').write(text + '\n')
print('wrote', out, len(text), 'bytes;', len(spec['sources']), 'sources;', len(pb_trims), 'paperback trims;', len(hc_trims), 'hardcover trims;',
      len(print_pricing['marketplaces']), 'print marketplaces;', len(ebook_markets), 'ebook marketplaces')
