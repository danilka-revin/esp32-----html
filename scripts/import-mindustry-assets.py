"""Import pinned upstream v146 sprites and block facts. Requires Pillow.
Usage: python scripts/import-mindustry-assets.py /path/to/Mindustry-146
Source archive: https://github.com/Anuken/Mindustry/archive/refs/tags/v146.tar.gz
No network access at runtime. Only static layers (not effects/animation) are composed.
"""
import json
import re
import shutil
import sys
from pathlib import Path
from PIL import Image

upstream = Path(sys.argv[1])
root = Path(__file__).resolve().parents[1]
sprites = upstream / 'core/assets-raw/sprites'
files = {p.stem: p for p in sorted(sprites.rglob('*.png'))}
output = root / 'public/mindustry'
output.mkdir(parents=True, exist_ok=True)
catalog = json.loads((root / 'src/catalog.json').read_text())
source = (upstream / 'core/src/mindustry/content/Blocks.java').read_text()
starts = list(re.finditer(r'^        \w+ = new \w+\("([^"]+)"', source, re.M))
facts = {}
kebab = lambda s: re.sub(r'([A-Z])', lambda m: '-' + m[1].lower(), s)
def number(s):
    s = s.strip().replace('f', '')
    if re.fullmatch(r'[\d.\s*/+()-]+', s):
        return eval(s, {'__builtins__': {}}, {})
    return None
for i, match in enumerate(starts):
    text = source[match.start():starts[i+1].start() if i+1 < len(starts) else len(source)]
    fact = {}
    req = re.search(r'requirements\(Category\.\w+,\s*(?:BuildVisibility\.\w+,\s*)?with\((.*?)\)\)', text, re.S)
    if req:
        fact['cost'] = {kebab(k): int(v) for k, v in re.findall(r'Items\.(\w+),\s*(\d+)', req[1])}
    for field in ['size', 'craftTime', 'heatRequirement', 'tier', 'drillTime', 'range', 'laserRange', 'maxNodes']:
        value = re.search(r'\b' + field + r' = ([^;]+);', text)
        if value and number(value[1]) is not None: fact[field] = number(value[1])
    fact['rotate'] = bool(re.search(r'\brotate = true', text))
    power = re.search(r'consumePower\(([^)]+)\)', text)
    if power and number(power[1]) is not None: fact['power'] = number(power[1]) * 60
    inputs = {}
    for group in re.findall(r'consumeItems\(with\((.*?)\)\)', text, re.S):
        inputs.update({kebab(k): int(v) for k, v in re.findall(r'Items\.(\w+),\s*(\d+)', group)})
    for k,v in re.findall(r'consumeItem\(Items\.(\w+),\s*(\d+)\)', text): inputs[kebab(k)] = int(v)
    if inputs: fact['inputs'] = inputs
    liquids = {}
    for k,v in re.findall(r'consumeLiquid\(Liquids\.(\w+),\s*([^\)]+)\)', text):
        if number(v) is not None: liquids[kebab(k)] = number(v) * 60
    if liquids: fact['liquids'] = liquids
    item = re.search(r'outputItem = new ItemStack\(Items\.(\w+),\s*(\d+)\)', text)
    if item: fact['output'] = {kebab(item[1]): int(item[2])}
    facts[match[1]] = fact
(root / 'src/block-facts.json').write_text(json.dumps(facts, ensure_ascii=False, indent=2) + '\n')

manifest = {}
for entry in catalog:
    id, kind = entry['id'], entry['type']
    layers = []
    if kind in ['item', 'liquid']:
        layers = [f'{kind}-{id}']
    elif id == 'air':
        # Air is actually invisible in the game.
        Image.new('RGBA', (32, 32)).save(output / 'block-air.png')
    else:
        names = [f'{id}-preview', id, f'{id}1', f'{id}-1', f'{id}-0-0', f'{id}-top-0', f'{id}-segment0', f'{id}-bottom']
        base = next((n for n in names if n in files), None)
        if base:
            layers = [base]
            if base == id:
                if f'{id}-bottom' in files: layers.insert(0, f'{id}-bottom')
                if f'{id}-top' in files: layers.append(f'{id}-top')
            if id in ['duct', 'armored-duct']: layers = ['duct-bottom-0', f'{id}-top-0']
            if 'conduit' in id and f'{id}-top-0' in files: layers = ['conduit-bottom-0', f'{id}-top-0']
            if entry.get('category') == 'turret':
                size = facts.get(id, {}).get('size', entry.get('size', 1))
                turret_base = next((n for n in [f'{id}-base', f'block-{size}'] if n in files), None)
                if turret_base: layers.insert(0, turret_base)
    filename = f'{kind}-{id}.png'
    if layers:
        images = [Image.open(files[n]).convert('RGBA') for n in layers]
        canvas = Image.new('RGBA', (max(i.width for i in images), max(i.height for i in images)))
        for image in images: canvas.alpha_composite(image, ((canvas.width-image.width)//2, (canvas.height-image.height)//2))
        canvas.thumbnail((192,192), Image.Resampling.NEAREST)
        canvas.save(output / filename, optimize=True)
    elif id != 'air':
        # Internal blocks without a drawable region use the game's own error icon.
        shutil.copyfile(upstream / 'core/assets/sprites/error.png', output / filename)
    manifest[f'{kind}:{id}'] = {'file': '/mindustry/' + filename, 'layers': [str(files[n].relative_to(upstream)) for n in layers], 'invisible': id == 'air', 'fallback': not layers and id != 'air'}
(root / 'src/sprite-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
shutil.copyfile(upstream / 'LICENSE', output / 'LICENSE-Mindustry.txt')
print(f'Imported {len(manifest)} objects; fallback:', [k for k,v in manifest.items() if v['fallback']])
