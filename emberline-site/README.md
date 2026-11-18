# Emberline website

A static site: no build step, no dependencies. Open `index.html` through any local server to preview.

## Put it on Netlify

1. Go to https://app.netlify.com/drop and drag this whole folder (or the zip) onto the page.
2. In the Netlify dashboard open **Forms** and turn on **form detection**, then deploy once more.
   Enquiries from the contact form then appear under Forms, and you can add an email notification there.

## Where to edit

| What | Where |
| --- | --- |
| Plan names, prices, inclusions | `index.html`, the `PRICING` section (also the compare table and the plan select in the form) |
| Plan finder rules and wording | `assets/main.js`, the `Plan finder` block |
| FAQ answers and all other wording | `index.html` |
| Colours and fonts | top of `assets/styles.css` (`:root`) |
| Logo | `favicon.svg`, `assets/brand/` |
