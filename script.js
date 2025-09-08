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
                <button class="btn btn-primary" onclick="imageProcessor.downloadImage('${imageData.id}')" disabled>
                    Download
                </button>
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
        
        if (repromptBtn && downloadBtn) {
            repromptBtn.disabled = imageData.status !== 'complete';
            downloadBtn.disabled = imageData.status !== 'complete';
        }
    }

    getStatusText(status) {
        const statusMap = {
            'queued': 'Queued',
            'processing': 'Processing...',
            'complete': 'Complete',
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
            if (imageData.status === 'complete') {
                completedCount++;
                continue;
            }

            imageData.status = 'processing';
            imageData.prompt = this.currentPrompt;
            this.updateImageCard(imageData);

            try {
                // Simulate API call for now - replace with actual nano banana API call
                await this.processImage(imageData);
                imageData.status = 'complete';
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

        return new Promise((resolve, reject) => {
            const checkStatus = async () => {
                attempts++;
                
                try {
                    const response = await fetch(`/api/job/${imageData.jobId}`);
                    if (!response.ok) {
                        throw new Error(`HTTP error! status: ${response.status}`);
                    }

                    const job = await response.json();
                    
                    if (job.status === 'complete') {
                        imageData.processedUrl = job.processedUrl;
                        resolve();
                        return;
                    }
                    
                    if (job.status === 'error') {
                        throw new Error(job.error || 'Processing failed');
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
                imageData.status = 'complete';
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
        link.download = `processed_${baseName}.${requestedFormat}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// Initialize the app
const imageProcessor = new ImageProcessor();