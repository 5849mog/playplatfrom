function workerMain() {
  const compile = Function;
  const integer = Number.isSafeInteger;
  const keysOf = Reflect.ownKeys;
  const getPrototype = Object.getPrototypeOf;
  const owns = Object.hasOwn;
  const plainObject = Object.prototype;
  const trimError = Function.call.bind(String.prototype.slice);

  // The match clock stays with the judge. Bots use their snapshot as input.
  for (const key of ['Date','performance','crypto','setTimeout','setInterval','queueMicrotask','Temporal']) {
    Object.defineProperty(self,key,{ value:undefined });
  }
  Object.defineProperty(Math,'random',{ value:undefined });

  self.addEventListener('message', event => {
    const port = event.ports[0];
    const emit = port.postMessage.bind(port);
    let makeDecision;
    port.onmessage = ({ data:{ ticket, source, state, team } }) => {
      try {
        if (typeof source === 'string') {
          makeDecision = compile('"use strict";\n' + source + '\n;return typeof decide === "function" ? decide : null;');
          emit({ ticket, ok:true });
          return;
        }
        const decide = makeDecision();
        if (typeof decide !== 'function') {
          emit({ ticket, fault:'缺少 function decide(state, team)' });
          return;
        }
        const order = decide(state,team);
        if (order === null) {
          emit({ ticket, order:null });
          return;
        }
        if (typeof order !== 'object' || getPrototype(order) !== plainObject ||
            keysOf(order).length !== 3 || !owns(order,'from') || !owns(order,'to') || !owns(order,'units')) {
          emit({ ticket, fault:'必须同步返回 null 或普通对象 { from, to, units }' });
          return;
        }
        const { from,to,units } = order;
        if (!integer(from) || !integer(to) || !integer(units)) {
          emit({ ticket, fault:'from、to 与 units 必须为安全整数' });
          return;
        }
        emit({ ticket, order:{ from,to,units } });
      } catch (error) {
        let message = typeof source === 'string' ? 'JavaScript 语法错误' : '执行时抛出异常';
        if (typeof error?.message === 'string') message += ' · ' + trimError(error.message,0,150);
        emit({ ticket, fault:message });
      }
    };
    emit({ ready:true });
  }, { once:true });
}

function sandboxMain(workerSource) {
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data !== 'siege-grid-runner' || !event.ports[0]) return;
    const bridge = event.ports[0];
    let worker;
    const objectURL = URL.createObjectURL(new Blob([workerSource], { type:'text/javascript' }));
    try {
      worker = new Worker(objectURL);
      const channel = new MessageChannel();
      channel.port1.onmessage = ({ data }) => bridge.postMessage(data);
      bridge.onmessage = ({ data }) => {
        if (data.close) worker.terminate();
        else channel.port1.postMessage(data);
      };
      worker.addEventListener('error', event => {
        event.preventDefault();
        bridge.postMessage({ unavailable:true });
      });
      window.addEventListener('pagehide', () => worker.terminate(), { once:true });
      worker.postMessage(null,[channel.port2]);
    } catch {
      bridge.postMessage({ unavailable:true });
    } finally {
      URL.revokeObjectURL(objectURL);
    }
  }, { once:true });
}

const WORKER_SOURCE = '(' + workerMain.toString() + ')();';
const POLICY = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";
const SANDBOX_HTML = '<!doctype html><meta http-equiv="Content-Security-Policy" content="' + POLICY +
  '"><script>(' + sandboxMain.toString() + ')(' + JSON.stringify(WORKER_SOURCE) + ');</script>';
const STARTUP_MS = 5000;

export async function openBot(source, budget, signal) {
  if (signal?.aborted) throw signal.reason;
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = '算法隔离运行器';
  frame.setAttribute('sandbox','allow-scripts');
  const { port1,port2 } = new MessageChannel();
  let pending;
  let closed = false;
  let nextTicket = 1;

  function settle(value, failure) {
    if (!pending) return;
    const { timer,resolve,reject } = pending;
    pending = null;
    clearTimeout(timer);
    if (failure) reject(failure);
    else resolve(value);
  }

  function stop(failure) {
    if (closed) return;
    closed = true;
    port1.postMessage({ close:true });
    port1.close();
    frame.remove();
    signal?.removeEventListener('abort',onAbort);
    settle(null,failure ?? new Error('算法运行器已关闭'));
  }

  function onAbort() {
    stop(signal.reason);
  }

  function wait(ticket, limit, onTimeout) {
    return new Promise((resolve,reject) => {
      pending = { ticket,resolve,reject,onTimeout,deadline:performance.now() + limit,timer:setTimeout(onTimeout,limit) };
    });
  }

  function request(data, limit, onTimeout) {
    const ticket = nextTicket++;
    const result = wait(ticket,limit,onTimeout);
    port1.postMessage({ ticket,...data });
    return result;
  }

  port1.onmessage = ({ data }) => {
    if (data.unavailable) {
      stop(new Error('无法启动浏览器的隔离运行器'));
    } else if (pending && ((pending.ticket === 0 && data.ready) || pending.ticket === data.ticket)) {
      if (performance.now() > pending.deadline) pending.onTimeout();
      else settle(data);
    }
  };
  frame.onload = () => frame.contentWindow?.postMessage('siege-grid-runner','*',[port2]);
  frame.srcdoc = SANDBOX_HTML;
  signal?.addEventListener('abort',onAbort,{ once:true });
  try {
    const ready = wait(0,STARTUP_MS,() => stop(new Error('浏览器隔离运行器启动超时')));
    document.body.append(frame);
    await ready;
    const compiled = await request({ source },STARTUP_MS,() => stop(new Error('代码编译超时')));
    return {
      fault:compiled.fault,
      async decide(state,team) {
        if (closed) throw new Error('算法运行器已关闭');
        return request({ state,team },budget,() => {
          settle({ fault:'单回合超过 ' + budget + ' ms' });
          stop();
        });
      },
      close: () => stop()
    };
  } catch (error) {
    stop(error);
    throw error;
  }
}
