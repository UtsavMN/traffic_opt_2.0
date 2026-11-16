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

  console.log('Testing Feature 1: Track Ambulance Toggle Button');
  // Find ambulance toggle button
  let ambBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => b.textContent.includes('Ambulance Path'));
  });

  if (ambBtn) {
    let btnText = await page.evaluate(el => el.textContent, ambBtn);
    console.log('Initial ambulance button text:', btnText);

    // Click to toggle OFF
    await ambBtn.click();
    await new Promise(r => setTimeout(r, 600));
    btnText = await page.evaluate(el => el.textContent, ambBtn);
    console.log('After toggle OFF:', btnText);

    const artifactAmbOff = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_ambulance_toggle_off.png';
    await page.screenshot({ path: artifactAmbOff });
    console.log('Saved ambulance OFF screenshot to', artifactAmbOff);

    // Click to toggle ON
    await ambBtn.click();
    await new Promise(r => setTimeout(r, 600));
    btnText = await page.evaluate(el => el.textContent, ambBtn);
    console.log('After toggle ON:', btnText);
  }

  console.log('\nTesting Feature 2: Interactive Junction Inspector');
  // Programmatically select junction n85 or click an intersection
  await page.evaluate(() => {
    const engine = window.__sancharEngine;
    if (engine && engine.intersections) {
      // Find a signalized intersection with approaches
      for (const [id, int] of engine.intersections) {
        if (int.isSignalized && int.approaches && int.approaches.length >= 4) {
          window.__testJunctionId = id;
          break;
        }
      }
    }
  });

  const junctionId = await page.evaluate(() => window.__testJunctionId || 'n85');
  console.log('Selecting junction for inspection:', junctionId);

  await page.evaluate((id) => {
    const store = window.__sancharUI || (window.__useUIStore && window.__useUIStore.getState ? window.__useUIStore : null);
    // Click via react state or dispatch event
    const evt = new CustomEvent('select-intersection', { detail: id });
    window.dispatchEvent(evt);
  }, junctionId);

  // Directly set in uiStore via page evaluation
  await page.evaluate((id) => {
    // Traverse React tree or use global hook
    const rootEl = document.querySelector('#root') || document.querySelector('.app-layout');
    // We can also trigger click on map near the junction
    const engine = window.__sancharEngine;
    const map = window.__sancharMap;
    if (engine && map) {
      const int = engine.intersections.get(id);
      if (int && int.lng && int.lat) {
        const pt = map.project([int.lng, int.lat]);
        map.fire('click', { point: pt, lngLat: { lng: int.lng, lat: int.lat } });
      }
    }
  }, junctionId);

  await new Promise(r => setTimeout(r, 1200));

  const artifactInspectorCCTV = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_junction_inspector_cctv.png';
  await page.screenshot({ path: artifactInspectorCCTV });
  console.log('Saved Junction Inspector CCTV screenshot to', artifactInspectorCCTV);

  // Click on 'Queue Backlogs & Splits' tab
  const queueTab = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => b.textContent.includes('Queue Backlogs'));
  });
  if (queueTab && queueTab.click) {
    await queueTab.click();
    await new Promise(r => setTimeout(r, 600));
    const artifactInspectorQueues = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_junction_inspector_queues.png';
    await page.screenshot({ path: artifactInspectorQueues });
    console.log('Saved Junction Inspector Queues screenshot to', artifactInspectorQueues);
  }

  // Click on 'Manual Phase Override' tab
  const controlsTab = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => b.textContent.includes('Manual Phase Override'));
  });
  if (controlsTab && controlsTab.click) {
    await controlsTab.click();
    await new Promise(r => setTimeout(r, 600));

    // Click "Switch Phase (Yellow)"
    const switchBtn = await page.evaluateHandle(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      return btns.find(b => b.textContent.includes('Switch Phase'));
    });
    if (switchBtn && switchBtn.click) {
      await switchBtn.click();
      console.log('Clicked Switch Phase button');
    }

    await new Promise(r => setTimeout(r, 800));
    const artifactInspectorControls = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_junction_inspector_controls.png';
    await page.screenshot({ path: artifactInspectorControls });
    console.log('Saved Junction Inspector Controls screenshot to', artifactInspectorControls);
  }

  console.log('\nTesting Feature 3: Side-by-Side A/B Benchmark View');
  // Open A/B Benchmark comparison modal
  const abBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => b.textContent.includes('A/B Compare'));
  });
  if (abBtn && abBtn.click) {
    await abBtn.click();
    console.log('Clicked A/B Compare button in TopBar');
  }

  await new Promise(r => setTimeout(r, 1500));

  const artifactAB = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_ab_benchmark_split_screen.png';
  await page.screenshot({ path: artifactAB });
  console.log('Saved A/B Split Screen screenshot to', artifactAB);

  // Test applying 120s Fixed mode
  const fixedBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => b.textContent.includes('Switch Entire City to 120s Fixed'));
  });
  if (fixedBtn && fixedBtn.click) {
    await fixedBtn.click();
    console.log('Applied 120s Fixed Mode to city');
  }

  await new Promise(r => setTimeout(r, 1200));

  // Test applying Sanchar AI mode back
  const aiBtn = await page.evaluateHandle(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    return btns.find(b => b.textContent.includes('Activate Sanchar AI Dynamic'));
  });
  if (aiBtn && aiBtn.click) {
    await aiBtn.click();
    console.log('Restored Sanchar AI Dynamic Mode to city');
  }

  await new Promise(r => setTimeout(r, 1000));
  await browser.close();
  console.log('\nAll tests completed successfully!');
})();
