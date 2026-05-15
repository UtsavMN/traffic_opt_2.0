/**
 * CityGraph — Road network graph (nodes=intersections, edges=roads)
 */
export class CityGraph {
  constructor() {
    this.nodes = new Map(); // id -> { id, x, y, type, zone, connections[] }
    this.edges = new Map(); // "from->to" -> edge data
    this.adjacency = new Map(); // id -> Set of neighbor ids
  }

  addNode(id, x, y, type = 'junction', zone = 'residential') {
    this.nodes.set(id, { id, x, y, type, zone, connections: [] });
    if (!this.adjacency.has(id)) this.adjacency.set(id, new Set());
  }

  addEdge(fromId, toId, lanes = 2, type = 'local', speedLimit = 40) {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return;

    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    const edge = {
      id: `${fromId}->${toId}`,
      from: fromId, to: toId,
      lanes, type, speedLimit, length,
      blocked: 0, // number of blocked lanes
      direction: Math.atan2(dy, dx)
    };

    this.edges.set(edge.id, edge);
    this.adjacency.get(fromId).add(toId);

    // Bidirectional
    const revEdge = {
      id: `${toId}->${fromId}`,
      from: toId, to: fromId,
      lanes, type, speedLimit, length,
      blocked: 0,
      direction: Math.atan2(-dy, -dx)
    };
    this.edges.set(revEdge.id, revEdge);
    this.adjacency.get(toId).add(fromId);

    from.connections.push(toId);
    to.connections.push(fromId);
  }

  getNeighbors(nodeId) {
    return this.adjacency.get(nodeId) || new Set();
  }

  getEdge(fromId, toId) {
    return this.edges.get(`${fromId}->${toId}`) || null;
  }

  getEdgeBetween(a, b) {
    return this.getEdge(a, b) || this.getEdge(b, a);
  }

  getBorderNodes() {
    const border = [];
    for (const [id, node] of this.nodes) {
      const neighbors = this.adjacency.get(id);
      if (neighbors && neighbors.size < 4) border.push(id);
    }
    return border;
  }

  getRandomNode() {
    const ids = Array.from(this.nodes.keys());
    return ids[Math.floor(Math.random() * ids.length)];
  }

  getRandomBorderNode() {
    const border = this.getBorderNodes();
    return border[Math.floor(Math.random() * border.length)];
  }
}
