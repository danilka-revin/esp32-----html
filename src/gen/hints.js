import facts from '../block-facts.json' with { type: 'json' };
import { getProductionMachine } from '../catalog.js';
import { Frame, normalizeSettings } from './frame.js';
import { pickAmmo, pickDoctrine } from './defense.js';
import { sharedIngredient } from './units.js';

/**
 * The item that matters most for a setup: the main ingredient of a recipe, the ammo of a turret line or the ingredient
 * most unit blocks share. The generator panel uses it as the default for "which item to watch / deliver".
 */
export function suggestTransportItem(input) {
  const settings = normalizeSettings(input);
  const fallback = settings.planet === 'erekir' ? 'beryllium' : 'copper';
  try {
    if (settings.direction === 'production') {
      const machine = getProductionMachine(settings.planet, settings.goal, settings.stage);
      const inputs = Object.entries(facts[machine]?.inputs ?? {});
      if (!inputs.length) return fallback;
      const craftTime = facts[machine].craftTime || 60;
      return inputs.map(([item, amount]) => [item, amount * 60 / craftTime]).sort((a, b) => b[1] - a[1])[0][0];
    }
    const frame = new Frame(settings);
    if (settings.direction === 'defense') {
      const { turrets } = pickDoctrine(frame, settings.goal);
      return turrets.length ? pickAmmo(frame, turrets) ?? fallback : fallback;
    }
    if (settings.direction === 'units') return sharedIngredient(frame, settings.goal) ?? fallback;
  } catch {
    return fallback;
  }
  return fallback;
}
