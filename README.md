# Nano Banana Image Processor

A web application for bulk processing images through Google's nano banana API.

## Features

- **Single or Batch Upload**: Drag & drop one or many images at once
- **Instant Status**: Each upload waits for the AI pipeline to finish and returns the final art in one response
- **Side-by-Side Preview**: See the original and enhanced image together
- **Download Options**: Grab the AI-only output or the fully enhanced version in JPG or PNG

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

- `POST /api/process-image` - Upload and process a single image (responds only after completion)
- `POST /api/process-batch` - Upload and process multiple images (still streaming results per file)
- `GET /api/download-by-token` - Secure download endpoint for finished files. Pass the `token` returned by `process-image` along with optional `format` and `filename` query params.

## Status

✅ **Fully functional** with Google's Gemini AI image generation API integrated!

## Important Notes

- All generated images include SynthID watermarks (Gemini feature)
- Best results with specific, detailed prompts
- Supports common image formats: JPG, PNG, GIF, WebP, BMP
- 10MB file size limit per image
- Processing time varies based on image complexity and prompt

## Troubleshooting

## Environment Variables

- **GEMINI_API_KEY**: Google Gemini API key (required)
- **PICSART_API_KEY**: Picsart API key for background removal and upscaling (optional but recommended)
- **ENABLE_BG_REMOVAL**: true/false (default true)
- **PORT**: default 3000 for local

- If images fail to process, check the server console for error messages
- Ensure your prompts are specific and descriptive for best results
- Large images may take longer to process

## Deploying to Vercel

1. Push to GitHub.
2. In Vercel, import the repo.
3. Set Environment Variables: GEMINI_API_KEY, PICSART_API_KEY (optional), ENABLE_BG_REMOVAL (optional).
4. Build & deploy.

Note: This app runs an Express server on PORT. Use a Node Server preset or set the Start Command to npm start.

### Environment variable reminder for downloads

- `DOWNLOAD_TOKEN_SECRET` (optional): Secret used to sign download tokens in production. If you do not supply one, a default development value is used.
