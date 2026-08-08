// backend/services/routeEngine.js
//
// SmartWay AVM Route Engine
// --------------------------------------------------------------------
// Graf modeli:
//   - Node   : { id, floorId, code, type, x, y, accessible }
//   - Edge   : { fromId, toId, weight, edgeType, bidirectional }
//
// edgeType 'elevator' | 'escalator' | 'stairs' düğümler ARASI kat geçişini
// temsil eder (aynı linked_group'taki farklı katlardaki node'lar arasında).
// Bu sayede rota tek bir grafta kat sınırlarını da aşarak hesaplanır;
// katta değişim olduğunda ön yüz otomatik olarak ilgili floor'a geçer.
//
// Desteklenen tercihler (preference):
//   'shortest'    -> toplam ağırlığı (mesafe) minimize et
//   'accessible'  -> merdiven/yürüyen merdiven kenarlarını hariç tut,
//                    yalnızca accessible=true düğümler ve elevator kullan
//   'least_stairs'-> stairs kenarlarına yüksek ceza ağırlığı ekle
//
// Algoritma: A* (öklid mesafesi heuristik olarak kullanılır; farklı katlar
// arası kenarlarda heuristik 0'a düşürülür çünkü x,y farklı katlarda
// karşılaştırılabilir değildir — bu, A*'ı Dijkstra'ya güvenli şekilde
// indirger ve yine de optimal sonuç garanti eder).
// --------------------------------------------------------------------

class MinHeap {
  constructor() { this._items = []; }
  get size() { return this._items.length; }
  push(item) {
    this._items.push(item);
    this._bubbleUp(this._items.length - 1);
  }
  pop() {
    const top = this._items[0];
    const last = this._items.pop();
    if (this._items.length > 0) {
      this._items[0] = last;
      this._bubbleDown(0);
    }
    return top;
  }
  _bubbleUp(i) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this._items[parent].priority <= this._items[i].priority) break;
      [this._items[parent], this._items[i]] = [this._items[i], this._items[parent]];
      i = parent;
    }
  }
  _bubbleDown(i) {
    const n = this._items.length;
    while (true) {
      let smallest = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this._items[l].priority < this._items[smallest].priority) smallest = l;
      if (r < n && this._items[r].priority < this._items[smallest].priority) smallest = r;
      if (smallest === i) break;
      [this._items[smallest], this._items[i]] = [this._items[i], this._items[smallest]];
      i = smallest;
    }
  }
}

class NavGraph {
  /**
   * @param {Array} nodes  [{id, floorId, code, type, x, y, accessible}]
   * @param {Array} edges  [{fromId, toId, weight, edgeType, bidirectional}]
   */
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
    this.adjacency.get(fromId).push({
      to: toId,
      // Number(): pg NUMERIC alanları sürücüden string dönebilir; toplamada
      // sessiz string-concatenation hatasına düşmemek için burada garanti altına alınır.
      weight: Number(e.weight ?? 1),
      edgeType: e.edgeType || 'walk',
    });
  }

  _euclid(aId, bId) {
    const a = this.nodesById.get(aId);
    const b = this.nodesById.get(bId);
    if (!a || !b || a.floorId !== b.floorId) return 0; // farklı kat -> heuristik güvenilmez, 0 kullan
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  _edgeCost(edge, toNode, preference) {
    let cost = edge.weight;

    if (preference === 'accessible') {
      if (edge.edgeType === 'stairs') return Infinity; // merdiven tamamen kapalı
      if (toNode && toNode.accessible === false) return Infinity;
    }

    if (preference === 'least_stairs' && edge.edgeType === 'stairs') {
      cost *= 15; // güçlü ceza — sadece başka yol yoksa kullanılır
    }

    if (edge.edgeType === 'elevator') cost += 8;   // bekleme/kullanım maliyeti
    if (edge.edgeType === 'escalator') cost += 2;

    return cost;
  }

  /**
   * A* / Dijkstra ile en iyi rotayı bulur.
   * @param {string} startId
   * @param {string} goalId
   * @param {'shortest'|'accessible'|'least_stairs'} preference
   * @returns {{path: string[], distance: number, floorChanges: Array} | null}
   */
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

      const neighbors = this.adjacency.get(current) || [];
      for (const edge of neighbors) {
        const toNode = this.nodesById.get(edge.to);
        const cost = this._edgeCost(edge, toNode, preference);
        if (!isFinite(cost)) continue;

        const newDist = dist.get(current) + cost;
        if (newDist < (dist.get(edge.to) ?? Infinity)) {
          dist.set(edge.to, newDist);
          prev.set(edge.to, current);
          const priority = newDist + this._euclid(edge.to, goalId);
          heap.push({ id: edge.to, priority });
        }
      }
    }

    if (!dist.has(goalId)) return null;

    // Yolu geri sar
    const path = [goalId];
    let cur = goalId;
    while (prev.has(cur)) {
      cur = prev.get(cur);
      path.unshift(cur);
    }

    return {
      path,
      distance: dist.get(goalId),
      floorChanges: this._extractFloorChanges(path),
    };
  }

  /**
   * Rotadaki kat geçişlerini çıkarır: ["Kat 0 -> Kat 1 (Asansör)", ...]
   */
  _extractFloorChanges(path) {
    const changes = [];
    for (let i = 0; i < path.length - 1; i++) {
      const a = this.nodesById.get(path[i]);
      const b = this.nodesById.get(path[i + 1]);
      if (a.floorId !== b.floorId) {
        const edgeList = this.adjacency.get(path[i]) || [];
        const edge = edgeList.find((e) => e.to === path[i + 1]);
        changes.push({
          fromFloorId: a.floorId,
          toFloorId: b.floorId,
          via: edge ? edge.edgeType : 'unknown',
          atNode: b.id,
        });
      }
    }
    return changes;
  }

  /**
   * Yön talimatlarını insan-okunur adımlara çevirir (basit sezgisel:
   * ardışık üç node'un açısına göre düz/sağa/sola dön kararı verir).
   */
  toInstructions(path) {
    const steps = [];
    for (let i = 0; i < path.length; i++) {
      const node = this.nodesById.get(path[i]);
      if (i === 0) {
        steps.push({ type: 'start', nodeId: node.id, label: 'Başlangıç noktası' });
        continue;
      }
      const prevNode = this.nodesById.get(path[i - 1]);
      if (node.floorId !== prevNode.floorId) {
        steps.push({ type: 'floor_change', nodeId: node.id, label: `Kat değişimi` });
        continue;
      }
      if (i < path.length - 1) {
        const nextNode = this.nodesById.get(path[i + 1]);
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
    if (Math.abs(angle) < 20) return null; // düz devam
    return angle > 0 ? 'Sağa dönün' : 'Sola dönün';
  }
}

module.exports = { NavGraph, MinHeap };
