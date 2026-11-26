(() => {
  // ── Session & analytics ────────────────────────────────────────────────────
  const SESSION_ID = (() => {
    try {
      let id = sessionStorage.getItem('sc_session');
      if (!id) {
        id = crypto.randomUUID();
        sessionStorage.setItem('sc_session', id);
      }
      return id;
    } catch (_) {
      return crypto.randomUUID();
    }
  })();

  function postEvent(type, data = {}) {
    try {
      fetch('/api/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: SESSION_ID, type, data }),
        keepalive: true
      }).catch(() => {});
    } catch (_) {}
  }

  // Send landed immediately
  postEvent('landed');

  // Throttle fog-progress to 25 / 50 / 70 / 100 milestones
  const fogMilestones = new Set();

  document.addEventListener('fog-progress', (e) => {
    const pct = e.detail?.percent ?? 0;
    for (const ms of [25, 50, 70, 100]) {
      if (pct >= ms && !fogMilestones.has(ms)) {
        fogMilestones.add(ms);
        postEvent('fog_progress', { percent: ms });
      }
    }
  });

  document.addEventListener('node-open', (e) => {
    postEvent('node_open', { id: e.detail?.id });
  });

  document.addEventListener('page-complete', () => {
    postEvent('page_complete');
  });

  // ── Form setup ─────────────────────────────────────────────────────────────
  // Idempotent: marks the form with data-setup on first call and returns early
  // on any subsequent call, so multiple invocations from setupScene /
  // applyReducedMotionView never attach duplicate listeners.
  function setupConnectForm() {
    const form       = document.getElementById('connect-form');
    const errorEl    = document.getElementById('connect-error');
    const successEl  = document.getElementById('connect-success');

    if (!form) return;
    if (form.dataset.setup === '1') return; // already wired — do nothing
    form.dataset.setup = '1';

    // Persist the flag in sessionStorage so it survives page refreshes
    // within the same tab session and fires at most once per session.
    const STARTED_KEY = 'sc_form_started';
    let startedInMemory = false; // fallback if sessionStorage is unavailable

    // Fire form_started on first focus of any field — at most once per session
    form.querySelectorAll('input, textarea').forEach(el => {
      el.addEventListener('focus', () => {
        try {
          if (sessionStorage.getItem(STARTED_KEY)) return;
          sessionStorage.setItem(STARTED_KEY, '1');
        } catch (_) {
          // sessionStorage unavailable — use in-memory flag
          if (startedInMemory) return;
          startedInMemory = true;
        }
        postEvent('form_started');
      }, { once: false });
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name    = form.querySelector('#cf-name').value.trim();
      const email   = form.querySelector('#cf-email').value.trim();
      const message = form.querySelector('#cf-message').value.trim();
      const website = form.querySelector('#cf-website').value;
      const submit  = form.querySelector('.cf-submit');

      // Clear any previous feedback before each attempt
      hideError();
      successEl.hidden = true;

      // Client-side validation for a helpful first response
      if (!name || name.length > 80) {
        showError('Please enter your name (1–80 characters).'); return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        showError('Please enter a valid email address.'); return;
      }
      if (!message || message.length > 1000) {
        showError('Please write a message (1–1000 characters).'); return;
      }

      // Disable while request is in flight to prevent double submits
      submit.disabled = true;

      try {
        const res = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, email, message, sessionId: SESSION_ID, website })
        });
        const json = await res.json().catch(() => ({ ok: false, error: 'Unexpected response.' }));

        if (res.status === 429) {
          showError('Please wait a moment and try again.');
          submit.disabled = false;
          return;
        }

        if (json.ok) {
          postEvent('form_submitted');
          form.hidden = true;
          successEl.hidden = false;
        } else {
          showError(json.error || 'Something went wrong. Please try again.');
          submit.disabled = false;
        }
      } catch (_) {
        showError('Could not reach the server. Please check your connection and try again.');
        submit.disabled = false;
      }
    });

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }
    function hideError() {
      errorEl.hidden = true;
      errorEl.textContent = '';
    }
  }

  // ── Visual layout constants ────────────────────────────────────────────────
  const DESKTOP_LAYOUT = {
    roots:        { x: 0.16, y: 0.48 },
    gaps:         { x: 0.22, y: 0.18 },
    wholepicture: { x: 0.45, y: 0.34 },
    teams:        { x: 0.41, y: 0.56 },
    demand:       { x: 0.64, y: 0.17 },
    sharing:      { x: 0.69, y: 0.50 },
    today:        { x: 0.84, y: 0.31 }
  };

  const MOBILE_LAYOUT = {
    gaps:         { x: 0.25, y: 0.12 },
    demand:       { x: 0.74, y: 0.16 },
    wholepicture: { x: 0.46, y: 0.27 },
    sharing:      { x: 0.76, y: 0.36 },
    roots:        { x: 0.23, y: 0.41 },
    teams:        { x: 0.56, y: 0.49 },
    today:        { x: 0.34, y: 0.57 }
  };

  const CONNECTIONS = [
    ['gaps', 'wholepicture'],
    ['roots', 'teams'],
    ['roots', 'wholepicture'],
    ['wholepicture', 'demand'],
    ['wholepicture', 'teams'],
    ['wholepicture', 'sharing'],
    ['demand', 'today'],
    ['teams', 'today'],
    ['sharing', 'today']
  ];

  const GRID_COLS = 112;
  const GRID_ROWS = 68;
  const COMPLETION_THRESHOLD = 70;
  const NODE_REVEAL_THRESHOLD = 0.42;

  const stage = document.getElementById('stage');
  const fogCanvas = document.getElementById('fog-canvas');
  const fogCtx = fogCanvas.getContext('2d');
  const svg = document.getElementById('constellation');
  const nodesLayer = document.getElementById('nodes-layer');
  const openingEl = document.getElementById('opening');
  const openingQuoteEl = document.getElementById('opening-quote');
  const endingEl = document.getElementById('ending');
  const endingQuoteEl = document.getElementById('ending-quote');
  const endingIdentityEl = document.getElementById('ending-identity');
  const endingHeadlineEl = document.getElementById('ending-headline');
  const endingLinkEl = document.getElementById('ending-link');
  const cardEl = document.getElementById('node-card');
  const cardCloseBtn = document.getElementById('card-close');
  const cardTitleEl = document.getElementById('card-title');
  const cardTextEl = document.getElementById('card-text');
  const progressFillEl = document.getElementById('progress-fill');
  const progressValueEl = document.getElementById('progress-value');

  const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  const state = {
    facts: null,
    width: 0,
    height: 0,
    dpr: 1,
    nodes: [],
    edges: [],
    activeEdge: null,
    activeNodeId: null,
    cardPinned: false,
    hoverCloseTimer: null,
    hasWiped: false,
    isComplete: false,
    lastDispatchedPercent: -1,
    fogOpacity: 1,
    pointer: {
      active: false,
      isDown: false,
      justPressed: false,
      x: 0,
      y: 0,
      smoothX: 0,
      smoothY: 0,
      lastBrushX: 0,
      lastBrushY: 0,
      hasLast: false
    }
  };

  // Fog clearance grid: `cleared` gently drifts back toward a floor of `everCleared`
  const clearedGrid = new Float32Array(GRID_COLS * GRID_ROWS);
  const peakGrid = new Float32Array(GRID_COLS * GRID_ROWS);

  // Offscreen canvases for procedural fog noise and smooth bilinear mask
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = GRID_COLS;
  maskCanvas.height = GRID_ROWS;
  const maskCtx = maskCanvas.getContext('2d');
  const maskImageData = maskCtx.createImageData(GRID_COLS, GRID_ROWS);

  const fogBufferCanvas = document.createElement('canvas');
  const fogBufferCtx = fogBufferCanvas.getContext('2d');

  const noiseTileA = createNoiseTile(256, 17);
  const noiseTileB = createNoiseTile(256, 73);

  function hash2D(ix, iy, seed) {
    const n = Math.sin(ix * 127.1 + iy * 311.7 + seed * 74.7) * 43758.5453123;
    return n - Math.floor(n);
  }

  function smoothNoise(x, y, period, seed) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const ix0 = ((x0 % period) + period) % period;
    const iy0 = ((y0 % period) + period) % period;
    const ix1 = (ix0 + 1) % period;
    const iy1 = (iy0 + 1) % period;

    const a = hash2D(ix0, iy0, seed);
    const b = hash2D(ix1, iy0, seed);
    const c = hash2D(ix0, iy1, seed);
    const d = hash2D(ix1, iy1, seed);

    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  }

  function createNoiseTile(size, seed) {
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const ctx = tile.getContext('2d');
    const img = ctx.createImageData(size, size);
    const data = img.data;

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const nx = x / size;
        const ny = y / size;

        const n1 = smoothNoise(nx * 4, ny * 4, 4, seed);
        const n2 = smoothNoise(nx * 8, ny * 8, 8, seed + 11);
        const n3 = smoothNoise(nx * 16, ny * 16, 16, seed + 29);
        const value = n1 * 0.56 + n2 * 0.3 + n3 * 0.14;

        const idx = (y * size + x) * 4;
        data[idx] = Math.round(12 + value * 32);
        data[idx + 1] = Math.round(19 + value * 42);
        data[idx + 2] = Math.round(33 + value * 56);
        data[idx + 3] = Math.round(115 + value * 115);
      }
    }

    ctx.putImageData(img, 0, 0);
    return tile;
  }

  function getLayout() {
    return state.width < 640 ? MOBILE_LAYOUT : DESKTOP_LAYOUT;
  }

  function getNodeCoords(nodeId) {
    const layout = getLayout();
    const pos = layout[nodeId] || { x: 0.5, y: 0.5 };
    return {
      x: pos.x * state.width,
      y: pos.y * state.height
    };
  }

  function createSvgLine() {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.classList.add('constellation-line');
    line.setAttribute('x1', '0');
    line.setAttribute('y1', '0');
    line.setAttribute('x2', '0');
    line.setAttribute('y2', '0');
    line.style.opacity = '0';
    svg.appendChild(line);
    return line;
  }

  function setupScene(facts) {
    state.facts = facts;

    const firstSentence = (facts.quotes[0] || '').split('.')[0];
    openingQuoteEl.textContent = firstSentence ? `${firstSentence}...` : '';

    endingQuoteEl.textContent = facts.quotes[2] || '';
    endingIdentityEl.textContent = facts.name || '';
    endingHeadlineEl.textContent = facts.headline || '';
    endingLinkEl.href = facts.profileUrl || '#';

    state.nodes = facts.nodes.map((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'node-btn';
      btn.dataset.nodeId = item.id;
      btn.tabIndex = -1;
      btn.setAttribute('aria-hidden', 'true');
      btn.setAttribute('aria-label', item.title);

      const dot = document.createElement('span');
      dot.className = 'node-dot';
      dot.setAttribute('aria-hidden', 'true');

      const label = document.createElement('span');
      label.className = 'node-label';
      label.textContent = item.title;

      btn.appendChild(dot);
      btn.appendChild(label);
      nodesLayer.appendChild(btn);

      attachNodeListeners(btn, item);

      return {
        ...item,
        el: btn,
        revealed: false
      };
    });

    state.edges = CONNECTIONS.map(([fromId, toId]) => ({
      fromId,
      toId,
      el: createSvgLine(),
      status: 'hidden', // hidden | queued | drawing | done
      progress: 0
    }));

    handleResize();

    if (reducedMotionQuery.matches) {
      applyReducedMotionView();
      return;
    }

    requestAnimationFrame(() => {
      openingEl.classList.add('is-visible');
    });

    requestAnimationFrame(tick);

    // Wire the connect form once the scene is ready
    setupConnectForm();
  }

  function applyReducedMotionView() {
    state.nodes.forEach((node) => {
      revealNode(node);
    });
    state.edges.forEach((edge) => {
      edge.status = 'done';
      edge.progress = 1;
      edge.el.style.opacity = '1';
    });
    positionNodesAndEdges();
    state.isComplete = true;
    state.fogOpacity = 0;
    endingEl.classList.add('is-visible');
    endingEl.setAttribute('aria-hidden', 'false');
    dispatchAnalytics('fog-progress', { percent: 100 });
    dispatchAnalytics('page-complete', { percent: 100 });
    setupConnectForm();
  }

  function attachNodeListeners(btn, item) {
    btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse' && btn.classList.contains('is-revealed')) {
        clearTimeout(state.hoverCloseTimer);
        openCard(item, false);
      }
    });

    btn.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !state.cardPinned) {
        scheduleHoverClose();
      }
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!btn.classList.contains('is-revealed')) return;
      if (state.activeNodeId === item.id && state.cardPinned) {
        closeCard();
      } else {
        openCard(item, true);
      }
    });

    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && btn.classList.contains('is-revealed')) {
        e.preventDefault();
        openCard(item, true);
      }
    });
  }

  function scheduleHoverClose() {
    clearTimeout(state.hoverCloseTimer);
    state.hoverCloseTimer = setTimeout(() => {
      if (!state.cardPinned) {
        closeCard();
      }
    }, 240);
  }

  function openCard(node, pinned) {
    clearTimeout(state.hoverCloseTimer);
    const isNewOpen = state.activeNodeId !== node.id;

    state.activeNodeId = node.id;
    state.cardPinned = pinned;

    state.nodes.forEach((n) => {
      n.el.classList.toggle('is-active', n.id === node.id);
    });

    cardTitleEl.textContent = node.title;
    cardTextEl.textContent = node.text;
    cardEl.hidden = false;
    cardEl.setAttribute('aria-hidden', 'false');
    positionCard(node.id);

    requestAnimationFrame(() => {
      cardEl.classList.add('is-open');
    });

    // Dim the ending card while a node card is open
    endingEl.classList.add('is-dimmed');

    if (isNewOpen) {
      dispatchAnalytics('node-open', { id: node.id });
    }
  }

  function closeCard() {
    clearTimeout(state.hoverCloseTimer);
    const prevNodeId = state.activeNodeId;
    state.activeNodeId = null;
    state.cardPinned = false;

    state.nodes.forEach((n) => n.el.classList.remove('is-active'));
    cardEl.classList.remove('is-open');
    cardEl.setAttribute('aria-hidden', 'true');

    // Restore ending card
    endingEl.classList.remove('is-dimmed');

    setTimeout(() => {
      if (!state.activeNodeId) {
        cardEl.hidden = true;
      }
    }, 450);

    if (prevNodeId && document.activeElement === cardCloseBtn) {
      const btn = state.nodes.find((n) => n.id === prevNodeId)?.el;
      if (btn) btn.focus();
    }
  }

  function positionCard(nodeId) {
    if (state.width < 640) return;

    const coords = getNodeCoords(nodeId);
    const cardWidth = Math.min(368, state.width - 32);
    const margin = 22;
    const offset = 28;

    let left = coords.x + offset;
    if (left + cardWidth > state.width - margin) {
      left = coords.x - cardWidth - offset;
    }
    left = Math.max(margin, Math.min(left, state.width - cardWidth - margin));

    const estimatedHeight = cardEl.offsetHeight || 190;
    let top = coords.y - estimatedHeight * 0.45;
    top = Math.max(margin, Math.min(top, state.height - estimatedHeight - margin));

    cardEl.style.left = `${Math.round(left)}px`;
    cardEl.style.top = `${Math.round(top)}px`;
  }

  function handleResize() {
    const rect = stage.getBoundingClientRect();
    state.width = Math.max(360, Math.round(rect.width));
    state.height = Math.max(320, Math.round(rect.height));
    state.dpr = Math.min(window.devicePixelRatio || 1, 2);

    fogCanvas.width = Math.round(state.width * state.dpr);
    fogCanvas.height = Math.round(state.height * state.dpr);
    fogCtx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    // Fog compositing buffer at half CSS resolution for silky performance
    fogBufferCanvas.width = Math.max(320, Math.round(state.width * 0.5));
    fogBufferCanvas.height = Math.max(200, Math.round(state.height * 0.5));

    svg.setAttribute('viewBox', `0 0 ${state.width} ${state.height}`);
    positionNodesAndEdges();

    if (state.activeNodeId) {
      positionCard(state.activeNodeId);
    }
  }

  function positionNodesAndEdges() {
    state.nodes.forEach((node) => {
      const { x, y } = getNodeCoords(node.id);
      node.el.style.left = `${x}px`;
      node.el.style.top = `${y}px`;
    });

    state.edges.forEach((edge) => {
      const a = getNodeCoords(edge.fromId);
      const b = getNodeCoords(edge.toId);
      const t = easeOutCubic(edge.progress);
      edge.el.setAttribute('x1', String(a.x));
      edge.el.setAttribute('y1', String(a.y));
      edge.el.setAttribute('x2', String(a.x + (b.x - a.x) * t));
      edge.el.setAttribute('y2', String(a.y + (b.y - a.y) * t));
    });
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  }

  function paintBrushSegment(x0, y0, x1, y1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dist = Math.hypot(dx, dy);
    const radiusPx = Math.max(66, Math.min(state.width, state.height) * 0.13);
    const step = Math.max(10, radiusPx * 0.25);
    const steps = Math.max(1, Math.ceil(dist / step));

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      stampBrush(x0 + dx * t, y0 + dy * t, radiusPx);
    }
  }

  function stampBrush(px, py, radiusPx) {
    const gx = (px / state.width) * GRID_COLS;
    const gy = (py / state.height) * GRID_ROWS;
    const rx = (radiusPx / state.width) * GRID_COLS;
    const ry = (radiusPx / state.height) * GRID_ROWS;

    const minX = Math.max(0, Math.floor(gx - rx));
    const maxX = Math.min(GRID_COLS - 1, Math.ceil(gx + rx));
    const minY = Math.max(0, Math.floor(gy - ry));
    const maxY = Math.min(GRID_ROWS - 1, Math.ceil(gy + ry));

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const nx = (x - gx) / rx;
        const ny = (y - gy) / ry;
        const d2 = nx * nx + ny * ny;
        if (d2 >= 1) continue;

        const d = Math.sqrt(d2);
        // Smooth cosine-feathered brush falloff
        const strength = 0.5 * (1 + Math.cos(Math.PI * d));
        const idx = y * GRID_COLS + x;
        const nextVal = Math.min(1, clearedGrid[idx] + strength * 0.55);
        clearedGrid[idx] = nextVal;
        if (nextVal > peakGrid[idx]) {
          peakGrid[idx] = nextVal;
        }
      }
    }
  }

  function sampleClarityAt(px, py) {
    const gx = Math.max(0, Math.min(GRID_COLS - 1, Math.round((px / state.width) * (GRID_COLS - 1))));
    const gy = Math.max(0, Math.min(GRID_ROWS - 1, Math.round((py / state.height) * (GRID_ROWS - 1))));
    return clearedGrid[gy * GRID_COLS + gx];
  }

  function revealNode(node) {
    if (node.revealed) return;
    node.revealed = true;
    node.el.classList.add('is-revealed');
    node.el.tabIndex = 0;
    node.el.setAttribute('aria-hidden', 'false');

    state.edges.forEach((edge) => {
      if (edge.status !== 'hidden') return;
      const fromNode = state.nodes.find((n) => n.id === edge.fromId);
      const toNode = state.nodes.find((n) => n.id === edge.toId);
      if (fromNode?.revealed && toNode?.revealed) {
        edge.status = 'queued';
      }
    });
  }

  function updateEdgeAnimations(dt) {
    if (!state.activeEdge) {
      state.activeEdge = state.edges.find((edge) => edge.status === 'queued') || null;
      if (state.activeEdge) {
        state.activeEdge.status = 'drawing';
        state.activeEdge.el.style.opacity = '1';
      }
    }

    if (state.activeEdge) {
      state.activeEdge.progress = Math.min(1, state.activeEdge.progress + dt * 1.45);
      positionNodesAndEdges();
      if (state.activeEdge.progress >= 1) {
        state.activeEdge.status = 'done';
        state.activeEdge = null;
      }
    }
  }

  function updateMaskAndProgress(dt) {
    let sum = 0;
    const data = maskImageData.data;

    for (let i = 0; i < clearedGrid.length; i++) {
      // Cleared areas drift back faintly toward 76% of peak clarity, never fully closing
      const floor = peakGrid[i] * 0.76;
      if (clearedGrid[i] > floor) {
        clearedGrid[i] = Math.max(floor, clearedGrid[i] - dt * 0.045);
      }

      const val = state.isComplete ? 1 : clearedGrid[i];
      sum += val;

      const p = i * 4;
      data[p] = 255;
      data[p + 1] = 255;
      data[p + 2] = 255;
      data[p + 3] = Math.round(val * 255);
    }

    maskCtx.putImageData(maskImageData, 0, 0);

    const rawPercent = Math.round((sum / clearedGrid.length) * 100);
    const displayPercent = state.isComplete ? 100 : rawPercent;

    progressFillEl.style.width = `${displayPercent}%`;
    progressValueEl.textContent = `${displayPercent}%`;

    if (displayPercent !== state.lastDispatchedPercent) {
      state.lastDispatchedPercent = displayPercent;
      dispatchAnalytics('fog-progress', { percent: displayPercent });
    }

    // Check node proximity reveals
    let revealedCount = 0;
    state.nodes.forEach((node) => {
      if (!node.revealed) {
        const { x, y } = getNodeCoords(node.id);
        if (sampleClarityAt(x, y) >= NODE_REVEAL_THRESHOLD) {
          revealNode(node);
        }
      }
      if (node.revealed) revealedCount++;
    });

    if (!state.hasWiped && rawPercent >= 6) {
      state.hasWiped = true;
      openingEl.classList.add('is-faded');
    }

    if (!state.isComplete && (rawPercent >= COMPLETION_THRESHOLD || revealedCount === state.nodes.length)) {
      triggerCompletion();
    }
  }

  function triggerCompletion() {
    state.isComplete = true;
    openingEl.classList.add('is-faded');

    state.nodes.forEach((node) => revealNode(node));

    endingEl.classList.add('is-visible');
    endingEl.setAttribute('aria-hidden', 'false');

    dispatchAnalytics('page-complete', {
      percent: 100,
      revealedCount: state.nodes.length
    });
  }

  function renderFog(nowSec) {
    const bw = fogBufferCanvas.width;
    const bh = fogBufferCanvas.height;

    if (state.isComplete) {
      state.fogOpacity = Math.max(0, state.fogOpacity - 0.012);
    }

    fogCtx.clearRect(0, 0, state.width, state.height);
    if (state.fogOpacity <= 0.002) return;

    fogBufferCtx.globalCompositeOperation = 'source-over';
    fogBufferCtx.clearRect(0, 0, bw, bh);

    // Base deep-slate mist veil
    fogBufferCtx.fillStyle = 'rgba(7, 11, 21, 0.94)';
    fogBufferCtx.fillRect(0, 0, bw, bh);

    // Drifting noise layer A
    drawWrappedLayer(noiseTileA, nowSec * 9, nowSec * 4, 1.85, 0.72);
    // Counter-drifting noise layer B
    drawWrappedLayer(noiseTileB, -nowSec * 6.5, nowSec * 5.2, 2.35, 0.56);

    // Carve out cleared regions with smooth bilinear interpolation
    fogBufferCtx.globalCompositeOperation = 'destination-out';
    fogBufferCtx.imageSmoothingEnabled = true;
    fogBufferCtx.drawImage(maskCanvas, 0, 0, bw, bh);

    fogCtx.save();
    fogCtx.globalAlpha = state.fogOpacity;
    fogCtx.imageSmoothingEnabled = true;
    fogCtx.drawImage(fogBufferCanvas, 0, 0, state.width, state.height);
    fogCtx.restore();
  }

  function drawWrappedLayer(tile, offsetX, offsetY, scale, alpha) {
    const bw = fogBufferCanvas.width;
    const bh = fogBufferCanvas.height;
    const tileW = tile.width * scale;
    const tileH = tile.height * scale;
    const startX = ((offsetX % tileW) + tileW) % tileW - tileW;
    const startY = ((offsetY % tileH) + tileH) % tileH - tileH;

    fogBufferCtx.save();
    fogBufferCtx.globalAlpha = alpha;
    for (let y = startY; y < bh; y += tileH) {
      for (let x = startX; x < bw; x += tileW) {
        fogBufferCtx.drawImage(tile, x, y, tileW, tileH);
      }
    }
    fogBufferCtx.restore();
  }

  function dispatchAnalytics(name, detail) {
    document.dispatchEvent(new CustomEvent(name, { bubbles: true, detail }));
  }

  let lastTime = performance.now();

  function tick(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    if (state.pointer.active && !state.isComplete) {
      // Smooth easing on brush cursor
      const ease = 1 - Math.exp(-dt * 18);
      state.pointer.smoothX += (state.pointer.x - state.pointer.smoothX) * ease;
      state.pointer.smoothY += (state.pointer.y - state.pointer.smoothY) * ease;

      if (!state.pointer.hasLast) {
        state.pointer.lastBrushX = state.pointer.smoothX;
        state.pointer.lastBrushY = state.pointer.smoothY;
        state.pointer.hasLast = true;
      }

      const movedDist = Math.hypot(
        state.pointer.smoothX - state.pointer.lastBrushX,
        state.pointer.smoothY - state.pointer.lastBrushY
      );

      if (movedDist > 0.6 || state.pointer.justPressed) {
        paintBrushSegment(
          state.pointer.lastBrushX,
          state.pointer.lastBrushY,
          state.pointer.smoothX,
          state.pointer.smoothY
        );
        state.pointer.lastBrushX = state.pointer.smoothX;
        state.pointer.lastBrushY = state.pointer.smoothY;
        state.pointer.justPressed = false;
      }
    }

    updateMaskAndProgress(dt);
    updateEdgeAnimations(dt);
    renderFog(now / 1000);

    requestAnimationFrame(tick);

    // Wire the connect form once the scene is ready
    setupConnectForm();
  }

  function setPointerPosition(clientX, clientY) {
    const rect = stage.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (!state.pointer.active) {
      state.pointer.smoothX = x;
      state.pointer.smoothY = y;
      state.pointer.lastBrushX = x;
      state.pointer.lastBrushY = y;
      state.pointer.hasLast = true;
    }
    state.pointer.x = x;
    state.pointer.y = y;
    state.pointer.active = true;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.target === fogCanvas) {
      state.pointer.isDown = true;
      state.pointer.justPressed = true;
      setPointerPosition(e.clientX, e.clientY);
      if (state.activeNodeId) {
        closeCard();
      }
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || state.pointer.isDown) {
      setPointerPosition(e.clientX, e.clientY);
    }
  });

  window.addEventListener('pointerup', () => {
    state.pointer.isDown = false;
    state.pointer.active = false;
    state.pointer.hasLast = false;
  });

  window.addEventListener('pointercancel', () => {
    state.pointer.isDown = false;
    state.pointer.active = false;
    state.pointer.hasLast = false;
  });

  stage.addEventListener('pointerleave', () => {
    state.pointer.isDown = false;
    state.pointer.active = false;
    state.pointer.hasLast = false;
  });

  cardEl.addEventListener('pointerenter', () => {
    clearTimeout(state.hoverCloseTimer);
  });

  cardEl.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !state.cardPinned) {
      scheduleHoverClose();
    }
  });

  cardCloseBtn.addEventListener('click', () => {
    closeCard();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.activeNodeId) {
      closeCard();
    }
  });

  window.addEventListener('resize', handleResize);

  fetch('/data/facts.json')
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(setupScene)
    .catch((err) => {
      console.error('Failed to load facts:', err);
    });
})();
