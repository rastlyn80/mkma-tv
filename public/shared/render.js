// Shared slide renderer — used by the TV display and the admin live preview,
// so what you see in the editor is exactly what appears on the TV.
(function (global) {
  'use strict';

  const THEMES = {
    concert:  { label: 'Concert (dark & gold)' },
    ivory:    { label: 'Ivory (light & red)' },
    burgundy: { label: 'Burgundy (rich & warm)' },
    fresh:    { label: 'Fresh (white & teal)' },
    slate:    { label: 'Slate (cool grey)' },
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function tokens(text, ctx) {
    const now = ctx.now || new Date();
    return String(text || '')
      .replace(/\{date\}/g, now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }))
      .replace(/\{day\}/g, now.toLocaleDateString('en-GB', { weekday: 'long' }))
      .replace(/\{academy\}/g, ctx.settings && ctx.settings.academyName || '');
  }

  // Text with line breaks, tokens replaced, HTML escaped
  function txt(text, ctx) { return esc(tokens(text, ctx)).replace(/\n/g, '<br>'); }

  function lessonsTable(rows, showTime, fontPx) {
    const head = `<div class="ls-row ls-head">${showTime ? '<div>Time</div>' : ''}<div>Studio</div><div>Instrument</div><div>Teacher</div></div>`;
    const body = rows.map((r) =>
      `<div class="ls-row">${showTime ? `<div class="ls-time">${esc(r.time)}</div>` : ''}<div class="ls-studio">${esc(r.studio)}</div><div>${esc(r.instrument)}</div><div>${esc(r.teacher)}</div></div>`
    ).join('');
    return `<div class="ls-table ${showTime ? 'with-time' : ''}" style="font-size:${fontPx}px">${head}${body}</div>`;
  }

  function renderLessons(block) {
    const rows = (block.rows || []).filter((r) => r && (r.studio || r.instrument || r.teacher || r.time)).slice(0, 30);
    if (!rows.length) return '<div class="blk blk-lessons"><div class="ls-empty">No lessons added yet</div></div>';
    const showTime = rows.some((r) => r.time);
    const n = rows.length;
    if (n > 12) { // two columns side by side
      const half = Math.ceil(n / 2);
      const font = n > 22 ? 22 : 26;
      return `<div class="blk blk-lessons two-col">${lessonsTable(rows.slice(0, half), showTime, font)}${lessonsTable(rows.slice(half), showTime, font)}</div>`;
    }
    const font = n <= 5 ? 46 : n <= 7 ? 40 : n <= 9 ? 35 : 30;
    return `<div class="blk blk-lessons">${lessonsTable(rows, showTime, font)}</div>`;
  }

  function renderBlock(b, ctx) {
    switch (b.type) {
      case 'heading': return `<h1 class="blk blk-heading size-${esc(b.size || 'l')}">${txt(b.text, ctx)}</h1>`;
      case 'text':    return `<p class="blk blk-text size-${esc(b.size || 'm')}">${txt(b.text, ctx)}</p>`;
      case 'lessons': return renderLessons(b);
      case 'image':   return b.src ? `<div class="blk blk-image size-${esc(b.size || 'm')}"><img src="${ctx.mediaBase}${encodeURIComponent(b.src)}" alt=""></div>` : '';
      case 'divider': return '<div class="blk blk-divider"></div>';
      case 'spacer':  return '<div class="blk blk-spacer"></div>';
      default: return '';
    }
  }

  // Returns HTML for a 1920×1080 stage
  function renderSlide(slide, ctx) {
    slide = slide || {};
    ctx = Object.assign({ mediaBase: '/media/', settings: {} }, ctx);
    const theme = THEMES[slide.theme] ? slide.theme : 'concert';
    const align = slide.align === 'left' ? 'left' : 'center';
    const bg = slide.bgImage
      ? `<div class="sl-bg" style="background-image:url('${ctx.mediaBase}${encodeURIComponent(slide.bgImage)}')"></div><div class="sl-dim" style="opacity:${Math.max(0, Math.min(0.9, slide.bgDim == null ? 0.55 : slide.bgDim))}"></div>`
      : '';
    const blocks = (slide.blocks || []).map((b) => renderBlock(b, ctx)).join('');
    const footer = slide.showFooter !== false && ctx.settings.academyName
      ? `<div class="sl-footer">${esc(ctx.settings.academyName)}</div>` : '';
    return `<div class="slide theme-${theme} align-${align} ${slide.bgImage ? 'has-bg' : ''}">${bg}<div class="sl-inner">${blocks}</div>${footer}</div>`;
  }

  const TEMPLATES = {
    blank: () => ({ title: 'New slide', slide: { theme: 'concert', align: 'center', blocks: [{ type: 'heading', text: 'Heading', size: 'l' }] } }),
    lessons: () => ({
      title: "Today's lessons",
      slide: {
        theme: 'concert', align: 'center',
        blocks: [
          { type: 'heading', text: "Today's Lessons", size: 'l' },
          { type: 'text', text: '{date}', size: 's' },
          { type: 'lessons', rows: [
            { time: '', studio: 'Studio 1', instrument: 'Piano', teacher: '' },
            { time: '', studio: 'Studio 2', instrument: 'Violin', teacher: '' },
            { time: '', studio: 'Studio 3', instrument: 'Guitar', teacher: '' },
          ] },
        ],
      },
    }),
    announcement: () => ({
      title: 'Announcement',
      slide: {
        theme: 'burgundy', align: 'center',
        blocks: [
          { type: 'text', text: 'Coming up', size: 's' },
          { type: 'heading', text: 'Christmas Concert', size: 'xl' },
          { type: 'divider' },
          { type: 'text', text: 'Saturday 14 December · 6pm\nEveryone welcome', size: 'm' },
        ],
      },
    }),
    welcome: () => ({
      title: 'Welcome',
      slide: {
        theme: 'ivory', align: 'center',
        blocks: [
          { type: 'heading', text: 'Welcome to\n{academy}', size: 'l' },
          { type: 'divider' },
          { type: 'text', text: 'Please take a seat — your teacher will collect you.', size: 'm' },
        ],
      },
    }),
  };

  // Should this item be shown right now?
  function isActive(item, now) {
    if (!item || item.enabled === false) return false;
    now = now || new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    if (item.startDate && today < item.startDate) return false;
    if (item.endDate && today > item.endDate) return false;
    if (item.days && item.days.length && !item.days.includes(now.getDay())) return false;
    return true;
  }

  global.MKMA = { renderSlide, THEMES, TEMPLATES, isActive, esc, tokens };
})(window);
