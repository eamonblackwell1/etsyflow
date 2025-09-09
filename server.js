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

// API keys (required)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const PICSART_API_KEY = process.env.PICSART_API_KEY;

// Feature flags
const ENABLE_BG_REMOVAL = (process.env.ENABLE_BG_REMOVAL || 'true').toLowerCase() !== 'false';

function assertApiKey() {
	if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') {
		throw new Error('GEMINI_API_KEY environment variable is not set');
	}
	if (!PICSART_API_KEY || PICSART_API_KEY.trim() === '') {
		throw new Error('PICSART_API_KEY environment variable is not set');
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
        const removeBgRaw = (req.body.removeBg || '').toString().toLowerCase();
        const removeBg = removeBgRaw === 'true' || (removeBgRaw === '' && ENABLE_BG_REMOVAL);
        if (!prompt || prompt.trim().length === 0) {
            return res.status(400).json({ error: 'Prompt is required' });
        }

        const jobId = generateJobId();
        const imageData = {
            jobId,
            originalPath: req.file.path,
            originalName: req.file.originalname,
            prompt: prompt.trim(),
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
app.post('/api/process-batch', upload.array('images', 20), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No image files provided' });
        }

        const { prompt } = req.body;
        const removeBgRaw = (req.body.removeBg || '').toString().toLowerCase();
        const removeBg = removeBgRaw === 'true' || (removeBgRaw === '' && ENABLE_BG_REMOVAL);
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
    try {
        console.log(`Processing image: ${imageData.originalName} with prompt: "${imageData.prompt}"`);
        
        // Update status to Gemini processing
        updateJobStatus(imageData.jobId, 'gemini_processing');
        
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
            
            // Step 1: Remove background using Picsart
            try {
                if (imageData.removeBg) {
                    updateJobStatus(imageData.jobId, 'removing_background');
                    bgRemovedPath = await processPicsartBackgroundRemoval(geminiPath);
                    finalProcessedPath = bgRemovedPath;
                    console.log('Background removal successful');
                } else {
                    console.log('Background removal disabled for this job; skipping to upscaling');
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
            
            // Step 2: Upscale the image using Picsart (use whichever image we have)
            try {
                updateJobStatus(imageData.jobId, 'upscaling_image');
                const upscaledPath = await processPicsartUpscaling(finalProcessedPath, 2);
                
                // Clean up intermediate files only if upscaling succeeded
                if (bgRemovedPath && bgRemovedPath !== geminiPath && fs.existsSync(bgRemovedPath)) {
                    fs.unlinkSync(bgRemovedPath);
                }
                // Keep the Gemini PNG for AI-only downloads
                
                finalProcessedPath = upscaledPath;
                console.log('Upscaling successful');
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
        const processedDir = './processed';
        if (!fs.existsSync(processedDir)) {
            fs.mkdirSync(processedDir);
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
        const processedDir = './processed';
        if (!fs.existsSync(processedDir)) {
            fs.mkdirSync(processedDir);
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

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    if (!GEMINI_API_KEY) {
        console.warn('Warning: GEMINI_API_KEY is not set. Requests will fail until it is provided.');
    } else {
        console.log('GEMINI_API_KEY detected. Using Gemini API (REST) for image generation.');
    }
    if (!PICSART_API_KEY) {
        console.warn('Warning: PICSART_API_KEY is not set. Background removal and upscaling will fail until it is provided.');
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