const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const os = require('os');
// Load environment variables
// Note: On Vercel, env vars come from dashboard, not .env file
if (process.env.NODE_ENV !== 'production' && !process.env.VERCEL) {
    require('dotenv').config();
    console.log('Loaded .env file (local development)');
}
// Using direct REST call to Gemini API (v1beta) to avoid SDK version mismatches

const app = express();
const PORT = process.env.PORT || 3000;

// API keys (Gemini required, Picsart optional)
// Support common env names on Vercel
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const PICSART_API_KEY = process.env.PICSART_API_KEY;

// Log startup environment info
console.log('Server starting with environment:', {
    NODE_ENV: process.env.NODE_ENV,
    VERCEL: !!process.env.VERCEL,
    PORT: process.env.PORT || 3000,
    API_KEYS: {
        GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
        GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
        NEXT_PUBLIC_GOOGLE_API_KEY: !!process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
        PICSART_API_KEY: !!process.env.PICSART_API_KEY,
        resolvedGeminiKey: !!GEMINI_API_KEY,
        resolvedValue: GEMINI_API_KEY ? `${GEMINI_API_KEY.substring(0, 8)}...` : 'NOT SET'
    }
});

const STATIC_PROMPT = `Role
You are an expert conceptual graphic designer. Create a new, original graphic inspired by an uploaded reference image.

Do this silently
Perform your visual analysis internally and do not output your reasoning.

Internal analysis checklist
- Subject and key parts
- Style family and rendering method
- Composition pattern and silhouette
- Color relationships and value contrast
- Mood and era cues

Creative mandate
Produce a design that feels like a close cousin to the reference, not a sibling. Target a novelty range of about 25 to 35 percent. Keep the same subject category, same broad style family, and same general compositional balance, but change specific details so the result is clearly new.

Required variation
Make at least 3 meaningful changes across different axes:
1. Subject pose or angle (stance, head turn, limb position, camera angle)
2. Feature treatment (line weight, texture pattern, edge quality, detailing density)
3. Secondary elements (swap or reposition props, foliage, clouds, stars, background motifs)
4. Composition spacing (scale, spacing, overlap, framing)
5. Color rewrite (fresh palette with at least two new hues or shifted temperature/value structure)
6. Stylization tweak (inkier lines, softer grain, halftone, etc.)

Hard constraints
- Do not trace or replicate shapes, contours, or textures one-to-one
- Do not reproduce the exact pose, element count/arrangement, or color codes
- No text, logos, signatures, or watermarks
- No brand identifiers or copyrighted marks

Target look
- Same subject type as the reference (bear -> bear, pizza -> pizza)
- Same composition family, but with altered spacing/feature emphasis for freshness
- Harmonious, printable palette with clean value separation

Output specs
- Single, isolated design centered on a pure white background
- Clear silhouette with large, readable shapes for apparel printing
- No text, no logos, no watermarks
- High-resolution raster suitable for print

Quality control self-check
Before finalizing, compare mentally against the reference: if pose, silhouette, arrangement, and palette feel near-identical, regenerate with larger adjustments.

Deliver
Generate 1 version that meets the above rules.`;

// Feature flags
const ENABLE_BG_REMOVAL = (process.env.ENABLE_BG_REMOVAL || 'true').toLowerCase() !== 'false';

function assertGeminiKey() {
    if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
        console.error('Missing API key. Checked:', {
            GEMINI_API_KEY: !!process.env.GEMINI_API_KEY,
            GOOGLE_API_KEY: !!process.env.GOOGLE_API_KEY,
            NEXT_PUBLIC_GOOGLE_API_KEY: !!process.env.NEXT_PUBLIC_GOOGLE_API_KEY,
            allEnvKeys: Object.keys(process.env).filter(k => k.includes('KEY')).sort()
        });
        throw new Error('GEMINI_API_KEY (or GOOGLE_API_KEY) environment variable is not set');
    }
}

// Middleware
app.use(cors());
app.use(express.json());

// Serve static site from an absolute path (works in Vercel Node runtime)
const STATIC_DIR = path.resolve(__dirname, 'public');
app.use(express.static(STATIC_DIR));

// NOTE: SPA fallback must be registered AFTER API routes so it doesn't
// intercept GET requests like /api/job/:id. We'll add it near the end.

