const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config();
// Using direct REST call to Gemini API (v1beta) to avoid SDK version mismatches

const app = express();
const PORT = process.env.PORT || 3000;

// Gemini API key (required)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function assertApiKey() {
	if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
		throw new Error('GEMINI_API_KEY environment variable is not set');
	}
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('.'));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadsDir = './uploads';
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir);
        }
        cb(null, uploadsDir);
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

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Server is running' });
});

// Process single image
app.post('/api/process-image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No image file provided' });
        }

        const { prompt } = req.body;
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const jobId = generateJobId();
        const imageData = {
            jobId,
            originalPath: req.file.path,
            originalName: req.file.originalname,
            prompt: prompt.trim(),
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

        res.json({
            jobId,
            status: 'processing',
            originalName: req.file.originalname
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed: ' + error.message });
    }
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

    if (job.status === 'complete' && job.processedPath) {
        response.processedUrl = `/api/download/${job.jobId}`;
    }

    if (job.status === 'error') {
        response.error = job.error;
    }

    res.json(response);
});

// Download processed image
app.get('/api/download/:jobId', async (req, res) => {
    const job = processingJobs.get(req.params.jobId);
    if (!job || job.status !== 'complete' || !job.processedPath) {
        return res.status(404).json({ error: 'Processed image not found' });
    }

    if (!fs.existsSync(job.processedPath)) {
        return res.status(404).json({ error: 'File not found on disk' });
    }

    const requestedFormatRaw = (req.query.format || '').toString().toLowerCase();
    const requestedFormat = ['jpg', 'jpeg', 'png'].includes(requestedFormatRaw) ? requestedFormatRaw : null;

    // If no conversion requested, stream the file as-is
    if (!requestedFormat) {
        const filename = `processed_${job.originalName}`;
        return res.download(job.processedPath, filename);
    }

    try {
        // Read source buffer
        const sourceBuffer = fs.readFileSync(job.processedPath);
        let transformer = sharp(sourceBuffer);

        // Ensure we output the requested format
        if (requestedFormat === 'png') {
            transformer = transformer.png({ compressionLevel: 9 });
        } else {
            // treat jpg and jpeg the same
            transformer = transformer.jpeg({ quality: 92, mozjpeg: true });
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
        // Fallback to raw download
        const filename = `processed_${job.originalName}`;
        return res.download(job.processedPath, filename);
    }
});

// Process multiple images
app.post('/api/process-batch', upload.array('images', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No image files provided' });
        }

        const { prompt } = req.body;
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const jobs = req.files.map(file => {
            const jobId = generateJobId();
            const imageData = {
                jobId,
                originalPath: file.path,
                originalName: file.originalname,
                prompt: prompt.trim(),
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

        res.json({ jobs });

    } catch (error) {
        console.error('Batch upload error:', error);
        res.status(500).json({ error: 'Batch upload failed: ' + error.message });
    }
});

// Utility functions
function generateJobId() {
    return 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

async function processImageWithNanoBanana(imageData) {
    try {
        console.log(`Processing image: ${imageData.originalName} with prompt: "${imageData.prompt}"`);
        
        // Read the image file and convert to base64
        const imageBuffer = fs.readFileSync(imageData.originalPath);
        const imageBase64 = imageBuffer.toString('base64');
        const imageMimeType = getMimeType(imageData.originalPath);

		assertApiKey();

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
		const { data } = await axios.post(url, body, {
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': GEMINI_API_KEY
			}
		});

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
            
            // Create processed directory
            const processedDir = './processed';
            if (!fs.existsSync(processedDir)) {
                fs.mkdirSync(processedDir);
            }

            // Save the generated image as PNG to ensure consistent format
            // The download endpoint will handle conversion to other formats
            const processedFilename = `processed_${Date.now()}_${path.basename(imageData.originalPath, path.extname(imageData.originalPath))}.png`;
            const processedPath = path.join(processedDir, processedFilename);
            const outputBuffer = Buffer.from(generatedImageData, 'base64');
            
            // Convert to PNG format using sharp to ensure consistency
            const pngBuffer = await sharp(outputBuffer)
                .png({ compressionLevel: 9 })
                .toBuffer();
            
            fs.writeFileSync(processedPath, pngBuffer);
            
            console.log(`Image successfully generated and saved: ${processedPath}`);
            return { processedPath };
            
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
        console.error('Gemini API error:', details);
        const message = (error && error.message) ? error.message : String(error);
        throw new Error(`Image processing failed: ${message}`);
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

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!GEMINI_API_KEY) {
        console.warn('Warning: GEMINI_API_KEY is not set. Requests will fail until it is provided.');
    } else {
        console.log('GEMINI_API_KEY detected. Using Gemini API (REST) for image generation.');
    }
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    process.exit(0);
});