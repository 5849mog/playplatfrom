import { prepareTurn, submitOrders } from './engine.js';

const INTERVAL = 128;

export function createRecording(initial) {
  const snapshots = [initial];
  const moves = new Map();
  let latest = initial;
  let current = initial;

  return {
    append(state, orders) {
      if (orders?.some(Boolean)) moves.set(state.turn,orders);
      if (state.turn % INTERVAL === 0) snapshots.push(state);
      latest = state;
    },
    get lastTurn() {
      return latest.turn;
    },
    at(turn) {
      if (turn === latest.turn) return latest;
      const checkpoint = snapshots[Math.floor(turn / INTERVAL)];
      if (current.turn > turn || current.turn < checkpoint.turn) current = checkpoint;
      while (current.turn < turn) {
        current = prepareTurn(current);
        const orders = moves.get(current.turn);
        if (orders) submitOrders(current,orders);
      }
      return current;
    }
  };
}
