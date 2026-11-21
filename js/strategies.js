export const STRATEGIES = {
  expand: { name:'开疆', description:'优先抢占中立据点，靠产能建立优势。', neutral:8, attack:2, guard:4, growth:7, pressure:2 },
  raid: { name:'破阵', description:'集中兵力打薄弱节点，优先威胁敌方要塞。', neutral:3, attack:7, guard:2, growth:3, pressure:9 },
  shield: { name:'固守', description:'留足驻军，前线吃紧时优先增援。', neutral:5, attack:3, guard:9, growth:4, pressure:2 },
  adaptive: { name:'权衡', description:'比较据点收益和行军时间，灵活调整推进方向。', neutral:6, attack:5, guard:5, growth:5, pressure:5 },
  custom: { name:'自定义', description:'调整五项权重，让自己的策略上场。', neutral:6, attack:5, guard:5, growth:5, pressure:5 }
};

export const PARAMETERS = {
  neutral: '扩张', attack: '进攻', guard: '防守', growth: '产能', pressure: '要塞'
};

function friendlyDistance(target, enemyBase) {
  return Math.hypot(target.x - enemyBase.x, target.y - enemyBase.y);
}

export function chooseMove(state, team, strategy) {
  const { nodes, neighbors, fleets, bases, turn } = state;
  const enemy = 3 - team;
  const enemyBase = nodes[bases[enemy]];
  const incoming = nodes.map(() => ({ own: 0, enemy: 0 }));
  for (const fleet of fleets) {
    incoming[fleet.to][fleet.team === team ? 'own' : 'enemy'] += fleet.units;
  }
  const frontier = nodes.map(node => neighbors[node.id].some(edge => nodes[edge.id].owner !== team));
  const split = bases[2];
  const directions = team === 1 ? nodes : [
    ...nodes.slice(split, split * 2), ...nodes.slice(0, split), ...nodes.slice(split * 2)
  ];
  let best = null;
  let bestScore = 0;

  for (const origin of directions) {
    if (origin.owner !== team) continue;
    const threatened = Math.max(0, incoming[origin.id].enemy - incoming[origin.id].own);
    const reserve = Math.max(2, Math.ceil(threatened * .85) + (frontier[origin.id] ? strategy.guard : 1));
    const available = origin.units - reserve;
    if (available < 4) continue;

    for (const { id, time } of neighbors[origin.id]) {
      const target = nodes[id];
      const approaching = incoming[id];
      let units;
      let utility;

      if (target.owner === team) {
        const need = approaching.enemy - target.units - approaching.own;
        const forward = friendlyDistance(origin, enemyBase) - friendlyDistance(target, enemyBase);
        if (need < 1 && (!frontier[id] || frontier[origin.id] || forward < 30 || target.units + approaching.own > 48)) continue;
        units = Math.min(available, Math.ceil(Math.max(need + 3, available * .56)));
        utility = need > 0 ? 12 + need * .6 + strategy.guard * 2 : 2 + forward / 110 + units / 12;
      } else {
        const grows = target.owner === enemy ? time * target.rate : 0;
        const defense = target.units + grows + approaching.enemy - approaching.own;
        if (defense < 0) continue;
        const threshold = Math.max(2, defense + 1);
        if (available < threshold) continue;
        const extra = Math.min(35, 3 + strategy.attack + Math.floor(available * .15));
        units = Math.min(available, threshold + extra);
        const preference = target.owner ? strategy.attack * 2 : strategy.neutral * 2;
        utility = 8 + preference + target.rate * strategy.growth * .65 - threshold * .18;
        utility += Math.max(0, 1 - friendlyDistance(target, enemyBase) / 630) * strategy.pressure;
        if (target.id === enemyBase.id) utility += 21 + strategy.pressure * 2;
      }

      utility += Math.min(6, units / 10) - time * 2;
      if (utility > bestScore) {
        bestScore = utility;
        best = { from: origin.id, to: id, units };
      }
    }
  }
  if (turn === 0) return null;
  return best;
}
