# -*- coding: utf-8 -*-
"""Round 3 marks: mechanism, material, state and depth — no letterforms, no object at rest.

Three of these are two-state systems: the product knows whether an item is in or out, so the
mark can too. The state that ships as the logo is noted per piste.
"""
INK="#1B2430"; INK_D="#0B1119"; INK_L="#2E3D50"
OR="#F2601F"; OR_L="#FF7A3D"; OR_D="#B8420C"
AMB="#FFB020"; AMB_D="#C77E06"; AMB_DD="#965D02"
BONE="#F2EDE3"; OX="#8E2B2B"
FOR="#22855F"; FOR_D="#155B41"; FOR_DD="#0C3B2A"
BLU="#3B82F6"; BLU_D="#1D4FA0"; BLU_DD="#12325C"
g=lambda v:f"{v:g}"

def svg(b,size=64):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 64 64" fill="none" '
            f'xmlns="http://www.w3.org/2000/svg">{b}</svg>')

# ---- 01 · la pièce sortie ----------------------------------------------------
# A rounded square with a square bite taken from the top-right; the piece IS that bite, so
# seated or displaced the two always fit exactly. That exactness is the whole craft signal.
def _piece(body, acc, dx=13, dy=-13, X=10, Y=10, W=44, R=10, P=20):
    nx = X + W - P
    corps = (f'M{X+R} {Y}h{nx-X-R}v{P}h{P}v{W-P-R}a{R} {R} 0 0 1 -{R} {R}h-{W-2*R}'
             f'a{R} {R} 0 0 1 -{R} -{R}v-{W-2*R}a{R} {R} 0 0 1 {R} -{R}Z')
    morceau = f'M{nx} {Y}h{P-R}a{R} {R} 0 0 1 {R} {R}v{P-R}h-{P}Z'
    return (f'<path d="{corps}" fill="{body}"/>'
            f'<g transform="translate({g(dx)} {g(dy)})"><path d="{morceau}" fill="{acc}"/></g>')

# ---- 02 · l'alvéole ----------------------------------------------------------
def _socket(cx,cy,a,h,ha,d,top,left,right,wA,wB,fl,dx=0,dy=0,pc=None):
    b=a/2; hb=ha/2
    T=(cx,cy-b); R=(cx+a,cy); B=(cx,cy+b); L=(cx-a,cy)
    t=(cx,cy-hb); r=(cx+ha,cy); bo=(cx,cy+hb); l=(cx-ha,cy)
    t2,r2,b2,l2 = (t[0],t[1]+d),(r[0],r[1]+d),(bo[0],bo[1]+d),(l[0],l[1]+d)
    P=lambda p: f"{g(p[0])} {g(p[1])}"
    pt,pl,pr = pc if pc else (top,left,right)
    return (f'<path d="M{P(L)} {P(B)}v{g(h)}l{g(-a)} {g(-b)}Z" fill="{left}"/>'
            f'<path d="M{P(R)} {P(B)}v{g(h)}l{g(a)} {g(-b)}Z" fill="{right}"/>'
            f'<path d="M{P(t2)} {P(r2)} {P(b2)} {P(l2)}Z" fill="{fl}"/>'
            f'<path d="M{P(l)} {P(t)} {P(t2)} {P(l2)}Z" fill="{wA}"/>'
            f'<path d="M{P(t)} {P(r)} {P(r2)} {P(t2)}Z" fill="{wB}"/>'
            f'<path fill-rule="evenodd" fill="{top}" d="M{P(T)} {P(R)} {P(B)} {P(L)}Z '
            f'M{P(t)} {P(r)} {P(bo)} {P(l)}Z"/>'
            f'<g transform="translate({g(dx)} {g(dy)})">'
            f'<path d="M{P(l)} {P(bo)}v{g(d)}l{g(-ha)} {g(-hb)}Z" fill="{pl}"/>'
            f'<path d="M{P(r)} {P(bo)}v{g(d)}l{g(ha)} {g(-hb)}Z" fill="{pr}"/>'
            f'<path d="M{P(t)} {P(r)} {P(bo)} {P(l)}Z" fill="{pt}"/></g>')

# ---- 03 · le casier ----------------------------------------------------------
def _casier(body, acc, hole, out=True):
    xs=[13,26.5,40]
    cells="".join(f'<rect x="{g(x)}" y="26" width="11" height="24" rx="3.5" fill="{acc}"/>'
                  for i,x in enumerate(xs) if not (out and i==2))
    voidc=f'<rect x="40" y="26" width="11" height="24" rx="3.5" fill="{hole}"/>' if out else ""
    piece=f'<rect x="43" y="6" width="11" height="14" rx="3.5" fill="{acc}"/>' if out else ""
    return f'<rect x="7" y="20" width="50" height="36" rx="7" fill="{body}"/>{voidc}{cells}{piece}'

# ---- 04 · le circuit ---------------------------------------------------------
# Two rounded L-strokes in two tones of one hue: the near face and the far face of one band.
_CIRCUIT = (f'<path d="M13 42V23a10 10 0 0 1 10-10h19" stroke="{BLU}" stroke-width="12" stroke-linecap="round"/>'
            f'<path d="M51 22v19a10 10 0 0 1-10 10H22" stroke="{BLU_DD}" stroke-width="12" stroke-linecap="round"/>')
