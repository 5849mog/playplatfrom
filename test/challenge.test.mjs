import assert from 'node:assert/strict';
import test from 'node:test';
import { CHALLENGE_PROMPT, DEFENSIVE_SAMPLE, PROTOCOL, SAMPLE, SOURCE_LIMIT, TRIALS, normalizeSource } from '../js/challenge.js';
import { createRecording } from '../js/recording.js';
import { advance, createMatch, decisionView, prepareTurn, submitOrders, validateOrder } from '../js/engine.js';

test('standard trials use the same map and seed in each pair, with colors exchanged', () => {
  assert.equal(TRIALS.length,18);
  for (let index = 0; index < TRIALS.length; index += 2) {
    const [first,second] = TRIALS.slice(index,index + 2);
    assert.equal(first.swapped,false);
    assert.deepEqual(second,{ ...first,swapped:true });
  }
  assert.equal(new Set(TRIALS.map(trial => trial.mapId + '/' + trial.seed)).size,9);
  assert(CHALLENGE_PROMPT.includes(PROTOCOL));
  assert(CHALLENGE_PROMPT.includes(TRIALS.length + ' 局'));
});

test('paste accepts JavaScript source and a single code fence and checks source size', () => {
  const source = 'function decide(state, team) { return null; }';
  const fence = String.fromCharCode(96).repeat(3);
  assert.equal(normalizeSource(' ' + source + '\n'),source);
  assert.equal(normalizeSource(fence + 'javascript\r\n' + source + '\r\n' + fence),source);
  assert.throws(() => normalizeSource(fence + 'python\n' + source + '\n' + fence));
  assert.throws(() => normalizeSource('x'.repeat(SOURCE_LIMIT + 1)));
});

test('both participants see a shared phase snapshot, then the judge submits orders', () => {
  const previous = createMatch();
  const next = prepareTurn(previous);
  const view = decisionView(next);
  const orders = [1,2].map(team => ({
    from:view.bases[team], to:view.neighbors[view.bases[team]][0].id, units:10
  }));
  const observed = [];
  const after = advance({ ...previous,blue:'observer',red:'observer' },{
    observer(snapshot,team) {
      observed.push(structuredClone(snapshot));
      snapshot.nodes[0].units = 0;
      return orders[team - 1];
    }
  });
  assert.deepEqual(observed,[view,view]);
  assert.equal(previous.nodes[0].units,28);
  assert.equal(next.nodes[0].units,31);
  assert.deepEqual(after.fleets,submitOrders(next,orders).fleets);
});

test('judge rejects orders sending the entire garrison or using an illegal route', () => {
  const state = prepareTurn(createMatch());
  assert.equal(validateOrder(state,null,1),'');
  assert.notEqual(validateOrder(state,{ from:0,to:1,units:31 },1),'');
  assert.notEqual(validateOrder(state,{ from:0,to:7,units:1 },1),'');
  assert.notEqual(validateOrder(state,{ from:7,to:8,units:1 },1),'');
  assert.equal(validateOrder(state,{ from:0,to:1,units:1 },1),'');
});

test('a waiting match stays active after the former turn limit', () => {
  const bots = { wait:()=>null };
  let state = createMatch({ blue:'wait',red:'wait' });
  for (let index = 0; index < 512; index++) state = advance(state,bots);
  assert.equal(state.turn,512);
  assert.equal(state.winner,null);
  assert.equal(state.nodes[state.bases[1]].units,360);
  assert.equal(state.nodes[state.bases[2]].units,360);
  assert(!Object.hasOwn(decisionView(state),'turnLimit'));
});

test('replay matches recorded moves while seeking across checkpoints and back', () => {
  let state = createMatch();
  const recording = createRecording(state);
  const originals = [state];
  for (let turn = 1; turn <= 300; turn++) {
    state = prepareTurn(state);
    const from = state.bases[1];
    const orders = [{ from, to:state.neighbors[from][0].id, units:1 },null];
    submitOrders(state,orders);
    recording.append(state,orders);
    originals.push(state);
  }
  assert.equal(recording.lastTurn,300);
  for (const turn of [0,1,127,128,129,256,300,250,70,0]) {
    assert.deepEqual(recording.at(turn),originals[turn]);
  }
});

test('demonstration bots complete the suite by taking a base on either side', () => {
  const bots = Object.fromEntries([['a',SAMPLE],['b',DEFENSIVE_SAMPLE]]
    .map(([id,source]) => [id,Function(source + '\nreturn decide;')()]));
  for (const { mapId,seed,swapped } of TRIALS) {
    let state = createMatch({ mapId,seed,blue:swapped ? 'b' : 'a',red:swapped ? 'a' : 'b' });
    for (let i = 0; i < 100 && state.winner === null; i++) state = advance(state,bots);
    assert.equal(state.winner,swapped ? 2 : 1);
    assert.equal(state.endReason,'占领敌方要塞');
  }
});
