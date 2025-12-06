# Local Font Setup

This directory contains self-hosted font files for GDPR compliance, improved performance, and offline support.

## Required Font Files

**Note:** Font files are not included in this repository. You must download and convert them yourself.

The following font files must be placed in this directory (`public/fonts/`):

- `lora-regular.woff2` - Lora Regular (400 weight) in WOFF2 format
- `lora-regular.woff` - Lora Regular (400 weight) in WOFF format (fallback)
- `lora-bold.woff2` - Lora Bold (700 weight) in WOFF2 format
- `lora-bold.woff` - Lora Bold (700 weight) in WOFF format (fallback)

## How to Obtain Font Files

### Step 1: Download Lora Font

1. Visit [Google Fonts - Lora](https://fonts.google.com/specimen/Lora)
2. Click "Download family" to download the TTF font files
3. Extract the ZIP file - you'll need:
   - `Lora-Regular.ttf` (for regular weight)
   - `Lora-Bold.ttf` (for bold weight)

### Step 2: Convert to Web Formats

Convert the TTF files to WOFF2 and WOFF formats using one of these methods:

**Option A: Using woff2 (Recommended)**
```bash
# Install woff2 (macOS: brew install woff2)
woff2_compress Lora-Regular.ttf    # Creates Lora-Regular.woff2
woff2_compress Lora-Bold.ttf       # Creates Lora-Bold.woff2

# For WOFF format, use a tool like:
# - Font Squirrel Webfont Generator: https://www.fontsquirrel.com/tools/webfont-generator
# - CloudConvert: https://cloudconvert.com/ttf-to-woff
```

**Option B: Online Conversion Tools**
- [Font Squirrel Webfont Generator](https://www.fontsquirrel.com/tools/webfont-generator) - Upload TTF, download WOFF/WOFF2
- [CloudConvert](https://cloudconvert.com/ttf-to-woff2) - Convert TTF to WOFF2 and WOFF

### Step 3: Rename and Place Files

After conversion, rename the files to match the expected names and place them in `public/fonts/`:

- `Lora-Regular.woff2` → `lora-regular.woff2`
- `Lora-Regular.woff` → `lora-regular.woff`
- `Lora-Bold.woff2` → `lora-bold.woff2`
- `Lora-Bold.woff` → `lora-bold.woff`

## Font License

**Lora** is licensed under the [SIL Open Font License 1.1](https://scripts.sil.org/OFL).

- **Source:** [Google Fonts](https://fonts.google.com/specimen/Lora)
- **License:** SIL Open Font License 1.1
- **License URL:** https://scripts.sil.org/OFL
- **Copyright:** Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora)

You are free to use, modify, and distribute Lora in your projects under the terms of the SIL Open Font License.

## Font Fallbacks

The CSS includes CJK-friendly fallbacks for Chinese, Japanese, and other international characters:
- Chinese: PingFang SC, Hiragino Sans GB, Microsoft YaHei
- Japanese: Hiragino Kaku Gothic ProN, Hiragino Sans, Yu Gothic, Meiryo

These fallbacks ensure proper rendering of non-Latin characters since Lora (a serif font) may not support CJK glyphs.

## Benefits of Self-Hosting

- **GDPR Compliance**: No data sharing with Google servers
- **Performance**: Faster loading from your own CDN/server
- **Offline Support**: Works without external dependencies
- **Privacy**: No IP address logging by third parties
