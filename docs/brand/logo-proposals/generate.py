#!/usr/bin/env python3
"""Regenerate every logo-proposal asset from the geometry in _marks.py.

    python3 docs/brand/logo-proposals/generate.py

Every mark is defined once, in _marks.py, and the four renditions are derived from it.
Redrawing a rendition by hand is what makes a mark and its app icon drift apart.

Run from the repository root.
"""
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _marks import PISTES  # noqa: E402

ROOT = os.path.join("docs", "brand", "logo-proposals")

# The existing "Louez" wordmark, already outlined in packages/ui/src/components/logo.tsx.
WORDMARK = (
    'M14.3399 20.1H-0.000117145V-2.49147e-05H4.28988V16.29H14.3399V20.1ZM22.0658 20.4C17.5958 20.4 14.7158 17.25 '
    '14.7158 12.75C14.7158 8.27997 17.5958 5.09998 22.0658 5.09998C26.6558 5.09998 29.5658 8.27997 29.5658 12.75C'
    '29.5658 17.25 26.6558 20.4 22.0658 20.4ZM22.1258 16.92C23.9558 16.92 25.2158 15.75 25.2158 12.75C25.2158 '
    '9.71998 23.9558 8.57998 22.1258 8.57998C20.3258 8.57998 19.0658 9.71998 19.0658 12.75C19.0658 15.75 20.3258 '
    '16.92 22.1258 16.92ZM36.3707 20.4C33.5807 20.4 31.8407 18.69 31.8407 15.66V5.39998H36.1307V14.16C36.1307 '
    '15.96 36.6107 17.07 38.5907 17.07C40.6307 17.07 41.2607 15.93 41.2607 13.53V5.39998H45.5507V20.1H41.2607V'
    '15.99C40.7507 18.33 39.3407 20.4 36.3707 20.4ZM55.3827 20.4C50.7027 20.4 47.8527 17.28 47.8527 12.75C47.8527 '
    '8.21997 50.7027 5.09998 55.0227 5.09998C59.7027 5.09998 62.0427 8.21997 62.0427 12.06C62.0427 12.69 61.9827 '
    '13.53 61.8927 13.86H51.8727C52.1427 15.93 53.5227 16.92 55.4427 16.92C57.5127 16.92 58.6227 16.02 59.1627 '
    '14.76L61.7727 17.37C60.6627 18.96 58.6827 20.4 55.3827 20.4ZM55.0527 8.39998C53.2227 8.39998 52.0827 9.41998 '
    '51.8727 11.4H58.1727C58.0227 9.44998 56.9727 8.39998 55.0527 8.39998ZM76.6136 20.1H63.1736V16.95L68.2736 '
    '11.37L71.4236 8.66998L67.0736 8.87998H63.5936V5.39998H76.3136V8.54997L71.1236 13.86L67.7936 16.8L72.3236 '
    '16.62H76.6136V20.1Z'
)


def body_of(svg):
    """Strip the <svg> wrapper, keeping only the drawing."""
    return re.sub(r"^<svg[^>]*>|</svg>$", "", svg)


def lockup(mark, word_fill, optical_scale):
    """Mark at 32u, an 11u optical gap, then the wordmark at 17u cap height.

    Full-bleed container marks carry more ink than line marks at the same box size,
    so they are scaled down slightly to sit as a peer to the wordmark rather than
    towering over it.
    """
    cap = 17.0
    word_w = 77 / 21 * cap
    total_w = 32 + 11 + word_w
    scale = 0.5 * optical_scale
    offset = (1 - optical_scale) * 16
    return (
        f'<svg width="{total_w:.1f}" height="32" viewBox="0 0 {total_w:.1f} 32" fill="none" '
        f'xmlns="http://www.w3.org/2000/svg">'
        f'<g transform="translate({offset:.2f} {offset:.2f}) scale({scale:.4f})">{body_of(mark)}</g>'
        f'<g transform="translate({32 + 11} {(32 - cap) / 2:.2f}) scale({cap / 21:.5f})">'
        f'<path d="{WORDMARK}" fill="{word_fill}"/></g>'
        f"</svg>"
    )


def main():
    if not os.path.isdir(ROOT):
        sys.exit(f"run this from the repository root (missing {ROOT})")
    written = 0
    for key, piste in sorted(PISTES.items()):
        folder = os.path.join(ROOT, key)
        os.makedirs(folder, exist_ok=True)
        optical = piste.get("lockup", 1.0)
        renditions = {
            "mark.svg": piste["mark"],
            "icon.svg": piste["icon"],
            "mono.svg": piste["mono"],
            "lockup-light.svg": lockup(piste["mark"], "#0B0D12", optical),
            "lockup-dark.svg": lockup(piste["mark"], "#F5F6F8", optical),
        }
        for name, content in renditions.items():
            with open(os.path.join(folder, name), "w") as handle:
                handle.write(content + "\n")
            written += 1
        print(f"  {key}: {len(renditions)} files")
    print(f"{written} files written")


if __name__ == "__main__":
    main()
