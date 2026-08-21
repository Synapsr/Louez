# -*- coding: utf-8 -*-
"""Round 2 marks: object-led, dimensional, no letterforms."""
INK="#1B2430"; INK_D="#111823"; STEEL="#8595AB"; STEEL_D="#5C6B7E"
OR="#F2601F"; ORD="#C4460F"; ORDD="#8E3208"
LT="#4C8DF6"; MD="#2560C9"; DK="#16386F"; DEEP="#0C1F3E"
f=lambda v:f"{v:g}"

def svg(b,size=64):
    return (f'<svg width="{size}" height="{size}" viewBox="0 0 64 64" fill="none" '
            f'xmlns="http://www.w3.org/2000/svg">{b}</svg>')

def box(cx,cy,a,h,top,left,right,b=None):
    b=a/2 if b is None else b
    return (f'<path d="M{f(cx)} {f(cy-b)} {f(cx+a)} {f(cy)} {f(cx)} {f(cy+b)} {f(cx-a)} {f(cy)}Z" fill="{top}"/>'
            f'<path d="M{f(cx-a)} {f(cy)} {f(cx)} {f(cy+b)}v{f(h)}l{f(-a)} {f(-b)}Z" fill="{left}"/>'
            f'<path d="M{f(cx+a)} {f(cy)} {f(cx)} {f(cy+b)}v{f(h)}l{f(a)} {f(-b)}Z" fill="{right}"/>')

# ---- la malle ---------------------------------------------------------------
MX,MY,MW,MH,MR,MA,MT = 8,10,48,44,6,15,8
def _corner_paths():
    X,Y,W,H,r,A,T = MX,MY,MW,MH,MR,MA,MT
    return [f'M{X} {Y+r}a{r} {r} 0 0 1 {r} -{r}h{A-r}v{T}h{T-A}v{A-T}h-{T}Z',
            f'M{X+W} {Y+r}a{r} {r} 0 0 0 -{r} -{r}h-{A-r}v{T}h{A-T}v{A-T}h{T}Z',
            f'M{X} {Y+H-r}a{r} {r} 0 0 0 {r} {r}h{A-r}v-{T}h{T-A}v{T-A}h-{T}Z',
            f'M{X+W} {Y+H-r}a{r} {r} 0 0 1 -{r} {r}h-{A-r}v-{T}h{A-T}v{T-A}h{T}Z']
SEAM = f'M{MX} {MY+MH/2-1.5}h{MW}v3h-{MW}Z'
MALLE = (f'<rect x="{MX}" y="{MY}" width="{MW}" height="{MH}" rx="{MR}" fill="{INK}"/>'
         f'<path d="{SEAM}" fill="{STEEL_D}"/>'
         + "".join(f'<path d="{p}" fill="{OR}"/>' for p in _corner_paths()))
# monochrome: body as an outline, corners solid — knocking them out of a filled body
# collapsed the silhouette into a cross.
MALLE_MONO = (f'<rect x="{MX+2.5}" y="{MY+2.5}" width="{MW-5}" height="{MH-5}" rx="{MR-1}" '
              f'stroke="currentColor" stroke-width="5"/>'
              f'<path d="M{MX} {MY+MH/2-1.5}h{MW}v3h-{MW}Z" fill="currentColor"/>'
              + "".join(f'<path d="{p}" fill="currentColor"/>' for p in _corner_paths()))

# ---- la caisse à fente ------------------------------------------------------
CAISSE = box(32,33,25,13,LT,MD,DK,b=12) + f'<path d="M32 21 45.5 33 32 45 18.5 33Z" fill="{DEEP}"/>'
CAISSE_MONO = (f'<path fill-rule="evenodd" clip-rule="evenodd" fill="currentColor" '
               f'd="M32 21 57 33 32 45 7 33Z M32 26.5 45.5 33 32 39.5 18.5 33Z"/>'
               f'<path fill="currentColor" d="M7 33v11l25 12v-11Z" opacity=".72"/>'
               f'<path fill="currentColor" d="M57 33v11L32 56V45Z" opacity=".45"/>')

# ---- la caisse sanglée ------------------------------------------------------
def _strap(cx,cy,a,h,t1,t2,ctop,cside,b=None):
    b=a/2 if b is None else b
    Q=lambda t:(cx-a+t*a, cy-t*b)
    q1,q2=Q(t1),Q(t2); p1=(q1[0]+a,q1[1]+b); p2=(q2[0]+a,q2[1]+b)
    return (f'<path d="M{f(q1[0])} {f(q1[1])} {f(q2[0])} {f(q2[1])} {f(p2[0])} {f(p2[1])} {f(p1[0])} {f(p1[1])}Z" fill="{ctop}"/>'
            f'<path d="M{f(p1[0])} {f(p1[1])} {f(p2[0])} {f(p2[1])}v{f(h)}h{f(p1[0]-p2[0])}Z" fill="{cside}"/>')
SANGLEE = box(32,30,23,14,LT,MD,DK) + _strap(32,30,23,14,0.36,0.62,OR,ORD)
SANGLEE_MONO = (box(32,30,23,14,"currentColor","currentColor","currentColor").replace('fill="currentColor"','fill="currentColor" opacity="1"',1)
                + _strap(32,30,23,14,0.36,0.62,"#FFFFFF","#FFFFFF"))

# ---- le diable --------------------------------------------------------------
DIABLE = (f'<path d="M16 9v33h26" stroke="{MD}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
          f'<rect x="23" y="15" width="25" height="23" rx="4" fill="{OR}"/>'
          f'<circle cx="19" cy="52" r="7" fill="{DK}"/>')
DIABLE_MONO = (f'<path d="M16 9v33h26" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>'
               f'<rect x="24" y="16" width="23" height="21" rx="4" stroke="currentColor" stroke-width="6"/>'
               f'<circle cx="19" cy="52" r="7" fill="currentColor"/>')

# ---- la boucle et la sangle -------------------------------------------------
BOUCLE = (f'<rect x="4" y="25" width="56" height="15" rx="7.5" fill="{LT}"/>'
          f'<rect x="21" y="7" width="26" height="51" rx="13" stroke="{OR}" stroke-width="10"/>'
          f'<path d="M44 25h8a7.5 7.5 0 0 1 0 15h-8Z" fill="{LT}"/>')
BOUCLE_MONO = (f'<rect x="4" y="25" width="56" height="15" rx="7.5" fill="currentColor"/>'
               f'<rect x="21" y="7" width="26" height="51" rx="13" stroke="currentColor" stroke-width="10"/>'
               f'<path d="M44 25h8a7.5 7.5 0 0 1 0 15h-8Z" fill="currentColor"/>')

PISTES = {
 "malle":    dict(fr="La malle",         mark=svg(MALLE),   mono=svg(MALLE_MONO)),
 "caisse":   dict(fr="La caisse à fente",mark=svg(CAISSE),  mono=svg(CAISSE_MONO)),
 "sanglee":  dict(fr="La caisse sanglée",mark=svg(SANGLEE), mono=svg(SANGLEE_MONO)),
 "diable":   dict(fr="Le diable",        mark=svg(DIABLE),  mono=svg(DIABLE_MONO)),
 "boucle":   dict(fr="La boucle",        mark=svg(BOUCLE),  mono=svg(BOUCLE_MONO)),
}