// Directories (use tmp on serverless platforms like Vercel)
const BASE_WORK_DIR = process.env.VERCEL ? os.tmpdir() : path.resolve('.');
const UPLOADS_DIR = path.join(BASE_WORK_DIR, 'uploads');
const PROCESSED_DIR = path.join(BASE_WORK_DIR, 'processed');

// Ensure working dirs exist
try {
    if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    if (!fs.existsSync(PROCESSED_DIR)) fs.mkdirSync(PROCESSED_DIR, { recursive: true });
} catch (e) {
    console.warn('Could not prepare working directories:', e?.message || e);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, UPLOADS_DIR);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    },
    fileFilter: function (req, file, cb) {
        if (!file.mimetype.startsWith('image/')) {
            return cb(new Error('Only image files are allowed'));
        }
        cb(null, true);
    }
});

// Store for tracking processing jobs
const processingJobs = new Map();

// API Routes

// Simple test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        message: 'API is working',
        timestamp: new Date().toISOString(),
        env: {
            node: process.version,
            platform: process.platform,
            isVercel: !!process.env.VERCEL,
            hasKeys: {
                anyGeminiKey: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.NEXT_PUBLIC_GOOGLE_API_KEY),
                resolvedGeminiKey: !!GEMINI_API_KEY
            }
        }
    });
});

