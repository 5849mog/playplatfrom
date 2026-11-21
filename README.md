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

## AI 算法挑战

从网页的「AI 挑战」复制统一提示词。让每个模型输出一个同步的 `function decide(state, team)`，将代码贴回 A、B 栏。校验通过后，以 `standard-18/1` 在三张地图、三个固定种子上交叉换边。测评页面可回放每局，并导出含协议、规则、赛制、源码 SHA-256 和逐局结果的 JSON。

`js/challenge.js` 维护协议、赛制、提示词与裁判流程。更改代码接口、对局规则或固定样本时，分别修改对应版本。提示词通过相同常量引用种子、地图、回合上限和时限。引擎以 `prepareTurn`、`decisionView`、`submitOrders` 提供同步决策边界，浏览器 Worker 和内置策略共用结算规则。

每个参赛位在独立的浏览器 Worker 里运行，每场重新创建，决策时限使用浏览器测得的往返时间。跨模型比较时应在同一设备和浏览器环境下运行，保留题面、重试次数和源码指纹。战局回放保存在当前页面会话里。

运行赛制与引擎回归检查：`node --test`。
