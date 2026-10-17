#!/usr/bin/env python3
"""waynesdays brand kit generator.

Builds every logo as outlined SVG (type converted to paths, so it renders the same
everywhere), plus the app icons, from the brand fonts in ../fonts.

  pip install fonttools brotli uharfbuzz
  python3 tools/brand.py            # writes brand/logos/svg, brand/icons/*.svg, icon.svg

PNG exports are rendered from these SVGs by tools/brand-png.js (Playwright).
"""
import io
import json
import math
import os
import re

import uharfbuzz as hb
from fontTools.misc.transform import Transform
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, 'fonts')
OUT = os.path.join(ROOT, 'brand')

# ---- palette -------------------------------------------------------------
GREEN = '#1d3a2c'     # clubhouse green
CREAM = '#f1ebdd'     # cream
BRASS = '#b08d57'     # brass
BRASS_LT = '#d2b07a'  # brass, on dark
INK = '#141414'
WHITE = '#ffffff'
NIGHT = '#0f1a14'     # night green

VARIANTS = {
    # name: (type colour, accent colour, preview background)
    'green': (GREEN, BRASS, CREAM),
    'cream': (CREAM, BRASS_LT, GREEN),
    'ink': (INK, INK, WHITE),
    'white': (WHITE, WHITE, INK),
}


class Face:
    """One instance of a variable font: shapes text with HarfBuzz and draws it as SVG path data."""

    def __init__(self, file, wght):
        tt = TTFont(os.path.join(FONTS, file))
        tt = instantiateVariableFont(tt, {'wght': wght})
        buf = io.BytesIO()
        tt.flavor = None
        tt.save(buf)
        self.tt = tt
        self.glyphs = tt.getGlyphSet()
        self.upem = tt['head'].unitsPerEm
        self.hbfont = hb.Font(hb.Face(buf.getvalue()))
        self.order = tt.getGlyphOrder()

    def shape(self, text, size, tracking=0.0):
        """-> ([(glyphName, x, advance)], width) in output units; tracking in em."""
        b = hb.Buffer()
        b.add_str(text)
        b.guess_segment_properties()
        hb.shape(self.hbfont, b, {'kern': True, 'liga': False})
        s = size / self.upem
        out, x = [], 0.0
        n = len(b.glyph_infos)
        for i, (info, pos) in enumerate(zip(b.glyph_infos, b.glyph_positions)):
            adv = pos.x_advance * s
            out.append((self.order[info.codepoint], x + pos.x_offset * s, adv))
            x += adv + (tracking * size if i < n - 1 else 0)
        return out, x

    def width(self, text, size, tracking=0.0):
        return self.shape(text, size, tracking)[1]

    def _draw(self, name, t):
        pen = SVGPathPen(self.glyphs, ntos=lambda v: ('%.2f' % v).rstrip('0').rstrip('.'))
        self.glyphs[name].draw(TransformPen(pen, t))
        return pen.getCommands()

    def text(self, text, size, x, y, anchor='start', tracking=0.0):
        """Path data for a line of text with its baseline at y."""
        glyphs, w = self.shape(text, size, tracking)
        x0 = x - (w / 2 if anchor == 'middle' else w if anchor == 'end' else 0)
        s = size / self.upem
        return ''.join(self._draw(g, Transform(s, 0, 0, -s, x0 + gx, y)) for g, gx, _ in glyphs)

    def arc(self, text, size, cx, cy, r, tracking=0.0, bottom=False):
        """Text set on a circle, centred on the top (reading clockwise) or the bottom (reading left to right)."""
        glyphs, w = self.shape(text, size, tracking)
        s = size / self.upem
        d = ''
        for g, gx, adv in glyphs:
            u = gx + adv / 2 - w / 2          # distance of the glyph centre from the middle of the line
            a = u / r
            if bottom:
                px, py, rot = cx + r * math.sin(a), cy + r * math.cos(a), -a
            else:
                px, py, rot = cx + r * math.sin(a), cy - r * math.cos(a), a
            t = Transform().translate(px, py).rotate(rot).translate(-adv / 2, 0).scale(s, -s)
            d += self._draw(g, t)
        return d


SERIF = Face('cormorant-garamond.woff2', 500)
SERIF_MONO = Face('cormorant-garamond.woff2', 600)
SANS = Face('jost.woff2', 450)

NAME = 'waynesdays'
EST = 'est. mmxxvi'


def f(v):
    return ('%.2f' % v).rstrip('0').rstrip('.')


