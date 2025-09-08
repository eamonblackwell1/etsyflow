# Nano Banana Image Processor

A web application for bulk processing images through Google's nano banana API.

## Features

- **Bulk Upload**: Drag & drop or select multiple images at once
- **Progress Tracking**: Real-time progress bars for individual and overall processing
- **Grid Display**: Clean grid layout showing original and processed images side-by-side
- **Reprompt**: Re-process individual images with different prompts
- **Download**: Save processed images to your computer

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   # or for development with auto-reload:
   npm run dev
   ```

3. **Open in Browser**
   Navigate to `http://localhost:3000`

**Note**: The Gemini API key is already configured in the server. If you need to use a different key, set the `GEMINI_API_KEY` environment variable.

## Usage

1. **Upload Images**: Drag & drop or click to select multiple image files
2. **Enter Prompt**: Type your processing prompt in the input field
3. **Process**: Click "Process All Images" to start batch processing
4. **Monitor Progress**: Watch the progress bar and individual image cards
5. **Download Results**: Click download button on completed images
6. **Reprompt**: Use reprompt button to reprocess with different prompts

## File Structure

```
├── index.html          # Main web interface
├── styles.css          # Styling
├── script.js           # Frontend JavaScript
├── server.js           # Backend API server
├── package.json        # Node.js dependencies
├── uploads/            # Temporary uploaded images
└── processed/          # Processed output images
```

## API Endpoints

- `POST /api/process-image` - Process single image
- `POST /api/process-batch` - Process multiple images
- `GET /api/job/:jobId` - Check processing status
- `GET /api/download/:jobId` - Download processed image

## Status

✅ **Fully functional** with Google's Gemini AI image generation API integrated!

## Important Notes

- All generated images include SynthID watermarks (Gemini feature)
- Best results with specific, detailed prompts
- Supports common image formats: JPG, PNG, GIF, WebP, BMP
- 10MB file size limit per image
- Processing time varies based on image complexity and prompt

## Troubleshooting

- If images fail to process, check the server console for error messages
- Ensure your prompts are specific and descriptive for best results
- Large images may take longer to process