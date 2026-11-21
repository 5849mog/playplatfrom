# 城域竞技场 · Siege Grid

在浏览器里观看两套策略争夺城邦。内置四套策略、三张对称地图和可调权重的自定义策略。对局支持暂停、单步、倍速和时间轴回放。算法测评使用相同地图和种子交换双方起点，记录胜、负、平。

## 本地运行

在仓库根目录运行 `python3 -m http.server 8080`，然后打开 `http://localhost:8080`。项目无需构建、数据库或 API 密钥，可托管在任意静态站点。

## 接入 JavaScript 策略

`js/engine.js` 的 `simulate(config, bots)` 和 `advance(state, bots)` 接收由策略 ID 到函数的映射。策略函数每回合收到独立的战局快照和阵营编号（蓝方 1，红方 2），返回 `{ from, to, units }` 或 `null`。出兵起点必须由本方控制、终点必须与起点相邻，且起点至少保留 1 个单位。无效命令会被跳过。

```js
import { simulate } from './js/engine.js';

function myBot({ nodes, neighbors }, team) {
  for (const origin of nodes) {
    if (origin.owner !== team || origin.units < 15) continue;
    const target = neighbors[origin.id].find(({ id }) => nodes[id].owner === 0);
    if (target) return { from: origin.id, to: target.id, units: origin.units - 4 };
  }
  return null;
}

const result = simulate({
  mapId: 'basin',
  seed: '2407',
  blue: 'myBot',
  red: 'raid'
}, { myBot });
console.log(result.winner, result.turn);
```

要在网页下拉框中添加内置权重策略，可在 `js/strategies.js` 的 `STRATEGIES` 注册。网页中的自定义策略通过权重表单配置。
