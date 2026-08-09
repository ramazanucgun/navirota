// frontend/public/js/map.js
//
// SVG kat planı çizimi: mağaza polygonları, koridor node'ları, başlangıç
// noktası pulse animasyonu, kampanya rozetleri, animasyonlu rota çizgisi
// ve hareket eden yön oku. Zoom/Pan pointer-events ile desteklenir.

const SmartWayMap = (() => {
  const svg = document.getElementById('mapSvg');
  let currentViewBox = { x: 0, y: 0, w: 1000, h: 600 };
  let baseViewBox = { ...currentViewBox };
  let onStoreClick = null;
  let arrowAnimFrame = null;

  function setViewBox(vb) {
    currentViewBox = vb;
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
  }

  function setBaseViewBox(w, h) {
    baseViewBox = { x: 0, y: 0, w, h };
    setViewBox(baseViewBox);
  }

  function zoom(factor) {
    const cx = currentViewBox.x + currentViewBox.w / 2;
    const cy = currentViewBox.y + currentViewBox.h / 2;
    const newW = Math.min(baseViewBox.w * 2.2, Math.max(baseViewBox.w * 0.4, currentViewBox.w * factor));
    const newH = newW * (baseViewBox.h / baseViewBox.w);
    setViewBox({ x: cx - newW / 2, y: cy - newH / 2, w: newW, h: newH });
  }

  function resetZoom() { setViewBox({ ...baseViewBox }); }

  function el(tag, attrs = {}) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  /**
   * Kat planını çizer.
   * @param {Object} opts { viewBox:[x,y,w,h], stores:[], nodes:[], edges:[], startNodeId }
   */
  function render(opts) {
    svg.innerHTML = '';
    const [vx, vy, vw, vh] = opts.viewBox || [0, 0, 1000, 600];
    setBaseViewBox(vw, vh);
    setViewBox({ x: vx, y: vy, w: vw, h: vh });

    // Arka plan referans görseli (AVM yönetiminin yüklediği gerçek mimari
    // kat planı) — varsa, koridor/mağaza katmanlarının ALTINDA, soluk
    // opaklıkla gösterilir. Yalnızca görsel referanstır, rota hesaplamasını
    // etkilemez (o tamamen node/edge koordinatlarına dayanır).
    if (opts.svgContent) {
      const bgLayer = el('g', { class: 'bg-layer', opacity: '0.35' });
      // Ham SVG içeriğini <g> içine gömüyoruz; kullanıcı yüklediği dosyanın
      // kendi viewBox'ı farklıysa <svg> öğesini <g>'ye çevirmemiz gerekir.
      const wrapper = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      wrapper.innerHTML = opts.svgContent.replace(/<\/?svg[^>]*>/g, '');
      bgLayer.appendChild(wrapper);
      svg.appendChild(bgLayer);
    }

    const nodesById = new Map((opts.nodes || []).map((n) => [n.id, n]));

    // Koridor kenarları (yalnızca walk tipindekiler, hafif çizgi)
    const edgeLayer = el('g', { class: 'edge-layer' });
    for (const e of opts.edges || []) {
      const a = nodesById.get(e.fromId), b = nodesById.get(e.toId);
      if (!a || !b || a.floorId !== b.floorId) continue;
      edgeLayer.appendChild(el('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: 'mp-corridor-edge',
      }));
    }
    svg.appendChild(edgeLayer);

    // Mağaza polygonları
    const storeLayer = el('g', { class: 'store-layer' });
    for (const s of opts.stores || []) {
      const poly = s.polygon && s.polygon.length ? s.polygon : autoPolygonFromEntrance(s, nodesById);
      if (!poly) continue;
      const points = poly.map((p) => p.join(',')).join(' ');
      const shape = el('polygon', { points, class: 'mp-store', 'data-store-id': s.id });
      shape.addEventListener('click', () => onStoreClick && onStoreClick(s.id));
      storeLayer.appendChild(shape);

      const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
      const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
      const label = el('text', { x: cx, y: cy + 4, class: 'mp-store-label', 'text-anchor': 'middle' });
      label.textContent = s.name;
      label.style.cursor = 'pointer';
      label.addEventListener('click', () => onStoreClick && onStoreClick(s.id));
      storeLayer.appendChild(label);

      if (s.active_campaigns && s.active_campaigns.length) {
        const badge = s.active_campaigns[0];
        const bx = cx + 30, by = cy - 22;
        storeLayer.appendChild(el('circle', { cx: bx, cy: by, r: 11, class: 'mp-badge-ring' }));
        const bt = el('text', { x: bx, y: by + 3, class: 'mp-badge-text', 'text-anchor': 'middle' });
        bt.textContent = badgeGlyph(badge.badge);
        storeLayer.appendChild(bt);
      }
    }
    svg.appendChild(storeLayer);

    // Asansör/merdiven ikonları
    const iconLayer = el('g', { class: 'icon-layer' });
    for (const n of opts.nodes || []) {
      if (n.type === 'elevator') {
        const t = el('text', { x: n.x, y: n.y, class: 'mp-elevator-icon', 'text-anchor': 'middle' });
        t.textContent = '⬍';
        iconLayer.appendChild(t);
      }
    }
    svg.appendChild(iconLayer);

    // Başlangıç noktası (pulse)
    if (opts.startNodeId && nodesById.get(opts.startNodeId)) {
      const start = nodesById.get(opts.startNodeId);
      const startLayer = el('g', { class: 'start-layer' });
      startLayer.appendChild(el('circle', { cx: start.x, cy: start.y, r: 8, class: 'mp-start-pulse' }));
      startLayer.appendChild(el('circle', { cx: start.x, cy: start.y, r: 7, class: 'mp-start-dot' }));
      svg.appendChild(startLayer);
    }
  }

  function badgeGlyph(badge) {
    if (badge === 'indirim') return '%';
    if (badge === 'yeni') return '✦';
    if (badge === 'hediye') return '🎁';
    return '•';
  }

  // Mağaza polygon'u tanımlı değilse, giriş node'u etrafında basit bir kutu üret (demo/fallback)
  function autoPolygonFromEntrance(store, nodesById) {
    const node = nodesById.get(store.entrance_node_id);
    if (!node) return null;
    const w = 70, h = 50;
    return [
      [node.x - w/2, node.y - h - 10], [node.x + w/2, node.y - h - 10],
      [node.x + w/2, node.y - 10], [node.x - w/2, node.y - 10],
    ];
  }

  /**
   * Verilen node id path'ini animasyonlu bir çizgi olarak çizer ve
   * hareket eden bir yön oku ekler (yalnızca aktif kattaki segment).
   */
  function drawRoute(pathNodes) {
    cancelAnimationFrame(arrowAnimFrame);
    const old = svg.querySelector('.route-layer');
    if (old) old.remove();
    if (!pathNodes || pathNodes.length < 2) return;

    const routeLayer = el('g', { class: 'route-layer' });
    const d = pathNodes.map((n, i) => `${i === 0 ? 'M' : 'L'} ${n.x} ${n.y}`).join(' ');
    const path = el('path', { d, class: 'mp-route-path' });
    routeLayer.appendChild(path);
    svg.appendChild(routeLayer);

    // Hareket eden ok
    const arrow = el('polygon', { points: '0,-6 10,0 0,6', class: 'mp-arrow' });
    routeLayer.appendChild(arrow);

    const total = path.getTotalLength();
    let t = 0;
    function step() {
      t = (t + 1.6) % total;
      const p1 = path.getPointAtLength(t);
      const p2 = path.getPointAtLength(Math.min(t + 1, total));
      const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
      arrow.setAttribute('transform', `translate(${p1.x},${p1.y}) rotate(${angle})`);
      arrowAnimFrame = requestAnimationFrame(step);
    }
    step();
  }

  function clearRoute() {
    cancelAnimationFrame(arrowAnimFrame);
    const old = svg.querySelector('.route-layer');
    if (old) old.remove();
  }

  // PDR (donanımsız yaklaşık konum) noktası — start-dot'tan ayrı, sürekli güncellenir.
  function updatePdrDot(x, y) {
    let dot = svg.querySelector('.mp-pdr-dot');
    if (!dot) {
      dot = el('circle', { r: 6, class: 'mp-pdr-dot', fill: '#4C7A5E', stroke: '#fff', 'stroke-width': 2 });
      svg.appendChild(dot);
    }
    dot.setAttribute('cx', x);
    dot.setAttribute('cy', y);
  }
  function clearPdrDot() {
    const dot = svg.querySelector('.mp-pdr-dot');
    if (dot) dot.remove();
  }

  // --- Pan (sürükleme) desteği ---
  let dragging = false, lastX = 0, lastY = 0;
  svg.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; svg.setPointerCapture(e.pointerId); });
  svg.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const scale = currentViewBox.w / svg.clientWidth;
    currentViewBox.x -= (e.clientX - lastX) * scale;
    currentViewBox.y -= (e.clientY - lastY) * scale;
    lastX = e.clientX; lastY = e.clientY;
    setViewBox(currentViewBox);
  });
  svg.addEventListener('pointerup', () => dragging = false);
  svg.addEventListener('pointerleave', () => dragging = false);

  return {
    render,
    drawRoute,
    clearRoute,
    updatePdrDot,
    clearPdrDot,
    zoomIn: () => zoom(0.8),
    zoomOut: () => zoom(1.25),
    resetZoom,
    onStoreClick: (fn) => { onStoreClick = fn; },
  };
})();

window.SmartWayMap = SmartWayMap;