def path(d, fill):
    return f'<path d="{d}" fill="{fill}"/>'


def stripes(x, y, color, n=5, gap=8.0, dx=7.0, h=10.0, sw=2.6):
    """The tab: five short brass slashes, bottom-left corner at (x, y)."""
    d = ' '.join(f'M{f(x + i * gap)} {f(y)}l{f(dx)} {f(-h)}' for i in range(n))
    return f'<path d="{d}" stroke="{color}" stroke-width="{f(sw)}" fill="none"/>'


def stripes_w(gap, dx, n=5):
    return gap * (n - 1) + dx


def ring(cx, cy, r, color, sw):
    return f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}" fill="none" stroke="{color}" stroke-width="{f(sw)}"/>'


def monogram(cx, cy, r, fg):
    """'wd', overlapped, optically centred in a ring of radius r."""
    size = r * 1.18
    return path(SERIF_MONO.text('wd', size, cx, cy + size * 0.2, 'middle', tracking=-0.1), fg)


def svg(w, h, body, bg=None, title='waynesdays'):
    rect = f'<rect width="{f(w)}" height="{f(h)}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{rect}{body}</svg>')


# ---- the marks -----------------------------------------------------------
# Every builder returns (width, height, body) for a given type colour and accent.

def wordmark_tab(fg, ac, size=100.0, signed=False):
    w = SERIF.width(NAME, size)
    asc = size * 0.72
    base = asc
    ry = base + size * 0.40
    sw = size * 0.012
    gap, dx, h = size * 0.13, size * 0.11, size * 0.16
    if signed:
        est_size = size * 0.15
        est_w = SANS.width(EST, est_size, tracking=0.22)
        st_x = w * 0.30
        body = (path(SERIF.text(NAME, size, 0, base), fg)
                + f'<path d="M{f(w * 0.0)} {f(ry)}H{f(st_x - gap * .6)}" stroke="{fg}" stroke-width="{f(sw)}"/>'
                + stripes(st_x, ry + h / 2, ac, gap=gap, dx=dx, h=h, sw=size * 0.034)
                + path(SANS.text(EST, est_size, w, ry + est_size * 0.36, 'end', tracking=0.22), fg))
    else:
        sx = w * 0.64
        body = (path(SERIF.text(NAME, size, 0, base), fg)
                + f'<path d="M{f(w * 0.06)} {f(ry)}H{f(sx - gap * .6)}" stroke="{fg}" stroke-width="{f(sw)}"/>'
                + stripes(sx, ry + h / 2, ac, gap=gap, dx=dx, h=h, sw=size * 0.034))
    return w, ry + h, body


def mono_ring(fg, ac, r=50.0, tab=False):
    sw = r * 0.036
    pad = sw
    body = ring(r + pad, r + pad, r, ac, sw) + monogram(r + pad, r + pad, r, fg)
    hgt = 2 * (r + pad)
    if tab:
        gap, dx, h = r * 0.17, r * 0.13, r * 0.18
        sw2 = r * 0.05
        x = r + pad - stripes_w(gap, dx) / 2
        body += stripes(x, hgt + r * 0.36, ac, gap=gap, dx=dx, h=h, sw=sw2)
        hgt += r * 0.40
    return 2 * (r + pad), hgt, body


def open_ring(fg, ac, r=50.0, with_mono=True):
    """The ring opens at the bottom and the five stripes sit in the gap."""
    sw = r * 0.036
    pad = sw
    cx = cy = r + pad
    g = math.radians(40)
    a1, a2 = math.pi / 2 + g, math.pi / 2 - g
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    x2, y2 = cx + r * math.cos(a2), cy + r * math.sin(a2)
    gap, dx, h = r * 0.14, r * 0.10, r * 0.20
    sx = cx - stripes_w(gap, dx) / 2
    body = (f'<path d="M{f(x1)} {f(y1)}A{f(r)} {f(r)} 0 1 1 {f(x2)} {f(y2)}" fill="none" stroke="{ac}" stroke-width="{f(sw)}"/>'
            + stripes(sx, cy + r + h / 2, ac, gap=gap, dx=dx, h=h, sw=r * 0.05))
    if with_mono:
        body += monogram(cx, cy - r * 0.04, r, fg)
    return 2 * (r + pad), cy + r + h / 2 + pad, body


