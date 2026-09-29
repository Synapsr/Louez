# Local PDF fonts

- `NotoSansCJK-{zh,ja,ko}.woff`: full Noto Sans CJK SC/JP/KR Medium,
  version 2.004, converted from static OTF to WOFF with fonttools 4.60.2.
  Source: [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk/tree/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/OTF).
  License: `NotoSans-LICENSE.txt` (SIL OFL 1.1).
- `Inter-{Regular,Bold}.ttf`: Inter 4.1 bundled by the existing PDF renderer.
  Source: [Inter v4.1](https://github.com/rsms/inter/releases/tag/v4.1).
  License: `OFL.txt` (SIL OFL 1.1).


CJK uses a single Medium face for regular and emphasized text. Complete fonts
are deliberate: PDF data can contain names and equipment descriptions absent
from the message catalogs. These files add approximately 40 MB to the server
image; they are not preloaded by web pages. React-pdf embeds only the used glyphs
in each generated document.
