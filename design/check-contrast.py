#!/usr/bin/env python3
"""Check every colour pairing in tokens.css against WCAG 2.2 AA.

Usage:  python3 design/check-contrast.py [path/to/tokens.css]

Exits non-zero if anything fails, so it can sit in CI.
"""
import re
import sys
from pathlib import Path

CATEGORIES = ["organize", "optimize", "convert-to", "convert-from", "edit", "security", "smart"]


def blocks(css):
    """Return {'light': {...}, 'dark': {...}} of hex custom properties."""
    light_src = css.split("@media (prefers-color-scheme: dark)")[0]
    dark_src = css.split(':root[data-theme="dark"]')[1].split("}")[0]
    grab = lambda src: {k: v.lower() for k, v in re.findall(r"--([\w-]+):\s*(#[0-9a-fA-F]{6})\b", src)}
    light = grab(light_src)
    dark = {**light, **grab(dark_src)}
    return {"light": light, "dark": dark}


def luminance(hex_):
    r, g, b = (int(hex_[i:i + 2], 16) / 255 for i in (1, 3, 5))
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)


def ratio(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


def main():
    path = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).with_name("tokens.css"))
    themes = blocks(path.read_text())
    failures = 0
    rows = []

    for theme, t in themes.items():
        checks = [
            ("main text on main background", "color-main-text", "color-main-background", 7),
            ("main text on hover", "color-main-text", "color-background-hover", 7),
            ("main text on background-dark", "color-main-text", "color-background-dark", 7),
            ("maxcontrast on main background", "color-text-maxcontrast", "color-main-background", 4.5),
            ("maxcontrast on hover", "color-text-maxcontrast", "color-background-hover", 4.5),
            ("border-maxcontrast on background (UI)", "color-border-maxcontrast", "color-main-background", 3),
            ("primary text on primary", "color-primary-element-text", "color-primary-element", 4.5),
            ("primary text on primary hover", "color-primary-element-text", "color-primary-element-hover", 4.5),
            ("primary on main background (UI)", "color-primary-element", "color-main-background", 3),
            ("light-primary text on light-primary", "color-primary-element-light-text", "color-primary-element-light", 4.5),
            ("error text on error", "color-error-text", "color-error", 4.5),
            ("warning text on warning", "color-warning-text", "color-warning", 4.5),
            ("success text on success", "color-success-text", "color-success", 4.5),
            ("info text on info", "color-info-text", "color-info", 4.5),
            ("error text on background", "color-text-error", "color-main-background", 4.5),
        ]
        for c in CATEGORIES:
            p = f"cat-{c}-"
            checks += [
                (f"{c}: on on fill", p + "on", p + "fill", 4.5),
                (f"{c}: text on background", p + "text", "color-main-background", 4.5),
                (f"{c}: text on soft", p + "text", p + "soft", 4.5),
                (f"{c}: main text on soft", "color-main-text", p + "soft", 7),
            ]
        for label, fg, bg, need in checks:
            v = ratio(t[fg], t[bg])
            ok = v >= need
            failures += not ok
            rows.append((theme, label, v, need, ok))

    for name, bg, fg in re.findall(r'data-backdrop="([\w-]+)"\]\s*\{\s*--color-background-plain:\s*(#[0-9a-f]{6});\s*--color-background-plain-text:\s*(#[0-9a-f]{6})', path.read_text()):
        v = ratio(fg, bg)
        ok = v >= 4.5
        failures += not ok
        rows.append(("both", f"backdrop {name}: header text", v, 4.5, ok))

    for theme, label, v, need, ok in rows:
        print(f"{theme:5}  {label:34}  {v:5.2f}  needs {need:<3}  {'ok' if ok else 'FAIL'}")
    print(f"\n{len(rows) - failures}/{len(rows)} pairings pass")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
