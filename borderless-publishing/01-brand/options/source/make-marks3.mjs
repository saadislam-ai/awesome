// Draws the marks of options 16 to 23 as SVG files: detailed book silhouettes
// and a real globe. Land shapes come from Natural Earth (public domain) through
// the world-atlas package; d3-geo projects them onto the globe.
//
// Colours are written as placeholders and replaced by the board when it places
// a mark: #AAAAAA is the main colour, #BBBBBB the accent, #CCCCCC the paper.
//
// Usage: node make-marks3.mjs <folder with node_modules for world-atlas, topojson-client, d3-geo> <output folder>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [modules, out] = process.argv.slice(2);
const require = createRequire(path.join(path.resolve(modules), 'index.js'));
const d3 = require('d3-geo');
const topojson = require('topojson-client');
const world = require('world-atlas/land-110m.json');
const land = topojson.feature(world, world.objects.land);
fs.mkdirSync(out, { recursive: true });

const A = '#AAAAAA';
const B = '#BBBBBB';
const C = '#CCCCCC';
const f = (n) => Math.round(n * 100) / 100;

/** A globe seen from above the Indian Ocean: Africa, Asia and Australia. */
function globe(cx, cy, r, o = {}) {
  const rotate = o.rotate ?? [-78, -8];
  const proj = d3.geoOrthographic().scale(r).translate([cx, cy]).rotate(rotate).clipAngle(90).precision(0.2);
  const p = d3.geoPath(proj);
  const step = o.step ?? 30;
  const grat = d3.geoGraticule().step([step, step])();
  let s = '';
  if (o.sphere) s += `<path d="${p({ type: 'Sphere' })}" fill="${o.sphere}"/>`;
  if (o.grat) s += `<path d="${p(grat)}" fill="none" stroke="${o.grat}" stroke-width="${o.gratWidth ?? 0.8}"/>`;
  s += `<path d="${p(land)}" fill="${o.land ?? A}"${o.landStroke ? ` stroke="${o.landStroke}" stroke-width="${o.landStrokeWidth ?? 0.8}" stroke-linejoin="round"` : ''}/>`;
  if (o.outline) s += `<path d="${p({ type: 'Sphere' })}" fill="none" stroke="${o.outline}" stroke-width="${o.outlineWidth ?? 2}"/>`;
  return s;
}

/** A flat map of the whole world, fitted to a box (for the pages of an atlas). */
function flatMap(x, y, w, h, o = {}) {
  const proj = d3.geoEquirectangular().fitExtent([[x, y], [x + w, y + h]], { type: 'Sphere' });
  const p = d3.geoPath(proj);
  const grat = d3.geoGraticule().step([30, 30])();
  return (o.grat ? `<path d="${p(grat)}" fill="none" stroke="${o.grat}" stroke-width="${o.gratWidth ?? 0.6}"/>` : '') + `<path d="${p(land)}" fill="${o.land ?? A}"/>`;
}

const mirror = (body) => `<g transform="translate(200 0) scale(-1 1)">${body}</g>`;

/**
 * The left half of an open book seen from the front, with its cover board,
 * the stack of pages along the edges and a page surface. `y` is where the top
 * of the page meets the spine; `lines` draws lines of text on the page.
 */
function openHalf(o) {
  const { top = 120, bottom = 172, outer = 22, sag = 14, layers = 5, gap = 2.2, cover = A, page = C, edge = A, lines = 0, lineColour = A } = o;
  // Page surface: rises from the spine to the outer edge and comes back down.
  const surf = (dx, dy) => `M100,${f(top + dy)} C${f(80 - dx * 0.2)},${f(top - sag + dy)} ${f(48 - dx * 0.5)},${f(top - sag - 4 + dy)} ${f(outer - dx)},${f(top - sag + 2 + dy)} L${f(outer - dx)},${f(bottom - sag + 2 + dy)} C${f(48 - dx * 0.5)},${f(bottom - sag - 4 + dy)} ${f(80 - dx * 0.2)},${f(bottom - sag + dy)} 100,${f(bottom + dy)} Z`;
  let s = '';
  // Cover board, a little larger than the pages and below them.
  const cv = layers * gap + 3;
  s += `<path d="${surf(cv * 0.7, cv)}" fill="${cover}"/>`;
  // The stack of pages: each sheet slightly lower and further out.
  for (let i = layers; i >= 1; i--) {
    s += `<path d="${surf(i * gap * 0.7, i * gap)}" fill="${page}" stroke="${edge}" stroke-width="0.9" stroke-linejoin="round"/>`;
  }
  s += `<path d="${surf(0, 0)}" fill="${page}" stroke="${edge}" stroke-width="1.2" stroke-linejoin="round"/>`;
  // Lines of text on the page, following its curve.
  for (let i = 0; i < lines; i++) {
    const t = (i + 1.4) / (lines + 1.6);
    const dy = (bottom - top) * t;
    s += `<path d="M92,${f(top + dy - 2)} C76,${f(top - sag + dy + 1)} 52,${f(top - sag - 3 + dy)} ${f(outer + 10)},${f(top - sag + 3 + dy)}" fill="none" stroke="${lineColour}" stroke-width="1.6" stroke-linecap="round" opacity="0.9"/>`;
  }
  return s;
}

