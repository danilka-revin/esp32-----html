#!/usr/bin/env python3
"""Import the exact Mindustry content catalog, facts and static sprites.

Usage:
  python scripts/import-mindustry-assets.py /path/to/Mindustry-v160.2

Run against a tagged upstream checkout. Runtime does not need Python, Pillow,
Mindustry source code, or network access. Pillow is only needed for regeneration.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image

if len(sys.argv) != 2:
    raise SystemExit(__doc__)

upstream = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parents[1]
content = upstream / "core/src/mindustry/content"
raw_sprites = upstream / "core/assets-raw/sprites"


def kebab(value: str) -> str:
    value = re.sub(r"([a-z0-9])([A-Z])", r"\1-\2", value)
    return re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()


def read_properties(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    lines = path.read_text(encoding="utf-8").splitlines()
    pending = ""
    for line in lines:
        if not line or line.lstrip().startswith(("#", "!")):
            continue
        pending += line.rstrip()
        if pending.endswith("\\"):
            pending = pending[:-1]
            continue
        match = re.match(r"([^=:\s]+)\s*[=:]\s*(.*)$", pending)
        if match:
            value = match.group(2).replace(r"\n", "\n").replace(r"\t", "\t").replace(r"\\", "\\")
            values[match.group(1)] = value
        pending = ""
    return values


def fields_from_declaration(source: str, marker: str, stop: str) -> list[str]:
    start = source.index(marker) + len(marker)
    end = source.index(stop, start)
    declaration = re.sub(r"//[^\n]*", " ", source[start:end])
    return re.findall(r"\b[A-Za-z_]\w*\b", declaration)


def region_by_line(source: str) -> dict[int, str]:
    stack: list[str] = []
    output: dict[int, str] = {}
    for index, line in enumerate(source.splitlines()):
        if re.search(r"//\s*endregion\b", line):
            if stack:
                stack.pop()
        match = re.search(r"//\s*region\s+(.+?)\s*$", line)
        if match:
            stack.append(match.group(1).strip().lower())
        output[index + 1] = stack[-1] if stack else ""
    return output


def content_assignments(path: Path, marker: str, stop: str, class_names: tuple[str, ...]):
    source = path.read_text(encoding="utf-8")
    variables = fields_from_declaration(source, marker, stop)
    starts = list(re.finditer(r"^ {8}(\w+)\s*=\s*new\s+\w+\s*\(", source, re.M))
    assigned = {match.group(1): match for match in starts if match.group(1) in variables}
    locations = region_by_line(source)
    entries = []
    for variable in variables:
        match = assigned.get(variable)
        if not match:
            continue
        next_matches = [candidate for candidate in starts if candidate.start() > match.start() and candidate.group(1) in variables]
        end = next_matches[0].start() if next_matches else len(source)
        snippet = source[match.start():end]
        constructor = re.search(r"new\s+(\w+)\s*\(\s*(?:\"([^\"]+)\"|Items\.(\w+))", snippet)
        if not constructor:
            continue
        block_class, literal_id, item_variable = constructor.groups()
        if literal_id:
            object_id = literal_id
        elif block_class == "OreBlock" and item_variable:
            object_id = "ore-" + kebab(item_variable)
        else:
            continue
        line_number = source.count("\n", 0, match.start()) + 1
        entries.append({
            "variable": variable,
            "id": object_id,
            "snippet": snippet,
            "line": line_number,
            "region": locations.get(line_number, ""),
            "class": block_class,
        })
    return source, entries


def parse_units(path: Path):
    source = path.read_text(encoding="utf-8")
    declaration = source[:source.index("public static void load()")]
    variables = []
    legacy_variables = set()
    for match in re.finditer(r"public\s+static\s+(.*?)UnitType\s+([^;]+);", declaration, re.S):
        prefix = re.sub(r"/\*.*?\*/|//[^\n]*", " ", match.group(1), flags=re.S)
        group = re.sub(r"/\*.*?\*/|//[^\n]*", " ", match.group(2), flags=re.S)
        names = re.findall(r"\b[A-Za-z_]\w*\b", group)
        variables.extend(names)
        if re.search(r"\blegacy\s*=\s*true", prefix):
            legacy_variables.update(names)
    assignments = {}
    for match in re.finditer(r"^ {8}(\w+)\s*=\s*new\s+(\w+)\s*\(\s*\"([^\"]+)\"", source, re.M):
        if match.group(1) in variables:
            assignments[match.group(1)] = (match.group(3), match.group(2))
    return source, [(var, *assignments[var]) for var in variables if var in assignments], legacy_variables


def read_number(value: str):
    value = value.strip().replace("f", "")
    if not re.fullmatch(r"[\d.\s*/+()-]+", value):
        return None
    try:
        return eval(value, {"__builtins__": {}}, {})
    except (ArithmeticError, SyntaxError, TypeError, ValueError):
        return None


def parse_item_stacks(value: str) -> dict[str, int | float]:
    return {kebab(item): int(amount) for item, amount in re.findall(r"Items\.(\w+)\s*,\s*(\d+)", value)}


def block_facts(blocks: list[dict]) -> dict:
    facts: dict[str, dict] = {}
    for block in blocks:
        text = re.sub(r"//[^\n]*|/\*.*?\*/", " ", block["snippet"], flags=re.S)
        fact: dict = {"rotate": bool(re.search(r"\brotate\s*=\s*true", text))}

        requirement = re.search(r"requirements\s*\(\s*Category\.\w+\s*,\s*(?:(?:BuildVisibility|BuildVisibility\.BuildVisibility)\.\w+\s*,\s*)?with\s*\((.*?)\)\s*\)", text, re.S)
        if requirement:
            cost = parse_item_stacks(requirement.group(1))
            if cost:
                fact["cost"] = cost

        for field in ("size", "craftTime", "heatRequirement", "heatOutput", "tier", "drillTime", "range", "laserRange", "maxNodes", "itemCapacity", "liquidCapacity", "displayedSpeed"):
            match = re.search(r"\b" + field + r"\s*=\s*([^;]+);", text)
            if match:
                value = read_number(match.group(1))
                if value is not None:
                    fact[field] = value

        # Power and liquid consumers are expressed per tick in the game source.
        # Store per-second values so the editor's mechanics panel is readable.
        power_values = [read_number(value) for value in re.findall(r"consumePower\s*\(\s*([^)]*)\)", text)]
        power_values = [value for value in power_values if value is not None]
        if power_values:
            fact["power"] = sum(power_values) * 60

        inputs: dict[str, int] = {}
        for group in re.findall(r"consumeItems\s*\(\s*with\s*\((.*?)\)\s*\)", text, re.S):
            inputs.update(parse_item_stacks(group))
        for item, amount in re.findall(r"consumeItem\s*\(\s*Items\.(\w+)\s*,\s*(\d+)\s*\)", text):
            inputs[kebab(item)] = int(amount)
        for item in re.findall(r"consumeItem\s*\(\s*Items\.(\w+)\s*\)", text):
            inputs.setdefault(kebab(item), 1)
        if inputs:
            fact["inputs"] = inputs

        liquids: dict[str, float] = {}
        for item, amount in re.findall(r"consumeLiquid\s*\(\s*Liquids\.(\w+)\s*,\s*([^)]*)\)", text):
            value = read_number(amount)
            if value is not None:
                liquids[kebab(item)] = value * 60
        for group in re.findall(r"consumeLiquids\s*\(\s*LiquidStack\.with\s*\((.*?)\)\s*\)\s*\)", text, re.S):
            for item, amount in re.findall(r"Liquids\.(\w+)\s*,\s*([^,()]+)", group):
                value = read_number(amount)
                if value is not None:
                    liquids[kebab(item)] = value * 60
        if liquids:
            fact["liquids"] = liquids

        outputs = {}
        for item, amount in re.findall(r"outputItem\s*=\s*new\s+ItemStack\s*\(\s*Items\.(\w+)\s*,\s*(\d+)\s*\)", text):
            outputs[kebab(item)] = int(amount)
        for group in re.findall(r"outputItems\s*=\s*ItemStack\.with\s*\((.*?)\)", text, re.S):
            outputs.update(parse_item_stacks(group))
        if outputs:
            fact["output"] = outputs

        output_liquids = {}
        for item, amount in re.findall(r"outputLiquid\s*=\s*new\s+LiquidStack\s*\(\s*Liquids\.(\w+)\s*,\s*([^)]*)\)", text):
            value = read_number(amount)
            if value is not None:
                output_liquids[kebab(item)] = value * 60
        if output_liquids:
            fact["outputLiquids"] = output_liquids

        facts[block["id"]] = fact
    return facts


upstream_version = "unknown"
try:
    upstream_version = subprocess.check_output(["git", "-C", str(upstream), "describe", "--tags", "--exact-match"], text=True, stderr=subprocess.DEVNULL).strip()
except (OSError, subprocess.CalledProcessError):
    upstream_version = upstream.name.replace("Mindustry-", "v")

old_catalog_path = root / "src/catalog.json"
old_catalog = json.loads(old_catalog_path.read_text(encoding="utf-8")) if old_catalog_path.exists() else []
old_by_key = {(entry["type"], entry["id"]): entry for entry in old_catalog}
bundle = read_properties(upstream / "core/assets/bundles/bundle_ru.properties")

blocks_source, block_rows = content_assignments(content / "Blocks.java", "public static Block", "public static void load()", ("Block",))
if not block_rows:
    raise SystemExit("Не удалось прочитать Blocks.java: проверьте путь к исходникам игры.")
block_vars = {row["variable"]: row["id"] for row in block_rows}

def tree_variables(filename: str) -> set[str]:
    source = (content / filename).read_text(encoding="utf-8")
    values = set(re.findall(r"\bnode\s*\(\s*(?:UnitTypes\.)?(\w+)", source))
    return values

serpulo_tree = tree_variables("SerpuloTechTree.java")
erekir_tree = tree_variables("ErekirTechTree.java")


def inferred_planet(variable: str, region: str, old: dict | None, kind: str = "block", unit_class: str = "") -> str:
    if old and old.get("planet"):
        return old["planet"]
    if variable in serpulo_tree and variable in erekir_tree:
        return "both"
    if variable in serpulo_tree:
        return "serpulo"
    if variable in erekir_tree:
        return "erekir"
    if kind == "unit":
        return "erekir" if "Erekir" in unit_class or variable in {"latum", "renale", "manifold", "assemblyDrone", "stell", "locus", "precept", "vanquish", "conquer"} else "both" if variable in {"block", "missile", "dummy"} else "serpulo"
    explicit = {
        "stoneVent": "serpulo", "basaltVent": "serpulo", "wallOreGraphite": "serpulo",
        "largeCliffCrusher": "erekir", "smallHeatRedirector": "erekir",
        "advancedLaunchPad": "serpulo", "landingPad": "serpulo", "largeCanvas": "erekir",
        "tileLogicDisplay": "serpulo",
    }
    if variable in explicit:
        return explicit[variable]
    if "erekir" in region:
        return "erekir"
    if region == "sandbox":
        return "both"
    if region in {"environment", "boulders", "colored", "logic"}:
        return "both"
    return "serpulo" if region in {"crafting", "production", "walls", "defense", "transport", "liquid", "power", "storage", "turrets", "units", "campaign", "payloads"} else "both"


def category_for(region: str, snippet: str, old: dict | None) -> str:
    if old and old.get("category"):
        return old["category"]
    req = re.search(r"requirements\s*\(\s*Category\.(\w+)", snippet)
    game_category = req.group(1).lower() if req else ""
    category_by_req = {
        "crafting": "production", "production": "mining", "distribution": "logistics",
        "liquid": "liquid", "power": "power", "turret": "turret", "defense": "defense",
        "storage": "storage", "units": "units", "logic": "logic", "effect": "campaign",
    }
    if game_category:
        # Different source sections disambiguate categories that share Category.effect.
        if "campaign" in region:
            return "campaign"
        if "defense" in region:
            return "defense"
        return category_by_req.get(game_category, "sandbox")
    if region in {"environment", "colored"}:
        return "surface"
    if region == "boulders":
        return "boulder"
    if region in {"ore", "wall ores"}:
        return "ore"
    if "turret" in region:
        return "turret"
    if "crafting" in region:
        return "production"
    if "production" in region:
        return "mining"
    if "defense" in region or "walls" in region:
        return "defense"
    if "transport" in region:
        return "logistics"
    if "liquid" in region:
        return "liquid"
    if "power" in region:
        return "power"
    if "storage" in region:
        return "storage"
    if "units" in region:
        return "units"
    if "payload" in region:
        return "payload"
    if "logic" in region:
        return "logic"
    if "campaign" in region:
        return "campaign"
    if "sandbox" in region:
        return "sandbox"
    return "surface"


def get_build_flags(text: str, region: str) -> tuple[bool, bool, str]:
    match = re.search(r"requirements\s*\(\s*Category\.\w+\s*,\s*(?:BuildVisibility\.(\w+)\s*,\s*)?with\s*\(", text, re.S)
    if not match:
        return False, False, "hidden"
    visibility = match.group(1) or "shown"
    campaign = visibility not in {"sandboxOnly", "editorOnly", "hidden", "debugOnly", "worldProcessorOnly"} and region != "sandbox"
    return True, campaign, visibility


def infer_stage(old: dict | None, snippet: str) -> str:
    if old and old.get("stage") in {"early", "mid", "late"}:
        return old["stage"]
    cost = set(re.findall(r"Items\.(\w+)\s*,\s*\d+", snippet))
    if cost.intersection({"thorium", "plastanium", "phaseFabric", "surgeAlloy", "carbide", "fissileMatter", "tungsten"}):
        return "late"
    if cost.intersection({"titanium", "silicon", "graphite", "metaglass", "oxide", "beryllium"}):
        return "mid"
    return "early"


catalog = []
for row in block_rows:
    old = old_by_key.get(("block", row["id"]))
    group = old.get("sourceGroup") if old else row["region"] or "environment"
    buildable, campaign_buildable, visibility = get_build_flags(row["snippet"], row["region"])
    category = category_for(row["region"], row["snippet"], old)
    object_name = bundle.get(f"block.{row['id']}.name")
    if not object_name and row["id"].startswith("ore-wall-"):
        item_id = row["id"].removeprefix("ore-wall-")
        object_name = bundle.get(f"item.{item_id}.name", item_id) + " · настенная руда"
    if not object_name and row["id"].startswith("ore-"):
        item_id = row["id"].removeprefix("ore-")
        object_name = bundle.get(f"item.{item_id}.name", item_id) + " · руда"
    object_name = object_name or (old or {}).get("name") or row["id"]
    description = bundle.get(f"block.{row['id']}.description", (old or {}).get("description", ""))
    facts = block_facts([row])
    size = facts.get(row["id"], {}).get("size", (old or {}).get("size", 1))
    catalog.append({
        "id": row["id"], "name": object_name, "description": description,
        "type": "block", "category": category, "sourceGroup": group,
        "buildable": buildable, "campaignBuildable": campaign_buildable,
        "visibility": visibility, "planet": inferred_planet(row["variable"], row["region"], old),
        "stage": infer_stage(old, row["snippet"]), "size": size,
        "mark": (old or {}).get("mark"),
    })

items_source = (content / "Items.java").read_text(encoding="utf-8")
item_rows = content_assignments(content / "Items.java", "public static Item", "public static final Seq<Item>", ("Item",))[1]
serpulo_item_vars = set()
erekir_item_vars = set()
for key, target in (("serpuloItems.addAll", serpulo_item_vars), ("erekirItems.addAll", erekir_item_vars)):
    match = re.search(re.escape(key) + r"\s*\((.*?)\)", items_source, re.S)
    if match:
        target.update(re.findall(r"\b([A-Za-z_]\w*)\b", re.sub(r"//[^\n]*", " ", match.group(1))))
for row in item_rows:
    old = old_by_key.get(("item", row["id"]))
    variable = row["variable"]
    planet = (old or {}).get("planet") or ("both" if variable in serpulo_item_vars and variable in erekir_item_vars else "erekir" if variable in erekir_item_vars else "serpulo")
    catalog.append({
        "id": row["id"], "name": bundle.get(f"item.{row['id']}.name", (old or {}).get("name", row["id"])),
        "description": bundle.get(f"item.{row['id']}.description", (old or {}).get("description", "")),
        "type": "item", "category": "item", "sourceGroup": "item", "buildable": False,
        "hidden": bool(re.search(r"\bhidden\s*=\s*true", row["snippet"])), "planet": planet,
        "stage": (old or {}).get("stage", "early"), "size": 1, "mark": (old or {}).get("mark"),
    })

liquids_source = (content / "Liquids.java").read_text(encoding="utf-8")
liquid_rows = content_assignments(content / "Liquids.java", "public static Liquid", "public static void load()", ("Liquid",))[1]
for row in liquid_rows:
    old = old_by_key.get(("liquid", row["id"]))
    catalog.append({
        "id": row["id"], "name": bundle.get(f"liquid.{row['id']}.name", (old or {}).get("name", row["id"])),
        "description": bundle.get(f"liquid.{row['id']}.description", (old or {}).get("description", "")),
        "type": "liquid", "category": "liquid", "sourceGroup": "liquid", "buildable": False,
        "hidden": bool(re.search(r"\bhidden\s*=\s*true", row["snippet"])),
        "planet": inferred_planet(row["variable"], "", old, kind="liquid"),
        "stage": (old or {}).get("stage", "early"), "size": 1, "mark": (old or {}).get("mark"),
    })

units_source, unit_rows, legacy_unit_variables = parse_units(content / "UnitTypes.java")
for variable, object_id, unit_class in unit_rows:
    old = old_by_key.get(("unit", object_id))
    # Capture each UnitType initializer independently for its hidden/legacy flags.
    start = re.search(r"^ {8}" + re.escape(variable) + r"\s*=\s*new\s+\w+\s*\(", units_source, re.M)
    end_match = re.search(r"^ {8}\w+\s*=\s*new\s+\w+\s*\(", units_source[start.end():], re.M) if start else None
    snippet = units_source[start.start():start.end() + end_match.start()] if start and end_match else units_source[start.start():] if start else ""
    region = region_by_line(units_source).get(units_source.count("\n", 0, start.start()) + 1, "") if start else ""
    planet = inferred_planet(variable, region, old, kind="unit", unit_class=unit_class)
    catalog.append({
        "id": object_id, "name": bundle.get(f"unit.{object_id}.name", (old or {}).get("name", object_id)),
        "description": bundle.get(f"unit.{object_id}.description", (old or {}).get("description", "")),
        "type": "unit", "category": "unit", "sourceGroup": "unit", "buildable": False,
        "hidden": variable in legacy_unit_variables or object_id in {"block", "missile", "dummy"},
        "planet": planet, "stage": (old or {}).get("stage", "early"), "size": 1,
        "mark": (old or {}).get("mark"),
    })

# De-duplicate by actual content type and internal ID; upstream aliases must not
# create multiple catalog cards for the same in-game object.
unique_catalog = []
seen = set()
for entry in catalog:
    key = (entry["type"], entry["id"])
    if key in seen:
        continue
    seen.add(key)
    unique_catalog.append(entry)
catalog = unique_catalog

facts = block_facts(block_rows)
(root / "src/catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(root / "src/block-facts.json").write_text(json.dumps(facts, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

# Compose only static previews. The real game remains the source of truth for
# animation, team tints, map-dependent variants, and assembled unit weapons.
files_by_stem: dict[str, list[Path]] = {}
for path in sorted(raw_sprites.rglob("*.png")):
    files_by_stem.setdefault(path.stem, []).append(path)


def choose_asset(stem: str, kind: str) -> Path | None:
    candidates = files_by_stem.get(stem, [])
    expected = {"block": "/blocks/", "unit": "/units/", "item": "/items/", "liquid": "/items/"}.get(kind, "")
    if expected:
        preferred = [path for path in candidates if expected in path.as_posix()]
        if preferred:
            return preferred[0]
    return candidates[0] if candidates else None


output = root / "public/mindustry"
output.mkdir(parents=True, exist_ok=True)
manifest = {}
for entry in catalog:
    object_id, kind = entry["id"], entry["type"]
    layers: list[str] = []
    layer_paths: list[Path] = []

    if kind in {"item", "liquid"}:
        image = choose_asset(f"{kind}-{object_id}", kind)
        if image:
            layer_paths = [image]
    elif object_id == "air":
        Image.new("RGBA", (32, 32)).save(output / "block-air.png")
        manifest[f"{kind}:{object_id}"] = {"file": "/mindustry/block-air.png", "layers": [], "invisible": True, "fallback": False}
        continue
    else:
        if object_id.startswith("metal-tiles-"):
            # These floors are rendered from autotile sheets instead of a
            # standalone sprite named after the content ID. Use a representative
            # upstream tile rather than showing the generic error texture.
            names = [f"{object_id}-autotile", f"{object_id}-autotile1", f"{object_id}-mid-2", object_id]
        else:
            names = [f"{object_id}-preview", object_id, f"{object_id}1", f"{object_id}-1", f"{object_id}-0-0", f"{object_id}-top-0", f"{object_id}-segment0", f"{object_id}-bottom"]
        base = next((name for name in names if choose_asset(name, kind)), None)
        if base:
            layer_paths = [choose_asset(base, kind)]
            if base == object_id:
                bottom = choose_asset(f"{object_id}-bottom", kind)
                top = choose_asset(f"{object_id}-top", kind)
                if bottom:
                    layer_paths.insert(0, bottom)
                if top:
                    layer_paths.append(top)
            if object_id in {"duct", "armored-duct"}:
                bottom = choose_asset("duct-bottom-0", "block")
                top = choose_asset(f"{object_id}-top-0", "block")
                if bottom and top:
                    layer_paths = [bottom, top]
            if "conduit" in object_id:
                base_name = "reinforced-conduit" if object_id.startswith("reinforced-") else "conduit"
                bottom = choose_asset(f"{base_name}-bottom-0", "block")
                top = choose_asset(f"{base_name}-top-0", "block")
                if bottom and top:
                    layer_paths = [bottom, top]
            if entry.get("category") == "turret":
                size = int(facts.get(object_id, {}).get("size", entry.get("size", 1)))
                turret_base = choose_asset(f"block-{size}", "block")
                if turret_base:
                    layer_paths.insert(0, turret_base)

    layer_paths = [path for path in layer_paths if path is not None]
    layers = [path.relative_to(upstream).as_posix() for path in layer_paths]
    filename = f"{kind}-{object_id}.png"
    fallback = not layer_paths and object_id != "air"
    if layer_paths:
        images = [Image.open(path).convert("RGBA") for path in layer_paths]
        canvas = Image.new("RGBA", (max(image.width for image in images), max(image.height for image in images)))
        for image in images:
            canvas.alpha_composite(image, ((canvas.width - image.width) // 2, (canvas.height - image.height) // 2))
        canvas.thumbnail((192, 192), Image.Resampling.NEAREST)
        canvas.save(output / filename, optimize=True)
    elif object_id != "air":
        error = choose_asset("error", "block")
        if error is None:
            error = upstream / "core/assets-raw/sprites/effects/error.png"
        if not error.exists():
            raise SystemExit(f"Не найдена текстура для {kind}:{object_id} и upstream error.png")
        shutil.copyfile(error, output / filename)
    manifest[f"{kind}:{object_id}"] = {
        "file": f"/mindustry/{filename}", "layers": layers,
        "invisible": False, "fallback": fallback,
    }

(root / "src/sprite-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
license_path = upstream / "LICENSE"
if license_path.exists():
    shutil.copyfile(license_path, output / "LICENSE-Mindustry.txt")
(root / "public/mindustry/ATTRIBUTION.md").write_text(
    f"# Mindustry {upstream_version} assets\n\n"
    "Original artwork and game data: Anuken and the Mindustry contributors.\n"
    f"Upstream: https://github.com/Anuken/Mindustry/tree/{upstream_version}\n"
    f"Source archive: https://github.com/Anuken/Mindustry/archive/refs/tags/{upstream_version}.tar.gz\n"
    "The upstream GPL-3.0 license is reproduced in LICENSE-Mindustry.txt.\n\n"
    "These are local, static previews derived from upstream PNG sprite layers,\n"
    "not a real-time reproduction of the game renderer. Animation, team tinting,\n"
    "connection variants, effects and assembled unit weapons are not simulated.\n\n"
    "`src/sprite-manifest.json` records the exact upstream layers for each object.\n"
    "Air is transparent; objects without a display sprite use the upstream error\n"
    "texture, while unknown mod objects use the editor's text fallback.\n\n"
    "Regenerate with `scripts/import-mindustry-assets.py` and a tagged source\n"
    "checkout (Python 3 + Pillow). Normal build/runtime needs no upstream source\n"
    "or network access.\n",
    encoding="utf-8",
)

fallbacks = [key for key, sprite in manifest.items() if sprite["fallback"]]
print(f"Imported Mindustry {upstream_version}: {len(catalog)} objects, {len(block_rows)} blocks, {len(unit_rows)} unit types.")
print(f"Static sprite fallbacks ({len(fallbacks)}): {', '.join(fallbacks) if fallbacks else 'none'}")
