import { CityGraph } from '../../simulation/CityGraph.js';

/**
 * Mumbai-Inspired District — Irregular grid with mixed lanes and one-way streets
 */
export function generateMumbaiCity() {
  const graph = new CityGraph();
  const nodes = [
    // Main arterial grid (irregular spacing)
    { id:'m0',  x:-400, y:-350, zone:'residential' },
    { id:'m1',  x:-250, y:-360, zone:'residential' },
    { id:'m2',  x:-80,  y:-340, zone:'commercial' },
    { id:'m3',  x: 100, y:-350, zone:'commercial' },
    { id:'m4',  x: 280, y:-330, zone:'residential' },
    { id:'m5',  x:-380, y:-180, zone:'residential' },
    { id:'m6',  x:-200, y:-200, zone:'commercial' },
    { id:'m7',  x:-30,  y:-170, zone:'commercial' },
    { id:'m8',  x: 150, y:-190, zone:'commercial' },
    { id:'m9',  x: 320, y:-170, zone:'industrial' },
    { id:'m10', x:-350, y:-20,  zone:'residential' },
    { id:'m11', x:-160, y:-30,  zone:'commercial' },
    { id:'m12', x: 20,  y:  0,  zone:'commercial' },
    { id:'m13', x: 200, y:-10,  zone:'commercial' },
    { id:'m14', x: 380, y: 10,  zone:'industrial' },
    { id:'m15', x:-320, y: 150, zone:'park' },
    { id:'m16', x:-130, y: 160, zone:'residential' },
    { id:'m17', x: 60,  y: 180, zone:'commercial' },
    { id:'m18', x: 230, y: 160, zone:'residential' },
    { id:'m19', x: 400, y: 180, zone:'industrial' },
    { id:'m20', x:-280, y: 320, zone:'park' },
    { id:'m21', x:-100, y: 340, zone:'residential' },
    { id:'m22', x: 90,  y: 350, zone:'residential' },
    { id:'m23', x: 270, y: 330, zone:'residential' },
    { id:'m24', x: 420, y: 340, zone:'industrial' },
    // Extra nodes for density
    { id:'m25', x:-120, y:-110, zone:'commercial' },
    { id:'m26', x: 80,  y:-80,  zone:'commercial' },
    { id:'m27', x:-50,  y: 80,  zone:'commercial' },
    { id:'m28', x: 140, y: 80,  zone:'commercial' },
  ];

  for (const n of nodes) graph.addNode(n.id, n.x, n.y, 'junction', n.zone);

  // Connections (organic, not uniform)
  const edges = [
    ['m0','m1',2,'local',40],['m1','m2',3,'arterial',50],['m2','m3',3,'arterial',50],
    ['m3','m4',2,'local',40],['m5','m6',2,'local',40],['m6','m7',3,'arterial',60],
    ['m7','m8',3,'arterial',60],['m8','m9',2,'local',40],['m10','m11',2,'local',40],
    ['m11','m12',3,'arterial',60],['m12','m13',3,'arterial',60],['m13','m14',2,'local',40],
    ['m15','m16',2,'local',40],['m16','m17',2,'local',40],['m17','m18',2,'local',40],
    ['m18','m19',2,'local',40],['m20','m21',2,'local',40],['m21','m22',2,'local',40],
    ['m22','m23',2,'local',40],['m23','m24',2,'local',40],
    // Vertical
    ['m0','m5',2,'local',40],['m1','m6',3,'arterial',50],['m2','m7',3,'arterial',60],
    ['m3','m8',3,'arterial',50],['m4','m9',2,'local',40],['m5','m10',2,'local',40],
    ['m6','m11',3,'arterial',50],['m7','m12',4,'highway',70],['m8','m13',3,'arterial',50],
    ['m9','m14',2,'local',40],['m10','m15',2,'local',40],['m11','m16',2,'local',40],
    ['m12','m17',4,'highway',70],['m13','m18',3,'arterial',50],['m14','m19',2,'local',40],
    ['m15','m20',2,'local',40],['m16','m21',2,'local',40],['m17','m22',2,'local',40],
    ['m18','m23',2,'local',40],['m19','m24',2,'local',40],
    // Cross links for density
    ['m6','m25',2,'local',30],['m25','m11',2,'local',30],['m25','m7',2,'local',30],
    ['m7','m26',2,'local',30],['m26','m12',2,'local',30],['m26','m13',2,'local',30],
    ['m11','m27',2,'local',30],['m27','m16',2,'local',30],['m27','m17',2,'local',30],
    ['m12','m28',2,'local',30],['m28','m17',2,'local',30],['m28','m18',2,'local',30],
  ];

  for (const [f,t,l,ty,s] of edges) graph.addEdge(f, t, l, ty, s);

  return graph;
}
