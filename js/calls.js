// Голосовые и видеозвонки: WebRTC между двумя браузерами, сигналинг через RPC чата.
const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

function errText(e) {
  const n = e?.name || '';
  if (n === 'NotAllowedError' || n === 'PermissionDeniedError') {
    return 'Браузер не дал микрофон или камеру. Разреши доступ в настройках сайта и нажми ещё раз.';
  }
  if (n === 'NotFoundError' || n === 'DevicesNotFoundError') {
    return 'Микрофон или камера не найдены на этом устройстве.';
  }
  if (n === 'NotReadableError' || n === 'TrackStartError') {
    return 'Камера или микрофон заняты другим приложением.';
  }
  if (n === 'SecurityError') {
    return 'Звонки работают только по HTTPS (GitHub Pages) или на localhost.';
  }
  return e?.message || String(e);
}

export function createCalls({ api, me, toast, getPeer, onButtons }) {
  const ui = {
    stage: document.getElementById('call-stage'),
    remote: document.getElementById('call-remote'),
    local: document.getElementById('call-local'),
    title: document.getElementById('call-title'),
    sub: document.getElementById('call-sub'),
    accept: document.getElementById('call-accept'),
    decline: document.getElementById('call-decline'),
    hang: document.getElementById('call-hang'),
    mute: document.getElementById('call-mute'),
    cam: document.getElementById('call-cam'),
  };

  let pc = null, local = null, callId = null, role = null, kind = 'audio';
  let peerName = '', seenIce = 0, poll = null, ringing = null;
  let camOn = false, micOn = true, starting = false;

  function showStage(mode) {
    ui.stage.hidden = false;
    ui.stage.dataset.mode = mode;
    ui.accept.hidden = mode !== 'in';
    ui.decline.hidden = mode !== 'in';
    ui.hang.hidden = mode === 'in';
    ui.mute.hidden = mode === 'in';
    ui.cam.hidden = mode === 'in' || kind !== 'video';
    ui.local.hidden = kind !== 'video';
  }
  function hideStage() { ui.stage.hidden = true; }

  function stopTracks(stream) {
    stream?.getTracks()?.forEach((t) => { try { t.stop(); } catch {} });
  }

  async function media(wantVideo) {
    const audio = { echoCancellation: true, noiseSuppression: true };
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Этот браузер не умеет звонки. Открой чат в Chrome, Safari или Firefox.');
    }
    if (wantVideo) {
      try {
        return await navigator.mediaDevices.getUserMedia({ audio, video: { facingMode: 'user', width: { ideal: 640 } } });
      } catch (e) {
        toast('Камера не включилась — звонок будет голосовым. ' + errText(e));
        kind = 'audio';
        return navigator.mediaDevices.getUserMedia({ audio });
      }
    }
    return navigator.mediaDevices.getUserMedia({ audio });
  }

  function wirePc() {
    pc = new RTCPeerConnection({ iceServers: ICE });
    local.getTracks().forEach((t) => pc.addTrack(t, local));
    pc.ontrack = (ev) => {
      const s = ev.streams[0] || new MediaStream([ev.track]);
      ui.remote.srcObject = s;
      ui.remote.play?.().catch(() => {});
      ui.sub.textContent = kind === 'video' ? 'видео на связи' : 'разговор идёт';
    };
    pc.onicecandidate = (ev) => {
      if (!ev.candidate || !callId) return;
      api.rpc('chat_call_ice', {
        p_nick: me.nick, p_code_hash: me.hash, p_id: callId, p_cand: JSON.stringify(ev.candidate),
      }).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const st = pc?.connectionState;
      if (st === 'connected') ui.sub.textContent = kind === 'video' ? 'видео на связи' : 'разговор идёт';
      if (st === 'failed' || st === 'disconnected') ui.sub.textContent = 'связь рвётся…';
      if (st === 'closed') hang(false);
    };
    ui.local.srcObject = local;
    ui.local.muted = true;
    ui.local.play?.().catch(() => {});
  }

  async function applyRemoteIce(list) {
    if (!pc || !Array.isArray(list)) return;
    for (let i = seenIce; i < list.length; i++) {
      const row = list[i];
      if (!row || row.from === me.nick || !row.cand) continue;
      try { await pc.addIceCandidate(JSON.parse(row.cand)); } catch {}
    }
    seenIce = list.length;
  }

  async function tick() {
    if (!callId) return;
    const rows = await api.rpc('chat_call_get', {
      p_nick: me.nick, p_code_hash: me.hash, p_id: callId,
    }).catch(() => []);
    const c = Array.isArray(rows) ? rows[0] : rows;
    if (!c) return;
    if (c.state === 'ended') { hang(false); return; }
    if (role === 'caller' && c.answer && pc && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription({ type: 'answer', sdp: c.answer });
    }
    await applyRemoteIce(c.ice);
  }

  function loop(ms) {
    clearInterval(poll);
    poll = setInterval(() => tick().catch(() => {}), ms);
  }

  async function start(wantVideo) {
    const peer = getPeer();
    if (!peer) return toast('Открой личку с человеком и нажми трубку.');
    if (starting || callId) return toast('Уже идёт звонок.');
    starting = true;
    kind = wantVideo ? 'video' : 'audio';
    camOn = wantVideo;
    try {
      local = await media(wantVideo);
      wirePc();
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const id = await api.rpc('chat_call_start', {
        p_nick: me.nick, p_code_hash: me.hash, p_peer: peer, p_kind: kind, p_offer: offer.sdp,
      });
      callId = Array.isArray(id) ? id[0] : id;
      if (callId && typeof callId === 'object') callId = callId.id || callId.chat_call_start || null;
      if (!callId) throw new Error('сервер не создал звонок — выполни sql/03-calls.sql в Supabase');
      role = 'caller'; peerName = peer; seenIce = 0;
      ui.title.textContent = (kind === 'video' ? 'Видеозвонок' : 'Звонок') + ' · ' + peer;
      ui.sub.textContent = 'вызов… разреши микрофон и камеру, если спросит';
      showStage('out');
      loop(700);
    } catch (e) {
      const msg = String(e.message || e);
      toast(/does not exist|schema cache|function/i.test(msg)
        ? 'Звонки ещё не включены в базе. В Supabase → SQL Editor выполни файл sql/03-calls.sql'
        : errText(e));
      await hang(false);
    } finally { starting = false; }
  }

  async function accept() {
    if (!ringing) return;
    const c = ringing;
    kind = c.kind === 'video' ? 'video' : 'audio';
    camOn = kind === 'video';
    try {
      local = await media(kind === 'video');
      callId = c.id; role = 'callee'; peerName = c.caller; seenIce = 0;
      wirePc();
      await pc.setRemoteDescription({ type: 'offer', sdp: c.offer });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await api.rpc('chat_call_answer', {
        p_nick: me.nick, p_code_hash: me.hash, p_id: c.id, p_answer: answer.sdp,
      });
      ringing = null;
      ui.title.textContent = (kind === 'video' ? 'Видеозвонок' : 'Звонок') + ' · ' + peerName;
      ui.sub.textContent = 'соединяем…';
      showStage('talk');
      loop(700);
      await applyRemoteIce(c.ice);
    } catch (e) {
      toast(errText(e));
      await hang(true);
    }
  }

  async function hang(notify = true) {
    const id = callId;
    callId = null; role = null; ringing = null; seenIce = 0;
    clearInterval(poll); poll = null;
    try { pc?.getSenders()?.forEach((s) => { try { s.track?.stop(); } catch {} }); } catch {}
    try { pc?.close(); } catch {}
    pc = null;
    stopTracks(local); local = null;
    ui.remote.srcObject = null; ui.local.srcObject = null;
    hideStage();
    if (notify && id) {
      await api.rpc('chat_call_hangup', { p_nick: me.nick, p_code_hash: me.hash, p_id: id }).catch(() => {});
    }
  }

  async function watchInbox() {
    if (!me.nick || callId) return;
    const rows = await api.rpc('chat_call_inbox', {
      p_nick: me.nick, p_code_hash: me.hash,
    }).catch((e) => {
      const m = String(e.message || e);
      if (/does not exist|schema cache|function/i.test(m) && !watchInbox._said) {
        watchInbox._said = true;
        toast('Чтобы звонки заработали, в Supabase SQL Editor один раз выполни sql/03-calls.sql');
      }
      return [];
    });
    const list = Array.isArray(rows) ? rows : [];
    const incoming = list.find((c) => c.callee === me.nick && c.state === 'ringing' && c.caller !== me.nick);
    if (!incoming) return;
    if (ringing && ringing.id === incoming.id) return;
    ringing = incoming;
    kind = incoming.kind === 'video' ? 'video' : 'audio';
    ui.title.textContent = (kind === 'video' ? 'Входящее видео' : 'Входящий звонок') + ' · ' + incoming.caller;
    ui.sub.textContent = 'прими вызов — браузер спросит микрофон' + (kind === 'video' ? ' и камеру' : '');
    showStage('in');
  }

  function toggleMute() {
    micOn = !micOn;
    local?.getAudioTracks()?.forEach((t) => { t.enabled = micOn; });
    ui.mute.textContent = micOn ? '🔇' : '🔊';
    ui.mute.title = micOn ? 'Выключить микрофон' : 'Включить микрофон';
  }

  async function toggleCam() {
    if (kind !== 'video' || !pc || !local) return;
    const v = local.getVideoTracks()[0];
    if (v) {
      camOn = !v.enabled;
      v.enabled = camOn;
      ui.cam.classList.toggle('off', !camOn);
      return;
    }
    try {
      const extra = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } });
      const track = extra.getVideoTracks()[0];
      local.addTrack(track);
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video') || pc.addTrack(track, local);
      if (sender.track !== track) await sender.replaceTrack(track);
      ui.local.srcObject = local;
      camOn = true;
    } catch (e) { toast(errText(e)); }
  }

  ui.accept.onclick = () => accept();
  ui.decline.onclick = () => hang(true);
  ui.hang.onclick = () => hang(true);
  ui.mute.onclick = toggleMute;
  ui.cam.onclick = toggleCam;

  setInterval(() => { if (me.nick) watchInbox(); }, 2000);

  function syncButtons() {
    const on = !!getPeer();
    onButtons?.(on);
  }

  return { startAudio: () => start(false), startVideo: () => start(true), hang, syncButtons };
}