def lockup(fg, ac):
    """Primary: ring monogram + the tab wordmark."""
    size = 100.0
    ww, wh, wbody = wordmark_tab(fg, ac, size)
    r = size * 0.56
    rw, rh, rbody = mono_ring(fg, ac, r)
    gap = size * 0.34
    # centre the ring on the wordmark's x-height band
    ty = (size * 0.72 - size * 0.22) - rh / 2
    oy = max(0, -ty)
    body = f'<g transform="translate(0 {f(ty + oy)})">{rbody}</g><g transform="translate({f(rw + gap)} {f(oy)})">{wbody}</g>'
    return rw + gap + ww, max(rh + ty + oy, wh + oy), body


def stacked(fg, ac):
    r = 50.0
    rw, rh, rbody = open_ring(fg, ac, r)
    size = r * 0.30
    track = 0.55
    nw = SANS.width(NAME, size, track)
    w = max(rw, nw)
    body = (f'<g transform="translate({f((w - rw) / 2)} 0)">{rbody}</g>'
            + path(SANS.text(NAME, size, w / 2, rh + r * 0.62, 'middle', tracking=track), fg))
    return w, rh + r * 0.70, body


def seal(fg, ac):
    R = 100.0                  # outer text radius
    inner = R * 0.66
    ts = R * 0.18
    sw = inner * 0.036
    cx = cy = R + ts * 1.1
    body = ring(cx, cy, inner, ac, sw) + monogram(cx, cy - inner * 0.06, inner, fg)
    gap, dx, h = inner * 0.12, inner * 0.09, inner * 0.13
    body += stripes(cx - stripes_w(gap, dx) / 2, cy + inner * 0.62, ac, gap=gap, dx=dx, h=h, sw=inner * 0.04)
    body += path(SANS.arc(NAME, ts, cx, cy, R * 0.92, tracking=0.26), fg)
    body += path(SANS.arc(EST, ts, cx, cy, R * 0.92 + ts * 0.72, tracking=0.26, bottom=True), fg)
    for sx in (-1, 1):
        body += f'<circle cx="{f(cx + sx * R * 0.96)}" cy="{f(cy + ts * 0.05)}" r="{f(ts * 0.13)}" fill="{ac}"/>'
    return 2 * cx, 2 * cy, body


def label(fg, ac):
    size = 100.0
    nw = SERIF.width(NAME, size)
    gap, dx, h = size * 0.13, size * 0.11, size * 0.26
    padx = size * 0.62
    hgt = size * 1.32
    sw = size * 0.022
    st = stripes_w(gap, dx)
    w = padx + nw + size * 0.36 + st + padx * 0.82
    y0 = sw
    body = (f'<rect x="{f(sw)}" y="{f(y0)}" width="{f(w)}" height="{f(hgt)}" rx="{f(hgt / 2)}" fill="none" stroke="{ac}" stroke-width="{f(sw * 1.4)}"/>'
            + path(SERIF.text(NAME, size, sw + padx, y0 + hgt / 2 + size * 0.2), fg)
            + stripes(sw + padx + nw + size * 0.36, y0 + hgt / 2 + h * 0.45, ac, gap=gap, dx=dx, h=h, sw=size * 0.034))
    return w + 2 * sw, hgt + 2 * sw, body


LOGOS = {
    'primary': ('Primary lockup', lockup),
    'wordmark': ('Wordmark', lambda fg, ac: wordmark_tab(fg, ac)),
    'wordmark-signed': ('Signed wordmark', lambda fg, ac: wordmark_tab(fg, ac, signed=True)),
    'monogram': ('Monogram', lambda fg, ac: mono_ring(fg, ac)),
    'mark-open': ('Open ring', lambda fg, ac: open_ring(fg, ac)),
    'stacked': ('Stacked lockup', stacked),
    'seal': ('Seal', seal),
    'label': ('Label', label),
}


def padded(w, h, body, pad):
    return w + 2 * pad, h + 2 * pad, f'<g transform="translate({f(pad)} {f(pad)})">{body}</g>'


def app_icon(size=1024, bg=GREEN, fg=CREAM, ac=BRASS_LT, rounded=False, maskable=False):
    """Ring monogram with the tab beneath, on green. Fits the maskable safe zone."""
    r = size * (0.27 if maskable else 0.31)
    rw, rh, body = mono_ring(fg, ac, r, tab=True)
    ox, oy = (size - rw) / 2, (size - rh) / 2 + r * 0.06
    rx = f' rx="{f(size * 0.225)}"' if rounded else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
            f'<rect width="{size}" height="{size}" fill="{bg}"{rx}/><g transform="translate({f(ox)} {f(oy)})">{body}</g></svg>')