// Test timeout logic
app.get('/api/test-timeout', async (req, res) => {
    const testDelay = parseInt(req.query.delay) || 5000;
    console.log(`Testing timeout with ${testDelay}ms delay`);
    
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Test timed out after 3 seconds`));
        }, 3000);
    });
    
    const delayPromise = new Promise((resolve) => {
        setTimeout(() => {
            resolve({ message: `Completed after ${testDelay}ms` });
        }, testDelay);
    });
    
    try {
        const result = await Promise.race([delayPromise, timeoutPromise]);
        res.json({ success: true, result, actualDelay: testDelay });
    } catch (error) {
        res.json({ success: false, error: error.message, actualDelay: testDelay });
    }
});

// Test Gemini API connectivity
app.get('/api/test-gemini', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) {
            return res.status(400).json({ error: 'No Gemini API key configured' });
        }
        
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent';
        const testBody = {
            contents: [{
                parts: [{ text: 'Say "API is working" and nothing else.' }]
            }]
        };
        
        const response = await axios.post(url, testBody, {
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': GEMINI_API_KEY
            },
            timeout: 10000
        });
        
        res.json({
            success: true,
            message: 'Gemini API is accessible',
            response: response.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'No text response'
        });
    } catch (error) {
        console.error('Gemini test failed:', error.response?.data || error.message);
        res.status(500).json({
            success: false,
            error: error.response?.data?.error?.message || error.message,
            status: error.response?.status,
            hint: error.response?.status === 401 ? 'Check your API key in Vercel dashboard' : undefined
        });
    }
});

// Health check with debug info
app.get('/api/health', (req, res) => {
    const hasGeminiKey = !!(GEMINI_API_KEY && GEMINI_API_KEY.trim());
    const hasPicsartKey = !!(PICSART_API_KEY && PICSART_API_KEY.trim());
    
    res.json({ 
        status: 'ok', 
        message: 'Server is running',
        environment: process.env.NODE_ENV || 'development',
        platform: process.env.VERCEL ? 'vercel' : 'local',
        keys: {
            gemini: hasGeminiKey,
            picsart: hasPicsartKey
        },
        // Debug info (remove in production)
        debug: {
            geminiKeyLength: GEMINI_API_KEY ? GEMINI_API_KEY.length : 0,
            picsartKeyLength: PICSART_API_KEY ? PICSART_API_KEY.length : 0,
            envKeys: Object.keys(process.env).filter(k => k.includes('API_KEY') || k.includes('GOOGLE')).map(k => `${k}: ${process.env[k] ? 'set' : 'unset'}`)
        }
    });
});

// Process single image
app.post('/api/process-image', (req, res) => {
    // Log request meta to help diagnose client issues
    try {
        console.log('Incoming /api/process-image', {
            contentType: req.headers['content-type'],
            contentLength: req.headers['content-length']
        });
    } catch (e) {}

    // Wrap multer so we can return friendly errors
    upload.single('image')(req, res, async (err) => {
        if (err) {
            console.error('Multer upload error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large (max 10MB)' });
            }
            return res.status(400).json({ error: err.message || 'Upload failed' });
        }

        try {
            // Some environments strip content-type boundaries; rely on multer success instead of strict check

            if (!req.file) {
                return res.status(400).json({ error: 'No image file provided (field name must be "image")' });
            }

            const { prompt: incomingPrompt } = req.body;
            const removeBgRaw = (req.body.removeBg || '').toString().toLowerCase();
            const removeBg = removeBgRaw === 'true' || (removeBgRaw === '' && ENABLE_BG_REMOVAL);
            const prompt = (incomingPrompt && incomingPrompt.trim().length > 0)
                ? incomingPrompt.trim()
                : STATIC_PROMPT;

            const jobId = generateJobId();
            const imageData = {
                jobId,
                originalPath: req.file.path,
                originalName: req.file.originalname,
                prompt,
                removeBg,
                status: 'processing',
                createdAt: new Date()
            };

            processingJobs.set(jobId, imageData);

            // Start processing in background
            processImageWithNanoBanana(imageData)
                .then(result => {
                    imageData.status = 'complete';
                    imageData.processedPath = result.processedPath;
                    imageData.completedAt = new Date();
                })
                .catch(error => {
                    console.error('Processing error:', error);
                    imageData.status = 'error';
                    imageData.error = error.message;
                    imageData.completedAt = new Date();
                });

            return res.json({
                jobId,
                status: 'processing',
                originalName: req.file.originalname
            });

        } catch (error) {
            console.error('Upload error:', error);
            return res.status(500).json({ error: 'Upload failed: ' + (error && error.message ? error.message : String(error)) });
        }
    });
});

// Check job status
app.get('/api/job/:jobId', (req, res) => {
    const job = processingJobs.get(req.params.jobId);
    if (!job) {
        return res.status(404).json({ error: 'Job not found' });
    }

    const response = {
        jobId: job.jobId,
        status: job.status,
        originalName: job.originalName,
        prompt: job.prompt,
        createdAt: job.createdAt
    };

    // Add lastUpdated if available
    if (job.lastUpdated) {
        response.lastUpdated = job.lastUpdated;
    }

    // Add processing stage information
    const completedStatuses = ['complete', 'pipeline_complete', 'partial_pipeline_success', 'picsart_failed_fallback'];
    if (completedStatuses.includes(job.status) && job.processedPath) {
        response.processedUrl = `/api/download/${job.jobId}`;
    }

    // Add Gemini download URL if available
    if (job.geminiDownloadPath) {
        response.geminiUrl = `/api/download-gemini/${job.jobId}`;
    }

    // Add progress information based on status
    switch (job.status) {
        case 'processing':
        case 'gemini_processing':
            response.progress = 'Generating design with AI...';
            break;
        case 'gemini_complete':
            response.progress = job.removeBg ? 'AI design complete, removing background...' : 'AI design complete, upscaling...';
            break;
        case 'removing_background':
            response.progress = 'Removing background...';
            break;
        case 'upscaling_image':
            response.progress = 'Upscaling image for high quality...';
            break;
        case 'pipeline_complete':
            response.progress = 'Processing complete!';
            break;
        case 'partial_pipeline_success':
            response.progress = 'Processing complete (partial enhancement)';
            break;
        case 'picsart_failed_fallback':
            response.progress = 'Processing complete (using fallback)';
            break;
        case 'complete':
            response.progress = 'Complete!';
            break;
    }

    if (job.status === 'error') {
        response.error = job.error;
    }

    res.json(response);
});

// Download Gemini-only processed image
app.get('/api/download-gemini/:jobId', async (req, res) => {
    const job = processingJobs.get(req.params.jobId);
    if (!job || !job.geminiDownloadPath) {
        return res.status(404).json({ error: 'Gemini image not found' });
    }

    if (!fs.existsSync(job.geminiDownloadPath)) {
        return res.status(404).json({ error: 'File not found on disk' });
    }

    const requestedFormatRaw = (req.query.format || '').toString().toLowerCase();
    const requestedFormat = ['jpg', 'jpeg', 'png'].includes(requestedFormatRaw) ? requestedFormatRaw : null;

    // If no conversion requested, stream the file inline for preview
    if (!requestedFormat) {
        return res.sendFile(path.resolve(job.geminiDownloadPath));
    }

    try {
        // Read source buffer and convert format
        const sourceBuffer = fs.readFileSync(job.geminiDownloadPath);
        let transformer = sharp(sourceBuffer);

        if (requestedFormat === 'png') {
            transformer = transformer.png({ compressionLevel: 9 });
        } else {
            // Flatten transparency onto white to avoid black backgrounds in JPEG
            transformer = transformer
                .flatten({ background: { r: 255, g: 255, b: 255 } })
                .jpeg({ quality: 92, mozjpeg: true });
        }

        const outputBuffer = await transformer.toBuffer();

        const baseName = path.basename(job.originalName, path.extname(job.originalName));
        const outName = `gemini_${baseName}.${requestedFormat === 'jpeg' ? 'jpg' : requestedFormat}`;
        const mime = requestedFormat === 'png' ? 'image/png' : 'image/jpeg';

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
        return res.send(outputBuffer);
    } catch (err) {
        console.error('Gemini download conversion error:', err);
        // Fallback to raw download with actual extension
        const actualExt = path.extname(job.geminiDownloadPath) || '.png';
        const baseName = path.basename(job.originalName, path.extname(job.originalName));
        const filename = `gemini_${baseName}${actualExt}`;
        return res.download(job.geminiDownloadPath, filename);
    }
});

// Download final processed image (with Picsart enhancements if successful)
app.get('/api/download/:jobId', async (req, res) => {
    const job = processingJobs.get(req.params.jobId);
    const completedStatuses = ['complete', 'pipeline_complete', 'partial_pipeline_success', 'picsart_failed_fallback'];
    if (!job || !completedStatuses.includes(job.status) || !job.processedPath) {
        return res.status(404).json({ error: 'Processed image not found' });
    }

    if (!fs.existsSync(job.processedPath)) {
        return res.status(404).json({ error: 'File not found on disk' });
    }

    const requestedFormatRaw = (req.query.format || '').toString().toLowerCase();
    const requestedFormat = ['jpg', 'jpeg', 'png'].includes(requestedFormatRaw) ? requestedFormatRaw : null;

    // If no conversion requested, stream the file inline for preview
    if (!requestedFormat) {
        return res.sendFile(path.resolve(job.processedPath));
    }

    try {
        // Read source buffer
        const sourceBuffer = fs.readFileSync(job.processedPath);
        let transformer = sharp(sourceBuffer);

        // Ensure we output the requested format
        if (requestedFormat === 'png') {
            transformer = transformer.png({ compressionLevel: 9 });
        } else {
            // treat jpg and jpeg the same; flatten transparency to white for JPEG
            transformer = transformer
                .flatten({ background: { r: 255, g: 255, b: 255 } })
                .jpeg({ quality: 92, mozjpeg: true });
        }

        const outputBuffer = await transformer.toBuffer();

        const baseName = path.basename(job.originalName, path.extname(job.originalName));
        const outName = `processed_${baseName}.${requestedFormat === 'jpeg' ? 'jpg' : requestedFormat}`;
        const mime = requestedFormat === 'png' ? 'image/png' : 'image/jpeg';

        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `attachment; filename="${outName}"`);
        return res.send(outputBuffer);
    } catch (err) {
        console.error('Download conversion error:', err);
        // Fallback to raw download with actual extension
        const actualExt = path.extname(job.processedPath) || '.png';
        const baseName = path.basename(job.originalName, path.extname(job.originalName));
        const filename = `processed_${baseName}${actualExt}`;
        return res.download(job.processedPath, filename);
    }
});

// Process multiple images
app.post('/api/process-batch', (req, res) => {
    try {
        console.log('Incoming /api/process-batch', {
            contentType: req.headers['content-type'],
            contentLength: req.headers['content-length']
        });
    } catch (e) {}

    upload.array('images', 20)(req, res, async (err) => {
        if (err) {
            console.error('Multer batch upload error:', err);
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'One or more files too large (max 10MB each)' });
            }
            return res.status(400).json({ error: err.message || 'Batch upload failed' });
        }

        try {
            if (!req.files || req.files.length === 0) {
                return res.status(400).json({ error: 'No image files provided' });
            }

            const { prompt: incomingPrompt } = req.body;
            const removeBgRaw = (req.body.removeBg || '').toString().toLowerCase();
            const removeBg = removeBgRaw === 'true' || (removeBgRaw === '' && ENABLE_BG_REMOVAL);
            const prompt = (incomingPrompt && incomingPrompt.trim().length > 0)
                ? incomingPrompt.trim()
                : STATIC_PROMPT;

            const jobs = req.files.map(file => {
                const jobId = generateJobId();
                const imageData = {
                    jobId,
                    originalPath: file.path,
                    originalName: file.originalname,
                    prompt,
                    removeBg,
                    status: 'processing',
                    createdAt: new Date()
                };

                processingJobs.set(jobId, imageData);

                // Start processing in background
                processImageWithNanoBanana(imageData)
                    .then(result => {
                        imageData.status = 'complete';
                        imageData.processedPath = result.processedPath;
                        imageData.completedAt = new Date();
                    })
                    .catch(error => {
                        console.error('Processing error:', error);
                        imageData.status = 'error';
                        imageData.error = error.message;
                        imageData.completedAt = new Date();
                    });

                return {
                    jobId,
                    originalName: file.originalname,
                    status: 'processing'
                };
            });

            return res.json({ jobs });
        } catch (error) {
            console.error('Batch upload error:', error);
            return res.status(500).json({ error: 'Batch upload failed: ' + (error && error.message ? error.message : String(error)) });
        }
    });
});

// Utility functions
function generateJobId() {
    return 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function updateJobStatus(jobId, status, additionalData = {}) {
    const job = processingJobs.get(jobId);
    if (job) {
        job.status = status;
        job.lastUpdated = new Date();
        
        // Add any additional data (like intermediate paths, progress, etc.)
        Object.assign(job, additionalData);
        
        console.log(`Job ${jobId} status updated to: ${status}`);
    }
}

async function processImageWithNanoBanana(imageData) {
    const jobStartTime = Date.now();
    
    // Create a timeout promise that will reject after 28 seconds (within Vercel's 30s limit)
    const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => {
            reject(new Error(`Job ${imageData.jobId} timed out after 28 seconds (Vercel function limit)`));
        }, 28000);
    });
    
    // Create the main processing promise
    const processingPromise = (async () => {
        try {
            console.log(`[${imageData.jobId}] Starting processing: ${imageData.originalName} with prompt: "${imageData.prompt}"`);
            
            // Update status to Gemini processing with timestamp
            updateJobStatus(imageData.jobId, 'gemini_processing', { startTime: jobStartTime });
            
            // Read the image file and convert to base64
            const imageBuffer = fs.readFileSync(imageData.originalPath);
            const imageBase64 = imageBuffer.toString('base64');
            const imageMimeType = getMimeType(imageData.originalPath);

            assertGeminiKey();

            // Build a stricter prompt wrapper to improve adherence to constraints
            const instructionPreamble = [
                'You are an expert apparel graphic designer. Follow ALL constraints strictly:',
                '- Use the uploaded image ONLY as inspiration for motif, silhouette, and palette.',
                '- OUTPUT: a single isolated design suitable for printing on apparel.',
                '- TRANSPARENT background, no mockups, no garment, no model, no scene.',
                '- NO text, letters, numbers, watermarks, brand marks, or logos.',
                '- Clean contours, large readable shapes; keep style simple and legible.',
                '',
                'If the user asks for a mockup or scene, IGNORE that and produce only the isolated design.'
            ].join('\n');

            const finalPrompt = `${instructionPreamble}\n\nUser instructions:\n${imageData.prompt}`;

            // Direct REST request to v1beta endpoint per official docs
            const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image-preview:generateContent';
            const body = {
                generationConfig: { temperature: 0.3 },
                contents: [
                    {
                        parts: [
                            { text: finalPrompt },
                            { inlineData: { mimeType: imageMimeType, data: imageBase64 } }
                        ]
                    }
                ]
            };
            // Add timeout and better error handling
            console.log(`[${imageData.jobId}] Calling Gemini API with timeout 25s...`);
            console.log(`[${imageData.jobId}] Image size: ${Math.round(imageBuffer.length / 1024)}KB`);
            console.log(`[${imageData.jobId}] API URL: ${url}`);
            
            const startTime = Date.now();
            const { data } = await axios.post(url, body, {
                headers: {
                    'Content-Type': 'application/json',
                    'x-goog-api-key': GEMINI_API_KEY
                },
                timeout: 25000, // 25 second timeout (within Vercel limits)
                maxContentLength: 50 * 1024 * 1024, // 50MB max response
                maxBodyLength: 50 * 1024 * 1024
            }).catch(error => {
                const elapsed = Date.now() - startTime;
                console.error(`[${imageData.jobId}] Gemini API request failed after ${elapsed}ms:`, {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    code: error.code,
                    message: error.message
                });
                
                if (error.code === 'ECONNABORTED') {
                    throw new Error('Gemini API request timed out after 25 seconds (Vercel function limit)');
                } else if (error.response?.status === 401) {
                    throw new Error('Invalid API key - please check GEMINI_API_KEY in Vercel dashboard');
                } else if (error.response?.status === 403) {
                    throw new Error('API key is valid but lacks permissions or quota exceeded');
                } else if (error.response?.status === 400) {
                    const detail = error.response?.data?.error?.message || 'Invalid request';
                    throw new Error(`Gemini API error: ${detail}`);
                }
                throw error;
            });
            
            const elapsed = Date.now() - startTime;
            console.log(`[${imageData.jobId}] Gemini API response received after ${elapsed}ms`);
            console.log(`[${imageData.jobId}] Response status: SUCCESS`);

            // Check if the response contains generated image data
            const candidates = data && data.candidates;
            if (!candidates || candidates.length === 0) {
                throw new Error('No candidates returned from Gemini API');
            }
            
            const candidate = candidates[0];
            const parts = candidate.content && candidate.content.parts ? candidate.content.parts : [];
        
        // Look for inline image data in the response
        const imageParts = parts.filter(part => part.inlineData && part.inlineData.data);
        
        if (imageParts.length > 0) {
            // Extract the generated image data
            const generatedImageData = imageParts[0].inlineData.data;
            
            // Ensure processed directory exists
            const processedDir = PROCESSED_DIR;
            if (!fs.existsSync(processedDir)) {
                fs.mkdirSync(processedDir, { recursive: true });
            }

            // Save the Gemini-generated image as PNG
            const geminiFilename = `gemini_${Date.now()}_${path.basename(imageData.originalPath, path.extname(imageData.originalPath))}.png`;
            const geminiPath = path.join(processedDir, geminiFilename);
            const outputBuffer = Buffer.from(generatedImageData, 'base64');
            
            // Convert to PNG format using sharp to ensure consistency
            const pngBuffer = await sharp(outputBuffer)
                .png({ compressionLevel: 9 })
                .toBuffer();
            
            fs.writeFileSync(geminiPath, pngBuffer);
            console.log(`Gemini image generated and saved: ${geminiPath}`);
            
            // Update status: Gemini complete, starting Picsart processing
            updateJobStatus(imageData.jobId, 'gemini_complete', { geminiPath, geminiDownloadPath: geminiPath });
            
            // Process with Picsart pipeline: Background Removal → Upscaling (background optional per job)
            let finalProcessedPath = geminiPath;
            let bgRemovedPath = null;
            let pipelineErrors = [];
            
            // Step 1: Remove background using Picsart (optional)
            try {
                if (imageData.removeBg && PICSART_API_KEY) {
                    updateJobStatus(imageData.jobId, 'removing_background');
                    bgRemovedPath = await processPicsartBackgroundRemoval(geminiPath);
                    finalProcessedPath = bgRemovedPath;
                    console.log('Background removal successful');
                } else {
                    console.log('Background removal disabled or PICSART_API_KEY missing; skipping to upscaling');
                    bgRemovedPath = geminiPath;
                    finalProcessedPath = geminiPath;
                }
            } catch (bgError) {
                console.error('Background removal failed:', bgError.message);
                pipelineErrors.push(`Background removal: ${bgError.message}`);
                // Continue with original Gemini image
                bgRemovedPath = geminiPath;
                finalProcessedPath = geminiPath;
            }
            
            // Step 2: Upscale the image using Picsart (optional)
            try {
                if (PICSART_API_KEY) {
                    updateJobStatus(imageData.jobId, 'upscaling_image');
                    const upscaledPath = await processPicsartUpscaling(finalProcessedPath, 2);
                
                    // Clean up intermediate files only if upscaling succeeded
                    if (bgRemovedPath && bgRemovedPath !== geminiPath && fs.existsSync(bgRemovedPath)) {
                        fs.unlinkSync(bgRemovedPath);
                    }
                    // Keep the Gemini PNG for AI-only downloads
                    
                    finalProcessedPath = upscaledPath;
                    console.log('Upscaling successful');
                } else {
                    console.log('PICSART_API_KEY missing; skipping upscaling');
                }
            } catch (upscaleError) {
                console.error('Upscaling failed:', upscaleError.message);
                pipelineErrors.push(`Upscaling: ${upscaleError.message}`);
                // Keep the current path (either bg-removed or original Gemini)
            }
            
            // Update final status based on what succeeded
            if (pipelineErrors.length === 0) {
                console.log(`Complete pipeline processing finished: ${finalProcessedPath}`);
                updateJobStatus(imageData.jobId, 'pipeline_complete');
            } else if (pipelineErrors.length === 1) {
                console.log(`Partial pipeline success with fallback: ${finalProcessedPath}`);
                updateJobStatus(imageData.jobId, 'partial_pipeline_success', { 
                    pipelineErrors: pipelineErrors 
                });
            } else {
                console.log(`Pipeline failed, using Gemini output: ${finalProcessedPath}`);
                updateJobStatus(imageData.jobId, 'picsart_failed_fallback', { 
                    pipelineErrors: pipelineErrors 
                });
            }
            
            return { processedPath: finalProcessedPath };
            
        } else {
            // If no image is generated, check for text response
            const textParts = parts.filter(part => part.text);
            if (textParts.length > 0) {
                const text = textParts.map(part => part.text).join(' ');
                console.log('Gemini text response:', text);
                throw new Error(`Image generation failed. Gemini response: ${text.substring(0, 200)}...`);
            } else {
                throw new Error('No image or text response received from Gemini API');
            }
        }
        
        } catch (error) {
            // Improve error visibility for troubleshooting
            const details = (error && (error.response?.data || error.response || error.cause || error.stack)) || error;
            console.error(`[${imageData.jobId}] Processing error:`, details);
            const message = (error && error.message) ? error.message : String(error);
            throw new Error(`Image processing failed: ${message}`);
        }
    })();
    
    // Race between processing and timeout
    try {
        return await Promise.race([processingPromise, timeoutPromise]);
    } catch (error) {
        // Update job status to error
        updateJobStatus(imageData.jobId, 'error', { 
            error: error.message,
            endTime: Date.now(),
            duration: Date.now() - jobStartTime 
        });
        throw error;
    }
}

function getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
    };
    return mimeTypes[ext] || 'image/jpeg';
}

async function processPicsartBackgroundRemoval(imagePath) {
    try {
        console.log(`Removing background from: ${imagePath}`);
        
        // Create form data for file upload - minimal parameters to avoid API errors
        const form = new FormData();
        form.append('image', fs.createReadStream(imagePath));
        
        const response = await axios.post('https://api.picsart.io/tools/1.0/removebg', form, {
            headers: {
                'X-Picsart-API-Key': PICSART_API_KEY,
                'accept': 'application/json',
                ...form.getHeaders()
            }
        });
        
        console.log('Picsart background removal response:', response.data);
        
        // Save the processed image with background removed
        const processedDir = PROCESSED_DIR;
        if (!fs.existsSync(processedDir)) {
            fs.mkdirSync(processedDir, { recursive: true });
        }
        
        const filename = `bg_removed_${Date.now()}_${path.basename(imagePath)}`;
        const outputPath = path.join(processedDir, filename);
        
        // Check if response contains an image URL instead of raw image data
        if (response.data && response.data.data && response.data.data.url) {
            // Download the image from the URL
            const imageResponse = await axios.get(response.data.data.url, {
                responseType: 'arraybuffer'
            });
            
            // Convert to PNG using sharp to ensure consistency
            const pngBuffer = await sharp(Buffer.from(imageResponse.data))
                .png({ compressionLevel: 9 })
                .toBuffer();
                
            fs.writeFileSync(outputPath, pngBuffer);
        } else {
            throw new Error('Unexpected Picsart response format: ' + JSON.stringify(response.data));
        }
        
        console.log(`Background removed successfully: ${outputPath}`);
        return outputPath;
        
    } catch (error) {
        console.error('Picsart background removal error:', error);
        
        // Provide more specific error information for debugging
        let errorMessage = 'Background removal failed';
        if (error.response) {
            // HTTP error response from API
            errorMessage += ` (HTTP ${error.response.status})`;
            if (error.response.data) {
                console.error('API Error Response:', error.response.data);
                // Decode buffer if it's a buffer
                if (Buffer.isBuffer(error.response.data)) {
                    const errorText = error.response.data.toString('utf8');
                    console.error('Decoded API Error:', errorText);
                    try {
                        const errorJson = JSON.parse(errorText);
                        if (errorJson.detail) {
                            errorMessage += `: ${errorJson.detail}`;
                        }
                    } catch (parseError) {
                        console.error('Could not parse error JSON:', parseError);
                    }
                }
            }
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            errorMessage += ': Network connection failed';
        } else if (error.message) {
            errorMessage += `: ${error.message}`;
        }
        
        throw new Error(errorMessage);
    }
}

async function processPicsartUpscaling(imagePath, upscaleFactor = 2) {
    try {
        console.log(`Upscaling image: ${imagePath} with factor ${upscaleFactor}`);
        
        // Create form data for file upload - minimal parameters
        const form = new FormData();
        form.append('image', fs.createReadStream(imagePath));
        form.append('upscale_factor', upscaleFactor.toString());
        
        const response = await axios.post('https://api.picsart.io/tools/1.0/upscale', form, {
            headers: {
                'X-Picsart-API-Key': PICSART_API_KEY,
                'accept': 'application/json',
                ...form.getHeaders()
            }
        });
        
        console.log('Picsart upscaling response:', response.data);
        
        // Save the upscaled image
        const processedDir = PROCESSED_DIR;
        if (!fs.existsSync(processedDir)) {
            fs.mkdirSync(processedDir, { recursive: true });
        }
        
        const filename = `upscaled_${Date.now()}_${path.basename(imagePath)}`;
        const outputPath = path.join(processedDir, filename);
        
        // Check if response contains an image URL instead of raw image data
        if (response.data && response.data.data && response.data.data.url) {
            // Download the image from the URL
            const imageResponse = await axios.get(response.data.data.url, {
                responseType: 'arraybuffer'
            });
            
            // Convert to PNG using sharp to ensure consistency
            const pngBuffer = await sharp(Buffer.from(imageResponse.data))
                .png({ compressionLevel: 9 })
                .toBuffer();
                
            fs.writeFileSync(outputPath, pngBuffer);
        } else {
            throw new Error('Unexpected Picsart response format: ' + JSON.stringify(response.data));
        }
        
        console.log(`Image upscaled successfully: ${outputPath}`);
        return outputPath;
        
    } catch (error) {
        console.error('Picsart upscaling error:', error);
        
        // Provide more specific error information for debugging
        let errorMessage = 'Image upscaling failed';
        if (error.response) {
            // HTTP error response from API
            errorMessage += ` (HTTP ${error.response.status})`;
            if (error.response.data) {
                console.error('API Error Response:', error.response.data);
                // Decode buffer if it's a buffer
                if (Buffer.isBuffer(error.response.data)) {
                    const errorText = error.response.data.toString('utf8');
                    console.error('Decoded API Error:', errorText);
                    try {
                        const errorJson = JSON.parse(errorText);
                        if (errorJson.detail) {
                            errorMessage += `: ${errorJson.detail}`;
                        }
                    } catch (parseError) {
                        console.error('Could not parse error JSON:', parseError);
                    }
                }
            }
        } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            errorMessage += ': Network connection failed';
        } else if (error.message) {
            errorMessage += `: ${error.message}`;
        }
        
        throw new Error(errorMessage);
    }
}

// TODO: Implement actual nano banana API integration
async function callNanoBananaAPI(imagePath, prompt) {
    // This is where you'll integrate with Google's nano banana API
    // Example structure:
    /*
    const formData = new FormData();
    formData.append('image', fs.createReadStream(imagePath));
    formData.append('prompt', prompt);
    
    const response = await axios.post('https://api.nanobanana.com/process', formData, {
        headers: {
            'Authorization': `Bearer ${process.env.NANO_BANANA_API_KEY}`,
            ...formData.getHeaders()
        }
    });
    
    return response.data;
    */
    
    throw new Error('Nano banana API integration not yet implemented');
}

// -------------------------
// SPA Fallback (register last)
// -------------------------
app.get('*', (req, res) => {
    return res.sendFile(path.join(STATIC_DIR, 'index.html'));
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!GEMINI_API_KEY) {
        console.warn('Warning: GEMINI_API_KEY/GOOGLE_API_KEY is not set. Requests will fail until it is provided.');
    } else {
        console.log('GEMINI_API_KEY detected. Using Gemini API (REST) for image generation.');
    }
    if (!PICSART_API_KEY) {
        console.warn('Note: PICSART_API_KEY is not set. Background removal and upscaling will be skipped.');
    } else {
        console.log('PICSART_API_KEY detected. Using Picsart API for background removal and upscaling.');
    }
    console.log(`Background removal enabled by default: ${ENABLE_BG_REMOVAL}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    process.exit(0);
});