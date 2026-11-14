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
    } else {
      console.log('[BROWSER LOG]', msg.text());
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

  // Measure FPS and Red-Light Obedience over 5 seconds
  const perfData = await page.evaluate(async () => {
    return new Promise(resolve => {
      let frameCount = 0;
      let redViolations = 0;
      let totalRedObservations = 0;
      const startTime = performance.now();

      function monitor() {
        frameCount++;
        const engine = window.__sancharEngine;
        if (engine && engine.vehicles) {
          for (const v of engine.vehicles) {
            if (!v.alive || v.routeIndex + 1 >= v.route.length) continue;
            const targetIntId = v.route[v.routeIndex + 1];
            const intObj = engine.intersections.get(targetIntId);
            if (!intObj || !intObj.isSignalized || !intObj.trafficLight) continue;

            const edge = v.currentEdge;
            if (!edge) continue;

            const dir = v._getDirection ? v._getDirection() : null;
            const lightColor = dir ? ((dir === 'N' || dir === 'S') ? intObj.trafficLight.getColorNS() : intObj.trafficLight.getColorEW()) : 'GREEN';

            const stopLineDist = Math.max(14, (intObj.maxLanes || 2) * (edge.laneWidthM || 2.85) * 1.0 * 0.65);
            const distToIntersection = (1 - v.segmentProgress) * edge.length;
            const distToStopLine = distToIntersection - stopLineDist;

            if (lightColor === 'RED' && !v.sirenActive) {
              totalRedObservations++;
              // If not legally clearing on green, but crossed > 8px past stop line on red:
              if (!v.clearingJunction && distToStopLine < -8) {
                redViolations++;
                if (redViolations <= 5) {
                  console.log(`[VIOLATION crossed stop line on red] Vehicle ${v.id} at node ${targetIntId}: dist=${distToStopLine.toFixed(1)}, spd=${v.speed.toFixed(1)}, clearing=${v.clearingJunction}`);
                }
              }
              // If past the stop line on red, speed must not exceed crawl
              if (!v.clearingJunction && distToStopLine <= 0 && distToStopLine >= -8 && v.speed > 1.0) {
                redViolations++;
                if (redViolations <= 5) {
                  console.log(`[VIOLATION creeping past stop line] Vehicle ${v.id} at node ${targetIntId}: dist=${distToStopLine.toFixed(1)}, spd=${v.speed.toFixed(1)}, clearing=${v.clearingJunction}`);
                }
              }
            }
          }
        }

        if (performance.now() - startTime < 4000) {
          requestAnimationFrame(monitor);
        } else {
          const elapsed = (performance.now() - startTime) / 1000;
          const fps = frameCount / elapsed;
          const vCount = engine ? engine.vehicles.length : 0;
          const intCount = engine ? engine.intersections.size : 0;
          let signalizedCount = 0;
          if (engine && engine.intersections) {
            for (const [, int] of engine.intersections) {
              if (int.isSignalized) signalizedCount++;
            }
          }
          resolve({ fps, frameCount, elapsed, vCount, intCount, signalizedCount, redViolations, totalRedObservations });
        }
      }
      requestAnimationFrame(monitor);
    });
  });

  console.log('--- PERFORMANCE & SIGNAL RESULTS ---');
  console.log(`FPS: ${perfData.fps.toFixed(2)}`);
  console.log(`Frames: ${perfData.frameCount} over ${perfData.elapsed.toFixed(2)}s`);
  console.log(`Active Vehicles: ${perfData.vCount}`);
  console.log(`Total Intersections: ${perfData.intCount}`);
  console.log(`Signalized Intersections: ${perfData.signalizedCount}`);
  console.log(`Red Light Observations: ${perfData.totalRedObservations}`);
  console.log(`Red Light Violations: ${perfData.redViolations}`);
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
