#!/usr/bin/env python3
"""Check every colour pairing in tokens.css against WCAG 2.2 AA.

Usage:  python3 design/check-contrast.py [path/to/tokens.css]

Exits non-zero if anything fails, so it can sit in CI.
"""
import re
import sys
from pathlib import Path

CATEGORIES = ["organize", "optimize", "convert-to", "convert-from", "edit", "security", "smart"]
STATUSES = ["danger", "success", "warning"]


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
            ("ink on paper", "ink", "paper", 7),
            ("ink on surface", "ink", "surface", 7),
            ("ink on surface-sunk", "ink", "surface-sunk", 7),
            ("ink-muted on paper", "ink-muted", "paper", 4.5),
            ("ink-muted on surface", "ink-muted", "surface", 4.5),
            ("ink-muted on surface-sunk", "ink-muted", "surface-sunk", 4.5),
            ("on-ink on ink (primary button)", "on-ink", "ink", 7),
            ("focus ring on paper", "focus-ring", "paper", 3),
        ]
        for c in CATEGORIES:
            p = f"cat-{c}-"
            checks += [
                (f"{c}: on on fill", p + "on", p + "fill", 4.5),
                (f"{c}: text on paper", p + "text", "paper", 4.5),
                (f"{c}: text on surface", p + "text", "surface", 4.5),
                (f"{c}: text on soft", p + "text", p + "soft", 4.5),
                (f"{c}: ink on soft", "ink", p + "soft", 7),
            ]
        for s in STATUSES:
            checks += [
                (f"{s}: on on fill", f"{s}-on", f"{s}-fill", 4.5),
                (f"{s}: text on paper", f"{s}-text", "paper", 4.5),
                (f"{s}: text on soft", f"{s}-text", f"{s}-soft", 4.5),
            ]
        for label, fg, bg, need in checks:
            v = ratio(t[fg], t[bg])
            ok = v >= need
            failures += not ok
            rows.append((theme, label, v, need, ok))

    for theme, label, v, need, ok in rows:
        print(f"{theme:5}  {label:34}  {v:5.2f}  needs {need:<3}  {'ok' if ok else 'FAIL'}")
    print(f"\n{len(rows) - failures}/{len(rows)} pairings pass")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
