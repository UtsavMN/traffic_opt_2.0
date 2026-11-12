import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

const ARTIFACT_DIR = 'C:\\Users\\Utsav M N\\.gemini\\antigravity\\brain\\541b9b1e-5e31-43e7-8737-baf02779bae2';

async function runAudit() {
  if (!fs.existsSync(ARTIFACT_DIR)) {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  }

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });

  console.log("=== STARTING SANCHAR SIMULATION AUDIT ===");

  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[Sanchar AI]') || text.includes('[StateEncoder]') || text.includes('[QApproximator]') || text.includes('safety layer')) {
      console.log(`[BROWSER] ${text}`);
    }
  });

  await page.goto('http://localhost:5173');
  // Wait for the app and weights to initialize
  await new Promise(r => setTimeout(r, 4000));

  console.log("--- PART 1: ADAPTIVE MODE Baseline ---");
  await new Promise(r => setTimeout(r, 15000));

  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'adaptive_run.png') });
  
  const adaptiveMetrics = await page.evaluate(() => {
    return (window.__sancharMetrics || window.__trafficOptMetrics).getMetrics();
  });
  console.log(`[ADAPTIVE METRICS] Wait: ${adaptiveMetrics.avgWait.toFixed(2)}s, Throughput: ${adaptiveMetrics.throughput.toFixed(2)}/min, Speed: ${adaptiveMetrics.avgSpeed.toFixed(2)}px/s, Green EFF: ${adaptiveMetrics.greenEfficiency.toFixed(2)}%`);

  // PART 2: RL_ACTIVE MODE with Loaded Neural Weights
  console.log("--- PART 2: RL_ACTIVE MODE ---");
  await page.evaluate(() => {
    (window.__sancharEngine || window.__trafficOptEngine).aiController.rlActive = true;
  });

  await new Promise(r => setTimeout(r, 15000));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'rl_active_run.png') });
  
  const rlMetrics = await page.evaluate(() => {
    return (window.__sancharMetrics || window.__trafficOptMetrics).getMetrics();
  });
  console.log(`[RL_ACTIVE METRICS] Wait: ${rlMetrics.avgWait.toFixed(2)}s, Throughput: ${rlMetrics.throughput.toFixed(2)}/min, Speed: ${rlMetrics.avgSpeed.toFixed(2)}px/s, Green EFF: ${rlMetrics.greenEfficiency.toFixed(2)}%`);

  // PART 3: STRESS TEST (SPAWN RATE INCREASE)
  console.log("--- PART 3: STRESS TEST (ELEVATED DEMAND) ---");
  await page.evaluate(() => {
    (window.__sancharEngine || window.__trafficOptEngine).setSpawnRate(2.5);
    console.log(`Spawn rate increased to ${(window.__sancharEngine || window.__trafficOptEngine).spawnRate}`);
  });

  await new Promise(r => setTimeout(r, 15000));
  await page.screenshot({ path: path.join(ARTIFACT_DIR, 'stress_test.png') });

  const stressMetrics = await page.evaluate(() => {
    const metrics = (window.__sancharMetrics || window.__trafficOptMetrics).getMetrics();
    return {
      vehicles: (window.__sancharEngine || window.__trafficOptEngine).vehicles.length,
      avgWait: metrics.avgWait.toFixed(2),
      throughput: metrics.throughput.toFixed(2),
    };
  });
  console.log(`[STRESS METRICS] Active Vehicles: ${stressMetrics.vehicles}, Wait: ${stressMetrics.avgWait}s, Throughput: ${stressMetrics.throughput}/min`);

  await browser.close();
  console.log("=== SANCHAR AUDIT COMPLETE ===");
  process.exit(0);
}

runAudit().catch(err => {
  console.error(err);
  process.exit(1);
});

