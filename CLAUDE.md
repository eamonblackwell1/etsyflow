# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web application for bulk processing images using Google's Gemini AI API and Picsart API integration. It's designed for Etsy sellers to generate high-quality apparel-ready designs from inspiration images through a multi-stage processing pipeline.

## Key Architecture

### Frontend-Backend Communication Flow
1. **Client** (script.js) uploads images and prompts via FormData to Express server
2. **Server** creates job IDs and tracks processing state in-memory (processingJobs Map)
3. **Async Processing**: Images are processed via Gemini API with polling-based status checks
4. **Download Pipeline**: Processed images are stored as PNG, converted to requested format on download

### Image Processing Pipeline
1. **Upload**: Images uploaded to `./uploads/` directory (10MB limit)
2. **Gemini Processing**: AI generates apparel designs using strict prompt engineering (transparent backgrounds, no text)
3. **Background Removal** (Optional per job): Picsart API removes/refines background for cleaner results
4. **Upscaling**: Picsart API upscales images for high-quality output
5. **Storage**: All processed images saved as PNG in `./processed/` directory
6. **Download**: Format conversion (JPG/PNG) happens on-demand using Sharp library

The pipeline gracefully handles failures - if Picsart steps fail, it falls back to Gemini-only output. Background removal can be toggled per job via the UI checkbox.

## Development Commands

```bash
# Install dependencies
npm install

# Run server (production)
npm start

# Run with auto-reload (development)
npm run dev

# Server runs on http://localhost:3000
```

## Critical Implementation Details

### Gemini API Integration (server.js:358-521)
- Uses REST API directly (v1beta endpoint) instead of SDK for reliability
- Enforces design constraints via strict prompt engineering (lines 372-384)
- Always saves processed images as PNG internally for consistency
- Requires GEMINI_API_KEY environment variable

### Picsart API Integration (server.js:536-697)
- Background removal using `/tools/1.0/removebg` endpoint
- Image upscaling using `/tools/1.0/upscale` endpoint with 2x factor
- Graceful error handling with fallback to Gemini-only output
- Requires PICSART_API_KEY environment variable

### Format Conversion & Downloads (server.js:188-284)
- Two download endpoints: `/api/download-gemini/` (AI-only) and `/api/download/` (enhanced)
- On-the-fly format conversion (JPG/PNG) using Sharp library
- Preserves original filename with new extension

### Job Management & Status Tracking
- In-memory job tracking using Map (processingJobs) - resets on server restart
- Detailed status tracking: `gemini_processing` → `gemini_complete` → (`removing_background` if enabled) → `upscaling_image` → `pipeline_complete`
- Client-side polling every 5 seconds with 5-minute timeout
- Multiple completion states: `pipeline_complete`, `partial_pipeline_success`, `picsart_failed_fallback`
- Per-job `removeBg` flag controls whether background removal step is performed

### Background Removal Toggle Feature
- UI checkbox "Remove background before upscaling" (unchecked by default)
- Frontend passes `removeBg` boolean via FormData to server endpoints
- Server-side `ENABLE_BG_REMOVAL` environment variable sets global default
- Each job has individual `removeBg` property that overrides global setting
- Progress messages adapt based on whether background removal is enabled for the job

## Environment Configuration

Required environment variables:
- `GEMINI_API_KEY`: Google Gemini API key for AI image generation
- `PICSART_API_KEY`: Picsart API key for background removal and upscaling

Optional environment variables:
- `ENABLE_BG_REMOVAL`: Global default for background removal (defaults to `true`)
- `PORT`: Server port (defaults to 3000)

Both APIs have usage limits and costs - monitor usage accordingly.

## Known Issues & Constraints

- 10MB file size limit per image upload
- No persistent storage - jobs and processing state lost on server restart
- Gemini adds SynthID watermarks to generated images (unavoidable)
- Processing time varies based on image complexity (typically 30-120 seconds)
- Picsart API calls may fail - application gracefully falls back to Gemini-only output
- All processed images stored locally in `./processed/` directory (manual cleanup required)

## File Structure

```
├── server.js          # Express server with API endpoints
├── script.js          # Frontend JavaScript (ImageProcessor class)
├── index.html         # Main UI
├── styles.css         # UI styling with status indicators
├── package.json       # Dependencies and scripts
├── uploads/           # Temporary storage for uploaded images
├── processed/         # Final processed images (PNG format)
└── .env              # Environment variables (API keys)
```