function svg(name, body) {
  fs.writeFileSync(path.join(out, `${name}.svg`), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">${body}</svg>`);
}

// 16. Atlas Rising: a real globe rising out of the gutter of an open book.
{
  let s = globe(100, 92, 52, { sphere: B, land: A, grat: C, gratWidth: 0.7 });
  const half = openHalf({ top: 128, bottom: 176, outer: 16, sag: 12, layers: 5, lines: 4, lineColour: A });
  s += half + mirror(half);
  s += `<path d="M100,128 L100,176" stroke="${A}" stroke-width="1.6"/>`;
  svg('16-atlas-rising', s);
}

// 17. Turning World: the right half of the globe lifts away as the page of a book being turned.
{
  let s = '';
  // Pages under the turning one, fanned along the bottom.
  for (let i = 4; i >= 1; i--) s += `<path d="M100,${f(40 - i * 1.5)} L${f(100 + 66 + i * 2.4)},${f(40 + i * 3)} L${f(100 + 66 + i * 2.4)},${f(160 + i * 3.2)} L100,${f(160 + i * 1.5)} Z" fill="${C}" stroke="${A}" stroke-width="0.9" stroke-linejoin="round"/>`;
  s += `<clipPath id="leftHalf"><rect x="0" y="0" width="100" height="200"/></clipPath>`;
  s += `<g clip-path="url(#leftHalf)">${globe(100, 100, 62, { sphere: A, land: B, grat: C, gratWidth: 0.6, rotate: [-40, -10] })}</g>`;
  // The turning page: a curl from the spine, showing the back of the right hemisphere.
  s += `<clipPath id="leaf"><path d="M100,38 C126,34 150,40 176,30 C166,70 168,120 180,166 C150,170 124,160 100,162 Z"/></clipPath>`;
  s += `<path d="M100,38 C126,34 150,40 176,30 C166,70 168,120 180,166 C150,170 124,160 100,162 Z" fill="${C}" stroke="${A}" stroke-width="1.4" stroke-linejoin="round"/>`;
  // The back of the page carries the other side of the world, as if seen through thin paper.
  s += `<g clip-path="url(#leaf)" opacity="0.55">${globe(100, 100, 62, { land: B, rotate: [-140, -10] })}</g>`;
  for (const y of [62, 78, 94, 110, 126, 142]) s += `<path d="M112,${y} C130,${y - 3} 150,${y + 1} ${f(165 + (y - 60) * 0.1)},${y - 4}" fill="none" stroke="${A}" stroke-width="1.3" stroke-linecap="round" opacity="0.8"/>`;
  s += `<path d="M176,30 C170,46 168,58 168,70 C172,58 178,48 186,40 Z" fill="${A}"/>`;
  s += `<path d="M100,36 L100,164" stroke="${A}" stroke-width="2"/>`;
  svg('17-turning-world', s);
}

// 18. Window Book: a standing hardcover, its cover cut with a round window onto the world.
{
  let s = '';
  // Page block seen on the right, with its lines.
  s += `<path d="M138,30 L160,40 L160,180 L138,172 Z" fill="${C}" stroke="${A}" stroke-width="1.2"/>`;
  for (let i = 1; i < 9; i++) s += `<path d="M${f(138 + i * 2.4)},${f(31 + i * 1.1)} L${f(138 + i * 2.4)},${f(172.5 + i * 0.9)}" stroke="${A}" stroke-width="0.6"/>`;
  // Back board showing behind the pages.
  s += `<path d="M160,40 L164,42 L164,184 L160,180 Z" fill="${A}"/>`;
  // Spine with raised bands on the left.
  s += `<path d="M36,30 L52,24 L52,170 L36,176 Z" fill="${A}"/>`;
  for (const y of [44, 60, 140, 156]) s += `<path d="M36,${y + 6} L52,${y}" stroke="${B}" stroke-width="2.6"/>`;
  // Front cover with the window.
  s += `<mask id="window"><rect x="0" y="0" width="200" height="200" fill="white"/><circle cx="96" cy="98" r="34" fill="black"/></mask>`;
  s += `<path d="M52,24 L138,30 L138,172 L52,170 Z" fill="${A}" mask="url(#window)"/>`;
  s += globe(96, 98, 34, { sphere: C, land: A, grat: B, gratWidth: 0.6 });
  s += `<circle cx="96" cy="98" r="34" fill="none" stroke="${B}" stroke-width="2.6"/>`;
  s += `<path d="M64,150 L126,151" stroke="${B}" stroke-width="2"/><path d="M76,158 L114,158.6" stroke="${B}" stroke-width="1.4"/>`;
  svg('18-window-book', s);
}

// 19. Globe on Books: a desk globe on its stand, resting on a stack of three books.
{
  let s = '';
  const book = (x, y, w, h, cover, band, pages) => {
    // Spine facing us, page edges on the right as a thin strip.
    let b = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2.4" fill="${cover}"/>`;
    b += `<rect x="${x + w - 2}" y="${y + 2}" width="7" height="${h - 4}" fill="${pages}" stroke="${cover}" stroke-width="0.8"/>`;
    for (let i = 1; i < 4; i++) b += `<path d="M${x + w - 2},${f(y + 2 + (i * (h - 4)) / 4)} L${x + w + 5},${f(y + 2 + (i * (h - 4)) / 4)}" stroke="${cover}" stroke-width="0.5"/>`;
    b += `<rect x="${x + 8}" y="${y + 3}" width="5" height="${h - 6}" fill="${band}"/><rect x="${x + w - 18}" y="${y + 3}" width="5" height="${h - 6}" fill="${band}"/>`;
    return b;
  };
  s += book(30, 168, 138, 20, A, B, C);
  s += book(40, 148, 118, 20, B, A, C);
  s += book(34, 128, 128, 20, A, B, C);
  // Stand: a base, a stem and the meridian ring.
  s += `<path d="M84,128 L116,128 L110,121 L90,121 Z" fill="${B}"/><rect x="97" y="108" width="6" height="14" fill="${B}"/>`;
  s += globe(100, 64, 42, { sphere: C, land: A, grat: B, gratWidth: 0.6, outline: A, outlineWidth: 1.4 });
  s += `<path d="M 54.5,64 A 45.5 45.5 0 0 0 100,109.5" fill="none" stroke="${B}" stroke-width="3.2"/><path d="M 100,18.5 A 45.5 45.5 0 0 0 54.5,64" fill="none" stroke="${B}" stroke-width="3.2"/>`;
  s += `<circle cx="100" cy="18" r="3" fill="${B}"/>`;
  svg('19-globe-on-books', s);
}

// 20. Atlas Seal: a round seal around a globe resting on an open book; the name is set around it by the board.
{
  let s = `<circle cx="100" cy="100" r="96" fill="${A}"/><circle cx="100" cy="100" r="70" fill="${C}"/><circle cx="100" cy="100" r="92" fill="none" stroke="${B}" stroke-width="1.4"/><circle cx="100" cy="100" r="73" fill="none" stroke="${B}" stroke-width="1.4"/>`;
  s += `<clipPath id="inner"><circle cx="100" cy="100" r="70"/></clipPath><g clip-path="url(#inner)">`;
  s += globe(100, 86, 40, { sphere: A, land: B, grat: C, gratWidth: 0.5 });
  const half = openHalf({ top: 120, bottom: 150, outer: 40, sag: 8, layers: 3, gap: 1.8, cover: A, page: C, edge: A, lines: 2, lineColour: B });
  s += half + mirror(half) + `<path d="M100,120 L100,150" stroke="${A}" stroke-width="1.2"/></g>`;
  svg('20-atlas-seal', s);
}

// 21. Atlas Spread: an open atlas whose two pages carry the map of the world.
{
  let s = '';
  const top = 64;
  const bottom = 150;
  const half = openHalf({ top, bottom, outer: 12, sag: 14, layers: 6, gap: 2, lines: 0 });
  s += half + mirror(half);
  // Each page shows half of the world, clipped to the page surface.
  const pagePath = `M100,${top} C80,${top - 14} 48,${top - 18} 12,${top - 12} L12,${bottom - 12} C48,${bottom - 18} 80,${bottom - 14} 100,${bottom} Z`;
  s += `<clipPath id="pL"><path d="${pagePath}"/></clipPath><clipPath id="pR"><path d="${pagePath}" transform="translate(200 0) scale(-1 1)"/></clipPath>`;
  s += `<g clip-path="url(#pL)"><g transform="translate(0 4)">${flatMap(6, 46, 188, 94, { land: A, grat: B, gratWidth: 0.5 })}</g></g>`;
  s += `<g clip-path="url(#pR)"><g transform="translate(0 4)">${flatMap(6, 46, 188, 94, { land: A, grat: B, gratWidth: 0.5 })}</g></g>`;
  s += `<path d="M100,${top} L100,${bottom}" stroke="${A}" stroke-width="2.4"/>`;
  // A ribbon bookmark falling from the gutter.
  s += `<path d="M97,${bottom} L97,${bottom + 34} L100,${bottom + 29} L103,${bottom + 34} L103,${bottom} Z" fill="${B}"/>`;
  svg('21-atlas-spread', s);
}

// 22. Bookmark Earth: a closed hardcover with a gold globe on its cover and a ribbon bookmark.
{
  let s = '';
  // Page block along the right and bottom, then the board.
  s += `<path d="M48,22 L160,22 L166,28 L166,184 L54,184 L48,178 Z" fill="${C}" stroke="${A}" stroke-width="1"/>`;
  for (let i = 1; i < 5; i++) s += `<path d="M${f(160 + i * 1.2)},${f(23 + i * 1.2)} L${f(160 + i * 1.2)},${f(178 + i * 1.2)}" stroke="${A}" stroke-width="0.5"/>`;
  s += `<rect x="40" y="16" width="120" height="164" rx="3" fill="${A}"/>`;
  s += `<rect x="40" y="16" width="14" height="164" rx="3" fill="${A}"/><path d="M54,16 L54,180" stroke="${C}" stroke-width="0.8" opacity="0.6"/>`;
  s += `<rect x="62" y="26" width="90" height="144" fill="none" stroke="${B}" stroke-width="1.2"/>`;
  s += globe(107, 92, 34, { land: B, grat: B, gratWidth: 0.5, outline: B, outlineWidth: 1.6 });
  s += `<path d="M80,140 L134,140" stroke="${B}" stroke-width="2"/><path d="M90,148 L124,148" stroke="${B}" stroke-width="1.3"/>`;
  // Ribbon over the top edge and down past the bottom.
  s += `<path d="M138,10 L146,10 L146,196 L142,190 L138,196 Z" fill="${B}"/>`;
  svg('22-bookmark-earth', s);
}

// 23. World Inside a Book: the outline of an open book filled with the globe.
{
  let s = '';
  const top = 58;
  const bottom = 156;
  const shape = (dx, dy) => `M100,${top + dy} C80,${top - 18 + dy} 46,${top - 24 + dy} ${10 - dx},${top - 14 + dy} L${10 - dx},${bottom - 14 + dy} C46,${bottom - 24 + dy} 80,${bottom - 18 + dy} 100,${bottom + dy} C120,${bottom - 18 + dy} 154,${bottom - 24 + dy} ${190 + dx},${bottom - 14 + dy} L${190 + dx},${top - 14 + dy} C154,${top - 24 + dy} 120,${top - 18 + dy} 100,${top + dy} Z`;
  for (let i = 4; i >= 1; i--) s += `<path d="${shape(i * 1.4, i * 2.4)}" fill="${C}" stroke="${A}" stroke-width="0.9" stroke-linejoin="round"/>`;
  s += `<clipPath id="bookShape"><path d="${shape(0, 0)}"/></clipPath>`;
  s += `<path d="${shape(0, 0)}" fill="${A}"/>`;
  s += `<g clip-path="url(#bookShape)">${globe(100, 100, 84, { land: B, grat: C, gratWidth: 0.7, step: 20 })}</g>`;
  s += `<path d="M100,${top} L100,${bottom}" stroke="${C}" stroke-width="2.2"/>`;
  svg('23-world-inside-a-book', s);
}
console.log('marks written to', out);
