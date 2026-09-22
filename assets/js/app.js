/* exfilcamper01 — site player
   Audio: SoundCloud Widget API (the real stream). Visuals: driven by SoundCloud's own waveform
   data for the playing track, synced to the widget's reported playback position. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const root = document.documentElement;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hasGsap = typeof gsap !== 'undefined';
  if (hasGsap) gsap.registerPlugin(ScrollTrigger, ScrambleTextPlugin);
  if (reduced) document.body.classList.add('no-motion');

  const TRACKS = window.TRACKS || [];
  const INTEL = window.INTEL || [];
  const fmt = ms => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
  const fmt2 = ms => { ms = Math.max(0, ms); const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  const hms = s => [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(n => String(n).padStart(2, '0')).join(':');
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  /* ─────────── waveform analysis (real data) ─────────── */
  TRACKS.forEach(t => {
    const s = t.waveform, n = s.length;
    const sorted = [...s].sort((a, b) => a - b);
    const lo = sorted[Math.floor(n * 0.08)], hi = sorted[n - 1];
    t.norm = s.map(v => clamp((v - lo) / (hi - lo || 1)));
    // transient = how far this sample rises above the recent past (kick/snare-ish hits)
    t.trans = t.norm.map((v, i) => { const p = (t.norm[i - 1] ?? v) * .5 + (t.norm[i - 2] ?? v) * .3 + (t.norm[i - 3] ?? v) * .2; return clamp((v - p) * 4); });
    // drop markers only from artist-supplied times: auto-detection on SoundCloud's (heavily compressed) waveform proved unreliable
    t.impacts = Array.isArray(t.drops) ? t.drops.map(x => x * 1000) : [];
  });
  /* ─────────── state ─────────── */
  const st = { idx: 0, pos: 0, posAt: performance.now(), playing: false, ready: false, deployed: false, widget: null, amp: 0, hit: 0, wantPlay: false };
  const cur = () => TRACKS[st.idx];
  const dur = () => cur().duration;
  const pos = () => clamp(st.playing ? st.pos + (performance.now() - st.posAt) : st.pos, 0, dur());
  const sampleAt = (arr, ms) => { const f = ms / dur() * (arr.length - 1); const i = Math.floor(f), r = f - i; return (arr[i] ?? 0) * (1 - r) + (arr[i + 1] ?? arr[i] ?? 0) * r; };

  /* ─────────── GATE ─────────── */
  const gate = $('#gate'), deployBtn = $('#deploy');
  const step = (name, ok = true, v) => { const li = $(`.gate-log [data-step="${name}"]`); if (!li) return; li.classList.add(ok ? 'ok' : 'fail'); $('.v', li).textContent = v || (ok ? 'OK' : 'SLOW'); };
  (function clock() { const d = new Date(); $('#gate-clock').textContent = d.toTimeString().slice(0, 8); if (!st.deployed) setTimeout(clock, 1000); })();
  document.fonts?.ready.then(() => step('fonts'));
  if (TRACKS.length) step('intel', true, `${TRACKS.length} READY`);
  const linkTimeout = setTimeout(() => { if (!st.ready) { step('link', false, 'WAITING'); deployBtn.disabled = false; } }, 6000);

  // gate static noise
  (() => {
    const c = $('#gate-noise'), x = c.getContext('2d'); c.width = 160; c.height = 90;
    const img = x.createImageData(160, 90);
    (function loop() {
      if (st.deployed) return;
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.random() * 60 | 0; img.data[i] = v * .6; img.data[i + 1] = v; img.data[i + 2] = v * .5; img.data[i + 3] = 255; }
      x.putImageData(img, 0, 0); setTimeout(() => requestAnimationFrame(loop), 70);
    })();
  })();

  function closeGate(withAudio) {
    if (st.deployed) return;
    st.deployed = true;
    document.body.classList.remove('is-gated');
    const done = () => { gate.remove(); introHero(); };
    if (hasGsap && !reduced) {
      const tl = gsap.timeline({ onComplete: done });
      if (withAudio) { deployBtn.classList.add('go'); }
      if (withAudio) tl.to('.deploy-fill', { scaleX: 1, duration: .25, ease: 'power2.in' });
      tl.to('.gate-shutter', { scaleY: 1, duration: .35, ease: 'power3.in' })
        .set('.gate-inner, #gate-noise', { autoAlpha: 0 })
        .set(gate, { background: 'transparent' })
        .to('.gate-shutter.top', { yPercent: -100, duration: .6, ease: 'expo.inOut' }, '+=.08')
        .to('.gate-shutter.bottom', { yPercent: 100, duration: .6, ease: 'expo.inOut' }, '<');
    } else done();
  }
  function deploy() {
    if (st.deployed) return;
    // play() must run inside the click so the browser counts the user gesture
    st.wantPlay = true;
    if (st.widget && st.ready) st.widget.play();
    closeGate(true);
    setTimeout(() => { if (!st.playing && st.wantPlay) audioFallback(); }, 3500);
  }
  deployBtn.addEventListener('click', deploy);
  $('#enter-silent').addEventListener('click', () => { st.wantPlay = false; closeGate(false); });
  addEventListener('keydown', e => { if (!st.deployed && e.key === 'Enter' && !deployBtn.disabled) { e.preventDefault(); deploy(); } });

  function audioFallback() {
    $('#sc-host').classList.add('show');
    toast('Your browser held the audio back. Hit play on the SoundCloud player to start the track.', 9000);
  }
  function toast(msg, ms = 4000) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(() => (t.hidden = true), ms); }

  /* ─────────── SOUNDCLOUD WIDGET ─────────── */
  function initWidget() {
    if (typeof SC === 'undefined' || !SC.Widget) { step('link', false, 'BLOCKED'); deployBtn.disabled = false; return; }
    const w = st.widget = SC.Widget($('#sc-frame'));
    const E = SC.Widget.Events;
    w.bind(E.READY, () => {
      const first = !st.ready;
      st.ready = true; clearTimeout(linkTimeout);
      w.setVolume(+$('#vol').value);
      refreshLiveStats();
      if (first) {
        step('link'); deployBtn.disabled = false;
        if (!st.deployed) deployBtn.focus({ preventScroll: true });
        // if the browser already allows sound-on autoplay, skip the gate entirely
        w.play();
        setTimeout(() => { if (st.playing && !st.deployed) { st.wantPlay = true; closeGate(true); } }, 1200);
      }
    });
    w.bind(E.PLAY, () => {
      if (!st.deployed && !st.wantPlay) { /* autoplay probe succeeded; gate closes via READY timer */ }
      st.playing = true; st.posAt = performance.now(); document.body.classList.add('playing');
      $('#sc-host').classList.remove('show');
      $('#btn-play').setAttribute('aria-label', 'Pause');
    });
    w.bind(E.PAUSE, () => { st.pos = pos(); st.playing = false; document.body.classList.remove('playing'); $('#btn-play').setAttribute('aria-label', 'Play'); });
    w.bind(E.PLAY_PROGRESS, e => { st.pos = e.currentPosition; st.posAt = performance.now(); if (!st.playing && st.deployed) { st.playing = true; document.body.classList.add('playing'); } });
    w.bind(E.SEEK, e => { st.pos = e.currentPosition; st.posAt = performance.now(); });
    w.bind(E.FINISH, () => { st.playing = false; st.pos = dur(); document.body.classList.remove('playing'); showExtract(); });
  }
  function refreshLiveStats() {
    st.widget?.getCurrentSound(s => {
      if (!s) return;
      const t = TRACKS.find(x => x.scId === s.id); if (!t) return;
      if (typeof s.playback_count === 'number') t.plays = s.playback_count, t.statsAsOf = 'live';
      if (typeof s.likes_count === 'number') t.likes = s.likes_count;
      if (s.duration) t.duration = s.duration;
      renderNow(); renderInspect(inspected);
    });
  }
  if (document.readyState === 'complete') initWidget(); else addEventListener('load', initWidget);

  /* ─────────── transport ─────────── */
  function play() { st.wantPlay = true; st.widget?.play(); }
  function toggle() { if (!st.deployed) return deploy(); st.playing ? st.widget?.pause() : play(); }
  function seek(ms) { ms = clamp(ms, 0, dur() - 250); st.pos = ms; st.posAt = performance.now(); st.widget?.seekTo(ms); if (!st.playing) play(); }
  function nextImpact() { const p = pos() + 1500; const n = cur().impacts.find(i => i > p); if (n != null) seek(n - 2000); else if (cur().impacts.length) seek(cur().impacts[0] - 2000); }
  function loadTrack(i, autoplay = true) {
    i = (i + TRACKS.length) % TRACKS.length;
    const t = TRACKS[i];
    st.idx = i; st.pos = 0; st.posAt = performance.now(); st.playing = false; document.body.classList.remove('playing');
    renderNow(true); renderStash();
    if (autoplay) st.wantPlay = true;
    st.widget?.load(`https://api.soundcloud.com/tracks/${t.scId}`, {
      auto_play: !!autoplay, show_artwork: false, visual: false, show_comments: false, show_user: true, show_reposts: false, show_teaser: false, color: '#8ee03a',
      callback: () => { st.widget.setVolume(+$('#vol').value); if (autoplay) st.widget.play(); refreshLiveStats(); }
    });
  }
  $('#btn-play').addEventListener('click', toggle);
  $('#btn-next').addEventListener('click', () => loadTrack(st.idx + 1, true));
  $('#btn-prev').addEventListener('click', () => (pos() > 4000 ? seek(0) : loadTrack(st.idx - 1, true)));
  $('#btn-impact').addEventListener('click', nextImpact);
  $('#vol').addEventListener('input', e => st.widget?.setVolume(+e.target.value));
  addEventListener('keydown', e => {
    if (!st.deployed || e.target.closest('input,textarea,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.code === 'Space' && !e.target.closest('button,a')) { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight' && !e.target.closest('.scrub')) seek(pos() + 10000);
    else if (e.key === 'ArrowLeft' && !e.target.closest('.scrub')) seek(pos() - 10000);
    else if (e.key === 'd' || e.key === 'D') nextImpact();
    else if (e.key === 'n' || e.key === 'N') loadTrack(st.idx + 1, true);
    else if (e.key === 'Escape') { closeReader(); hideExtract(); }
  });

  /* ─────────── hero render ─────────── */
  function renderNow(animate) {
    const t = cur();
    const title = $('#now-title');
    if (animate && hasGsap && !reduced) gsap.to(title, { duration: .8, scrambleText: { text: t.title, chars: 'upperCase', speed: .6 } });
    else title.textContent = t.title;
    title.dataset.text = t.title;
    $('#now-credit').textContent = t.credit;
    $('#now-account').textContent = t.account;
    $('#now-art').src = t.art; $('#now-art').alt = `Artwork for ${t.title}`;
    $('#now-tags').innerHTML = t.tags.filter(x => !/^(electronic|edm|melodic dubstep)$/i.test(x)).slice(0, 3).map(x => `<li>${x}</li>`).join('');
    $('#now-plays').textContent = t.plays.toLocaleString();
    $('#now-likes').textContent = t.likes.toLocaleString();
    $('#t-dur').textContent = fmt(t.duration);
    $('#sc-link').href = t.url;
    $('#btn-impact').hidden = !t.impacts.length; $('#impact-readout').hidden = !t.impacts.length;
    $('#deck-now').textContent = t.title;
    $('#hero-follow').href = t.account.startsWith('zero') ? 'https://soundcloud.com/iamzeroofficial' : 'https://soundcloud.com/cargoelevatorclutch';
    $('#scrub-markers').innerHTML = t.impacts.map((ms, k) =>
      `<button class="mark" style="left:${ms / t.duration * 100}%" data-ms="${ms}" aria-label="Skip to drop ${k + 1} at ${fmt(ms)}"><span>DROP ${k + 1}</span></button>`).join('');
    $$('#scrub-markers .mark').forEach(m => m.addEventListener('click', e => { e.stopPropagation(); seek(+m.dataset.ms - 2000); }));
    drawScrub(true);
  }

  /* ─────────── scrubber ─────────── */
  const scrub = $('#scrub'), sc = $('#scrub-canvas'), sx = sc.getContext('2d');
  let scrubBars = [], scrubW = 0, scrubH = 0, hoverX = -1;
  function sizeScrub() {
    const r = scrub.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    scrubW = r.width; scrubH = r.height; sc.width = r.width * d; sc.height = r.height * d; sx.setTransform(d, 0, 0, d, 0, 0);
    drawScrub(true);
  }
  function drawScrub(rebuild) {
    const t = cur(); if (!scrubW) return;
    if (rebuild) {
      const n = Math.max(40, Math.floor(scrubW / 3)); scrubBars = [];
      for (let i = 0; i < n; i++) { const a = Math.floor(i / n * t.waveform.length), b = Math.floor((i + 1) / n * t.waveform.length); let m = 0; for (let j = a; j < b; j++) m = Math.max(m, t.norm[j]); scrubBars.push(m); }
    }
    const p = pos() / dur(), n = scrubBars.length, bw = scrubW / n;
    sx.clearRect(0, 0, scrubW, scrubH);
    for (let i = 0; i < n; i++) {
      const h = 3 + scrubBars[i] * (scrubH - 6), x = i * bw, played = i / n < p, hov = hoverX >= 0 && x <= hoverX;
      sx.fillStyle = played ? '#8ee03a' : hov ? '#6b705f' : '#353b2e';
      sx.fillRect(x, (scrubH - h) / 2, Math.max(1, bw - 1), h);
    }
    scrub.setAttribute('aria-valuenow', Math.round(p * 100));
  }
  const scrubMs = e => { const r = scrub.getBoundingClientRect(); return clamp((e.clientX - r.left) / r.width) * dur(); };
  let dragging = false;
  scrub.addEventListener('pointerdown', e => { if (e.target.closest('.mark')) return; dragging = true; scrub.setPointerCapture(e.pointerId); seek(scrubMs(e)); });
  scrub.addEventListener('pointermove', e => {
    const r = scrub.getBoundingClientRect(); hoverX = e.clientX - r.left;
    const h = $('#scrub-hover'); h.style.left = hoverX + 'px'; h.textContent = fmt(scrubMs(e));
    if (dragging) seek(scrubMs(e));
  });
  scrub.addEventListener('pointerup', () => (dragging = false));
  scrub.addEventListener('pointerleave', () => (hoverX = -1));
  scrub.addEventListener('keydown', e => { if (e.key === 'ArrowRight') { e.preventDefault(); seek(pos() + 5000); } if (e.key === 'ArrowLeft') { e.preventDefault(); seek(pos() - 5000); } });

  /* ─────────── main visualizer ─────────── */
  const viz = $('#viz'), vx = viz.getContext('2d'), raid = $('#raid'), bgvid = $('#bgvid');
  let VW = 0, VH = 0, cx = 0, cy = 0, R = 0;
  const embers = Array.from({ length: reduced ? 30 : 110 }, () => ({ x: Math.random(), y: Math.random(), z: .3 + Math.random() * .7, s: Math.random() }));
  function sizeViz() {
    const d = 1, r = raid.getBoundingClientRect();
    VW = r.width; VH = r.height; viz.width = VW * d; viz.height = VH * d; vx.setTransform(d, 0, 0, d, 0, 0);
    // ring frames the operator in the background video (focal point fx/fy of the 16:9 source, object-fit:cover, object-position 50% 60%)
    const FX = .51, FY = .66, sw = 16, sh = 9, sc = Math.max(VW / sw, VH / sh) * 1.02;
    const dw = sw * sc, dh = sh * sc, ox = (VW - dw) * .5, oy = (VH - dh) * .6;
    cx = ox + FX * dw; cy = oy + FY * dh; R = Math.min(VW, VH) * (VW < 760 ? .2 : .15);
  }
  let idleDrawn = false, scrubIdle = false, rot = 0, lastT = performance.now(), lastState = '', lastAmp = '', lastHit = '';
  const flash = $('#raid-flash'), txt = (el, v) => { if (el.textContent !== v) el.textContent = v; };
  function frame(now) {
    const dt = Math.min(50, now - lastT) / 16.67; lastT = now;
    const t = cur(), p = pos();
    // real amplitude at the playhead; idle = flat
    const a = st.playing ? sampleAt(t.norm, p) : 0;
    const tr = st.playing ? sampleAt(t.trans, p) : 0;
    st.amp += (a - st.amp) * .35;
    st.hit = Math.max(st.hit * Math.pow(.86, dt), tr);
    const ampS = st.amp.toFixed(2), hitS = reduced ? '0' : st.hit.toFixed(2);
    if (ampS !== lastAmp) { raid.style.setProperty('--amp', ampS); lastAmp = ampS; }
    if (hitS !== lastHit) { raid.style.setProperty('--hit', hitS); flash.style.opacity = hitS; lastHit = hitS; }
    if (!reduced && st.hit > .45) { raid.classList.add('shake'); raid.style.setProperty('--sx', Math.random() > .5 ? 1 : -1); raid.style.setProperty('--sy', Math.random() > .5 ? 1 : -1); }
    else raid.classList.remove('shake');

    // readouts
    const left = dur() - p;
    txt($('#raid-timer'), fmt2(left));
    $('#raid-bar').style.transform = `scaleX(${left / dur()})`;
    raid.classList.toggle('low-time', st.playing && left < 30000);
    txt($('#t-cur'), fmt(p));
    const stateTxt = st.playing ? 'NOW PLAYING' : st.deployed ? (p >= dur() - 300 ? 'FINISHED' : 'PAUSED') : 'READY';
    if (stateTxt !== lastState) { lastState = stateTxt; $('#now-state').textContent = stateTxt; }
    const ni = t.impacts.findIndex(i => i > p);
    txt($('#next-impact'), ni >= 0 ? `#${String(ni + 1).padStart(2, '0')} in ${fmt(t.impacts[ni] - p)}` : (t.impacts.length ? 'done' : '—'));

    const busy = st.playing || st.hit > .01 || dragging || hoverX >= 0;
    if (heroVisible && (busy || !idleDrawn)) { drawViz(t, p, dt); idleDrawn = !busy; }
    if (busy || !scrubIdle) { drawScrub(false); scrubIdle = !busy; }
    ticker && ticker.timeScale(1 + st.amp * 3 + st.hit * 4);
    requestAnimationFrame(frame);
  }
  function drawViz(t, p, dt) {
    vx.clearRect(0, 0, VW, VH);

    // embers — speed follows the real amplitude
    const sp = .6 + st.amp * 3 + st.hit * 5;
    for (const e of embers) {
      e.y -= .0009 * e.z * sp * dt; e.x += Math.sin((e.y + e.s) * 12) * .0004 * dt;
      if (e.y < -.02) { e.y = 1.02; e.x = Math.random(); }
      const s = 1 + e.z * 2;
      vx.fillStyle = e.s > .8 ? `rgba(255,58,42,${.25 + st.hit * .6})` : `rgba(240,177,60,${.12 + e.z * .25 + st.amp * .2})`;
      vx.fillRect(e.x * VW, e.y * VH, s, s);
    }

    // radial waveform: ±40s window of the real track around the playhead, playhead at 12 o'clock
    const N = 180, n = t.norm.length, ci = p / dur() * (n - 1), span = n * (40000 / dur());
    const r0 = R * (1 + st.hit * .06);
    for (let k = 0; k < N; k++) {
      const f = k / N, ang = -Math.PI / 2 + f * Math.PI * 2;
      const rel = (f <= .5 ? f : f - 1) * span; // right side = upcoming, left side = past
      const si = Math.round(ci + rel);
      if (si < 0 || si >= n) continue;
      const v = t.norm[si], len = 4 + v * v * R * .45 * (.55 + st.amp * .9);
      const future = rel > 0, near = Math.abs(rel) < 3;
      vx.strokeStyle = near ? '#ff3a2a' : future ? `rgba(142,224,58,${.35 + v * .5})` : `rgba(217,213,195,${.1 + v * .25})`;
      vx.lineWidth = near ? 3 : 2;
      const c = Math.cos(ang), s = Math.sin(ang);
      vx.beginPath(); vx.moveTo(cx + c * r0, cy + s * r0); vx.lineTo(cx + c * (r0 + len), cy + s * (r0 + len)); vx.stroke();
    }
    // compass ring
    rot += (.0015 + st.amp * .01) * dt;
    const r2 = R * 1.62;
    vx.strokeStyle = 'rgba(217,213,195,.14)'; vx.lineWidth = 1;
    vx.beginPath(); vx.arc(cx, cy, r2, 0, Math.PI * 2); vx.stroke();
    for (let d = 0; d < 72; d++) {
      const ang = rot + d / 72 * Math.PI * 2, L = d % 6 === 0 ? 12 : 5;
      vx.beginPath(); vx.moveTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2); vx.lineTo(cx + Math.cos(ang) * (r2 - L), cy + Math.sin(ang) * (r2 - L)); vx.stroke();
    }
    // impact markers on the compass, positioned by their offset from the playhead
    t.impacts.forEach(ms => {
      const rel = (ms - p) / 40000; if (Math.abs(rel) > .5) return;
      const ang = -Math.PI / 2 + rel * Math.PI * 2;
      vx.fillStyle = '#ff3a2a'; vx.beginPath(); vx.arc(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2, 4 + st.hit * 4, 0, Math.PI * 2); vx.fill();
    });
    // hit flash
    if (st.hit > .35) { vx.fillStyle = `rgba(255,58,42,${(st.hit - .35) * .12})`; vx.fillRect(0, 0, VW, VH); }
  }

  // background loop only runs while the hero is on screen
  const syncBg = () => { if (!bgvid) return; if (heroVisible && !document.hidden) bgvid.play().catch(() => {}); else bgvid.pause(); };
  document.addEventListener('visibilitychange', syncBg);

  let heroVisible = true;
  new IntersectionObserver(([en]) => {
    heroVisible = en.isIntersecting; syncBg();
    const mini = en.intersectionRatio < .2 && st.deployed;
    const deck = $('#deck');
    if (mini !== deck.classList.contains('mini')) { deck.classList.toggle('mini', mini); requestAnimationFrame(sizeScrub); }
  }, { threshold: [0, .2, .4] }).observe(raid);

  /* ─────────── ticker (real titles + tags) ─────────── */
  let ticker = null;
  (() => {
    const words = [...new Set([...TRACKS.flatMap(t => [t.title, ...t.tags]), 'Breakdowns', 'Las Vegas 702', 'Emercamp Alliance'])];
    const html = words.map(w => `<span>${w}</span><em>✕</em>`).join('');
    const el = $('#ticker'); el.innerHTML = html + html + html + html;
    if (hasGsap && !reduced) { ticker = gsap.to(el, { xPercent: -50, duration: 40, ease: 'none', repeat: -1 }); }
  })();

  /* ─────────── STASH ─────────── */
  let inspected = null;
  function renderStash() {
    const grid = $('#stash-grid');
    const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length || 10;
    const rows = 4;
    const places = cols >= 10 ? [[1, 1], [5, 2]] : [[1, 1], [4, 2]];
    const taken = new Set();
    let html = '';
    TRACKS.forEach((t, i) => {
      const [c, r] = places[i] || [1, 1 + i * 3];
      for (let dx = 0; dx < 3; dx++) for (let dy = 0; dy < 3; dy++) taken.add(`${c + dx},${r + dy}`);
      html += `<button class="item${i === st.idx ? ' current' : ''}" style="grid-column:${c}/span 3;grid-row:${r}/span 3" data-i="${i}" aria-label="Play ${t.title}">
        <img src="${t.art}" alt="" loading="lazy"><span class="item-tag">${i === st.idx ? 'PLAYING' : 'PLAY'}</span><span class="item-dur">${fmt(t.duration)}</span><span class="item-name">${t.title}</span></button>`;
    });
    for (let r = 1; r <= rows; r++) for (let c = 1; c <= cols; c++) if (!taken.has(`${c},${r}`)) html += `<span class="cell" style="grid-column:${c};grid-row:${r}" aria-hidden="true"></span>`;
    grid.innerHTML = html;
    $('#stash-count').textContent = TRACKS.length;
    $$('.item', grid).forEach(b => {
      const i = +b.dataset.i;
      b.addEventListener('click', () => { if (!st.deployed) return deploy(); i === st.idx ? toggle() : loadTrack(i, true); $('#raid').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); });
      b.addEventListener('mouseenter', () => renderInspect(i));
      b.addEventListener('focus', () => renderInspect(i));
    });
  }
  function renderInspect(i) {
    if (i == null) return; inspected = i; const t = TRACKS[i];
    const asof = t.statsAsOf === 'live' ? 'live from SoundCloud' : `SoundCloud, as of ${t.statsAsOf}`;
    $('#inspect').innerHTML = `<p class="inspect-k">INSPECT</p><h3>${t.title}</h3>
      <dl><dt>Artist</dt><dd>${t.account}</dd><dt>Credit</dt><dd>${t.credit}</dd><dt>Length</dt><dd>${fmt(t.duration)}</dd>
      <dt>Released</dt><dd>${new Date(t.released + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
      <dt>Plays</dt><dd>${t.plays.toLocaleString()}</dd><dt>Likes</dt><dd>${t.likes.toLocaleString()}</dd></dl>
      ${t.note ? `<p class="note">“${t.note}”</p>` : ''}
      <div class="inspect-actions"><button class="i-btn" data-load="${i}">▶ PLAY</button><a class="i-btn alt" href="${t.url}" target="_blank" rel="noopener">SOUNDCLOUD ↗</a></div>
      <p class="asof">Plays/likes: ${asof}</p>`;
    $('[data-load]', $('#inspect')).addEventListener('click', () => { if (!st.deployed) return deploy(); loadTrack(i, true); $('#raid').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' }); });
  }

  /* ─────────── INTEL ─────────── */
  $('#intel-list').innerHTML = INTEL.length ? INTEL.map(p => `<a class="post reveal" href="${p.href}" data-post>
      <span class="post-no">${p.no}</span>
      <span><h3 class="post-title">${p.title}</h3><p class="post-meta">${new Date(p.date + 'T12:00:00').toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })} · ${p.tag}</p><p class="post-excerpt">${p.excerpt}</p></span>
      <span class="post-go">READ ▸</span></a>`).join('') : '<p class="sec-sub">No posts yet.</p>';
  const reader = $('#reader');
  $$('[data-post]').forEach(a => a.addEventListener('click', async e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    try {
      const html = await (await fetch(a.getAttribute('href'))).text();
      const art = new DOMParser().parseFromString(html, 'text/html').querySelector('#post');
      $('#reader-body').innerHTML = ''; $('#reader-body').append(art);
      $$('[data-play]', art).forEach(b => b.addEventListener('click', ev => { ev.preventDefault(); const i = TRACKS.findIndex(t => t.id === b.dataset.play); closeReader(); if (i >= 0) { if (i !== st.idx) loadTrack(i, true); else play(); } $('#raid').scrollIntoView(); }));
      reader.hidden = false; $('.reader-panel').scrollTop = 0; $('#reader-close').focus();
      if (hasGsap && !reduced) gsap.from('.reader-panel', { xPercent: 100, duration: .5, ease: 'expo.out' });
    } catch { location.href = a.href; }
  }));
  function closeReader() { reader.hidden = true; }
  $('#reader-close').addEventListener('click', closeReader);
  reader.addEventListener('click', e => { if (e.target === reader) closeReader(); });

  /* ─────────── EXTRACT ─────────── */
  function showExtract() {
    const next = TRACKS[(st.idx + 1) % TRACKS.length];
    $('#extract-time').textContent = fmt(dur());
    $('#extract-track').textContent = cur().title;
    $('#x-next-title').textContent = next.title;
    $('#x-follow').href = cur().account.startsWith('zero') ? 'https://soundcloud.com/iamzeroofficial' : 'https://soundcloud.com/cargoelevatorclutch';
    const x = $('#extract'); x.hidden = false; $('#x-next').focus();
    if (hasGsap && !reduced) gsap.fromTo('.extract-title', { scale: 1.6, autoAlpha: 0, filter: 'blur(12px)' }, { scale: 1, autoAlpha: 1, filter: 'blur(0px)', duration: .9, ease: 'expo.out' });
  }
  function hideExtract() { $('#extract').hidden = true; }
  $('#x-next').addEventListener('click', () => { hideExtract(); loadTrack(st.idx + 1, true); });
  $('#x-again').addEventListener('click', () => { hideExtract(); seek(0); });
  $('#x-close').addEventListener('click', hideExtract);

  /* ─────────── scroll motion ─────────── */
  function introHero() {
    if (!hasGsap || reduced) return;
    gsap.from('.raid-left > *', { y: 40, autoAlpha: 0, stagger: .08, duration: .9, ease: 'expo.out' });
    gsap.from('#bgvid', { scale: 1.25, filter: 'brightness(0)', duration: 1.6, ease: 'expo.out', clearProps: 'transform,filter' });
    gsap.from('.raid-right > *', { x: 40, autoAlpha: 0, stagger: .1, duration: .9, ease: 'expo.out', delay: .15 });
    gsap.from('.deck', { y: 60, autoAlpha: 0, duration: .9, ease: 'expo.out', delay: .25 });
  }
  if (hasGsap && !reduced) {
    $$('[data-scramble]').forEach(h => ScrollTrigger.create({ trigger: h, start: 'top 85%', once: true,
      onEnter: () => gsap.to(h, { duration: 1, scrambleText: { text: h.textContent, chars: 'upperCase', revealDelay: .2, speed: .5 } }) }));
    ScrollTrigger.batch('.reveal', { start: 'top 95%', once: true, onEnter: els => gsap.to(els, { autoAlpha: 1, y: 0, stagger: .06, duration: .6, ease: 'expo.out' }) });
    ScrollTrigger.create({ trigger: '#stash', start: 'top 75%', once: true, onEnter: () => gsap.from('#stash-grid .item', { scale: .7, autoAlpha: 0, stagger: .15, duration: .7, ease: 'back.out(2)' }) });
    gsap.to('#raid .raid-grid', { yPercent: 18, ease: 'none', scrollTrigger: { trigger: '#raid', start: 'top top', end: 'bottom top', scrub: true } });
    gsap.from('.comm', { y: 30, autoAlpha: 0, stagger: .06, duration: .7, ease: 'expo.out', scrollTrigger: { trigger: '#comms', start: 'top 75%' } });
    gsap.from('.operator', { x: -40, autoAlpha: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '#dossier', start: 'top 70%' } });
  }
  // active nav
  $$('.nav a').forEach(a => { const s = $(a.getAttribute('href')); if (!s) return; new IntersectionObserver(([en]) => { if (en.isIntersecting) { $$('.nav a').forEach(x => x.classList.remove('on')); a.classList.add('on'); } }, { rootMargin: '-45% 0px -50% 0px' }).observe(s); });

  // solid HUD once past the hero top
  const hud = $('#hud');
  addEventListener('scroll', () => hud.classList.toggle('solid', scrollY > 80), { passive: true });

  // easter egg: Konami code flips the site into the artist's personal pastel palette
  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let kx = 0;
  addEventListener('keydown', e => {
    kx = e.key === KONAMI[kx] ? kx + 1 : (e.key === KONAMI[0] ? 1 : 0);
    if (kx === KONAMI.length) { kx = 0; const on = document.body.classList.toggle('pastel'); toast(on ? 'Pastel mode unlocked.' : 'Back to the dark.', 2500); }
  });

  /* ─────────── boot ─────────── */
  try { const want = sessionStorage.getItem('ec_load'); if (want) { sessionStorage.removeItem('ec_load'); const i = TRACKS.findIndex(t => t.id === want); if (i > 0) { st.idx = i; $('#sc-frame').src = $('#sc-frame').src.replace(/tracks%2F\d+|tracks\/\d+/, `tracks/${TRACKS[i].scId}`).replace('api.soundcloud.com/tracks/1676139921', `api.soundcloud.com/tracks/${TRACKS[i].scId}`); } } } catch {}
  $('#yr').textContent = new Date().getFullYear();
  renderNow(); renderStash(); renderInspect(st.idx);
  sizeViz(); sizeScrub();
  let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { sizeViz(); sizeScrub(); renderStash(); }, 120); });
  document.fonts?.ready.then(() => { sizeViz(); sizeScrub(); });
  requestAnimationFrame(frame);
})();
