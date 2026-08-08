// frontend/public/js/routeEngine.js
//
// backend/services/routeEngine.js ile birebir aynı A* / Dijkstra mantığının
// bağımlılıksız (framework-agnostic) tarayıcı portu. Offline-first PWA
// senaryosunda, service worker'ın önceden senkronize ettiği node/edge
// verisiyle rota TAMAMEN istemci tarafında hesaplanabilir — internet
// olmasa da QR okutulup rota alınabilir.

class MinHeap {
  constructor() { this._items = []; }
  get size() { return this._items.length; }
  push(item) { this._items.push(item); this._bubbleUp(this._items.length - 1); }
  pop() {
    const top = this._items[0];
    const last = this._items.pop();
    if (this._items.length > 0) { this._items[0] = last; this._bubbleDown(0); }
    return top;
  }
  _bubbleUp(i) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._items[p].priority <= this._items[i].priority) break;
      [this._items[p], this._items[i]] = [this._items[i], this._items[p]];
      i = p;
    }
  }
  _bubbleDown(i) {
    const n = this._items.length;
    while (true) {
      let s = i; const l = 2*i+1, r = 2*i+2;
      if (l < n && this._items[l].priority < this._items[s].priority) s = l;
      if (r < n && this._items[r].priority < this._items[s].priority) s = r;
      if (s === i) break;
      [this._items[s], this._items[i]] = [this._items[i], this._items[s]];
      i = s;
    }
  }
}

class NavGraph {
  constructor(nodes, edges) {
    this.nodesById = new Map(nodes.map((n) => [n.id, n]));
    this.adjacency = new Map();
    for (const n of nodes) this.adjacency.set(n.id, []);
    for (const e of edges) {
      this._addDirected(e.fromId, e.toId, e);
      if (e.bidirectional !== false) this._addDirected(e.toId, e.fromId, e);
    }
  }
  _addDirected(fromId, toId, e) {
    if (!this.adjacency.has(fromId)) this.adjacency.set(fromId, []);
    this.adjacency.get(fromId).push({ to: toId, weight: Number(e.weight ?? 1), edgeType: e.edgeType || 'walk' });
  }
  _euclid(aId, bId) {
    const a = this.nodesById.get(aId), b = this.nodesById.get(bId);
    if (!a || !b || a.floorId !== b.floorId) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  _edgeCost(edge, toNode, preference) {
    let cost = edge.weight;
    if (preference === 'accessible') {
      if (edge.edgeType === 'stairs') return Infinity;
      if (toNode && toNode.accessible === false) return Infinity;
    }
    if (preference === 'least_stairs' && edge.edgeType === 'stairs') cost *= 15;
    if (edge.edgeType === 'elevator') cost += 8;
    if (edge.edgeType === 'escalator') cost += 2;
    return cost;
  }
  findPath(startId, goalId, preference = 'shortest') {
    if (!this.nodesById.has(startId) || !this.nodesById.has(goalId)) return null;
    const dist = new Map([[startId, 0]]);
    const prev = new Map();
    const visited = new Set();
    const heap = new MinHeap();
    heap.push({ id: startId, priority: this._euclid(startId, goalId) });
    while (heap.size > 0) {
      const { id: current } = heap.pop();
      if (visited.has(current)) continue;
      visited.add(current);
      if (current === goalId) break;
      for (const edge of (this.adjacency.get(current) || [])) {
        const toNode = this.nodesById.get(edge.to);
        const cost = this._edgeCost(edge, toNode, preference);
        if (!isFinite(cost)) continue;
        const newDist = dist.get(current) + cost;
        if (newDist < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, newDist);
          prev.set(edge.to, current);
          heap.push({ id: edge.to, priority: newDist + this._euclid(edge.to, goalId) });
        }
      }
    }
    if (!dist.has(goalId)) return null;
    const path = [goalId];
    let cur = goalId;
    while (prev.has(cur)) { cur = prev.get(cur); path.unshift(cur); }
    return { path, distance: dist.get(goalId), floorChanges: this._extractFloorChanges(path) };
  }
  _extractFloorChanges(path) {
    const changes = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = this.nodesById.get(path[i]), b = this.nodesById.get(path[i+1]);
      if (a.floorId !== b.floorId) {
        const edge = (this.adjacency.get(path[i]) || []).find((e) => e.to === path[i+1]);
        changes.push({ fromFloorId: a.floorId, toFloorId: b.floorId, via: edge ? edge.edgeType : 'unknown', atNode: b.id });
      }
    }
    return changes;
  }
  toInstructions(path) {
    const steps = [];
    for (let i = 0; i < path.length; i++) {
      const node = this.nodesById.get(path[i]);
      if (i === 0) { steps.push({ type: 'start', nodeId: node.id, label: 'Başlangıç noktası' }); continue; }
      const prevNode = this.nodesById.get(path[i-1]);
      if (node.floorId !== prevNode.floorId) { steps.push({ type: 'floor_change', nodeId: node.id, label: 'Kat değişimi' }); continue; }
      if (i < path.length - 1) {
        const nextNode = this.nodesById.get(path[i+1]);
        const turn = this._turnDirection(prevNode, node, nextNode);
        if (turn) steps.push({ type: 'turn', nodeId: node.id, label: turn });
      }
    }
    const last = this.nodesById.get(path[path.length - 1]);
    steps.push({ type: 'arrive', nodeId: last.id, label: 'Hedefe ulaştınız' });
    return steps;
  }
  _turnDirection(a, b, c) {
    const v1 = { x: b.x - a.x, y: b.y - a.y };
    const v2 = { x: c.x - b.x, y: c.y - b.y };
    const cross = v1.x * v2.y - v1.y * v2.x;
    const dot = v1.x * v2.x + v1.y * v2.y;
    const angle = Math.atan2(cross, dot) * (180 / Math.PI);
    if (Math.abs(angle) < 20) return null;
    return angle > 0 ? 'Sağa dönün' : 'Sola dönün';
  }
}

window.SmartWayRouteEngine = { NavGraph, MinHeap };
