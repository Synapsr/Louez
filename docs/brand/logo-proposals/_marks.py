# -*- coding: utf-8 -*-
"""Single source of truth for the Louez logo proposals.

Every mark emits four renditions:
  mark   — standalone, transparent ground
  icon   — knocked out of the brand squircle, for app icons / avatars
  mono   — one colour via currentColor, for print, stamps, invoices, GitHub
  lockup — generated separately, mark + the existing "Louez" wordmark

Colours are the codebase's own tokens, converted from oklch:
  --primary (dashboard) oklch(0.546 0.228 264) -> #265FF2
  --louez-orange        oklch(0.689 0.192 44.745) -> #F76A13
"""
B = "#265FF2"; O = "#F76A13"; W = "#FFFFFF"

SQ = 'M2 18C2 9.2 9.2 2 18 2h28c8.8 0 16 7.2 16 16v28c0 8.8-7.2 16-16 16H18C9.2 62 2 54.8 2 46Z'
# Tag silhouette: a squircle with a deep chamfer on the eyelet corner. The chamfer is
# deliberately deep — a shallow one reads as a folded-corner document icon.
TAG = 'M30 4h22a8 8 0 0 1 8 8v40a8 8 0 0 1-8 8H12a8 8 0 0 1-8-8V26Z'

def svg(body, size=64):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 64 64" fill="none" '
            f'xmlns="http://www.w3.org/2000/svg">{body}</svg>')

def contained(body, scale=0.84, keep_accent=False):
    """Reverse the mark out of the brand squircle, reusing its exact geometry.
    Deriving the icon from the mark rather than redrawing it is what keeps the two
    renditions identical in proportion."""
    inner = body.replace(B, W) if keep_accent else body.replace(B, W).replace(O, W)
    return svg(f'<path d="{SQ}" fill="{B}"/>'
               f'<g transform="translate(32 32) scale({scale}) translate(-32 -32)">{inner}</g>')

PISTES = {}

# ---- 01 · L'étiquette --------------------------------------------------------
_tag_eye = f'<circle cx="21" cy="19" r="4.6" fill="{O}"/>'
_tag_l   = f'<path d="M20 26h13v18h18v10H20Z" fill="{W}"/>'
_p1 = f'<path d="{TAG}" fill="{B}"/>{_tag_eye}{_tag_l}'
PISTES["01-etiquette"] = dict(fr="L'étiquette", en="The Asset Tag", lockup=0.90,
    mark=svg(_p1), icon=svg(_p1),
    mono=svg(f'<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" d="{TAG}'
             f' M21 14.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 1 0 0-9.2Z'
             f' M20 26h13v18h18v10H20Z"/>'))

# ---- 02 · L'emplacement ------------------------------------------------------
_p2 = (f'<path d="M14 13v30a5 5 0 0 0 5 5h31" stroke="{B}" stroke-width="11.5" '
       f'stroke-linecap="round" stroke-linejoin="round"/>'
       f'<rect x="32" y="16" width="20" height="20" rx="5.75" fill="{O}"/>')
PISTES["02-emplacement"] = dict(fr="L'emplacement", en="The Slot", lockup=1.0,
    mark=svg(_p2), icon=contained(_p2, 0.82, keep_accent=True),
    mono=svg(f'<path d="M14 13v30a5 5 0 0 0 5 5h31" stroke="currentColor" stroke-width="11.5" '
             f'stroke-linecap="round" stroke-linejoin="round"/>'
             f'<rect x="34" y="18" width="16" height="16" rx="4.6" fill="currentColor"/>'))

# ---- 03 · Le L ouvert --------------------------------------------------------
# The white L overshoots and is clipped to the squircle: terminating it exactly on the
# edge left an antialiasing seam, and letting it run past showed as a clipping bug on dark.
_l_open = 'M20 -2h12v32h34v12H20Z'
PISTES["03-l-ouvert"] = dict(fr="Le L ouvert", en="The Open L", lockup=0.90,
    mark=svg(f'<defs><clipPath id="lz-sq"><path d="{SQ}"/></clipPath></defs>'
             f'<path d="{SQ}" fill="{B}"/>'
             f'<g clip-path="url(#lz-sq)"><path d="{_l_open}" fill="{W}"/></g>'),
    icon=svg(f'<defs><clipPath id="lz-sq"><path d="{SQ}"/></clipPath></defs>'
             f'<path d="{SQ}" fill="{B}"/>'
             f'<g clip-path="url(#lz-sq)"><path d="{_l_open}" fill="{W}"/></g>'),
    mono=svg(f'<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" '
             f'd="{SQ} M20 2h12v28h30v12H20Z"/>'))

# ---- 04 · Le Z ---------------------------------------------------------------
# Short top bar, long bottom bar overshooting to the right: the exit ramp.
_z = 'M17 14H41V22L27 41H53V50H17V42L29 23H17Z'
PISTES["04-le-z"] = dict(fr="Le Z", en="The Return Z", lockup=1.0,
    mark=svg(f'<path d="{_z}" fill="{B}"/>'),
    icon=svg(f'<path d="{SQ}" fill="{B}"/>'
             f'<g transform="translate(32 32) scale(0.84) translate(-32 -32)">'
             f'<path d="{_z}" fill="{W}"/></g>'),
    mono=svg(f'<path d="{_z}" fill="currentColor"/>'))

# ---- 90 · Le créneau — explored, then set aside ------------------------------
_p90 = f'<g fill="{B}"><path d="M11 15h11v27h16v11H11Z"/><path d="M53 49H42V22H26V11h27Z"/></g>'
PISTES["90-creneau"] = dict(fr="Le créneau", en="The Booking Window", lockup=1.0, rejected=True,
    mark=svg(_p90), icon=contained(_p90), mono=svg(_p90.replace(B, "currentColor")))

# ---- 91 · L'aller-retour — explored, then set aside --------------------------
_p91 = (f'<g stroke="{B}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round">'
        f'<path d="M17 13v27h20"/><path d="M50 48V29a11 11 0 0 0-11-11"/></g>')
PISTES["91-aller-retour"] = dict(fr="L'aller-retour", en="The Round Trip", lockup=1.0, rejected=True,
    mark=svg(_p91), icon=contained(_p91, 0.80), mono=svg(_p91.replace(B, "currentColor")))

# ---- 00 · the mark as it stands today ---------------------------------------
_p0 = '<circle cx="32" cy="32" r="32" fill="#1f54dd"/><path d="M20 14v36h24v-8H28V14Z" fill="#fff"/>'
PISTES["00-actuel"] = dict(fr="Le logo actuel", en="Current", lockup=0.90, current=True,
    mark=svg(_p0), icon=svg(_p0),
    mono=svg('<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" '
             'd="M32 0a32 32 0 1 0 0 64 32 32 0 1 0 0-64Z M20 14v36h24v-8H28V14Z"/>'))
