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

class ImageProcessor {
    constructor() {
        this.images = [];
        this.currentPrompt = STATIC_PROMPT;
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateProcessButton();
    }

    setupEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const processBtn = document.getElementById('processBtn');
        const removeBgToggle = document.getElementById('removeBgToggle');

        this.removeBg = removeBgToggle ? removeBgToggle.checked : false;
        if (removeBgToggle) {
            removeBgToggle.addEventListener('change', (e) => {
                this.removeBg = !!e.target.checked;
            });
        }

        uploadArea.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));
        uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        uploadArea.addEventListener('drop', this.handleDrop.bind(this));
        processBtn.addEventListener('click', () => this.processAllImages());
    }

    handleDragOver(e) {
        e.preventDefault();
        document.getElementById('uploadArea').classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        document.getElementById('uploadArea').classList.remove('dragover');
    }

    handleDrop(e) {
        e.preventDefault();
        document.getElementById('uploadArea').classList.remove('dragover');
        this.handleFiles(e.dataTransfer.files);
    }

    handleFiles(files) {
        const validFiles = Array.from(files).filter(file => {
            if (!file.type.startsWith('image/')) {
                alert(`${file.name} is not an image file`);
                return false;
            }
            if (file.size > 10 * 1024 * 1024) {
                alert(`${file.name} is too large (max 10MB)`);
                return false;
            }
            return true;
        });

        validFiles.forEach(file => this.addImage(file));
        this.updateProcessButton();
    }

    addImage(file) {
        const imageId = 'img_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        const imageData = {
            id: imageId,
            file: file,
            name: file.name,
            status: 'queued',
            originalUrl: null,
            processedUrl: null,
            prompt: this.currentPrompt
        };

        this.images.push(imageData);
        this.createImageCard(imageData);

        const reader = new FileReader();
        reader.onload = (e) => {
            imageData.originalUrl = e.target.result;
            this.updateImageCard(imageData);
        };
        reader.readAsDataURL(file);
    }

    createImageCard(imageData) {
        const grid = document.getElementById('imagesGrid');
        const card = document.createElement('div');
        card.className = 'image-card';
        card.id = `card_${imageData.id}`;

        card.innerHTML = `
            <div class="original-section">
                <h4>Original</h4>
                <img class="image-preview" id="original_${imageData.id}" alt="Original">
                <p class="image-name">${imageData.name}</p>
            </div>

            <div class="processed-section">
                <h4>Processed</h4>
                <div class="image-status status-queued" id="status_${imageData.id}">Queued</div>
                <img class="image-preview" id="processed_${imageData.id}" style="display: none;" alt="Processed">
            </div>

            <div class="image-actions">
                <div class="download-controls">
                    <label for="format_${imageData.id}">Format:</label>
                    <select class="format-select" id="format_${imageData.id}">
                        <option value="jpg">JPG</option>
                        <option value="jpeg">JPEG</option>
                        <option value="png">PNG</option>
                    </select>
                </div>
                <div class="download-buttons">
                    <button class="btn btn-accent" onclick="imageProcessor.downloadGeminiImage('${imageData.id}')" disabled id="download_gemini_${imageData.id}">
                        Download AI Only
                    </button>
                    <button class="btn btn-primary" onclick="imageProcessor.downloadImage('${imageData.id}')" disabled id="download_final_${imageData.id}">
                        Download Enhanced
                    </button>
                </div>
            </div>
        `;

        grid.appendChild(card);
    }

    updateImageCard(imageData) {
        const originalImg = document.getElementById(`original_${imageData.id}`);
        const processedImg = document.getElementById(`processed_${imageData.id}`);
        const status = document.getElementById(`status_${imageData.id}`);
        const card = document.getElementById(`card_${imageData.id}`);

        if (imageData.originalUrl && originalImg) {
            originalImg.src = imageData.originalUrl;
        }

        if (status) {
            status.textContent = this.getStatusText(imageData.status);
            status.className = `image-status status-${imageData.status}`;
        }

        if (imageData.processedUrl && processedImg) {
            processedImg.src = imageData.processedUrl;
            processedImg.style.display = 'block';
        }

        const downloadBtn = card.querySelector('.btn-primary');
        const downloadGeminiBtn = document.getElementById(`download_gemini_${imageData.id}`);
        const downloadFinalBtn = document.getElementById(`download_final_${imageData.id}`);

        if (downloadGeminiBtn) {
            const hasGemini = !!(imageData.imageData && imageData.imageData.gemini) || !!(imageData.downloadTokens && imageData.downloadTokens.gemini);
            downloadGeminiBtn.disabled = !hasGemini;
        }

        if (downloadFinalBtn) {
            const hasFinal = !!(imageData.imageData && imageData.imageData.final) || !!(imageData.downloadTokens && imageData.downloadTokens.final);
            downloadFinalBtn.disabled = !hasFinal;
        }

        if (downloadBtn) {
            const hasFinal = !!(imageData.imageData && imageData.imageData.final) || !!(imageData.downloadTokens && imageData.downloadTokens.final);
            downloadBtn.disabled = !hasFinal;
        }
    }

    getStatusText(status, job) {
        const statusMap = {
            'queued': 'Queued',
            'processing': 'Processing...',
            'gemini_processing': 'Generating design...',
            'gemini_complete': (job && job.progress) ? job.progress : 'AI complete, removing background...',
            'removing_background': 'Removing background...',
            'upscaling_image': 'Upscaling image...',
            'complete': 'Complete',
            'pipeline_complete': 'Complete (Enhanced)',
            'partial_pipeline_success': 'Complete (Partial enhancement)',
            'picsart_failed_fallback': 'Complete (AI only)',
            'error': 'Error'
        };
        return statusMap[status] || status;
    }

    updateProcessButton() {
        const processBtn = document.getElementById('processBtn');
        const hasImages = this.images.length > 0;

        processBtn.disabled = !hasImages;
        processBtn.textContent = `Process ${this.images.length} Image${this.images.length !== 1 ? 's' : ''}`;
    }

    async processAllImages() {
        if (this.images.length === 0) return;

        const progressSection = document.getElementById('overallProgress');
        progressSection.style.display = 'block';
        this.updateOverallProgress(0);

        let completedCount = 0;

        for (const imageData of this.images) {
            imageData.status = 'processing';
            imageData.prompt = this.currentPrompt;
            this.updateImageCard(imageData);
            this.logStatus(imageData, 'Uploading image...');

            try {
                await this.processImage(imageData);
            } catch (error) {
                console.error('Processing failed:', error);
                imageData.status = 'error';
                imageData.error = error.message;
            }

            this.updateImageCard(imageData);
            completedCount++;
            this.updateOverallProgress(completedCount);
        }

        setTimeout(() => {
            progressSection.style.display = 'none';
        }, 2000);
    }

    async processImage(imageData) {
        try {
            // Step 1: Upload the image
            const formData = new FormData();
            formData.append('image', imageData.file);
            formData.append('prompt', imageData.prompt);
            formData.append('removeBg', this.removeBg ? 'true' : 'false');

            console.log('Step 1: Uploading image...');
            const uploadResponse = await fetch('/api/upload-image', {
                method: 'POST',
                body: formData
            });

            if (!uploadResponse.ok) {
                const errorBody = await uploadResponse.json().catch(() => ({}));
                const message = errorBody?.error || `Upload failed! status: ${uploadResponse.status}`;
                throw new Error(message);
            }

            const uploadResult = await uploadResponse.json();
            imageData.jobId = uploadResult.jobId;
            console.log(`Step 1 complete: Job ${imageData.jobId} created`);

            // Step 2: Start processing (this keeps serverless function alive)
            console.log('Step 2: Starting processing (function stays alive)...');
            imageData.status = 'processing';
            this.updateImageCard(imageData);
            this.logStatus(imageData, 'Processing with AI...');

            const processResponse = await fetch(`/api/start-processing/${imageData.jobId}`, {
                method: 'POST'
            });

            if (!processResponse.ok) {
                const errorBody = await processResponse.json().catch(() => ({}));
                const message = errorBody?.error || `Processing failed! status: ${processResponse.status}`;
                throw new Error(message);
            }

            const processResult = await processResponse.json();
            console.log(`Step 2 complete: Job ${imageData.jobId} finished with status ${processResult.status}`);

            // Apply the final result
            this.applyProcessingResult(imageData, processResult);

        } catch (error) {
            console.error('Process image error:', error);
            throw error;
        }
    }

    async pollJobStatus(imageData, retries = 0) {
        const maxRetries = 60; // 5 minutes with 5 second intervals
        const pollInterval = 5000; // 5 seconds

        try {
            const response = await fetch(`/api/job/${imageData.jobId}`);

            if (!response.ok) {
                if (response.status === 404 && retries < 3) {
                    // Job might not be ready yet, retry
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    return this.pollJobStatus(imageData, retries + 1);
                }
                throw new Error(`Failed to check job status: ${response.status}`);
            }

            const result = await response.json();
            console.log(`Job ${imageData.jobId}: Status updated to ${result.status}`);

            // Update UI with current status
            this.applyProcessingResult(imageData, result);

            // Check if job is complete or errored
            const completedStates = [
                'complete', 'pipeline_complete', 'partial_pipeline_success',
                'picsart_failed_fallback', 'error'
            ];

            if (completedStates.includes(result.status)) {
                console.log(`Job ${imageData.jobId} completed with status: ${result.status}`);
                return; // Job is done
            }

            // Continue polling if not complete
            if (retries < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, pollInterval));
                return this.pollJobStatus(imageData, retries + 1);
            } else {
                throw new Error('Processing timeout - exceeded 5 minutes');
            }
        } catch (error) {
            console.error(`Polling error for job ${imageData.jobId}:`, error);
            imageData.status = 'error';
            imageData.error = error.message;
            this.updateImageCard(imageData);
            throw error;
        }
    }

    applyProcessingResult(imageData, result) {
        const safeStatus = result.status || 'complete';
        imageData.status = safeStatus;
        imageData.progress = null;
        imageData.pipelineErrors = result.pipelineErrors || [];
        imageData.processedUrl = result.previewUrl || null;
        imageData.geminiUrl = result.geminiPreviewUrl || null;
        imageData.downloadTokens = result.downloadTokens || {};
        imageData.downloadFilenames = result.downloadFilenames || {};
        imageData.imageData = result.imageData || null; // Base64 image data for Vercel
        imageData.error = result.error || null;

        if (imageData.processedUrl) {
            const cacheBust = Date.now();
            imageData.processedUrl = `${imageData.processedUrl}${imageData.processedUrl.includes('?') ? '&' : '?'}cb=${cacheBust}`;
        }

        if (imageData.geminiUrl) {
            const cacheBust = Date.now();
            imageData.geminiUrl = `${imageData.geminiUrl}${imageData.geminiUrl.includes('?') ? '&' : '?'}cb=${cacheBust}`;
        }

        this.logStatus(imageData, this.getStatusText(imageData.status, { progress: result.progress }));
        this.updateImageCard(imageData);
    }

    logStatus(imageData, message) {
        const statusElement = document.getElementById(`status_${imageData.id}`);
        if (statusElement && message) {
            statusElement.textContent = message;
        }
    }

    updateOverallProgress(completedCount) {
        const progressText = document.getElementById('progressText');
        const progressFill = document.getElementById('progressFill');

        const total = this.images.length;
        const percentage = (completedCount / total) * 100;

        progressText.textContent = `Processing ${completedCount} of ${total} images...`;
        progressFill.style.width = `${percentage}%`;
    }

    downloadImage(imageId) {
        const imageData = this.images.find(img => img.id === imageId);
        if (!imageData) return;

        const link = document.createElement('a');
        const formatSelect = document.getElementById(`format_${imageId}`);
        const requestedFormat = formatSelect ? (formatSelect.value || 'jpg') : 'jpg';

        // Check for base64 image data first (Vercel mode)
        if (imageData.imageData && imageData.imageData.final) {
            const base64Data = imageData.imageData.final.base64;
            const mimeType = requestedFormat === 'png' ? 'image/png' : 'image/jpeg';
            const filename = imageData.imageData.final.filename.replace('.png', `.${requestedFormat}`);

            link.href = `data:${mimeType};base64,${base64Data}`;
            link.download = filename;
        } else if (imageData.downloadTokens && imageData.downloadTokens.final) {
            // Fall back to token-based download (local mode)
            const filename = (imageData.downloadFilenames && imageData.downloadFilenames.final) || `enhanced_${(imageData.name || 'image').replace(/\.[^/.]+$/, '')}.${requestedFormat}`;
            link.href = `/api/download-by-token?token=${encodeURIComponent(imageData.downloadTokens.final)}&format=${encodeURIComponent(requestedFormat)}&filename=${encodeURIComponent(filename)}`;
        } else {
            return; // No download available
        }

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    downloadGeminiImage(imageId) {
        const imageData = this.images.find(img => img.id === imageId);
        if (!imageData) return;

        const link = document.createElement('a');
        const formatSelect = document.getElementById(`format_${imageId}`);
        const requestedFormat = formatSelect ? (formatSelect.value || 'jpg') : 'jpg';

        // Check for base64 image data first (Vercel mode)
        if (imageData.imageData && imageData.imageData.gemini) {
            const base64Data = imageData.imageData.gemini.base64;
            const mimeType = requestedFormat === 'png' ? 'image/png' : 'image/jpeg';
            const filename = imageData.imageData.gemini.filename.replace('.png', `.${requestedFormat}`);

            link.href = `data:${mimeType};base64,${base64Data}`;
            link.download = filename;
        } else if (imageData.downloadTokens && imageData.downloadTokens.gemini) {
            // Fall back to token-based download (local mode)
            const filename = (imageData.downloadFilenames && imageData.downloadFilenames.gemini) || `ai_only_${(imageData.name || 'image').replace(/\.[^/.]+$/, '')}.${requestedFormat}`;
            link.href = `/api/download-by-token?token=${encodeURIComponent(imageData.downloadTokens.gemini)}&format=${encodeURIComponent(requestedFormat)}&filename=${encodeURIComponent(filename)}`;
        } else {
            return; // No download available
        }

        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

const imageProcessor = new ImageProcessor();