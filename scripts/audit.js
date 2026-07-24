import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\Utsav M N\\.gemini\\antigravity\\brain\\bdf9584d-66f3-4f30-932b-81628dd2f2fb';

async function runAudit() {
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  console.log("=== STARTING AUDIT ===");

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[StateEncoder]') || text.includes('[QApproximator]') || text.includes('safety layer')) {
      console.log(`[BROWSER] ${text}`);
    }
  });

  await page.goto('http://localhost:5173');
  // Wait for the app to initialize
  await new Promise(r => setTimeout(r, 5000));

  console.log("--- PART 1: ADAPTIVE MODE Baseline ---");
  await new Promise(r => setTimeout(r, 30000));

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'adaptive_run.png') });
  
  const adaptiveMetrics = await page.evaluate(() => {
    return window.__trafficOptMetrics.getMetrics();
  });
  console.log(`[ADAPTIVE METRICS] Wait: ${adaptiveMetrics.avgWait.toFixed(2)}s, Throughput: ${adaptiveMetrics.throughput.toFixed(2)}/min, Speed: ${adaptiveMetrics.avgSpeed.toFixed(2)}px/s, Green EFF: ${adaptiveMetrics.greenEfficiency.toFixed(2)}%`);

  // PART 2: RL_ACTIVE MODE & ML Integration
  console.log("--- PART 2: RL_ACTIVE MODE ---");
  await page.evaluate(() => {
    // Inject log into StateEncoder
    const oldEncode = window.__trafficOptEngine.aiController.coordinator.rlAgent.encoder.encode;
    window.__trafficOptEngine.aiController.coordinator.rlAgent.encoder.encode = function(int, engine) {
      const state = oldEncode.call(this, int, engine);
      if (Math.random() < 0.05) { 
        console.log(`[StateEncoder] Encoded state: [${state.join(', ')}] (Length: ${state.length})`);
      }
      return state;
    };
    
    // Switch to RL_ACTIVE
    window.__trafficOptEngine.aiController.rlActive = true;
  });

  await new Promise(r => setTimeout(r, 30000));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'rl_active_run.png') });
  
  const rlMetrics = await page.evaluate(() => {
    return window.__trafficOptMetrics.getMetrics();
  });
  console.log(`[RL_ACTIVE METRICS] Wait: ${rlMetrics.avgWait.toFixed(2)}s, Throughput: ${rlMetrics.throughput.toFixed(2)}/min, Speed: ${rlMetrics.avgSpeed.toFixed(2)}px/s, Green EFF: ${rlMetrics.greenEfficiency.toFixed(2)}%`);

  // PART 3: STRESS TEST
  console.log("--- PART 3: STRESS TEST (2x SPAWN RATE) ---");
  await page.evaluate(() => {
    window.__trafficOptEngine.setSpawnRate(120);
    console.log(`Spawn rate doubled to ${window.__trafficOptEngine.spawnRate}`);
  });

  await new Promise(r => setTimeout(r, 30000));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'stress_test.png') });

  const stressMetrics = await page.evaluate(() => {
    return {
      poolActive: window.__trafficOptEngine.vehicles.length,
      poolCap: window.__trafficOptEngine.vehiclePool._capacity,
    };
  });
  console.log(`[STRESS METRICS] Active Vehicles: ${stressMetrics.poolActive} / Cap: ${stressMetrics.poolCap}`);

  await browser.close();
  console.log("=== AUDIT COMPLETE ===");
  process.exit(0);
}

runAudit().catch(err => {
  console.error(err);
  process.exit(1);
});
