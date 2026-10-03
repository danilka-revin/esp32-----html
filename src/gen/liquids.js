import { blockSize } from '../geometry.js';
import { liquids as liquidCatalog } from '../catalog.js';

const liquidName = id => liquidCatalog.find(entry => entry.id === id)?.name ?? id;

/**
 * A straight liquid line with inline liquid routers: conduits carry the liquid west from the inlet (`fromX`)
 * and every router feeds the blocks touching it. Mirrors the item spine used for turrets.
 */
export function liquidRow(frame, { y, fromX, taps, liquid }) {
  const board = frame.board;
  const conduit = frame.profile.conduits.find(entry => frame.has(entry.id))?.id;
  const router = frame.profile.liquidRouter;
  if (!conduit || !frame.has(router) || !taps.length) return null;
  const last = Math.min(...taps);
  const placed = [];
  for (let x = fromX; x >= last; x -= 1) {
    const tile = taps.includes(x)
      ? board.place(router, x, y, 0, null, { role: 'liquid-router' })
      : board.place(conduit, x, y, 2, null, { role: 'liquid-lane' });
    if (!tile) { frame.fail(`Не хватило места для линии «${liquidName(liquid)}».`); return null; }
    placed.push(tile);
  }
  frame.inlet({ x: fromX, y, kind: 'liquid', id: liquid });
  frame.require(`Подай «${liquidName(liquid)}» в крайнюю трубу линии — она кормит блоки рядом с жидкостными маршрутизаторами.`);
  return { cells: placed, inlet: { x: fromX, y } };
}

export function tapXs(tiles) {
  return tiles.map(tile => tile.x).filter((x, index, all) => all.indexOf(x) === index);
}

export { blockSize };
