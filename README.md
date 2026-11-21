# 城域竞技场 · Siege Grid

两套 AI 生成的 JavaScript 算法在相同规则下对战。[打开 GitHub Pages](https://5849mog.github.io/playplatfrom/)

## 使用方法

在「AI 对战」复制统一提示词，让两个模型分别生成同步的 `function decide(state, team)`，再把代码贴回 A、B 栏。可选择地图、种子和阵营进行单局，也可运行 `standard-18/2` 的 18 局固定换边测评。各算法运行在独立的浏览器 Worker 中，每回合使用相同的响应时限。

对局没有回合上限。攻占敌方要塞决定胜负，非法指令、异常或超时按规则判罚。僵局可手动中止。测评中跳过一局后会继续下一局，中止的局不计入胜率。打开结果表中的回放，可以暂停、单步、倍速或定位回合。回放保存在当前页面会话里，JSON 报告含协议、规则、赛制、源码指纹和逐局结果。

## 开发

在仓库根目录运行 `python3 -m http.server 8080`，然后打开 `http://localhost:8080`。网站是以 `main` 分支根目录为源的 GitHub Pages 静态站点。

`js/challenge.js` 管理协议、赛制、提示词和裁判。引擎以 `prepareTurn`、`decisionView`、`submitOrders` 提供固定的同步决策边界。回放存储双方指令和周期性快照，播放时无需重新运行参赛代码。更改接口、游戏规则和固定样本时分别更新版本。

运行 `node --test`（Node.js 22.7 或更新版本）检查赛制、回放和引擎。
