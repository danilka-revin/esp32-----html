# Mindustry v146 assets

Original artwork and game data: Anuken and the Mindustry contributors.
Upstream: https://github.com/Anuken/Mindustry/tree/v146
Source archive: https://github.com/Anuken/Mindustry/archive/refs/tags/v146.tar.gz
The upstream GPL-3.0 license is reproduced in LICENSE-Mindustry.txt.

These are local, static previews derived from upstream PNG sprite layers,
not AI-generated images and not a real-time reproduction of the game renderer.
The import script centers/composites available bottom, main, preview and top
layers and limits previews to 192 pixels. Animation, team tinting, connection
variants, effects and assembled unit weapons are not simulated.

`src/sprite-manifest.json` records the exact upstream layers for each object.
Air is transparent. The internal shield-breaker block has no matching region
in the v146 source set and intentionally uses the upstream error texture.
Unknown mod objects use the editor's text fallback instead of a broken image.

Regenerate with `scripts/import-mindustry-assets.py` and a v146 source checkout
(Python 3 + Pillow). Normal installation/build does not require Python or
network access to Mindustry/GitHub to display the textures.
