class ImageProcessor {
    constructor() {
        this.images = [];
        this.currentPrompt = '';
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.updateProcessButton();
    }

    setupEventListeners() {
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const promptInput = document.getElementById('promptInput');
        const processBtn = document.getElementById('processBtn');
        const removeBgToggle = document.getElementById('removeBgToggle');

        // Background removal preference (defaults to checked)
        this.removeBg = removeBgToggle ? removeBgToggle.checked : true;
        if (removeBgToggle) {
            removeBgToggle.addEventListener('change', (e) => {
                this.removeBg = !!e.target.checked;
            });
        }

        // Click to select files
        uploadArea.addEventListener('click', () => fileInput.click());

        // File selection
        fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

        // Drag and drop
        uploadArea.addEventListener('dragover', this.handleDragOver.bind(this));
        uploadArea.addEventListener('dragleave', this.handleDragLeave.bind(this));
        uploadArea.addEventListener('drop', this.handleDrop.bind(this));

        // Prompt input
        promptInput.addEventListener('input', (e) => {
            this.currentPrompt = e.target.value.trim();
            this.updateProcessButton();
        });

        // Process button
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
            if (file.size > 10 * 1024 * 1024) { // 10MB limit
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
        
        // Create preview URL
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
                <button class="btn btn-secondary" onclick="imageProcessor.repromptImage('${imageData.id}')" disabled>
                    Reprompt
                </button>
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

        // Update button states
        const repromptBtn = card.querySelector('.btn-secondary');
        const downloadBtn = card.querySelector('.btn-primary');
        const downloadGeminiBtn = document.getElementById(`download_gemini_${imageData.id}`);
        const downloadFinalBtn = document.getElementById(`download_final_${imageData.id}`);
        
        if (repromptBtn && downloadBtn) {
            // Enable buttons for all completion statuses
            const completedStatuses = ['complete', 'pipeline_complete', 'partial_pipeline_success', 'picsart_failed_fallback'];
            const isComplete = completedStatuses.includes(imageData.status);
            repromptBtn.disabled = !isComplete;
            downloadBtn.disabled = !isComplete;
        }

        // Update download button states
        if (downloadGeminiBtn) {
            // Enable Gemini download if we have gemini_complete status or better
            const geminiStatuses = ['gemini_complete', 'removing_background', 'upscaling_image', 'complete', 'pipeline_complete', 'partial_pipeline_success', 'picsart_failed_fallback'];
            downloadGeminiBtn.disabled = !geminiStatuses.includes(imageData.status);
        }

        if (downloadFinalBtn) {
            // Enable final download only when completely done
            const completedStatuses = ['complete', 'pipeline_complete', 'partial_pipeline_success', 'picsart_failed_fallback'];
            downloadFinalBtn.disabled = !completedStatuses.includes(imageData.status);
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
        const hasPrompt = this.currentPrompt.length > 0;
        
        processBtn.disabled = !hasImages || !hasPrompt;
        processBtn.textContent = `Process ${this.images.length} Image${this.images.length !== 1 ? 's' : ''}`;
    }

    async processAllImages() {
        if (this.images.length === 0 || !this.currentPrompt) return;

        // Show overall progress
        const progressSection = document.getElementById('overallProgress');
        progressSection.style.display = 'block';
        
        this.updateOverallProgress(0);

        let completedCount = 0;

        for (const imageData of this.images) {
            // Check if already complete with any of the completion statuses
            const completedStatuses = ['complete', 'pipeline_complete', 'partial_pipeline_success', 'picsart_failed_fallback'];
            if (completedStatuses.includes(imageData.status)) {
                completedCount++;
                continue;
            }

            imageData.status = 'processing';
            imageData.prompt = this.currentPrompt;
            this.updateImageCard(imageData);

            try {
                // Process image through the pipeline
                await this.processImage(imageData);
                // Status is already set by processImage based on the pipeline result
            } catch (error) {
                console.error('Processing failed:', error);
                imageData.status = 'error';
            }

            this.updateImageCard(imageData);
            completedCount++;
            this.updateOverallProgress(completedCount);
        }

        // Hide progress after completion
        setTimeout(() => {
            progressSection.style.display = 'none';
        }, 2000);
    }

    async processImage(imageData) {
        try {
            const formData = new FormData();
            formData.append('image', imageData.file);
            formData.append('prompt', imageData.prompt);
            formData.append('removeBg', this.removeBg ? 'true' : 'false');

            const response = await fetch('/api/process-image', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            imageData.jobId = result.jobId;

            // Start polling for status
            await this.pollJobStatus(imageData);
        } catch (error) {
            console.error('Process image error:', error);
            throw error;
        }
    }

    async pollJobStatus(imageData) {
        const maxAttempts = 60; // 5 minutes max
        let attempts = 0;
        const getStatusText = this.getStatusText.bind(this);

        return new Promise((resolve, reject) => {
            const checkStatus = async () => {
                attempts++;
                
                try {
                    const response = await fetch(`/api/job/${imageData.jobId}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const job = await response.json();
                    
                    // Check for all possible completion statuses from the pipeline
                    const completedStatuses = ['complete', 'pipeline_complete', 'partial_pipeline_success', 'picsart_failed_fallback'];
                    if (completedStatuses.includes(job.status)) {
                        imageData.processedUrl = job.processedUrl;
                        imageData.status = job.status; // Set the actual final status
                        imageData.progress = job.progress;
                        resolve();
                        return;
                    }
                    
                    if (job.status === 'error') {
                        throw new Error(job.error || 'Processing failed');
                    }
                    
                    // Update progress message and status for intermediate stages
                    if (job.status !== imageData.status) {
                        imageData.status = job.status;
                        console.log(`Job ${imageData.jobId}: Status updated to ${job.status}`);
                        
                        // Update the visual status immediately
                        const statusElement = document.getElementById(`status_${imageData.id}`);
                        if (statusElement) {
                            statusElement.textContent = getStatusText(job.status, job);
                            statusElement.className = `image-status status-${job.status}`;
                        }
                    }
                    
                    // Update progress message if available
                    if (job.progress) {
                        console.log(`Job ${imageData.jobId}: ${job.progress}`);
                        const statusElement = document.getElementById(`status_${imageData.id}`);
                        if (statusElement) {
                            statusElement.textContent = job.progress;
                        }
                    }

                    if (attempts >= maxAttempts) {
                        throw new Error('Processing timeout');
                    }

                    // Continue polling every 5 seconds
                    setTimeout(checkStatus, 5000);
                    
                } catch (error) {
                    reject(error);
                }
            };

            checkStatus();
        });
    }

    updateOverallProgress(completedCount) {
        const progressText = document.getElementById('progressText');
        const progressFill = document.getElementById('progressFill');
        
        const total = this.images.length;
        const percentage = (completedCount / total) * 100;
        
        progressText.textContent = `Processing ${completedCount} of ${total} images...`;
        progressFill.style.width = `${percentage}%`;
    }

    async repromptImage(imageId) {
        const imageData = this.images.find(img => img.id === imageId);
        if (!imageData) return;

        const newPrompt = prompt('Enter new prompt:', imageData.prompt);
        if (newPrompt && newPrompt.trim() !== imageData.prompt) {
            imageData.prompt = newPrompt.trim();
            imageData.status = 'processing';
            this.updateImageCard(imageData);

            try {
                // Process single image with new prompt
                await this.processImage(imageData);
                // Status is already set by processImage based on the pipeline result
                this.updateImageCard(imageData);
            } catch (error) {
                console.error('Reprompt failed:', error);
                imageData.status = 'error';
                this.updateImageCard(imageData);
            }
        }
    }

    downloadImage(imageId) {
        const imageData = this.images.find(img => img.id === imageId);
        if (!imageData || !imageData.processedUrl || !imageData.jobId) return;

        // Use the backend download endpoint
        const link = document.createElement('a');
        const formatSelect = document.getElementById(`format_${imageId}`);
        const requestedFormat = formatSelect ? (formatSelect.value || 'jpg') : 'jpg';
        link.href = `/api/download/${imageData.jobId}?format=${encodeURIComponent(requestedFormat)}`;

        // Suggest a filename with the selected extension
        const baseName = (imageData.name || 'image').replace(/\.[^/.]+$/, '');
        link.download = `enhanced_${baseName}.${requestedFormat}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    downloadGeminiImage(imageId) {
        const imageData = this.images.find(img => img.id === imageId);
        if (!imageData || !imageData.jobId) return;

        // Use the Gemini-only download endpoint
        const link = document.createElement('a');
        const formatSelect = document.getElementById(`format_${imageId}`);
        const requestedFormat = formatSelect ? (formatSelect.value || 'jpg') : 'jpg';
        link.href = `/api/download-gemini/${imageData.jobId}?format=${encodeURIComponent(requestedFormat)}`;

        // Suggest a filename with the selected extension
        const baseName = (imageData.name || 'image').replace(/\.[^/.]+$/, '');
        link.download = `ai_only_${baseName}.${requestedFormat}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Initialize the app
const imageProcessor = new ImageProcessor();