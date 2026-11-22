import { initChallenge } from './challenge-ui.js?v=20261122';
import { initReplay } from './replay-ui.js';

const replay = initReplay();
let showingReplay = false;
let returnTo;

function navigate() {
  const nextView = window.location.hash === '#replay' && replay.hasMatch();
  document.getElementById('challenge').hidden = nextView;
  document.getElementById('replay').hidden = !nextView;
  if (nextView) {
    replay.render();
    if (!showingReplay) window.scrollTo(0,0);
  } else {
    replay.pause();
    if (showingReplay && returnTo) {
      const target = returnTo.control?.isConnected ? returnTo.control : document.getElementById('challenge-results-title');
      target?.focus({ preventScroll:true });
      window.scrollTo(0,returnTo.top);
      returnTo = undefined;
    }
  }
  showingReplay = nextView;
}

window.addEventListener('hashchange',navigate);
document.getElementById('open-rules').addEventListener('click',() => document.getElementById('rules').showModal());
initChallenge((match,control) => {
  returnTo = { top:window.scrollY,control };
  replay.load(match);
  window.location.hash = '#replay';
});
navigate();