def main():
    os.makedirs(os.path.join(OUT, 'logos', 'svg'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'icons'), exist_ok=True)
    index = []
    for key, (title, build) in LOGOS.items():
        for vname, (fg, ac, bg) in VARIANTS.items():
            w, h, body = build(fg, ac)
            pad = max(w, h) * 0.04
            w, h, body = padded(w, h, body, pad)
            name = f'waynesdays-{key}-{vname}.svg'
            with open(os.path.join(OUT, 'logos', 'svg', name), 'w') as fh:
                fh.write(svg(w, h, body, title=f'waynesdays {title.lower()}'))
            index.append({'logo': key, 'title': title, 'variant': vname, 'file': f'logos/svg/{name}', 'w': round(w, 2), 'h': round(h, 2), 'preview': bg})
    icons = {
        'app-icon.svg': app_icon(),
        'app-icon-rounded.svg': app_icon(rounded=True),
        'app-icon-maskable.svg': app_icon(maskable=True),
        'app-icon-cream.svg': app_icon(bg=CREAM, fg=GREEN, ac=BRASS),
        'favicon.svg': app_icon(rounded=True),
    }
    for name, s in icons.items():
        with open(os.path.join(OUT, 'icons', name), 'w') as fh:
            fh.write(s)
    with open(os.path.join(ROOT, 'icon.svg'), 'w') as fh:
        fh.write(icons['app-icon.svg'])
    os.makedirs(os.path.join(OUT, 'social'), exist_ok=True)
    for name, (bg, fg, ac) in {'og-cream.svg': (CREAM, GREEN, BRASS), 'og-green.svg': (GREEN, CREAM, BRASS_LT)}.items():
        w, h, body = lockup(fg, ac)
        sc = 760 / w
        with open(os.path.join(OUT, 'social', name), 'w') as fh:
            fh.write(svg(1200, 630, f'<g transform="translate({f((1200 - w * sc) / 2)} {f((630 - h * sc) / 2)}) scale({f(sc)})">{body}</g>', bg=bg))
    os.makedirs(os.path.join(OUT, 'patterns'), exist_ok=True)
    for name, (bg, ac) in {'stripes-cream.svg': (CREAM, BRASS), 'stripes-green.svg': (GREEN, BRASS_LT)}.items():
        tile = f'<pattern id="t" width="60" height="40" patternUnits="userSpaceOnUse">{stripes(8, 26, ac, gap=8, dx=7, h=12, sw=2.4)}</pattern>'
        with open(os.path.join(OUT, 'patterns', name), 'w') as fh:
            fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"><defs>{tile}</defs><rect width="600" height="400" fill="{bg}"/><rect width="600" height="400" fill="url(#t)"/></svg>')
    with open(os.path.join(OUT, 'logos', 'index.json'), 'w') as fh:
        json.dump(index, fh, indent=1)
    # inline sprite for the app header: lockup in currentColor + brass accent via CSS variable
    w, h, body = lockup('currentColor', 'var(--logo-accent, #b08d57)')
    rw, rh, rbody = mono_ring('currentColor', 'var(--logo-accent, #b08d57)')
    # presentation attributes can't take var(), so the accent goes in a style attribute
    body, rbody = (re.sub(r'(stroke|fill)="(var\([^"]+\))"', r'style="\1:\2"', x) for x in (body, rbody))
    with open(os.path.join(OUT, 'sprite.svg'), 'w') as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" style="display:none">'
                 f'<symbol id="logo-lockup" viewBox="0 0 {f(w)} {f(h)}">{body}</symbol>'
                 f'<symbol id="logo-ring" viewBox="0 0 {f(rw)} {f(rh)}">{rbody}</symbol></svg>')
    # the app inlines the same symbols, between markers in index.html
    html_path = os.path.join(ROOT, 'index.html')
    html = open(html_path).read()
    symbols = (f'<symbol id="logo-lockup" viewBox="0 0 {f(w)} {f(h)}">{body}</symbol>'
               f'<symbol id="logo-ring" viewBox="0 0 {f(rw)} {f(rh)}">{rbody}</symbol>')
    html = re.sub(r'(<!-- brand:start -->).*?(<!-- brand:end -->)', lambda m: m.group(1) + symbols + m.group(2), html, flags=re.S)
    with open(html_path, 'w') as fh:
        fh.write(html)
    print(len(index), 'logo files,', len(icons), 'icons')


if __name__ == '__main__':
    main()
