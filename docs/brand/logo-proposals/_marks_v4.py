# -*- coding: utf-8 -*-
"""Série 4 — issue d'une idéation large (6 champs sémantiques, 5 lentilles, 68 idées).

Le brief de cette série : « on ne ressent rien » → chaque marque part d'un MOMENT VÉCU
de la location, pas d'une forme. L'enseigne suspendue, le ticket de consigne, la clé
de comptoir, la clé sortie du tableau.
"""
INK = "#141A22"; OR = "#F2601F"; W = "#FFFFFF"

def svg(b, d="", size=64):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 64 64" fill="none" '
            f'xmlns="http://www.w3.org/2000/svg">{d}{b}</svg>')

# ---- 01 · l'enseigne ---------------------------------------------------------
# Le panonceau suspendu de vitrine : à louer + ouvert, en une image. La corde en
# triangle et le clou font la lecture ; la barre blanche est le mot ; -3° de charme.
_ENS = (f'<g transform="rotate(-3 32 39)">'
        f'<path d="M16 24 32 9l16 15" stroke="{INK}" stroke-width="3.8" '
        f'stroke-linecap="round" stroke-linejoin="round"/>'
        f'<circle cx="32" cy="8.5" r="3.8" fill="{OR}"/>'
        f'<rect x="9" y="24" width="46" height="31" rx="7" fill="{INK}"/>'
        f'<rect x="17" y="36.5" width="30" height="6.5" rx="3.25" fill="{W}"/></g>')
_ENS_MONO = (f'<g transform="rotate(-3 32 39)">'
             f'<path d="M16 24 32 9l16 15" stroke="currentColor" stroke-width="3.8" '
             f'stroke-linecap="round" stroke-linejoin="round"/>'
             f'<circle cx="32" cy="8.5" r="3.8" fill="currentColor"/>'
             # la barre est un vrai trou (evenodd), pas une barre peinte
             f'<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" '
             f'd="M16 24h32a7 7 0 0 1 7 7v17a7 7 0 0 1-7 7H16a7 7 0 0 1-7-7V31a7 7 0 0 1 7-7Z '
             f'M20.25 36.5a3.25 3.25 0 0 0 0 6.5h23.5a3.25 3.25 0 0 0 0-6.5Z"/></g>')
SQ = 'M2 18C2 9.2 9.2 2 18 2h28c8.8 0 16 7.2 16 16v28c0 8.8-7.2 16-16 16H18C9.2 62 2 54.8 2 46Z'
_ENS_ICON = (f'<path d="{SQ}" fill="{INK}"/>'
             f'<g transform="rotate(-3 32 40)">'
             f'<path d="M18 26 32 13l14 13" stroke="{W}" stroke-width="3.6" '
             f'stroke-linecap="round" stroke-linejoin="round"/>'
             f'<circle cx="32" cy="12.5" r="3.6" fill="{OR}"/>'
             f'<rect x="12" y="26" width="40" height="27" rx="6" fill="{W}"/>'
             f'<rect x="19" y="37" width="26" height="6" rx="3" fill="{OR}"/></g>')

# ---- 02 · le ticket de consigne ---------------------------------------------
# Une moitié pour le loueur, une pour le client. Les encoches appariées sur la ligne
# de déchirure sont construites dans le contour (arcs concaves), pas en evenodd —
# un cercle qui déborde du corps se remplirait à l'extérieur.
_R = 7; _B = 4
_TL = (f'M16 17h12A{_B} {_B} 0 0 0 32 21V43A{_B} {_B} 0 0 0 28 47H16'
       f'A{_R} {_R} 0 0 1 9 40V24A{_R} {_R} 0 0 1 16 17Z')
_TR = (f'M32 21A{_B} {_B} 0 0 0 36 17H48A{_R} {_R} 0 0 1 55 24V40'
       f'A{_R} {_R} 0 0 1 48 47H36A{_B} {_B} 0 0 0 32 43Z')
def _ticket(gap, dy, left=INK, right=OR):
    return (f'<path fill="{left}" d="{_TL}"/>'
            f'<g transform="translate({gap} {dy})"><path fill="{right}" d="{_TR}"/></g>')

# ---- 03 · la clé au fob ------------------------------------------------------
_FOB = (f'<rect x="15" y="5" width="22" height="28" rx="7" fill="{OR}" transform="rotate(8 26 19)"/>'
        f'<circle cx="27.5" cy="13.5" r="3" fill="{W}" transform="rotate(8 26 19)"/>'
        f'<circle cx="31" cy="34" r="6" stroke="{INK}" stroke-width="5"/>'
        f'<g transform="rotate(-12 31 40)">'
        f'<path d="M31 40v14" stroke="{INK}" stroke-width="6" stroke-linecap="round"/>'
        f'<path d="M35 46h6M35 52h4.5" stroke="{INK}" stroke-width="4.8" stroke-linecap="round"/></g>')
_FOB_MONO = _FOB.replace(INK, "currentColor").replace(f'fill="{OR}"', 'fill="currentColor"')

# ---- 04 · la clé sortie (shadow board) --------------------------------------
_CLE = (f'<g stroke="{INK}" stroke-width="4.2" stroke-dasharray="6.5 5.5" '
        f'stroke-linecap="round" opacity=".8">'
        f'<circle cx="20" cy="22" r="8.5"/><path d="M20 32v18"/></g>'
        f'<g transform="rotate(14 42 34)">'
        f'<circle cx="42" cy="20" r="8.5" stroke="{OR}" stroke-width="6.5"/>'
        f'<path d="M42 30v18" stroke="{OR}" stroke-width="6.5" stroke-linecap="round"/>'
        f'<path d="M46.5 39h6.5M46.5 45.5h5" stroke="{OR}" stroke-width="5" stroke-linecap="round"/></g>')
_CLE_MONO = _CLE.replace(INK, "currentColor").replace(OR, "currentColor")

PISTES = {
 "enseigne": dict(fr="L'enseigne", moment="le panonceau suspendu en vitrine — à louer, et ouvert",
    mark=svg(_ENS), icon=svg(_ENS_ICON), mono=svg(_ENS_MONO), alt=None),
 "ticket": dict(fr="Le ticket de consigne", moment="la moitié pour vous, la moitié pour moi",
    mark=svg(_ticket(0, 0)), icon=svg(_ticket(0, 0)),
    alt=svg(_ticket(6, -3)),
    mono=svg(_ticket(3, 0, "currentColor", "currentColor"))),
 "cle-fob": dict(fr="La clé au fob", moment="ce qu'on vous tend au comptoir",
    mark=svg(_FOB), icon=svg(_FOB), mono=svg(_FOB_MONO), alt=None),
 "cle-sortie": dict(fr="La clé sortie", moment="le tableau à clés : sa place l'attend",
    mark=svg(_CLE), icon=svg(_CLE), mono=svg(_CLE_MONO), alt=None),
}
