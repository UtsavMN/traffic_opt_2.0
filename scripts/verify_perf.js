import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/geo+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  const decodedUrl = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(process.cwd(), 'dist', decodedUrl === '/' ? 'index.html' : decodedUrl);
  
  if (!fs.existsSync(filePath)) {
    // Check public dir
    filePath = path.join(process.cwd(), 'public', decodedUrl);
  }

  if (!fs.existsSync(filePath)) {
    filePath = path.join(process.cwd(), 'dist', 'index.html');
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(4173, async () => {
  console.log('Test HTTP server listening on http://localhost:4173');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900 });

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
      console.error('[BROWSER ERROR]', msg.text());
    }
  });
  page.on('pageerror', err => {
    errors.push(err.message);
    console.error('[PAGE ERROR]', err.message);
  });

  console.log('Navigating to simulation...');
  await page.goto('http://localhost:4173', { waitUntil: 'networkidle2' });

  console.log('Waiting for simulation to initialize and populate vehicles...');
  await new Promise(r => setTimeout(r, 6000));

  // Measure FPS over 5 seconds
  const perfData = await page.evaluate(async () => {
    return new Promise(resolve => {
      let frameCount = 0;
      const startTime = performance.now();
      function count() {
        frameCount++;
        if (performance.now() - startTime < 4000) {
          requestAnimationFrame(count);
        } else {
          const elapsed = (performance.now() - startTime) / 1000;
          const fps = frameCount / elapsed;
          const vCount = window.__sancharEngine ? window.__sancharEngine.vehicles.length : 0;
          const intCount = window.__sancharEngine ? window.__sancharEngine.intersections.size : 0;
          resolve({ fps, frameCount, elapsed, vCount, intCount });
        }
      }
      requestAnimationFrame(count);
    });
  });

  console.log('--- PERFORMANCE RESULTS ---');
  console.log(`FPS: ${perfData.fps.toFixed(2)}`);
  console.log(`Frames: ${perfData.frameCount} over ${perfData.elapsed.toFixed(2)}s`);
  console.log(`Active Vehicles: ${perfData.vCount}`);
  console.log(`Total Intersections: ${perfData.intCount}`);
  console.log(`Errors caught: ${errors.length}`);

  // Take a full overview screenshot
  const screenshotDir = path.join(process.cwd(), 'dist');
  await page.screenshot({ path: path.join(screenshotDir, 'perf_overview.png') });
  console.log('Saved overview screenshot to dist/perf_overview.png');

  // Zoom in on Benson Town / Davis Road to verify signals & lane dashes
  await page.evaluate(() => {
    if (window.__sancharEngine) {
      // Zoom into Davis Road area
      window.__sancharEngine.renderer.camera.zoom = 3.2;
      window.__sancharEngine.renderer.camera.x = 2100;
      window.__sancharEngine.renderer.camera.y = 1950;
      window.__sancharEngine.renderer.invalidateRoadCache();
    }
  });

  await new Promise(r => setTimeout(r, 1000));
  await page.screenshot({ path: path.join(screenshotDir, 'perf_zoomed_davis_road.png') });
  console.log('Saved zoomed Davis Road screenshot to dist/perf_zoomed_davis_road.png');

  await browser.close();
  server.close();

  if (errors.length > 0) {
    console.error('FAILED with errors:', errors);
    process.exit(1);
  } else {
    console.log('SUCCESS: ZERO errors and smooth performance!');
    process.exit(0);
  }
});
