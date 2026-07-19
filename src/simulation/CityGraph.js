/**
 * CityGraph — Road network graph (nodes=intersections, edges=roads)
 */
export class CityGraph {
  constructor() {
    this.nodes = new Map(); // id -> { id, x, y, type, zone, connections[] }
    this.edges = new Map(); // "from->to" -> edge data
    this.adjacency = new Map(); // id -> Set of neighbor ids
    this.bounds = { minX: 0, minY: 0, maxX: 4000, maxY: 4000 };
  }

  calculateBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, n] of this.nodes) {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    this.bounds = { minX, minY, maxX, maxY };
  }

  addNode(id, x, y, type = 'junction', zone = 'residential') {
    this.nodes.set(id, { id, x, y, type, zone, connections: [] });
    if (!this.adjacency.has(id)) this.adjacency.set(id, new Set());
  }

  addEdge(fromId, toId, lanes = 2, type = 'local', speedLimit = 40, geometry = null) {
    const from = this.nodes.get(fromId);
    const to = this.nodes.get(toId);
    if (!from || !to) return;

    let length = 0;
    let actualGeometry = [];
    if (geometry && geometry.length >= 2) {
      actualGeometry = geometry;
      for (let i = 0; i < geometry.length - 1; i++) {
        const p1 = geometry[i], p2 = geometry[i+1];
        length += Math.hypot(p2.x - p1.x, p2.y - p1.y);
      }
    } else {
      const dx = to.x - from.x, dy = to.y - from.y;
      length = Math.sqrt(dx * dx + dy * dy);
      actualGeometry = [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
    }

    if (length < 1) return; // skip zero-length edges

    const edgeId = `${fromId}->${toId}`;
    if (this.edges.has(edgeId)) return; // skip duplicates

    const edge = {
      id: edgeId,
      from: fromId, to: toId,
      lanes, type, speedLimit, length,
      blocked: 0,
      direction: Math.atan2(to.y - from.y, to.x - from.x),
      geometry: actualGeometry
    };

    this.edges.set(edge.id, edge);
    if (!this.adjacency.has(fromId)) this.adjacency.set(fromId, new Set());
    if (!this.adjacency.has(toId)) this.adjacency.set(toId, new Set());
    this.adjacency.get(fromId).add(toId);

    if (!from.connections.includes(toId)) from.connections.push(toId);
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

  getAllNodes() {
    return Array.from(this.nodes.values());
  }

  getNodesInBounds(bounds) {
    const result = [];
    for (const [, node] of this.nodes) {
      if (node.x >= bounds.minX && node.x <= bounds.maxX &&
          node.y >= bounds.minY && node.y <= bounds.maxY) {
        result.push(node);
      }
    }
    return result;
  }

  getDegree(nodeId) {
    return this.adjacency.has(nodeId) ? this.adjacency.get(nodeId).size : 0;
  }

  removeEdge(edgeId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    this.edges.delete(edgeId);
    
    // Remove from adjacency list
    const fromAdj = this.adjacency.get(edge.from);
    if (fromAdj) fromAdj.delete(edge.to);
    
    // Remove from connections array
    const fromNode = this.nodes.get(edge.from);
    if (fromNode) {
      fromNode.connections = fromNode.connections.filter(id => id !== edge.to);
    }
  }

  removeNode(nodeId) {
    if (!this.nodes.has(nodeId)) return;
    
    // Find and remove all connected edges
    const edgesToRemove = [];
    for (const [edgeId, edge] of this.edges) {
      if (edge.from === nodeId || edge.to === nodeId) {
        edgesToRemove.push(edgeId);
      }
    }
    
    for (const edgeId of edgesToRemove) {
      this.removeEdge(edgeId);
    }
    
    this.adjacency.delete(nodeId);
    this.nodes.delete(nodeId);
  }
}
