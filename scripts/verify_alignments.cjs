const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 30000 });

  await new Promise(r => setTimeout(r, 3000));

  // Click on 'Armstrong Road' bookmark button
  const buttons = await page.$$('button');
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Armstrong Road')) {
      await btn.click();
      console.log('Clicked Armstrong Road');
      break;
    }
  }

  // Wait 3.5s for map transition and simulation loop
  await new Promise(r => setTimeout(r, 3500));

  // Take screenshot of Armstrong Road detail
  const artifactPath1 = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_aligned_armstrong_detail.png';
  await page.screenshot({ path: artifactPath1 });
  console.log('Saved screenshot 1 to', artifactPath1);

  // Click on 'Davis Road Junction' button
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Davis Road Junction')) {
      await btn.click();
      console.log('Clicked Davis Road Junction');
      break;
    }
  }

  await new Promise(r => setTimeout(r, 3500));

  const artifactPath2 = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_aligned_davis_junction.png';
  await page.screenshot({ path: artifactPath2 });
  console.log('Saved screenshot 2 to', artifactPath2);

  // Click on 'Tannery Road Corridor'
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Tannery Road Corridor')) {
      await btn.click();
      console.log('Clicked Tannery Road Corridor');
      break;
    }
  }

  await new Promise(r => setTimeout(r, 3500));

  const artifactPath3 = 'C:/Users/Utsav M N/.gemini/antigravity/brain/541b9b1e-5e31-43e7-8737-baf02779bae2/v2_aligned_tannery_circle.png';
  await page.screenshot({ path: artifactPath3 });
  console.log('Saved screenshot 3 to', artifactPath3);

  await browser.close();
  console.log('All verification screenshots captured successfully!');
})();
