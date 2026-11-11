// TV display loop. Plays the enabled playlist items in order, forever.
(function () {
  'use strict';
  const stage = document.getElementById('stage');
  const layers = [document.getElementById('layerA'), document.getElementById('layerB')];
  const clockEl = document.getElementById('clock');
  const sleepEl = document.getElementById('sleep');
  const MAX_VIDEO_SECONDS = 15 * 60; // safety net if a video never fires "ended"

  let state = { items: [], settings: {}, updatedAt: 0 };
  let front = 0;           // index of the visible layer
  let pos = -1;            // position in the playlist
  let timer = null;
  let dirty = false;       // playlist changed; reload at next advance
  let sleeping = false;
  let current = null;      // item on screen
  let seq = 0;             // guards against overlapping transitions
  let bootId = null;       // server instance; changes after an update

  // ---- scale the 1920×1080 stage to fit any screen ----
  function fit() {
    const s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    const x = (window.innerWidth - 1920 * s) / 2, y = (window.innerHeight - 1080 * s) / 2;
    stage.style.left = '0'; stage.style.top = '0';
    stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
  }
  window.addEventListener('resize', fit); fit();

  async function loadState() {
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (r.ok) state = await r.json();
    } catch (e) { /* keep the last good playlist */ }
    dirty = false;
    applySettings();
  }

  const logoEl = document.getElementById('logo');
  const logoImg = logoEl.querySelector('img');
  function applySettings() {
    const s = state.settings || {};
    clockEl.style.display = s.showClock ? 'block' : 'none';
    const lg = s.logo || {};
    if (lg.file) {
      const src = '/media/' + encodeURIComponent(lg.file);
      if (logoImg.getAttribute('src') !== src) logoImg.setAttribute('src', src);
    }
    logoEl.className = `pos-${lg.position || 'tr'} size-${lg.size || 'm'}${lg.plate ? ' plate' : ''}${logoEl.classList.contains('on') ? ' on' : ''}`;
    logoEl.style.setProperty('--logo-opacity', lg.opacity || 1);
    clockEl.classList.toggle('left', lg.enabled && lg.position === 'tr');
    layers.forEach((l) => l.classList.toggle('fade', s.transition !== 'cut'));
  }

  // Show or hide the logo overlay for the item about to appear
  function updateLogo(item) {
    const lg = (state.settings || {}).logo || {};
    let show = !!(lg.enabled && lg.file && item && !item.hideLogo);
    if (show && lg.showOn === 'media') show = item.type === 'image' || item.type === 'video';
    if (show && lg.showOn === 'slides') show = item.type === 'slide';
    logoEl.classList.toggle('on', show);
  }

  function activeItems() {
    const now = new Date();
    return (state.items || []).filter((it) => MKMA.isActive(it, now));
  }

  // Shown when the playlist is empty: tells you where the admin page is
  function idleItem() {
    const h = state.host || {};
    const where = h.name ? `http://${h.name}.local:${h.port}/admin` : '';
    const ip = h.ips && h.ips.length ? `or  http://${h.ips[0]}:${h.port}/admin` : '';
    return { type: 'slide', duration: 60, slide: { theme: 'concert', showFooter: false,
      blocks: [{ type: 'heading', text: '{academy}', size: 'l' }, { type: 'divider' },
        { type: 'text', text: '{date}', size: 's' },
        where ? { type: 'text', text: `Manage this screen at\n${where}\n${ip}`, size: 's' } : null].filter(Boolean) } };
  }

  function clearLayer(layer) {
    const v = layer.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); } // free the video decoder
    layer.innerHTML = '';
  }

  // Build an item into a layer; resolves when it is ready to show
  function build(layer, item) {
    clearLayer(layer);
    return new Promise((resolve) => {
      const done = (ok) => resolve(ok !== false);
      if (item.type === 'image') {
        const img = new Image();
        img.className = 'media fit-' + (item.fit || 'cover');
        img.onload = () => done(true); img.onerror = () => done(false);
        img.src = '/media/' + encodeURIComponent(item.src);
        layer.appendChild(img);
      } else if (item.type === 'video') {
        const v = document.createElement('video');
        v.className = 'media fit-' + (item.fit || 'contain');
        v.muted = item.muted !== false; v.playsInline = true; v.preload = 'auto';
        let settled = false;
        const finish = (ok) => { if (!settled) { settled = true; done(ok); } };
        v.oncanplay = () => finish(true); v.onerror = () => finish(false);
        setTimeout(() => finish(v.readyState >= 2), 8000);
        v.src = '/media/' + encodeURIComponent(item.src);
        layer.appendChild(v);
      } else {
        layer.innerHTML = MKMA.renderSlide(item.slide, { settings: state.settings, now: new Date() });
        const imgs = layer.querySelectorAll('img');
        if (!imgs.length) return done(true);
        let left = imgs.length;
        imgs.forEach((im) => { const fin = () => { if (--left === 0) done(true); };
          if (im.complete) fin(); else { im.onload = fin; im.onerror = fin; } });
        setTimeout(() => done(true), 5000);
      }
    });
  }

  async function next(skips) {
    clearTimeout(timer);
    skips = skips || 0;
    if (sleeping) return;
    const my = ++seq;
    if (dirty) await loadState();

    let list = activeItems();
    let item;
    if (!list.length) { item = idleItem(); pos = -1; current = null; }
    else { pos = (pos + 1) % list.length; item = list[pos]; current = item; }

    const back = layers[1 - front];
    const ok = await build(back, item);
    if (my !== seq) return; // a newer transition took over
    if (!ok) {
      // broken file: skip it (but avoid looping forever if everything is broken)
      if (skips < list.length) return next(skips + 1);
      item = idleItem(); current = null; pos = -1; await build(back, item);
    }

    // swap layers
    updateLogo(current ? item : null);
    back.classList.add('on');
    layers[front].classList.remove('on');
    const old = layers[front];
    front = 1 - front;
    const fadeMs = state.settings.transition === 'cut' ? 0 : 1000;
    setTimeout(() => { if (old !== layers[front]) clearLayer(old); }, fadeMs);

    const dflt = (state.settings.defaultDuration || 10);
    if (item.type === 'video') {
      const v = back.querySelector('video');
      const p = v.play(); if (p && p.catch) p.catch(() => {});
      if (item.duration > 0) timer = setTimeout(next, item.duration * 1000);
      else { v.onended = () => next(); timer = setTimeout(next, MAX_VIDEO_SECONDS * 1000); }
      // if a single video is the whole playlist, loop it
      if (list.length === 1 && !(item.duration > 0)) { v.loop = true; v.onended = null; }
    } else {
      timer = setTimeout(next, (item.duration > 0 ? item.duration : dflt) * 1000);
    }
  }

  // ---- screen schedule: black screen outside opening hours ----
  function checkSleep() {
    const sch = (state.settings || {}).screenSchedule || {};
    let shouldSleep = false;
    if (sch.enabled) {
      const now = new Date();
      const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
      shouldSleep = sch.on < sch.off ? (hm < sch.on || hm >= sch.off) : (hm < sch.on && hm >= sch.off);
    }
    if (shouldSleep && !sleeping) {
      sleeping = true; clearTimeout(timer); sleepEl.style.display = 'block';
      layers.forEach(clearLayer); layers.forEach((l) => l.classList.remove('on'));
    } else if (!shouldSleep && sleeping) {
      sleeping = false; sleepEl.style.display = 'none'; pos = -1; next();
    }
  }

  function tickClock() {
    clockEl.textContent = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  // When the admin saves: reload now. If the item on screen was edited or
  // removed, show the new version immediately; otherwise carry on smoothly.
  async function onChange() {
    const shown = current ? JSON.stringify(current) : null;
    await loadState();
    updateLogo(current);
    if (sleeping) { checkSleep(); return; }
    const list = activeItems();
    const idx = current ? list.findIndex((it) => it.id === current.id) : -1;
    if (pos === -1 || idx === -1) { pos = Math.min(Math.max(pos, 0), list.length) - 1; next(); return; }
    if (JSON.stringify(list[idx]) !== shown) { pos = idx - 1; next(); return; }
    pos = idx; // keep our place if items were reordered
  }

  // ---- live updates from the admin ----
  function listen() {
    const es = new EventSource('/events');
    es.onmessage = (e) => {
      try {
        const d = JSON.parse(e.data);
        // Server restarted (e.g. after an update): reload so the TV runs the new version
        if (d.boot) { if (bootId && d.boot !== bootId) return location.reload(); bootId = d.boot; }
        if (d.updatedAt && d.updatedAt !== state.updatedAt) onChange();
      } catch (_) {}
    };
  }

  (async function start() {
    await loadState();
    listen();
    tickClock(); setInterval(tickClock, 10000);
    setInterval(checkSleep, 30000);
    setInterval(() => { dirty = true; }, 5 * 60 * 1000); // belt and braces
    checkSleep();
    if (!sleeping) next();
  })();
})();
