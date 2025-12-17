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

    // 3) Row profile: leftmost/rightmost opaque pixel per row
    const L = new Int32Array(h);
    const R = new Int32Array(h);

    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      let l = -1, r = -1;

      for (let x = 0; x < w; x++) {
        if (data[row + x * 4 + 3] >= THR) { l = x; break; }
      }
      if (l === -1) { L[y] = R[y] = -1; continue; }

      for (let x = w - 1; x >= 0; x--) {
        if (data[row + x * 4 + 3] >= THR) { r = x; break; }
      }

      L[y] = l;
      R[y] = r;
    }

    // 4) Find the row with maximum width
    let y0 = -1, maxW = -1;
    for (let y = 0; y < h; y++) {
      if (L[y] >= 0) {
        const ww = R[y] - L[y];
        if (ww > maxW) { maxW = ww; y0 = y; }
      }
    }
    if (y0 < 0) {
      try { imageObj.imageData.dispose(); } catch (_) {}
      return;
    }

    // 5) Search for the maximum-area rectangle (for convex shapes after rotate/lens correction)
    let bestArea = 0;
    let bestL = L[y0], bestR = R[y0], bestT = y0, bestB = y0;

    // up
    {
      let maxL = L[y0], minR = R[y0];
      for (let y = y0; y >= 0; y--) {
        if (L[y] < 0) break;
        maxL = Math.max(maxL, L[y]);
        minR = Math.min(minR, R[y]);
        if (maxL >= minR) break;

        const area = (y0 - y + 1) * (minR - maxL);
        if (area > bestArea) {
          bestArea = area;
          bestL = maxL; bestR = minR; bestT = y; bestB = y0;
        }
      }
    }

    // down
    {
      let maxL = L[y0], minR = R[y0];
      for (let y = y0; y < h; y++) {
        if (L[y] < 0) break;
        maxL = Math.max(maxL, L[y]);
        minR = Math.min(minR, R[y]);
        if (maxL >= minR) break;

        const area = (y - y0 + 1) * (minR - maxL);
        if (area > bestArea) {
          bestArea = area;
          bestL = maxL; bestR = minR; bestT = y0; bestB = y;
        }
      }
    }

    // 6) Convert to document coordinates + apply inward inset
    const cropL = Math.min(width,  Math.max(0, offX + bestL + INSET));
    const cropR = Math.min(width,  Math.max(0, offX + bestR - INSET));
    const cropT = Math.min(height, Math.max(0, offY + bestT + INSET));
    const cropB = Math.min(height, Math.max(0, offY + bestB - INSET));

    if (cropL < cropR && cropT < cropB) {
      await doc.crop({ left: cropL, top: cropT, right: cropR, bottom: cropB });
    }

    try { imageObj.imageData.dispose(); } catch (_) {}
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
