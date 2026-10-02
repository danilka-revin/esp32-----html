# Mindustry v160.2 assets

Original artwork and game data: Anuken and the Mindustry contributors.
Upstream: https://github.com/Anuken/Mindustry/tree/v160.2
Source archive: https://github.com/Anuken/Mindustry/archive/refs/tags/v160.2.tar.gz
The upstream GPL-3.0 license is reproduced in LICENSE-Mindustry.txt.

These are local, static previews derived from upstream PNG sprite layers,
not a real-time reproduction of the game renderer. Animation, team tinting,
connection variants, effects and assembled unit weapons are not simulated.

`src/sprite-manifest.json` records the exact upstream layers for each object.
Air is transparent; objects without a display sprite use the upstream error
texture, while unknown mod objects use the editor's text fallback.

Regenerate with `scripts/import-mindustry-assets.py` and a tagged source
checkout (Python 3 + Pillow). Normal build/runtime needs no upstream source
or network access.
