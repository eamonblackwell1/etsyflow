# Picsart API Integration

## Overview

The Etsy Automation Nano Banana webapp now includes a 3-stage image processing pipeline:

1. **Gemini AI Generation**: Creates apparel-ready designs from inspiration images
2. **Picsart Background Removal**: Removes background for clean, transparent designs
3. **Picsart Upscaling**: Enhances image resolution for high-quality print output

## Setup

### 1. Get Picsart API Key

1. Sign up at [Picsart for Developers](https://picsart.io/developers)
2. Get your API key from the dashboard
3. You start with 50 free credits

### 2. Environment Configuration

Add your Picsart API key to the `.env` file:

```bash
GEMINI_API_KEY=your_gemini_key_here
PICSART_API_KEY=your_picsart_key_here
```

### 3. Start Server

```bash
npm start
```

The server will show warnings if either API key is missing.

## Pipeline Details

### Processing Stages

| Stage | API | Cost | Purpose |
|-------|-----|------|---------|
| 1. AI Generation | Gemini | Free* | Generate apparel design from inspiration |
| 2. Background Removal | Picsart | 8 credits | Clean transparent background |
| 3. Image Upscaling | Picsart | ~3-8 credits | High resolution for printing |

*Gemini may have usage limits

### Status Tracking

The API now provides detailed status updates:

- `processing` / `gemini_processing` - Generating design with AI
- `gemini_complete` - AI design complete, removing background
- `removing_background` - Removing background
- `upscaling_image` - Upscaling image for high quality
- `pipeline_complete` - All processing complete
- `partial_pipeline_success` - Some steps failed, partial success
- `picsart_failed_fallback` - Picsart failed, using Gemini output

### Error Handling & Fallbacks

The system includes robust error handling:

1. **Background removal fails**: Continues with original Gemini image for upscaling
2. **Upscaling fails**: Uses the best available image (background-removed or original)
3. **Both Picsart steps fail**: Falls back to Gemini-generated image
4. **Network issues**: Detailed error messages for debugging

## API Endpoints

### Check Job Status
```http
GET /api/job/{jobId}
```

**Response includes:**
- `status` - Current processing stage
- `progress` - Human-readable progress message
- `lastUpdated` - Timestamp of last status update
- `processedUrl` - Download URL when complete

### Download Processed Image
```http
GET /api/download/{jobId}?format=png
```

Supports: `png`, `jpg`, `jpeg`

## File Management

- **Input**: Uploaded to `./uploads/`
- **Intermediate**: Temporary files in `./processed/` 
- **Output**: Final processed image in `./processed/`
- **Cleanup**: Intermediate files automatically deleted to save space

## Credit Usage

- **Background Removal**: 8 credits per image
- **Upscaling (2x)**: ~3-8 credits per image
- **Total per image**: ~11-16 Picsart credits

Monitor your credit usage in the Picsart dashboard.

## Troubleshooting

### Common Issues

1. **"PICSART_API_KEY environment variable is not set"**
   - Add your API key to `.env` file
   - Restart the server

2. **"Background removal failed (HTTP 401)"**
   - Invalid or expired API key
   - Check your key in Picsart dashboard

3. **"Network connection failed"**
   - Check internet connectivity
   - Verify Picsart API endpoint is accessible

4. **Processing falls back to Gemini output**
   - Picsart API limits reached
   - Check credit balance in dashboard

### Debug Information

The server logs detailed error information including:
- HTTP status codes from Picsart API
- Network connectivity issues
- Credit balance problems
- File processing errors

## Testing

To test the pipeline:

1. Use the existing web interface
2. Upload an image with a prompt
3. Monitor the job status for detailed progress
4. Download the processed result

The system will automatically attempt the full pipeline and gracefully fall back if any step fails.