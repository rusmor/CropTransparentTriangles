# Crop Transparent Triangles

Photoshop UXP plugin that automatically crops transparent edges left after image rotation, perspective transforms, or lens correction.

It removes transparent corners and borders, leaving the largest clean rectangular image area.

## Features
- Automatically finds the maximum solid rectangle
- Crops based on pixel transparency
- Supports 8-bit and 16-bit RGB
- Works as a panel button and as an Action (can be assigned to a hotkey)

## Important: Transparency is required
This plugin works **only on layers with real transparency**.

- Works on normal layers with transparent pixels (non-background layers only)
- Does **not** work on background layers
- Does **not** work if corners are filled with white (or any color)

If your image has white corners instead of transparent ones, you must remove the background or convert it to a normal layer first.

## Limitations
- RGB documents only
- Works only on layers with transparency (RGBA)
- Does nothing on background layers without transparency
- No guarantees for future Photoshop versions

## Installation

### Option 1: Developer Mode (recommended)
1. Clone or download this repository
2. Enable **Developer Mode** in Photoshop
3. Load the plugin folder via **Plugins → Development → Load Plugin…**

### Option 2: Manual install (Windows only)
On some Windows setups the plugin also works when copied directly into the Photoshop Plug-ins folder:

`C:\Program Files\Adobe\Adobe Photoshop 2025\Plug-ins\CropTransparentTriangles`

Restart Photoshop after copying.
> Note: This method is not officially documented by Adobe and may stop working in future versions.

## Usage
1. Open an image with transparent corners
2. Make sure the active layer is **not** a background layer
3. Click **Crop Transparent Triangles**

## License
MIT License  
Copyright (c) 2025 rusmor
