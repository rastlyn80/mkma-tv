// MKMA TV admin — playlist manager and slide editor. Plain JS, no build step.
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const DAY_LABELS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];
  const THEME_SWATCH = { concert: ['#12141b', '#c9a24a'], ivory: ['#f6f1e7', '#9b1c2e'], burgundy: ['#5c1420', '#e6c27a'], fresh: ['#ffffff', '#0f8a83'], slate: ['#2b3340', '#8fb3d9'] };
  const BLOCK_NAMES = { heading: 'Heading', text: 'Text', lessons: 'Lessons table', image: 'Picture / logo', divider: 'Line', spacer: 'Space' };

  let items = [];
  let settings = {};
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------- tiny DOM helper ----------
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'value') n.value = v;
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(c));
    return n;
  }

  // ---------- API ----------
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (r.status === 401 && !url.includes('login') && !url.includes('password')) { showLogin(false); throw new Error('Signed out'); }
    if (!r.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function setSave(text, cls) { const s = $('#saveState'); s.textContent = text; s.className = 'save-state ' + (cls || ''); }

  let saveTimer;
  function saveItems(now) {
    setSave('Saving…');
    clearTimeout(saveTimer);
    const go = async () => {
      try { await api('PUT', '/api/items', { items }); setSave('Saved ✓', 'ok'); }
      catch (e) { setSave('Not saved', 'bad'); toast(e.message); }
    };
    if (now) return go();
    saveTimer = setTimeout(go, 400);
  }

  // ---------- login ----------
  async function boot() {
    const me = await api('GET', '/api/me');
    if (!me.authed) return showLogin(me.needsSetup);
    $('#login').classList.add('hidden'); $('#app').classList.remove('hidden');
    const st = await api('GET', '/api/state');
    items = st.items || []; settings = st.settings || {};
    renderList(); fillSettings();
  }
  let setupMode = false;
  function showLogin(needsSetup) {
    setupMode = needsSetup;
    $('#app').classList.add('hidden'); $('#login').classList.remove('hidden');
    $('#loginPw2').classList.toggle('hidden', !needsSetup);
    $('#loginPw2').required = needsSetup;
    $('#loginHint').textContent = needsSetup ? 'First time here — choose an admin password (at least 6 characters).' : 'Sign in to manage the academy screen.';
    $('#loginBtn').textContent = needsSetup ? 'Set password' : 'Sign in';
    $('#loginPw').focus();
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#loginPw').value; $('#loginErr').textContent = '';
    try {
      if (setupMode) {
        if (pw !== $('#loginPw2').value) throw new Error("Passwords don't match");
        await api('POST', '/api/setup', { password: pw });
      } else await api('POST', '/api/login', { password: pw });
      $('#loginPw').value = ''; $('#loginPw2').value = '';
      boot();
    } catch (err) { $('#loginErr').textContent = err.message; }
  });
  $('#logoutBtn').addEventListener('click', async () => { await api('POST', '/api/logout'); showLogin(false); });

  // ---------- tabs ----------
  $$('.tab').forEach((b) => b.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tabpane').forEach((p) => p.classList.toggle('hidden', p.id !== 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'settings') loadMediaLib();
  }));

  // ---------- slide thumbnails (scaled 1920×1080 render) ----------
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) {
      const mini = e.target.querySelector(':scope > .mini');
      if (mini) mini.style.transform = `scale(${e.contentRect.width / 1920})`;
    }
  });
  function miniSlide(box, slide) {
    let mini = box.querySelector(':scope > .mini');
    if (!mini) { mini = el('div', { class: 'mini' }); box.prepend(mini); ro.observe(box); }
    mini.innerHTML = MKMA.renderSlide(slide, { settings });
    const w = box.getBoundingClientRect().width;
    if (w) mini.style.transform = `scale(${w / 1920})`;
  }

  // ---------- playlist ----------
  function describe(it) {
    const parts = [];
    const dflt = settings.defaultDuration || 10;
    if (it.type === 'video') parts.push(it.duration > 0 ? `${it.duration}s` : 'plays to the end');
    else parts.push(it.duration > 0 ? `${it.duration}s` : `${dflt}s`);
    if (it.days && it.days.length && it.days.length < 7) parts.push(DAY_LABELS.filter(([d]) => it.days.includes(d)).map(([, l]) => l).join(' '));
    const fmt = (d) => new Date(d + 'T12:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    if (it.startDate && it.endDate) parts.push(`${fmt(it.startDate)} – ${fmt(it.endDate)}`);
    else if (it.startDate) parts.push(`from ${fmt(it.startDate)}`);
    else if (it.endDate) parts.push(`until ${fmt(it.endDate)}`);
    return parts.join(' · ');
  }

  function renderList() {
    const list = $('#list'); list.innerHTML = '';
    $('#empty').classList.toggle('hidden', items.length > 0);
    $('#playHint').classList.toggle('hidden', items.length < 2);
    const now = new Date();
    items.forEach((it) => {
      const thumb = el('div', { class: 'thumb' });
      if (it.type === 'image') thumb.append(el('img', { src: '/media/' + encodeURIComponent(it.src), loading: 'lazy', alt: '' }));
      else if (it.type === 'video') thumb.append(el('video', { src: '/media/' + encodeURIComponent(it.src) + '#t=1', preload: 'metadata', muted: true, playsInline: true }));
      const badge = { image: 'PHOTO', video: '▶ VIDEO', slide: 'SLIDE' }[it.type];
      thumb.append(el('span', { class: 'badge' }, badge));
      const warn = it.info && it.info.warnings && it.info.warnings.length ? el('div', { class: 'w' }, '⚠ ' + it.info.warnings[0]) : null;
      const scheduledOut = it.enabled && !MKMA.isActive(it, now) ? el('div', { class: 's' }, 'Not showing today (schedule)') : null;
      const sw = el('input', { type: 'checkbox', checked: it.enabled, onchange: (e) => { it.enabled = e.target.checked; li.classList.toggle('off', !it.enabled); saveItems(); } });
      const li = el('li', { class: 'item' + (it.enabled ? '' : ' off'), 'data-id': it.id },
        el('span', { class: 'handle', title: 'Drag to reorder' }, '⠿'),
        thumb,
        el('div', { class: 'meta', onclick: () => openEditor(it.id) },
          el('div', { class: 't' }, it.title || BLOCK_NAMES[it.type] || 'Item'),
          el('div', { class: 's' }, describe(it)), scheduledOut, warn),
        el('label', { class: 'switch', title: 'Show on TV' }, sw, el('span')),
      );
      list.append(li);
      if (it.type === 'slide') miniSlide(thumb, it.slide);
    });
  }

  // drag to reorder (works with touch and mouse)
  (function dragSort() {
    const list = $('#list');
    let drag = null;
    list.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.handle'); if (!h) return;
      const li = h.closest('.item'); e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const r = li.getBoundingClientRect();
      drag = { li, h, startY: e.clientY, offset: e.clientY - r.top };
      li.classList.add('dragging');
    });
    list.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const { li } = drag;
      const t = e.clientY - drag.startY;
      li.style.transform = `translateY(${t}px)`;
      let before = null;
      for (const sib of $$('.item', list)) {
        if (sib === li) continue;
        const r = sib.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) { before = sib; break; }
      }
      const natBefore = li.getBoundingClientRect().top - t;
      if (before) { if (li.nextElementSibling !== before) list.insertBefore(li, before); }
      else if (list.lastElementChild !== li) list.append(li);
      const natAfter = li.getBoundingClientRect().top - t;
      if (natAfter !== natBefore) { drag.startY += natAfter - natBefore; li.style.transform = `translateY(${e.clientY - drag.startY}px)`; }
      if (e.clientY < 80) window.scrollBy(0, -12); else if (e.clientY > innerHeight - 60) window.scrollBy(0, 12);
    });
    const end = () => {
      if (!drag) return;
      drag.li.classList.remove('dragging'); drag.li.style.transform = '';
      const order = $$('.item', list).map((x) => x.dataset.id);
      const changed = order.join() !== items.map((i) => i.id).join();
      items.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      drag = null;
      if (changed) saveItems(true);
    };
    list.addEventListener('pointerup', end); list.addEventListener('pointercancel', end);
  })();

  // ---------- uploads ----------
  async function prepareImage(file) {
    // Resize on this device so the old NUC never has to handle huge photos.
    if (file.type === 'image/gif') return { blob: file, name: file.name };
    if (file.type === 'image/png' && file.size < 1.5e6) return { blob: file, name: file.name }; // logos with transparency
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const scale = Math.min(1, Math.max(1920 / bmp.width, 1080 / bmp.height));
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
      return { blob, name: file.name.replace(/\.[^.]+$/, '') + '.jpg' };
    } catch { return { blob: file, name: file.name }; }
  }
  function upload(blob, name, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('PUT', '/api/upload?name=' + encodeURIComponent(name));
      x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch {}
        x.status === 200 ? resolve(d) : reject(new Error(d.error || 'Upload failed')); };
      x.onerror = () => reject(new Error('Upload failed — check the Wi-Fi'));
      x.send(blob);
    });
  }
  async function uploadFiles(files, { addToPlaylist = true } = {}) {
    const results = [];
    for (const file of files) {
      const isVideo = file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm)$/i.test(file.name);
      const row = el('div', { class: 'up' }, el('span', {}, file.name.slice(0, 28)), el('div', { class: 'bar' }, el('i')), el('span', { class: 'pct' }, isVideo ? '0%' : 'Resizing…'));
      $('#uploads').append(row);
      try {
        const { blob, name } = isVideo ? { blob: file, name: file.name } : await prepareImage(file);
        const res = await upload(blob, name, (f) => { $('i', row).style.width = Math.round(f * 100) + '%'; $('.pct', row).textContent = Math.round(f * 100) + '%'; });
        results.push(res);
        if (addToPlaylist) {
          items.push({ id: uid(), type: res.kind, title: file.name.replace(/\.[^.]+$/, ''), enabled: true, duration: 0,
            src: res.file, fit: res.kind === 'video' ? 'contain' : 'cover', muted: true, days: [], startDate: '', endDate: '',
            info: res.kind === 'video' ? Object.assign({}, res.info, { warnings: res.warnings }) : undefined });
          renderList(); saveItems(true);
        }
        if (res.warnings && res.warnings.length) toast('⚠ ' + res.warnings[0]);
        row.remove();
      } catch (e) {
        $('.pct', row).textContent = 'Failed'; toast(file.name + ': ' + e.message);
        setTimeout(() => row.remove(), 6000);
      }
    }
    return results;
  }
  $('#fileInput').addEventListener('change', (e) => { const f = Array.from(e.target.files); e.target.value = ''; uploadFiles(f); });

  // ---------- templates ----------
  $('#newSlideBtn').addEventListener('click', () => {
    const grid = $('#tplGrid'); grid.innerHTML = '';
    const labels = { lessons: "Today's lessons", announcement: 'Announcement', welcome: 'Welcome', blank: 'Blank slide' };
    for (const key of ['lessons', 'announcement', 'welcome', 'blank']) {
      const t = MKMA.TEMPLATES[key]();
      const thumb = el('div', { class: 'thumb' });
      const b = el('button', { class: 'tpl', onclick: () => {
        closeSheet('#tplSheet');
        const it = { id: uid(), type: 'slide', title: t.title, enabled: true, duration: key === 'lessons' ? 20 : 0, days: [], startDate: '', endDate: '', slide: t.slide };
        openEditor(null, it);
      } }, thumb, el('div', { class: 'l' }, labels[key]));
      grid.append(b);
      requestAnimationFrame(() => miniSlide(thumb, t.slide));
    }
    openSheet('#tplSheet');
  });

  function openSheet(sel) { $(sel).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
  function closeSheet(sel) { $(sel).classList.add('hidden'); if ($$('.sheet:not(.hidden)').length === 0) document.body.style.overflow = ''; }
  $$('.sheet').forEach((s) => {
    s.addEventListener('click', (e) => { if (e.target === s && s.id !== 'editor') closeSheet('#' + s.id); });
    $$('[data-close]', s).forEach((b) => b.addEventListener('click', () => closeSheet('#' + s.id)));
  });

  // ---------- media picker ----------
  function pickImage() {
    return new Promise(async (resolve) => {
      const grid = $('#pickerGrid'); grid.innerHTML = '<p class="hint">Loading…</p>';
      openSheet('#picker');
      const done = (v) => { closeSheet('#picker'); $('#pickerUpload').onchange = null; resolve(v); };
      $('#pickerUpload').onchange = async (e) => {
        const f = Array.from(e.target.files); e.target.value = '';
        const r = await uploadFiles(f, { addToPlaylist: false });
        if (r[0]) done(r[0].file);
      };
      $$('[data-close]', $('#picker')).forEach((b) => (b.onclick = () => done(null)));
      const { files } = await api('GET', '/api/media');
      grid.innerHTML = '';
      const imgs = files.filter((f) => f.kind === 'image');
      if (!imgs.length) grid.append(el('p', { class: 'hint' }, 'No photos uploaded yet.'));
      imgs.forEach((f) => grid.append(el('button', { class: 'pick', onclick: () => done(f.file) },
        el('img', { src: '/media/' + encodeURIComponent(f.file), loading: 'lazy', alt: '' }))));
    });
  }

  // ---------- editor ----------
  let draft = null, draftIsNew = false;

  function openEditor(id, newItem) {
    draftIsNew = !!newItem;
    draft = newItem ? newItem : clone(items.find((i) => i.id === id));
    if (!draft) return;
    $('#edTitle').textContent = draftIsNew ? 'New slide' : 'Edit';
    renderEditorForm();
    openSheet('#editor');
    updatePreview(true);
  }
  $('#edCancel').addEventListener('click', () => closeSheet('#editor'));
  $('#edDone').addEventListener('click', () => {
    if (draftIsNew) items.push(draft);
    else items = items.map((i) => (i.id === draft.id ? draft : i));
    closeSheet('#editor'); renderList(); saveItems(true);
  });

  let previewRaf;
  function updatePreview(full) {
    const box = $('#edPreview');
    if (draft.type === 'slide') {
      cancelAnimationFrame(previewRaf);
      previewRaf = requestAnimationFrame(() => miniSlide(box, draft.slide));
    } else if (full) {
      box.innerHTML = '';
      const src = '/media/' + encodeURIComponent(draft.src);
      box.append(draft.type === 'image'
        ? el('img', { src, alt: '', style: `object-fit:${draft.fit}` })
        : el('video', { src, controls: true, playsInline: true, muted: true, style: `object-fit:${draft.fit}` }));
    } else {
      const m = $('img, video', box); if (m) m.style.objectFit = draft.fit;
    }
  }

  function sec(title, ...kids) { return el('div', { class: 'sec' }, el('h3', {}, title), ...kids); }
  function seg(options, value, onPick) {
    const wrap = el('div', { class: 'seg' });
    options.forEach(([v, label]) => wrap.append(el('button', { type: 'button', class: v === value ? 'on' : '',
      onclick: (e) => { $$('button', wrap).forEach((b) => b.classList.remove('on')); e.currentTarget.classList.add('on'); onPick(v); } }, label)));
    return wrap;
  }
  function field(label, input) { return el('label', { class: 'fld' }, label, input); }

  function renderEditorForm() {
    const f = $('#edForm'); f.innerHTML = '';
    const d = draft;

    // Basics
    const dflt = settings.defaultDuration || 10;
    const durHelp = d.type === 'video' ? '0 = play the whole video' : `0 = default (${dflt}s)`;
    f.append(sec('Basics',
      field('Name (only you see this)', el('input', { value: d.title || '', oninput: (e) => (d.title = e.target.value) })),
      field(`Seconds on screen · ${durHelp}`, el('input', { type: 'number', min: 0, max: 3600, value: d.duration || 0, oninput: (e) => (d.duration = Math.max(0, parseInt(e.target.value, 10) || 0)) })),
      d.type !== 'slide' ? field('Fit', seg([['cover', 'Fill the screen'], ['contain', 'Show the whole thing']], d.fit, (v) => { d.fit = v; updatePreview(); })) : null,
      d.type === 'video' ? el('label', { class: 'fld row' }, el('input', { type: 'checkbox', checked: d.muted === false, onchange: (e) => (d.muted = !e.target.checked) }), 'Play sound') : null,
      d.type === 'video' && d.info && d.info.warnings && d.info.warnings.length ? el('div', { class: 'warn' }, ...d.info.warnings.map((w) => el('div', {}, '⚠ ' + w))) : null,
    ));

    // Schedule
    const days = el('div', { class: 'days' });
    DAY_LABELS.forEach(([n, label]) => {
      const on = !d.days || !d.days.length || d.days.includes(n);
      days.append(el('button', { type: 'button', class: 'chip' + (on ? ' on' : ''), onclick: (e) => {
        e.currentTarget.classList.toggle('on');
        const sel = $$('.chip', days).map((c, i) => (c.classList.contains('on') ? DAY_LABELS[i][0] : null)).filter((x) => x !== null);
        d.days = sel.length === 7 ? [] : sel;
      } }, label));
    });
    f.append(sec('When to show it',
      el('div', { class: 'fld' }, 'Days of the week', days),
      el('div', { class: 'two' },
        field('From (optional)', el('input', { type: 'date', value: d.startDate || '', onchange: (e) => (d.startDate = e.target.value) })),
        field('Until (optional)', el('input', { type: 'date', value: d.endDate || '', onchange: (e) => (d.endDate = e.target.value) }))),
    ));

    if (d.type === 'slide') renderSlideForm(f);

    // Actions
    if (!draftIsNew) {
      f.append(el('div', { class: 'add-blocks' },
        el('button', { type: 'button', class: 'btn', onclick: () => {
          const copy = clone(d); copy.id = uid(); copy.title = (d.title || '') + ' (copy)';
          const idx = items.findIndex((i) => i.id === d.id); items.splice(idx + 1, 0, copy);
          closeSheet('#editor'); renderList(); saveItems(true); toast('Duplicated');
        } }, 'Duplicate'),
        el('button', { type: 'button', class: 'btn danger', onclick: () => {
          if (!confirm('Remove this from the playlist?')) return;
          items = items.filter((i) => i.id !== d.id); closeSheet('#editor'); renderList(); saveItems(true);
        } }, 'Delete')));
    }
  }

  function renderSlideForm(f) {
    const s = draft.slide;
    s.blocks = s.blocks || [];

    // Look
    const themes = el('div', { class: 'themes' });
    Object.keys(MKMA.THEMES).forEach((k) => {
      const [bg, ac] = THEME_SWATCH[k];
      themes.append(el('button', { type: 'button', title: MKMA.THEMES[k].label, class: 'sw' + (s.theme === k ? ' on' : ''), style: `background:${bg}`,
        onclick: (e) => { s.theme = k; $$('.sw', themes).forEach((x) => x.classList.remove('on')); e.currentTarget.classList.add('on'); updatePreview(); } },
      el('i', { style: `background:${ac}` })));
    });
    const bgRow = el('div', { class: 'add-blocks' },
      el('button', { type: 'button', class: 'btn sm', onclick: async () => { const p = await pickImage(); if (p) { s.bgImage = p; renderEditorForm(); updatePreview(); } } }, s.bgImage ? 'Change photo' : 'Choose photo'),
      s.bgImage ? el('button', { type: 'button', class: 'btn sm danger', onclick: () => { s.bgImage = ''; renderEditorForm(); updatePreview(); } }, 'Remove') : null);
    f.append(sec('Look',
      el('div', { class: 'fld' }, 'Style', themes),
      el('div', { class: 'fld' }, 'Alignment', seg([['center', 'Centred'], ['left', 'Left']], s.align || 'center', (v) => { s.align = v; updatePreview(); })),
      el('div', { class: 'fld' }, 'Background photo', bgRow),
      s.bgImage ? field('Darken photo', el('input', { type: 'range', min: 0, max: 0.9, step: 0.05, value: s.bgDim == null ? 0.55 : s.bgDim, oninput: (e) => { s.bgDim = parseFloat(e.target.value); updatePreview(); } })) : null,
      el('label', { class: 'fld row' }, el('input', { type: 'checkbox', checked: s.showFooter !== false, onchange: (e) => { s.showFooter = e.target.checked; updatePreview(); } }), 'Show academy name at the bottom'),
    ));

    // Content blocks
    const blocksWrap = el('div', { class: 'sec' }, el('h3', {}, 'Content'));
    s.blocks.forEach((b, i) => blocksWrap.append(blockEditor(b, i)));
    const add = el('div', { class: 'add-blocks' });
    ['heading', 'text', 'lessons', 'image', 'divider', 'spacer'].forEach((t) => add.append(el('button', { type: 'button', class: 'btn sm', onclick: () => {
      const nb = { type: t };
      if (t === 'heading') Object.assign(nb, { text: 'Heading', size: 'l' });
      if (t === 'text') Object.assign(nb, { text: 'Some text', size: 'm' });
      if (t === 'lessons') nb.rows = [{ time: '', studio: '', instrument: '', teacher: '' }];
      if (t === 'image') { nb.size = 'm'; nb.src = ''; }
      s.blocks.push(nb); renderEditorForm(); updatePreview();
      setTimeout(() => $('#edForm .sec:last-of-type .block:last-of-type')?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50);
    } }, '＋ ' + BLOCK_NAMES[t])));
    blocksWrap.append(el('div', { class: 'fld' }, 'Add', add));
    blocksWrap.append(el('p', { class: 'hint' }, 'Tip: type {date} for today\'s date, {day} for the weekday, {academy} for the academy name.'));
    f.append(blocksWrap);
  }

  function blockEditor(b, i) {
    const s = draft.slide;
    const move = (dir) => { const j = i + dir; [s.blocks[i], s.blocks[j]] = [s.blocks[j], s.blocks[i]]; renderEditorForm(); updatePreview(); };
    const head = el('div', { class: 'block-head' }, el('b', {}, BLOCK_NAMES[b.type] || b.type),
      el('button', { type: 'button', class: 'ib', title: 'Move up', disabled: i === 0, onclick: () => move(-1) }, '↑'),
      el('button', { type: 'button', class: 'ib', title: 'Move down', disabled: i === s.blocks.length - 1, onclick: () => move(1) }, '↓'),
      el('button', { type: 'button', class: 'ib', title: 'Remove', onclick: () => { s.blocks.splice(i, 1); renderEditorForm(); updatePreview(); } }, '✕'));
    const box = el('div', { class: 'block' }, head);

    if (b.type === 'heading' || b.type === 'text') {
      box.append(el('textarea', { rows: 2, value: b.text || '', oninput: (e) => { b.text = e.target.value; updatePreview(); } }));
      const sizes = b.type === 'heading' ? [['m', 'Medium'], ['l', 'Large'], ['xl', 'Huge']] : [['s', 'Small'], ['m', 'Medium'], ['l', 'Large']];
      box.append(seg(sizes, b.size || (b.type === 'heading' ? 'l' : 'm'), (v) => { b.size = v; updatePreview(); }));
    }
    if (b.type === 'image') {
      box.append(el('div', { class: 'add-blocks' },
        el('button', { type: 'button', class: 'btn sm', onclick: async () => { const p = await pickImage(); if (p) { b.src = p; renderEditorForm(); updatePreview(); } } }, b.src ? 'Change picture' : 'Choose picture'),
        seg([['s', 'Small'], ['m', 'Medium'], ['l', 'Large']], b.size || 'm', (v) => { b.size = v; updatePreview(); })));
    }
    if (b.type === 'lessons') box.append(lessonsEditor(b));
    return box;
  }

  function lessonsEditor(b) {
    b.rows = b.rows || [];
    const wrap = el('div', { class: 'fld' });
    const draw = () => {
      wrap.innerHTML = '';
      wrap.append(el('div', { class: 'lrow head' }, el('span', {}, 'Time'), el('span', {}, 'Studio'), el('span', {}, 'Instrument'), el('span', {}, 'Teacher'), el('span', {}, '')));
      b.rows.forEach((r, i) => {
        const inp = (key, ph) => el('input', { value: r[key] || '', placeholder: ph, oninput: (e) => { r[key] = e.target.value; updatePreview(); } });
        wrap.append(el('div', { class: 'lrow' }, inp('time', 'Time'), inp('studio', 'Studio'), inp('instrument', 'Instrument'), inp('teacher', 'Teacher'),
          el('div', { style: 'display:flex;gap:4px' },
            el('button', { type: 'button', class: 'ib', title: 'Move up', disabled: i === 0, onclick: () => { [b.rows[i - 1], b.rows[i]] = [b.rows[i], b.rows[i - 1]]; draw(); updatePreview(); } }, '↑'),
            el('button', { type: 'button', class: 'ib', title: 'Remove row', onclick: () => { b.rows.splice(i, 1); draw(); updatePreview(); } }, '✕'))));
      });
      wrap.append(el('div', { class: 'add-blocks' },
        el('button', { type: 'button', class: 'btn sm', onclick: () => {
          b.rows.push({ time: '', studio: '', instrument: '', teacher: '' });
          draw(); updatePreview();
          const ins = $$('.lrow:not(.head)', wrap); $('input', ins[ins.length - 1])?.focus();
        } }, '＋ Add lesson'),
        el('button', { type: 'button', class: 'btn sm', onclick: () => {
          b.rows.sort((x, y) => (x.time || '').localeCompare(y.time || '') || (x.studio || '').localeCompare(y.studio || '', undefined, { numeric: true }));
          draw(); updatePreview();
        } }, 'Sort by time'),
        b.rows.length ? el('button', { type: 'button', class: 'btn sm danger', onclick: () => { if (confirm('Clear all lessons in this table?')) { b.rows = []; draw(); updatePreview(); } } }, 'Clear all') : null));
      wrap.append(el('p', { class: 'hint' }, 'Time is optional — leave it empty and the column disappears. Big lists switch to two columns automatically.'));
    };
    draw();
    return wrap;
  }

  // ---------- settings ----------
  function fillSettings() {
    const f = $('#settingsForm');
    f.academyName.value = settings.academyName || '';
    f.defaultDuration.value = settings.defaultDuration || 10;
    f.transition.value = settings.transition || 'fade';
    f.showClock.checked = !!settings.showClock;
    const sc = settings.screenSchedule || {};
    f.schedEnabled.checked = !!sc.enabled; f.schedOn.value = sc.on || '08:00'; f.schedOff.value = sc.off || '21:30';
  }
  $('#settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target;
    try {
      const r = await api('PUT', '/api/settings', {
        academyName: f.academyName.value, defaultDuration: f.defaultDuration.value, transition: f.transition.value,
        showClock: f.showClock.checked, screenSchedule: { enabled: f.schedEnabled.checked, on: f.schedOn.value, off: f.schedOff.value },
      });
      settings = r.settings; toast('Settings saved'); renderList();
    } catch (err) { toast(err.message); }
  });
  $('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target; $('#pwMsg').textContent = '';
    try { await api('POST', '/api/password', { current: f.current.value, next: f.next.value }); f.reset(); toast('Password changed'); }
    catch (err) { $('#pwMsg').textContent = err.message; }
  });
  async function loadMediaLib() {
    const box = $('#mediaLib'); box.innerHTML = '<p class="hint">Loading…</p>';
    const { files } = await api('GET', '/api/media');
    box.innerHTML = '';
    if (!files.length) box.append(el('p', { class: 'hint' }, 'No files yet.'));
    const total = files.reduce((a, f) => a + f.size, 0);
    files.sort((a, b) => a.used - b.used).forEach((f) => {
      const src = '/media/' + encodeURIComponent(f.file);
      box.append(el('div', { class: 'pick' },
        f.kind === 'image' ? el('img', { src, loading: 'lazy', alt: '' }) : el('video', { src: src + '#t=1', preload: 'metadata', muted: true }),
        el('span', { class: 'tag' }, f.used ? 'in use' : (f.size / 1e6).toFixed(1) + ' MB'),
        f.used ? null : el('button', { type: 'button', class: 'ib del', title: 'Delete file', onclick: async () => {
          if (!confirm('Delete this file permanently?')) return;
          await api('DELETE', '/api/media?file=' + encodeURIComponent(f.file)); loadMediaLib();
        } }, '🗑')));
    });
    box.append(el('p', { class: 'hint', style: 'grid-column:1/-1' }, `${files.length} files · ${(total / 1e6).toFixed(0)} MB`));
  }

  boot().catch((e) => toast(e.message));
})();
