const entrypoints = require("uxp").entrypoints;

function px(v) {
  if (typeof v === "number") return v;
  if (v && typeof v.value === "number") return v.value;
  return Number(v);
}

// Settings (tweak if you want)
const INSET = 1; // px inward to reliably remove 1px transparent “fringes”

// Alpha threshold by bit depth
function alphaThreshold(componentSize) {
  // componentSize: 8 / 16 / 32 (32 is rare, but handle it anyway)
  if (componentSize === 16) return 256;   // 0..65535
  if (componentSize === 32) return 0.002; // float 0..1 (in case we get floats)
  return 2;                               // 8-bit: 0..255
}

async function runCrop() {
  let ps;
  try {
    ps = require("photoshop");
  } catch (_) {
    return;
  }

  const { app, imaging, core, action } = ps;

  // When recording an Action, register a plugin step (so users can bind an F-key to the Action)
  try {
    action.recordAction(
      { name: "Crop Max Rectangle", methodName: "cropMaxRectActionHandler" },
      {}
    );
  } catch (_) {}

  const doc = app.activeDocument;
  if (!doc) return;

  const layer = doc.activeLayers && doc.activeLayers[0];
  if (!layer) return;

  const width = Math.round(px(doc.width));
  const height = Math.round(px(doc.height));

  await core.executeAsModal(async () => {
    // 1) Read layer pixels at native bit depth (this is critical for 16-bit)
    const imageObj = await imaging.getPixels({
      layerID: layer.id,
      sourceBounds: { left: 0, top: 0, right: width, bottom: height },
      componentSize: -1, // IMPORTANT: use source depth (8/16/32)
      colorSpace: "RGB"
    });

    if (!imageObj || !imageObj.imageData) return;

    const comps = imageObj.imageData.components;     // expected 4 (RGBA)
    const csize = imageObj.imageData.componentSize;  // 8/16/32

    // If we got RGB without alpha, the algorithm is meaningless (nothing to “crop by transparency”)
    if (comps !== 4) {
      try { imageObj.imageData.dispose(); } catch (_) {}
      return;
    }

    // 2) Fetch data correctly
    // For 16-bit prefer fullRange so alpha is 0..65535
    let data;
    if (csize === 16) {
      data = await imageObj.imageData.getData({ chunky: true, fullRange: true });
    } else {
      data = await imageObj.imageData.getData({ chunky: true });
    }

    if (!data || !data.length) {
      try { imageObj.imageData.dispose(); } catch (_) {}
      return;
    }

    const sb = imageObj.sourceBounds || { left: 0, top: 0, right: width, bottom: height };
    const offX = sb.left || 0;
    const offY = sb.top || 0;
    const w = (sb.right - sb.left);
    const h = (sb.bottom - sb.top);

    const THR = alphaThreshold(csize);

    // 3) Find the largest all-opaque axis-aligned rectangle (global maximum)
    // Build a per-row histogram of consecutive opaque pixels and solve
    // "largest rectangle in histogram" for each row (O(w*h)).
    const heights = new Int32Array(w);

    let bestArea = 0;
    let bestL = 0, bestR = 0, bestT = 0, bestB = 0; // L/R/T/B are [inclusive/exclusive) coords

    for (let y = 0; y < h; y++) {
      const row = y * w * 4;

      // Update histogram heights for this row
      for (let x = 0; x < w; x++) {
        const a = data[row + x * 4 + 3];
        heights[x] = (a >= THR) ? (heights[x] + 1) : 0;
      }

      // Largest rectangle in histogram (stack of indices with increasing heights)
      const stack = [];
      for (let i = 0; i <= w; i++) {
        const curH = (i === w) ? 0 : heights[i];

        while (stack.length && curH < heights[stack[stack.length - 1]]) {
          const topIdx = stack.pop();
          const height = heights[topIdx];
          if (height <= 0) continue;

          const right = i; // exclusive
          const left = stack.length ? (stack[stack.length - 1] + 1) : 0; // inclusive
          const widthRect = right - left;
          const area = height * widthRect;

          if (area > bestArea) {
            bestArea = area;
            bestL = left;
            bestR = right;        // exclusive
            bestB = y + 1;        // exclusive
            bestT = bestB - height; // inclusive
          }
        }

        stack.push(i);
      }
    }

    if (bestArea <= 0) {
      try { imageObj.imageData.dispose(); } catch (_) {}
      return;
    }

    // 4) Convert to document coordinates + apply inward inset
    // Note: bestR/bestB are exclusive, matching width/height math.
    const cropL = Math.min(width,  Math.max(0, offX + bestL + INSET));
    const cropR = Math.min(width,  Math.max(0, offX + bestR - INSET));
    const cropT = Math.min(height, Math.max(0, offY + bestT + INSET));
    const cropB = Math.min(height, Math.max(0, offY + bestB - INSET));

    if (cropL < cropR && cropT < cropB) {
      await doc.crop({ left: cropL, top: cropT, right: cropR, bottom: cropB });
    }

  }, { commandName: "Crop Max Rectangle" });
}

// Action playback handler (must be in global scope)
globalThis.cropMaxRectActionHandler = async function cropMaxRectActionHandler(executionContext, info) {
  await runCrop();
  return info || {};
};

// Panel wiring (button)
function wirePanelButton() {
  const btn = document.getElementById("run");
  if (!btn) return;
  btn.onclick = runCrop;
}

// entrypoints: command + panel
entrypoints.setup({
  commands: {
    cropMaxRect: runCrop
  },
  panels: {
    vanilla: {
      show() { wirePanelButton(); },
      hide() {}
    }
  }
});
