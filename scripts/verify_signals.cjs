const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 30000 });
  
  await new Promise(r => setTimeout(r, 3500));

  const junctionStats = await page.evaluate(() => {
    const engine = window.__sancharEngine;
    if (!engine || !engine.intersections) return { error: 'No engine' };
    
    let total = engine.intersections.size;
    let signalized = 0;
    let multiLegCircles = [];
    let samples = [];
    
    for (const [id, int] of engine.intersections) {
      if (!int.isSignalized) continue;
      signalized++;
      const numApps = int.approaches ? int.approaches.length : 0;
      const numPhases = int.numPhases || 2;
      if (numApps >= 5) {
        multiLegCircles.push({
          id,
          numApps,
          numPhases,
          currentPhase: int.trafficLight ? int.trafficLight.currentPhase : null,
          approaches: int.approaches.map(a => ({
            roadName: a.roadName,
            angleDeg: (a.angle * 180 / Math.PI).toFixed(1),
            phaseIndex: a.phaseIndex,
            color: int.getLightColorForEdge(a.edgeId)
          }))
        });
      }
      if (samples.length < 4 && numApps >= 3) {
        samples.push({
          id,
          numApps,
          numPhases,
          currentPhase: int.trafficLight ? int.trafficLight.currentPhase : null,
          approaches: int.approaches.map(a => ({
            roadName: a.roadName,
            angleDeg: (a.angle * 180 / Math.PI).toFixed(1),
            phaseIndex: a.phaseIndex,
            color: int.getLightColorForEdge(a.edgeId)
          }))
        });
      }
    }
    return {
      total,
      signalized,
      multiLegCount: multiLegCircles.length,
      multiLegCircles: multiLegCircles.slice(0, 3),
      samples
    };
  });

  console.log('Junction Stats:\n', JSON.stringify(junctionStats, null, 2));

  // Click on 'Davis Road Junction' button to zoom in
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Davis Road Junction')) {
      await btn.click();
      console.log('Clicked Davis Road Junction button');
      break;
    }
  }

  // Wait 3s for camera transition and signal updates
  await new Promise(r => setTimeout(r, 3000));

  const artifactDavis = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_road_aligned_davis_junction.png';
  await page.screenshot({ path: artifactDavis });
  console.log('Saved Davis Road screenshot to', artifactDavis);

  // Click on 'Armstrong Road' button
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Armstrong Road')) {
      await btn.click();
      console.log('Clicked Armstrong Road button');
      break;
    }
  }

  await new Promise(r => setTimeout(r, 3000));

  const artifactArmstrong = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_road_aligned_armstrong_detail.png';
  await page.screenshot({ path: artifactArmstrong });
  console.log('Saved Armstrong Road screenshot to', artifactArmstrong);

  // Click on 'Tannery Road Corridor' button
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Tannery Road Corridor')) {
      await btn.click();
      console.log('Clicked Tannery Road Corridor button');
      break;
    }
  }

  await new Promise(r => setTimeout(r, 3000));

  const artifactTannery = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_road_aligned_tannery_circle.png';
  await page.screenshot({ path: artifactTannery });
  console.log('Saved Tannery Circle screenshot to', artifactTannery);

  await browser.close();
})();