# in one colour the two faces collapse, so the mono drawing opens a real gap at each turn
_CIRCUIT_MONO = ('<path d="M13 40V23a10 10 0 0 1 10-10h17" stroke="currentColor" stroke-width="12" stroke-linecap="round"/>'
                 '<path d="M51 24v17a10 10 0 0 1-10 10H24" stroke="currentColor" stroke-width="12" stroke-linecap="round"/>')

# ---- 05 · la perforation -----------------------------------------------------
_PERFO_HOLES = " ".join(f'M26 {y}a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 1 0 0-5.6Z' for y in range(11,52,8))
_PERFO = (f'<path fill-rule="evenodd" fill="{INK}" d="M12 8h40a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H12'
          f'a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z {_PERFO_HOLES}"/>'
          f'<path d="M6 14a6 6 0 0 1 6-6h11v48H12a6 6 0 0 1-6-6Z" fill="{OR}"/>'
          f'<path fill-rule="evenodd" fill="{INK}" d="M23 8h29a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H23Z {_PERFO_HOLES}"/>')

PISTES = {
 "piece": dict(
   fr="La pièce sortie", ship="sortie",
   mark=svg(_piece(INK, OR)), alt=svg(_piece(INK, OR, 0, 0)),
   mono=svg(_piece("currentColor", "currentColor")),
   palettes={"encre + orange": svg(_piece(INK, OR)),
             "forêt + ambre":  svg(_piece(FOR, AMB)),
             "oxblood + os":   svg(_piece(OX, BONE))}),
 "alveole": dict(
   fr="L'alvéole", ship="sortie",
   mark=svg(_socket(32,30,24,14,11,7,INK_L,INK,INK_D,"#0B121B","#060B12","#03070C",0,-19,(OR_L,OR,OR_D))),
   alt =svg(_socket(32,30,24,14,11,7,INK_L,INK,INK_D,"#0B121B","#060B12","#03070C",0,0,(OR_L,OR,OR_D))),
   mono=svg('<path fill-rule="evenodd" fill="currentColor" d="M32 18 56 30 32 42 8 30Z '
            'M32 24.5 43 30 32 35.5 21 30Z"/>'
            '<path fill="currentColor" opacity=".72" d="M8 30v14l24 12V42Z"/>'
            '<path fill="currentColor" opacity=".45" d="M56 30v14L32 56V42Z"/>'
            '<path fill="currentColor" d="M32 5 43 11 32 17 21 11Z"/>'),
   palettes={"encre + orange": svg(_socket(32,30,24,14,11,7,INK_L,INK,INK_D,"#0B121B","#060B12","#03070C",0,-19,(OR_L,OR,OR_D))),
             "bleu + ambre":   svg(_socket(32,30,24,14,11,7,BLU,BLU_D,BLU_DD,"#0B1F3D","#071630","#040E20",0,-19,(AMB,AMB_D,AMB_DD))),
             "forêt + ambre":  svg(_socket(32,30,24,14,11,7,FOR,FOR_D,FOR_DD,"#07281C","#041B13","#02120C",0,-19,(AMB,AMB_D,AMB_DD)))}),
 "casier": dict(
   fr="Le casier", ship="un emplacement vide",
   mark=svg(_casier(INK, OR, INK_D)), alt=svg(_casier(INK, OR, INK_D, False)),
   mono=svg('<path fill-rule="evenodd" fill="currentColor" d="M14 20h36a7 7 0 0 1 7 7v22a7 7 0 0 1-7 7H14'
            'a7 7 0 0 1-7-7V27a7 7 0 0 1 7-7Z M40 26h11v24H40Z"/>'
            '<rect x="43" y="6" width="11" height="14" rx="3.5" fill="currentColor"/>'),
   palettes={"encre + orange": svg(_casier(INK, OR, INK_D)),
             "forêt + ambre":  svg(_casier(FOR_DD, AMB, "#061F16")),
             "oxblood + os":   svg(_casier(OX, BONE, "#5E1A1A"))}),
 "circuit": dict(
   fr="Le circuit", ship=None,
   mark=svg(_CIRCUIT), alt=None, mono=svg(_CIRCUIT_MONO),
   palettes={"bleu, deux faces": svg(_CIRCUIT),
             "encre + orange": svg(_CIRCUIT.replace(BLU, OR).replace(BLU_DD, INK)),
             "forêt + ambre":  svg(_CIRCUIT.replace(BLU, AMB).replace(BLU_DD, FOR_DD))}),
 "perforation": dict(
   fr="La perforation", ship=None,
   mark=svg(_PERFO), alt=None,
   mono=svg(f'<path fill-rule="evenodd" fill="currentColor" d="M12 8h40a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H12'
            f'a6 6 0 0 1-6-6V14a6 6 0 0 1 6-6Z {_PERFO_HOLES}"/>'),
   palettes={"encre + orange": svg(_PERFO)}),
}
