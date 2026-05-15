import { CityGraph } from '../../simulation/CityGraph.js';

/**
 * Grid City Generator — Creates a uniform NxN grid city
 */
export function generateGridCity(cols = 10, rows = 10, blockSize = 120) {
  const graph = new CityGraph();
  const offsetX = -(cols - 1) * blockSize / 2;
  const offsetY = -(rows - 1) * blockSize / 2;

  // Create nodes
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `n${r}_${c}`;
      const x = offsetX + c * blockSize;
      const y = offsetY + r * blockSize;
      const zone = getZone(r, c, rows, cols);
      graph.addNode(id, x, y, 'junction', zone);
    }
  }

  // Create edges
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const id = `n${r}_${c}`;
      // Right neighbor
      if (c < cols - 1) {
        const rightId = `n${r}_${c + 1}`;
        const isArterial = r % 3 === 0;
        graph.addEdge(id, rightId,
          isArterial ? 3 : 2,
          isArterial ? 'arterial' : 'local',
          isArterial ? 60 : 40
        );
      }
      // Bottom neighbor
      if (r < rows - 1) {
        const downId = `n${r + 1}_${c}`;
        const isArterial = c % 3 === 0;
        graph.addEdge(id, downId,
          isArterial ? 3 : 2,
          isArterial ? 'arterial' : 'local',
          isArterial ? 60 : 40
        );
      }
    }
  }

  // Mark center cross as highway
  const midR = Math.floor(rows / 2);
  const midC = Math.floor(cols / 2);
  for (let c = 0; c < cols - 1; c++) {
    const edge = graph.getEdge(`n${midR}_${c}`, `n${midR}_${c + 1}`);
    const rev = graph.getEdge(`n${midR}_${c + 1}`, `n${midR}_${c}`);
    if (edge) { edge.type = 'highway'; edge.lanes = 4; edge.speedLimit = 80; }
    if (rev) { rev.type = 'highway'; rev.lanes = 4; rev.speedLimit = 80; }
  }
  for (let r = 0; r < rows - 1; r++) {
    const edge = graph.getEdge(`n${r}_${midC}`, `n${r + 1}_${midC}`);
    const rev = graph.getEdge(`n${r + 1}_${midC}`, `n${r}_${midC}`);
    if (edge) { edge.type = 'highway'; edge.lanes = 4; edge.speedLimit = 80; }
    if (rev) { rev.type = 'highway'; rev.lanes = 4; rev.speedLimit = 80; }
  }

  return graph;
}

function getZone(r, c, rows, cols) {
  const cr = rows / 2, cc = cols / 2;
  const dr = Math.abs(r - cr), dc = Math.abs(c - cc);
  if (dr < rows * 0.2 && dc < cols * 0.2) return 'commercial';
  if (r < 2 && c < 2) return 'industrial';
  if (r >= rows - 2 && c >= cols - 2) return 'industrial';
  if ((r < 2 && c >= cols - 2) || (r >= rows - 2 && c < 2)) return 'park';
  return 'residential';
}
