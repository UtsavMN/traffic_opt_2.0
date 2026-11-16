/**
 * gpuUtils — Hardware GPU detection, WebGL2 acceleration, and front-buffer context optimization
 */

let cachedGPUInfo = null;

export function getGPUInfo() {
  if (cachedGPUInfo) return cachedGPUInfo;

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {
      hasGPU: false,
      rendererName: 'Headless / Server',
      isHardwareAccelerated: false,
      isDedicated: false,
      glVersion: 'None',
      maxTextureSize: 0,
    };
  }

  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    
    // Explicitly request high-performance GPU (triggers discrete NVIDIA GPU on Optimus/hybrid laptops)
    const gl = canvas.getContext('webgl2', { powerPreference: 'high-performance' }) ||
               canvas.getContext('webgl', { powerPreference: 'high-performance' });

    if (!gl) {
      cachedGPUInfo = {
        hasGPU: false,
        rendererName: 'Software Rasterizer / Fallback',
        isHardwareAccelerated: false,
        isDedicated: false,
        glVersion: 'None',
        maxTextureSize: 0,
      };
      return cachedGPUInfo;
    }

    const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
    let rawRenderer = 'WebGL Graphics Accelerator';
    let rawVendor = 'Generic Vendor';

    if (debugInfo) {
      rawRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || rawRenderer;
      rawVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || rawVendor;
    }

    const glVersion = gl.getParameter(gl.VERSION) || 'WebGL 1.0';
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

    // Clean up vendor/renderer string for clean UI display
    let cleanName = rawRenderer;
    const isNvidia = /nvidia|geforce|rtx|gtx/i.test(rawRenderer);
    const isAmd = /amd|radeon/i.test(rawRenderer);
    const isIntel = /intel|iris|uhd/i.test(rawRenderer);

    // Extract cleanest model name from ANGLE strings if present
    const angleMatch = rawRenderer.match(/ANGLE\s*\([^,]+,\s*([^,]+)/i);
    if (angleMatch && angleMatch[1]) {
      cleanName = angleMatch[1].trim();
    }

    const isDedicated = isNvidia || (isAmd && !/graphics processor|vega/i.test(rawRenderer));
    const isHardwareAccelerated = !/swiftshader|software|llvmpipe/i.test(rawRenderer);

    cachedGPUInfo = {
      hasGPU: true,
      rawRenderer,
      rawVendor,
      rendererName: cleanName,
      isDedicated,
      isNvidia,
      isAmd,
      isIntel,
      isHardwareAccelerated,
      glVersion,
      maxTextureSize,
      backend: rawRenderer.includes('Direct3D11') ? 'Direct3D 11' : (rawRenderer.includes('Vulkan') ? 'Vulkan' : 'OpenGL'),
    };

    console.log(`[GPU Accelerator] Hardware detected: ${cleanName} (${cachedGPUInfo.backend}) | WebGL: ${glVersion}`);
    return cachedGPUInfo;
  } catch (err) {
    console.warn('[GPU Accelerator] Error detecting GPU:', err);
    return {
      hasGPU: true,
      rendererName: 'Hardware WebGL Accelerator',
      isHardwareAccelerated: true,
      isDedicated: false,
      glVersion: 'WebGL',
      maxTextureSize: 4096,
      backend: 'Hardware',
    };
  }
}

/**
 * Returns optimal GPU-accelerated 2D canvas context attributes
 * desynchronized: true - bypasses DWM/OS compositor for zero latency front-buffer rendering
 * willReadFrequently: false - keeps texture strictly in GPU VRAM (no RAM readback)
 */
export function getOptimal2DContext(canvas) {
  if (!canvas) return null;
  return canvas.getContext('2d', {
    alpha: true,
    desynchronized: true,
    willReadFrequently: false,
  });
}

/**
 * Returns high-performance context attributes for MapLibre WebGL instance
 */
export function getMapLibreContextAttributes() {
  return {
    powerPreference: 'high-performance',
    antialias: true,
    desynchronized: true,
    preserveDrawingBuffer: false,
  };
}
