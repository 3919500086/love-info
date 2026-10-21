/* ==========================================================================
   love-info — 页面逻辑
   纯原生 JavaScript：读取 data.json → 渲染 → 交互
   ========================================================================== */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const numberFormat = new Intl.NumberFormat('zh-CN');

  const STORAGE_KEYS = {
    wishes: 'love-info:wishes:v1',
    messages: 'love-info:messages:v1'
  };

  const state = {
    data: null,
    photos: [],
    visiblePhotos: [],
    serverMessages: [],
    localMessages: [],
    wishes: null,
    wishState: {},
    quoteIndex: 0,
    lightboxIndex: 0
  };

  let revealObserver = null;
  let clockTimer = null;
  let statusTimer = null;

  /* ------------------------------------------------------------------ 工具 */

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  function toDate(value) {
    if (value instanceof Date) return value;
    const match = String(value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return match
      ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      : new Date(value);
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function daysBetween(from, to) {
    return Math.round((startOfDay(to) - startOfDay(from)) / 86400000);
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function fmtLong(date) {
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月 ${date.getDate()} 日`;
  }

  function fmtDots(date) {
    return `${date.getFullYear()}.${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
  }

  function fmtIso(date) {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  }

  function nextAnnual(date) {
    const today = startOfDay(new Date());
    let next = new Date(today.getFullYear(), date.getMonth(), date.getDate());
    if (next < today) {
      next = new Date(today.getFullYear() + 1, date.getMonth(), date.getDate());
    }
    return next;
  }

  /** 图片地址：本地图片原样返回，远程图片按需追加尺寸参数。 */
  function imageUrl(src, width) {
    if (!src) return '';
    if (!/^https?:\/\//i.test(src)) return src;
    const separator = src.includes('?') ? '&' : '?';
    return `${src}${separator}auto=format&fit=crop&w=${width}&q=80`;
  }

  function readStore(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function animateNumber(node, from, to, duration = 1100) {
    if (!node) return;
    if (reduceMotion || from === to) {
      node.textContent = numberFormat.format(to);
      return;
    }
    const startTime = performance.now();
    const frame = (now) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = numberFormat.format(Math.round(from + (to - from) * eased));
      if (progress < 1) window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  }

  function setStatus(message) {
    const node = $('#message-status');
    if (!node) return;
    node.textContent = message;
    if (statusTimer) window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      node.textContent = '';
    }, 5000);
  }

  /* ------------------------------------------------------------ 数据渲染 */

  function renderSite(site = {}) {
    if (site.title) document.title = `${site.title} · love-info`;

    const names = Array.isArray(site.names) ? site.names : [];
    if (names[0]) $('#name-a').textContent = names[0];
    if (names[1]) $('#name-b').textContent = names[1];

    if (site.since) {
      const since = toDate(site.since);
      if (!Number.isNaN(since.getTime())) {
        $('#hero-since').textContent = fmtDots(since);
        $('#counter-since').textContent = `自 ${fmtLong(since)}`;
      }
    }

    if (site.subtitle) $('#hero-subtitle').textContent = site.subtitle;
    if (site.footer) $('#footer-line').textContent = site.footer;
    $('#footer-year').textContent = String(new Date().getFullYear());
  }

  function renderPeople(people) {
    const grid = $('#people-grid');
    if (!grid) return;
    grid.textContent = '';

    people.forEach((person, index) => {
      const card = el('article', 'profile reveal');
      card.style.setProperty('--accent', person.accent || '#FF8A5B');
      card.style.setProperty('--delay', `${index * 90}ms`);

      const head = el('div', 'profile__head');

      const avatarWrap = el('div', 'profile__avatar-wrap');
      const avatar = el('img', 'profile__avatar');
      avatar.src = imageUrl(person.avatar, 400);
      avatar.alt = `${person.name || ''}的头像`;
      avatar.loading = 'lazy';
      avatar.decoding = 'async';
      avatar.width = 92;
      avatar.height = 92;
      avatarWrap.append(avatar);

      const intro = el('div', 'profile__intro');
      const nameRow = el('h3', 'profile__name');
      nameRow.append(document.createTextNode(person.name || ''));
      if (person.role) nameRow.append(el('span', 'profile__role', person.role));
      intro.append(nameRow);
      if (person.tagline) intro.append(el('p', 'profile__tagline', person.tagline));

      head.append(avatarWrap, intro);
      card.append(head);

      const meta = el('dl', 'profile__meta');
      [
        ['生日', person.birthday ? fmtLong(toDate(person.birthday)) : ''],
        ['星座', person.constellation || ''],
        ['MBTI', person.mbti || ''],
        ['职业', person.job || '']
      ].forEach(([label, value]) => {
        if (!value) return;
        const item = el('div', 'meta');
        item.append(el('dt', 'meta__label', label), el('dd', 'meta__value', value));
        meta.append(item);
      });
      if (meta.children.length) card.append(meta);

      if (Array.isArray(person.hobbies) && person.hobbies.length) {
        const tags = el('ul', 'profile__tags');
        person.hobbies.forEach((hobby) => tags.append(el('li', 'tag', hobby)));
        card.append(tags);
      }

      grid.append(card);
    });
  }

  function renderDates(items) {
    const grid = $('#date-grid');
    if (!grid) return;
    grid.textContent = '';

    const today = startOfDay(new Date());

    items.forEach((item, index) => {
      const date = toDate(item.date);
      const card = el('article', 'date-card reveal');
      card.style.setProperty('--delay', `${index * 60}ms`);
      card.append(el('span', 'date-card__emoji', item.emoji || '💫'));
      card.append(el('p', 'date-card__label', item.label || ''));

      const value = el('p', 'date-card__value');

      if (item.type === 'countdown') {
        card.classList.add('date-card--countdown');
        const target = item.annual === false ? date : nextAnnual(date);
        const remaining = daysBetween(today, target);

        if (remaining === 0) {
          card.classList.add('is-today');
          value.textContent = '就是今天';
        } else {
          value.append(el('strong', null, String(remaining)), el('span', null, '天'));
        }

        card.append(value);
        card.append(el(
          'p',
          'date-card__note',
          remaining === 0
            ? (item.note || '别忘了说一句祝福')
            : `下一次 ${fmtLong(target)}${item.note ? ` · ${item.note}` : ''}`
        ));
      } else {
        const passed = Math.max(0, daysBetween(date, today));
        value.append(el('strong', null, numberFormat.format(passed)), el('span', null, '天'));
        card.append(value);
        card.append(el(
          'p',
          'date-card__note',
          `${fmtLong(date)} 起${item.note ? ` · ${item.note}` : ''}`
        ));
      }

      grid.append(card);
    });
  }

  function renderTimeline(items) {
    const list = $('#timeline-list');
    if (!list) return;
    list.textContent = '';

    items.forEach((item, index) => {
      const row = el('li', 'timeline__item reveal');
      row.style.setProperty('--delay', `${index * 70}ms`);

      const dot = el('span', 'timeline__dot', item.emoji || '·');
      dot.setAttribute('aria-hidden', 'true');

      const card = el('article', 'timeline__card');
      card.append(el('p', 'timeline__date', fmtDots(toDate(item.date))));
      card.append(el('h3', 'timeline__title', item.title || ''));
      if (item.text) card.append(el('p', 'timeline__text', item.text));

      if (item.photo) {
        const figure = el('figure', 'timeline__photo');
        const img = el('img');
        img.src = imageUrl(item.photo, 900);
        img.alt = item.photoAlt || item.title || '';
        img.loading = 'lazy';
        img.decoding = 'async';
        figure.append(img);
        card.append(figure);
      }

      row.append(dot, card);
      list.append(row);
    });
  }

  function renderGallery(photos) {
    const gallery = $('#gallery-grid');
    const filters = $('#filters');
    if (!gallery || !filters) return;

    state.photos = photos.slice();
    gallery.textContent = '';
    filters.textContent = '';

    const groups = ['全部'];
    photos.forEach((photo) => {
      if (photo.group && !groups.includes(photo.group)) groups.push(photo.group);
    });

    groups.forEach((group, index) => {
      const button = el('button', `filter${index === 0 ? ' is-active' : ''}`, group);
      button.type = 'button';
      button.dataset.group = group;
      button.setAttribute('aria-pressed', index === 0 ? 'true' : 'false');
      filters.append(button);
    });

    photos.forEach((photo, index) => {
      const button = el('button', `photo${photo.size === 'wide' ? ' photo--wide' : ''}`);
      button.type = 'button';
      button.dataset.index = String(index);
      button.setAttribute('aria-label', `查看大图：${photo.caption || '照片'}`);

      const img = el('img');
      img.src = imageUrl(photo.src, 900);
      img.alt = photo.alt || photo.caption || '';
      img.loading = 'lazy';
      img.decoding = 'async';
      button.append(img);

      const caption = el('span', 'photo__cap');
      caption.append(el('span', null, photo.caption || ''));
      if (photo.date) {
        const meta = [photo.group, fmtDots(toDate(photo.date))].filter(Boolean).join(' · ');
        caption.append(el('small', null, meta));
      }
      button.append(caption);

      gallery.append(button);
    });

    applyFilter('全部');
  }

  function applyFilter(group) {
    if (!state.photos.length) return;

    $$('#gallery-grid .photo').forEach((button) => {
      const photo = state.photos[Number(button.dataset.index)];
      button.hidden = !(photo && (group === '全部' || photo.group === group));
    });

    state.visiblePhotos = state.photos.filter(
      (photo) => group === '全部' || photo.group === group
    );

    $$('#filters .filter').forEach((button) => {
      const active = button.dataset.group === group;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderQuote(quotes) {
    if (!Array.isArray(quotes) || !quotes.length) return;
    const today = startOfDay(new Date());
    const dayNumber = Math.floor(today.getTime() / 86400000);
    state.quoteIndex = ((dayNumber % quotes.length) + quotes.length) % quotes.length;
    updateQuote(quotes);
  }

  function updateQuote(quotes) {
    const text = quotes[state.quoteIndex] || '';
    $('#quote-text').textContent = text;
    $('#quote-meta').textContent = `${fmtLong(new Date())} · 第 ${state.quoteIndex + 1} / ${quotes.length} 句`;
  }

  function renderWishes(wishes) {
    const list = $('#wish-list');
    if (!list) return;

    state.wishes = wishes;
    const stored = readStore(STORAGE_KEYS.wishes, {});
    state.wishState = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    list.textContent = '';

    wishes.forEach((wish) => {
      const label = el('label', 'wish');

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.id = wish.id;
      input.dataset.default = wish.done ? '1' : '0';
      input.checked = Object.prototype.hasOwnProperty.call(state.wishState, wish.id)
        ? Boolean(state.wishState[wish.id])
        : Boolean(wish.done);

      const box = el('span', 'wish__box');
      box.setAttribute('aria-hidden', 'true');

      const text = el('span', 'wish__text', wish.text || '');
      if (wish.note) text.append(el('span', 'wish__note', wish.note));

      label.append(input, box, text);

      input.addEventListener('change', () => {
        state.wishState[wish.id] = input.checked;
        writeStore(STORAGE_KEYS.wishes, state.wishState);
        updateWishProgress();
      });

      list.append(label);
    });

    updateWishProgress();
  }

  function updateWishProgress() {
    const inputs = $$('#wish-list input[type="checkbox"]');
    const total = inputs.length;
    const done = inputs.filter((input) => input.checked).length;
    const percent = total ? Math.round((done / total) * 100) : 0;

    const doneNode = $('#wish-done');
    const totalNode = $('#wish-total');
    const bar = $('#wish-bar');
    const fill = $('#wish-bar-fill');

    if (doneNode) doneNode.textContent = String(done);
    if (totalNode) totalNode.textContent = String(total);
    if (bar) bar.setAttribute('aria-valuenow', String(percent));
    if (fill) fill.style.width = `${percent}%`;
  }

  function renderMessages() {
    const list = $('#message-list');
    if (!list) return;
    list.textContent = '';

    const all = [
      ...state.localMessages.map((message) => ({ ...message, local: true })),
      ...state.serverMessages
    ];

    if (!all.length) {
      list.append(el('p', 'message-form__hint', '还没有留言，写第一句吧。'));
      return;
    }

    all.forEach((message) => {
      const card = el('article', 'message');

      const head = el('div', 'message__head');
      const from = el('p', 'message__from');
      from.append(el('span', 'message__dot'));
      from.append(document.createTextNode(message.from || '匿名'));

      const meta = el('div', 'message__meta');
      if (message.local) meta.append(el('span', 'message__local', '仅本机'));
      if (message.date) {
        const date = toDate(message.date);
        const time = el('time', null, fmtDots(date));
        time.dateTime = fmtIso(date);
        meta.append(time);
      }
      head.append(from, meta);

      card.append(head, el('p', 'message__text', message.text || ''));

      if (message.local && message.id) {
        const remove = el('button', 'message__del', '删除这条留言');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          state.localMessages = state.localMessages.filter((item) => item.id !== message.id);
          writeStore(STORAGE_KEYS.messages, state.localMessages);
          renderMessages();
          setStatus('已删除本机留言。');
        });
        card.append(remove);
      }

      list.append(card);
    });
  }

  /* --------------------------------------------------------------- 倒计时 */

  function startClock(sinceValue) {
    const start = toDate(sinceValue);
    const daysNode = $('#days-together');
    const clockNode = $('#clock');
    if (!daysNode || !clockNode || Number.isNaN(start.getTime())) return;

    let lastDays = -1;
    let firstRun = true;

    const tick = () => {
      const diff = Math.max(0, Date.now() - start.getTime());
      const days = Math.floor(diff / 86400000);

      if (days !== lastDays) {
        if (firstRun) {
          firstRun = false;
          animateNumber(daysNode, 0, days, 1200);
        } else {
          daysNode.textContent = numberFormat.format(days);
        }
        lastDays = days;
      }

      const hours = Math.floor(diff / 3600000) % 24;
      const minutes = Math.floor(diff / 60000) % 60;
      const seconds = Math.floor(diff / 1000) % 60;
      clockNode.textContent = `${pad2(hours)}:${pad2(minutes)}:${pad2(seconds)}`;
    };

    tick();
    if (clockTimer) window.clearInterval(clockTimer);
    clockTimer = window.setInterval(tick, 1000);
  }

  /* ----------------------------------------------------------------- 灯箱 */

  function setupLightbox() {
    const dialog = $('#lightbox');
    const image = $('#lightbox-img');
    const caption = $('#lightbox-caption');
    const counter = $('#lightbox-count');
    if (!dialog || !image) return;

    const update = () => {
      const photo = state.visiblePhotos[state.lightboxIndex];
      if (!photo) return;
      image.src = imageUrl(photo.src, 1600);
      image.alt = photo.alt || photo.caption || '';
      caption.textContent = [
        photo.caption,
        photo.group,
        photo.date ? fmtDots(toDate(photo.date)) : ''
      ].filter(Boolean).join(' · ');
      counter.textContent = `${state.lightboxIndex + 1} / ${state.visiblePhotos.length}`;
    };

    const open = (index) => {
      state.lightboxIndex = index;
      update();
      if (typeof dialog.showModal === 'function') {
        if (!dialog.open) dialog.showModal();
      } else {
        dialog.setAttribute('open', '');
      }
      document.body.classList.add('no-scroll');
    };

    const close = () => {
      if (typeof dialog.close === 'function' && dialog.open) {
        dialog.close();
      } else {
        dialog.removeAttribute('open');
      }
      document.body.classList.remove('no-scroll');
    };

    const step = (delta) => {
      const total = state.visiblePhotos.length;
      if (!total) return;
      state.lightboxIndex = (state.lightboxIndex + delta + total) % total;
      update();
    };

    const gallery = $('#gallery-grid');
    if (gallery) {
      gallery.addEventListener('click', (event) => {
        const button = event.target.closest('.photo');
        if (!button) return;
        const photo = state.photos[Number(button.dataset.index)];
        const index = state.visiblePhotos.indexOf(photo);
        if (index >= 0) open(index);
      });
    }

    $('#lightbox-prev')?.addEventListener('click', () => step(-1));
    $('#lightbox-next')?.addEventListener('click', () => step(1));
    $('#lightbox-close')?.addEventListener('click', close);

    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) close();
    });

    dialog.addEventListener('close', () => {
      document.body.classList.remove('no-scroll');
    });

    dialog.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        step(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        step(1);
      }
    });

    let touchStartX = null;
    dialog.addEventListener('touchstart', (event) => {
      if (event.touches.length === 1) touchStartX = event.touches[0].clientX;
    }, { passive: true });

    dialog.addEventListener('touchend', (event) => {
      if (touchStartX === null) return;
      const delta = event.changedTouches[0].clientX - touchStartX;
      if (Math.abs(delta) > 50) step(delta < 0 ? 1 : -1);
      touchStartX = null;
    }, { passive: true });
  }

  /* ------------------------------------------------------------- 进场动效 */

  function setupReveal() {
    const items = $$('.reveal');
    if (reduceMotion || !('IntersectionObserver' in window)) {
      items.forEach((item) => item.classList.remove('reveal'));
      return;
    }

    if (!revealObserver) {
      revealObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const item = entry.target;
          item.classList.add('is-visible');
          observer.unobserve(item);
          window.setTimeout(() => {
            item.classList.remove('reveal', 'is-visible');
          }, 1300);
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -30px 0px' });
    }

    items.forEach((item) => revealObserver.observe(item));
  }

  function revealAll() {
    $$('.reveal').forEach((item) => item.classList.remove('reveal'));
  }

  /* --------------------------------------------------------------- 导航高亮 */

  function setupNavSpy() {
    const links = $$('.nav__link');
    if (!links.length || !('IntersectionObserver' in window)) return;

    const sections = new Map();
    links.forEach((link) => {
      const id = link.getAttribute('href').slice(1);
      const section = document.getElementById(id);
      if (section) sections.set(section, link);
    });
    if (!sections.size) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => link.classList.remove('is-active'));
        const link = sections.get(entry.target);
        if (link) link.classList.add('is-active');
      });
    }, { rootMargin: '-42% 0px -52% 0px', threshold: 0 });

    sections.forEach((_, section) => observer.observe(section));
  }

  /* ---------------------------------------------------------------- 事件 */

  function bindActions() {
    const filters = $('#filters');
    if (filters) {
      filters.addEventListener('click', (event) => {
        const button = event.target.closest('.filter');
        if (!button) return;
        applyFilter(button.dataset.group);
      });
    }

    const quoteNext = $('#quote-next');
    if (quoteNext) {
      quoteNext.addEventListener('click', () => {
        const quotes = state.data?.quotes;
        if (!Array.isArray(quotes) || !quotes.length) return;
        state.quoteIndex = (state.quoteIndex + 1) % quotes.length;
        updateQuote(quotes);
      });
    }

    const wishReset = $('#wish-reset');
    if (wishReset) {
      wishReset.addEventListener('click', () => {
        if (!state.wishes) return;
        state.wishState = {};
        writeStore(STORAGE_KEYS.wishes, {});
        $$('#wish-list input[type="checkbox"]').forEach((input) => {
          input.checked = input.dataset.default === '1';
        });
        updateWishProgress();
      });
    }

    const form = $('#message-form');
    if (form) {
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const fromInput = $('#message-from');
        const textInput = $('#message-text');
        const from = fromInput.value.trim();
        const text = textInput.value.trim();

        if (!from || !text) {
          setStatus('署名和内容都要填一下。');
          return;
        }

        const now = new Date();
        state.localMessages.unshift({
          id: `local-${now.getTime()}`,
          from: from.slice(0, 12),
          text: text.slice(0, 200),
          date: fmtIso(now)
        });

        const saved = writeStore(STORAGE_KEYS.messages, state.localMessages);
        renderMessages();
        form.reset();
        setStatus(saved ? '已保存在本机浏览器，只有你能看到。' : '浏览器不允许本地存储，这条留言没有保存成功。');
        textInput.focus();
      });
    }

    setupLightbox();
  }

  /* ---------------------------------------------------------------- 错误 */

  function showDataError() {
    const box = $('#data-state');
    if (box) {
      box.hidden = false;
      box.textContent = '数据加载失败：读不到 data.json。请用本地服务器打开页面（例如在项目目录运行 python3 -m http.server 8000），不要直接双击 index.html；同时确认 data.json 与 index.html 在同一目录。';
    }
    revealAll();
  }

  /* ---------------------------------------------------------------- 启动 */

  async function init() {
    bindActions();

    try {
      const response = await fetch('data.json', { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      state.data = data;

      renderSite(data.site || {});
      renderPeople(Array.isArray(data.people) ? data.people : []);
      renderDates(Array.isArray(data.anniversaries) ? data.anniversaries : []);
      renderTimeline(Array.isArray(data.timeline) ? data.timeline : []);
      renderGallery(Array.isArray(data.photos) ? data.photos : []);
      renderQuote(data.quotes);

      const storedMessages = readStore(STORAGE_KEYS.messages, []);
      state.localMessages = Array.isArray(storedMessages) ? storedMessages : [];
      state.serverMessages = Array.isArray(data.messages) ? data.messages : [];
      renderMessages();
      renderWishes(Array.isArray(data.wishes) ? data.wishes : []);

      if (data.site?.since) startClock(data.site.since);
    } catch (error) {
      console.error('[love-info] 数据加载失败：', error);
      showDataError();
    }

    setupReveal();
    setupNavSpy();
  }

  init();
})();
