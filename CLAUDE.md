# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a web application for bulk processing images using Google's Gemini AI API (previously referred to as "nano banana"). It's designed for Etsy sellers to generate apparel-ready designs from inspiration images.

## Key Architecture

### Frontend-Backend Communication Flow
1. **Client** (script.js) uploads images and prompts via FormData to Express server
2. **Server** creates job IDs and tracks processing state in-memory (processingJobs Map)
3. **Async Processing**: Images are processed via Gemini API with polling-based status checks
4. **Download Pipeline**: Processed images are stored as PNG, converted to requested format on download

### Image Processing Pipeline
1. Images uploaded to `./uploads/` directory
2. Gemini API called with strict prompts to generate apparel designs (transparent backgrounds, no text)
3. Results saved as PNG in `./processed/` directory
4. Format conversion happens at download time using Sharp library

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

### Gemini API Integration (server.js:252-346)
- Uses REST API directly (v1beta endpoint) instead of SDK
- Enforces design constraints via prompt engineering (lines 263-276)
- Always saves processed images as PNG internally for consistency
- Requires GEMINI_API_KEY environment variable

### Format Conversion (server.js:143-191)
- Download endpoint handles JPG/JPEG/PNG conversion on-the-fly
- Uses Sharp library for image format conversion
- Preserves original filename with new extension

### Job Management
- In-memory job tracking using Map (processingJobs)
- Polling-based status checks with 5-second intervals
- Maximum 5-minute timeout for processing

## Environment Configuration

Required environment variable:
- `GEMINI_API_KEY`: Google Gemini API key for image generation

## Known Issues & Constraints

- 10MB file size limit per image
- No persistent storage - jobs lost on server restart
- Gemini adds SynthID watermarks to generated images
- Processing time varies based on image complexity