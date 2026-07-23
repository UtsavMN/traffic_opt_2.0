import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { RLAgent } from '../src/ai/RLAgent.js';

/**
 * train_offline.js — Domain Randomization Training Loop
 * 
 * Simulates a mathematical Queuing Theory model to rapidly train the 
 * RLAgent using the pressure-based state encoder and reward function.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEIGHTS_DIR = path.join(__dirname, '../public/weights');

const EPISODES = 1500;
const STEPS_PER_EPISODE = 200;
const ACTIONS = ['KEEP_PHASE', 'SWITCH_PHASE', 'EXTEND_PHASE', 'PEDESTRIAN_SCRAMBLE'];

function generateRandomDomain() {
  const isGrid = Math.random() > 0.5;
  return {
    topology: isGrid ? 'grid' : 'random_graph',
    numNodes: Math.floor(Math.random() * 20) + 5,
    baseSpawnRate: (Math.random() * 1.5) + 0.5,
    weatherMult: Math.random() > 0.8 ? (Math.random() * 0.5 + 0.5) : 1.0,
    timeOfDay: Math.random() * 24
  };
}

class MockTrafficLight {
  constructor() {
    this.currentPhase = 'NS_GREEN';
    this.phaseProgress = 0;
    this.timer = 10;
  }
  
  canPass(dir) {
    if (this.currentPhase.includes('YELLOW') || this.currentPhase === 'ALL_RED') return false;
    if (this.currentPhase.includes('NS') && (dir === 'N' || dir === 'S')) return true;
    if (this.currentPhase.includes('EW') && (dir === 'E' || dir === 'W')) return true;
    return false;
  }
  
  switchPhase() {
    this.currentPhase = this.currentPhase === 'NS_GREEN' ? 'EW_GREEN' : 'NS_GREEN';
    this.phaseProgress = 0;
  }
}

class MockEngine {
  constructor(domain) {
    this.weather = { speedMult: domain.weatherMult };
    this.timeOfDay = { normalized: domain.timeOfDay / 24 };
    this.sensorRealism = null;
    this.spawnRate = domain.baseSpawnRate;
    
    // Create random connections for pressure calculation
    const connections = new Map();
    for(let i=0; i<domain.numNodes; i++) {
      const neighbors = [];
      const numNeighbors = Math.floor(Math.random() * 3) + 2; // 2 to 4 neighbors
      for(let j=0; j<numNeighbors; j++) {
        let n = Math.floor(Math.random() * domain.numNodes);
        if (n !== i) neighbors.push(`node_${n}`);
      }
      connections.set(`node_${i}`, neighbors);
    }
    
    this.graph = {
      getNeighbors: (id) => connections.get(id) || []
    };
    
    this.intersections = new Map();
    for(let i=0; i<domain.numNodes; i++) {
      const id = `node_${i}`;
      this.intersections.set(id, {
        id,
        trafficLight: new MockTrafficLight(),
        queues: { N: 0, S: 0, E: 0, W: 0 },
        pedestriansWaiting: 0,
        emergencyApproaching: Math.random() > 0.98,
        totalWaitSeconds: 0,
        vehiclesPassedAccumulatedRL: 0,
        maxWait: 0
      });
    }
  }

  step() {
    const dischargeRate = 2.0 * this.weather.speedMult; // Vehicles per step when green
    
    for (const [id, int] of this.intersections.entries()) {
      // 1. Arrivals (Poisson-like)
      const arrivalProb = 0.5 * this.spawnRate;
      ['N', 'S', 'E', 'W'].forEach(dir => {
        if (Math.random() < arrivalProb) {
          int.queues[dir] += 1;
        }
      });
      
      // 2. Discharges
      ['N', 'S', 'E', 'W'].forEach(dir => {
        if (int.trafficLight.canPass(dir) && int.queues[dir] > 0) {
          const discharged = Math.min(int.queues[dir], dischargeRate);
          int.queues[dir] -= discharged;
          int.vehiclesPassedAccumulatedRL += discharged;
        }
      });
      
      // 3. Accumulate wait times
      const totalQ = int.queues.N + int.queues.S + int.queues.E + int.queues.W;
      int.totalWaitSeconds += totalQ * 1.0; // 1 second per step
      if (totalQ > 0) {
        int.maxWait += 1.0;
      } else {
        int.maxWait = 0;
      }
      
      int.trafficLight.phaseProgress = Math.min(1.0, int.trafficLight.phaseProgress + 0.05);
    }
  }
}

async function train() {
  console.log("=== Zenith RL Offline Training (v10 Queuing Model) ===");
  console.log(`Starting domain-randomized training for ${EPISODES} episodes...`);
  
  const rlAgent = new RLAgent();
  rlAgent.shadowMode = false; // Enable active learning
  
  let totalReward = 0;
  
  for (let e = 0; e < EPISODES; e++) {
    const domain = generateRandomDomain();
    const engine = new MockEngine(domain);
    
    let episodeReward = 0;
    
    for (let step = 0; step < STEPS_PER_EPISODE; step++) {
      engine.step();
      
      for (const [id, int] of engine.intersections.entries()) {
        const { action } = rlAgent.observe(id, engine) || {};
        
        // Apply action to environment
        if (action === 'SWITCH_PHASE') {
          int.trafficLight.switchPhase();
        } else if (action === 'EXTEND_PHASE') {
          int.trafficLight.phaseProgress = Math.max(0, int.trafficLight.phaseProgress - 0.2);
        } else if (action === 'PEDESTRIAN_SCRAMBLE') {
           int.pedestriansWaiting = 0;
           int.trafficLight.switchPhase(); // simplified scramble effect
        }
        
        // Hack: read the last reward calculated during observe() to track progress
        if (rlAgent.replay.buffer.length > 0) {
          episodeReward += rlAgent.replay.buffer[rlAgent.replay.buffer.length - 1].reward;
        }
      }
      
      rlAgent.train();
    }
    
    totalReward += episodeReward;
    
    if (e > 0 && e % 100 === 0) {
      const avgRew = (totalReward / 100).toFixed(2);
      console.log(`Episode ${e}/${EPISODES} | Avg Reward: ${avgRew} | Epsilon: ${rlAgent.epsilon.toFixed(3)} | Replay: ${rlAgent.replay.size}`);
      totalReward = 0;
    }
  }
  
  console.log("Training complete. Exporting generalized weights...");
  
  if (!fs.existsSync(WEIGHTS_DIR)) {
    fs.mkdirSync(WEIGHTS_DIR, { recursive: true });
  }
  
  // Extract QApproximator weights
  const exportData = {
    stateDim: rlAgent.encoder.inputSize,
    actionCount: rlAgent.actionCount,
    weights: Array.from(rlAgent.q.weights || []),
    bias: Array.from(rlAgent.q.bias || []),
    trainingSteps: rlAgent.trainingSteps,
    version: 'v10-pressure'
  };
  
  fs.writeFileSync(
    path.join(WEIGHTS_DIR, 'gnn_policy.json'), 
    JSON.stringify(exportData, null, 2)
  );
  
  console.log(`Weights saved to ${WEIGHTS_DIR}/gnn_policy.json`);
}

train();
