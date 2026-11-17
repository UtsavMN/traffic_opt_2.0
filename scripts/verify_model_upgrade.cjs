const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 35000 });

  console.log('Simulating 22 seconds to observe multi-phase, DQN & green wave decisions...');
  await new Promise(r => setTimeout(r, 22000));

  const stats = await page.evaluate(() => {
    const engine = window.__sancharEngine;
    const controller = engine?.aiController;
    const coordinator = controller?.coordinator;

    const decisions = controller?.decisions || [];
    const modelsCount = {};
    const actionsCount = {};

    for (const d of decisions) {
      modelsCount[d.model] = (modelsCount[d.model] || 0) + 1;
      actionsCount[d.action] = (actionsCount[d.action] || 0) + 1;
    }

    // Check multi-phase intersections
    let multiPhaseDecisions = 0;
    let greenWaveDecisions = 0;
    for (const d of decisions) {
      if (d.action && d.action.includes('SWITCH_TO_P')) multiPhaseDecisions++;
      if (d.model === 'GREEN_WAVE' || (d.reason && d.reason.includes('Green Wave'))) greenWaveDecisions++;
    }

    return {
      totalVehicles: engine?.vehicles?.filter(v => v.alive).length,
      totalDecisions: controller?.totalDecisions || 0,
      modelsCount,
      actionsCount,
      multiPhaseDecisions,
      greenWaveDecisions,
      recentDecisions: decisions.slice(-12).map(d => ({
        id: d.intersectionId,
        action: d.action,
        model: d.model,
        reason: d.reason,
        reward: d.reward ? d.reward.toFixed(2) : null
      })),
      neuralWeightsLoaded: !!(coordinator?.rlAgent?.q?.mlpLayers?.length > 0),
      mlpLayers: coordinator?.rlAgent?.q?.mlpLayers?.length || 0,
      epsilon: coordinator?.rlAgent?.epsilon
    };
  });

  console.log('=== 22s AI & Simulation Model Verification Stats ===');
  console.log(JSON.stringify(stats, null, 2));

  // Capture screenshot of live model dashboard
  const artifactPath = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_model_upgrade_verified.png';
  await page.screenshot({ path: artifactPath });
  console.log('Saved model upgrade screenshot to:', artifactPath);

  await browser.close();
})();
