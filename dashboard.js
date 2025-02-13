// Handle file upload functionality
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const uploadStatus = document.getElementById('uploadStatus');

// State management
let currentEstimate = null;
let currentAnalysis = null;

// Initialize dashboard
document.addEventListener('DOMContentLoaded', async () => {
    initializeEventListeners();
    await loadQueueItems();
    checkFeatureFlags();
});

// Initialize all event listeners
function initializeEventListeners() {
    // Existing upload listeners
    dropZone.addEventListener('dragover', handleDragOver);
    dropZone.addEventListener('dragleave', handleDragLeave);
    dropZone.addEventListener('drop', handleDrop);
    fileInput.addEventListener('change', handleFileSelect);

    // Queue filters
    queueFilter.addEventListener('change', filterQueue);
    searchQueue.addEventListener('input', filterQueue);

    // Estimate actions
    document.querySelectorAll('.action-btn').forEach(btn => {
        btn.addEventListener('click', handleEstimateAction);
    });
}

// Drag and drop handlers
dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    const files = e.dataTransfer.files;
    handleFiles(files);
});

fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
});

async function handleFiles(files) {
    const file = files[0];
    if (!isValidFile(file)) {
        showError('Invalid file type. Please upload PDF or EMS files only.');
        return;
    }

    try {
        showLoading('Processing estimate...');
        
        // Extract data based on file type
        let estimateData;
        if (file.type === 'application/pdf') {
            estimateData = await OCRService.extractFromPDF(file);
        } else if (file.name.endsWith('.ems')) {
            estimateData = await OCRService.processEMS(file);
        }

        // Get AI analysis
        const analysis = await AIService.analyzeLaborRates(estimateData);
        const approvalPrediction = await PredictiveModel.getApprovalProbability(estimateData);
        
        // Auto-correct if confidence is high enough
        if (analysis.confidence >= CONFIG.AI_CONFIDENCE_THRESHOLD) {
            estimateData = await AIService.autoCorrect(estimateData, analysis);
        }

        // Update UI
        updateEstimateDisplay(estimateData, analysis, approvalPrediction);
        showSuccess('Estimate processed successfully');
        
        // Submit for learning feedback
        if (FEATURES.LEARNING_FEEDBACK) {
            PredictiveModel.submitFeedback(estimateData.id, 'processed');
        }
    } catch (error) {
        ErrorHandler.showError(error);
    }
}

// Validation functions
function isValidFile(file) {
    return CONFIG.SUPPORTED_FORMATS.some(format => 
        file.name.toLowerCase().endsWith(format) || 
        file.type === 'application/pdf'
    );
}

// UI update functions
function updateEstimateDisplay(estimate, analysis, approvalPrediction) {
    // Update estimate details
    document.getElementById('estimateTitle').textContent = estimate.title;
    document.getElementById('estimateStatus').className = `status-badge ${estimate.status}`;
    document.getElementById('estimateStatus').textContent = estimate.status;

    // Update original estimate data
    const estimateData = document.querySelector('.estimate-data');
    estimateData.textContent = formatEstimateData(estimate);

    // Update AI analysis
    const analysisData = document.querySelector('.analysis-data');
    analysisData.textContent = formatAnalysisData(analysis);

    // Show recommendations if confidence is high enough
    if (analysis.confidence >= CONFIG.AI_CONFIDENCE_THRESHOLD) {
        showRecommendations(analysis.recommendations);
    }

    // Show approval prediction
    const approvalPredictionData = document.querySelector('.approval-prediction-data');
    approvalPredictionData.textContent = formatApprovalPredictionData(approvalPrediction);

    // Switch to estimate detail view
    showSection('estimate-detail');
}

// Recommendation handling
function showRecommendations(recommendations) {
    const container = document.querySelector('.recommendations-container');
    container.innerHTML = recommendations.map(rec => `
        <div class="recommendation-card">
            <h3>${rec.title}</h3>
            <div class="progress-bar">
                <div class="progress" style="width: ${rec.confidence}%;">${rec.confidence}%</div>
            </div>
            <div class="recommendation-details">
                ${formatRecommendationDetails(rec)}
            </div>
            <button class="action-btn" onclick="applyRecommendation('${rec.id}')">Apply</button>
        </div>
    `).join('');
}

// Estimate actions
async function handleEstimateAction(event) {
    const action = event.target.dataset.action;
    const estimateId = currentEstimate.id;

    try {
        showLoading(`Processing ${action}...`);
        await EstimateService.processEstimate(estimateId, action);
        
        // Update queue and UI
        await loadQueueItems();
        showSuccess(`Estimate ${action} successfully`);
    } catch (error) {
        showError(`Error processing ${action}: ${error.message}`);
    }
}

// Queue management
async function loadQueueItems() {
    try {
        const items = await QueueService.getQueueItems(
            queueFilter.value,
            searchQueue.value
        );
        renderQueueItems(items);
    } catch (error) {
        showError('Error loading queue: ' + error.message);
    }
}

// Feature flag checking
function checkFeatureFlags() {
    const apiSection = document.querySelector('#api');
    if (!FEATURES.CCC_INTEGRATION) {
        apiSection.querySelector('.api-status').innerHTML = `
            <p>Integration Status: Coming Soon</p>
            <div class="progress-bar">
                <div class="progress" style="width: 60%;">Development in Progress</div>
            </div>
        `;
    }
}

// Utility functions
function showLoading(message) {
    const status = document.getElementById('uploadStatus');
    status.className = 'loading';
    status.textContent = message;
}

function showError(message) {
    const status = document.getElementById('uploadStatus');
    status.className = 'error-state';
    status.textContent = message;
}

function showSuccess(message) {
    const status = document.getElementById('uploadStatus');
    status.className = 'success-state';
    status.textContent = message;
}

function formatEstimateData(estimate) {
    return `
Estimate ID: ${estimate.id}
Date: ${estimate.date}
Insurance: ${estimate.insurer}
Total Amount: ${estimate.amount}

Labor Operations:
${estimate.operations.map(op => 
    `- ${op.description}: ${op.hours}hrs @ $${op.rate}/hr`
).join('\n')}

Parts:
${estimate.parts.map(part => 
    `- ${part.partNumber}: ${part.description} @ $${part.price}`
).join('\n')}
    `.trim();
}

function formatAnalysisData(analysis) {
    return `
Confidence Score: ${analysis.confidence}%
Risk Level: ${analysis.riskLevel}

Findings:
${analysis.findings.map(finding => 
    `- ${finding.description} (${finding.severity})`
).join('\n')}

Recommendations:
${analysis.recommendations.map(rec => 
    `- ${rec.title}: ${rec.description}`
).join('\n')}
    `.trim();
}

function formatApprovalPredictionData(prediction) {
    return `
Approval Probability: ${prediction.probability}%
    `.trim();
}

// Navigation functionality
document.querySelectorAll('.sidebar nav a').forEach(link => {
    link.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = link.getAttribute('href').substring(1);
        showSection(targetId);
    });
});

function showSection(sectionId) {
    // Hide all sections
    document.querySelectorAll('main section').forEach(section => {
        section.classList.add('hidden');
    });
    
    // Show target section
    document.getElementById(sectionId).classList.remove('hidden');
    
    // Update active state in sidebar
    document.querySelectorAll('.sidebar nav li').forEach(li => {
        li.classList.remove('active');
    });
    document.querySelector(`a[href="#${sectionId}"]`).parentElement.classList.add('active');
}

// Logout functionality
function logout() {
    // Add logout logic here
    window.location.href = 'index.html';
}

// Queue Management
const queueFilter = document.getElementById('queueFilter');
const searchQueue = document.getElementById('searchQueue');
const queueList = document.getElementById('queueList');

// Sample queue data (replace with actual data from your backend)
let queueItems = [
    {
        id: 1,
        title: 'Estimate #1234',
        status: 'urgent',
        date: '2024-03-20',
        insurer: 'ABC Insurance',
        amount: '$2,500.00'
    },
    {
        id: 2,
        title: 'Estimate #1235',
        status: 'pending',
        date: '2024-03-19',
        insurer: 'XYZ Insurance',
        amount: '$3,750.00'
    },
    {
        id: 3,
        title: 'Estimate #1236',
        status: 'completed',
        date: '2024-03-18',
        insurer: 'DEF Insurance',
        amount: '$1,800.00'
    }
];

function renderQueueItems(items) {
    queueList.innerHTML = '';
    
    if (items.length === 0) {
        queueList.innerHTML = '<p>No items found</p>';
        return;
    }

    items.forEach(item => {
        const queueItem = document.createElement('div');
        queueItem.className = `queue-item ${item.status}`;
        queueItem.innerHTML = `
            <div class="queue-item-details">
                <span class="queue-item-title">${item.title}</span>
                <span class="queue-item-meta">
                    ${item.date} | ${item.insurer} | ${item.amount}
                </span>
            </div>
            <div class="queue-item-actions">
                <button onclick="viewEstimate(${item.id})">View</button>
                <button onclick="processEstimate(${item.id})">Process</button>
            </div>
        `;
        queueList.appendChild(queueItem);
    });
}

function filterQueue() {
    const filterValue = queueFilter.value;
    const searchValue = searchQueue.value.toLowerCase();
    
    let filtered = queueItems;
    
    if (filterValue !== 'all') {
        filtered = filtered.filter(item => item.status === filterValue);
    }
    
    if (searchValue) {
        filtered = filtered.filter(item => 
            item.title.toLowerCase().includes(searchValue) ||
            item.insurer.toLowerCase().includes(searchValue)
        );
    }
    
    renderQueueItems(filtered);
}

function viewEstimate(id) {
    // Implement view functionality
    console.log(`Viewing estimate ${id}`);
    // Navigate to estimate detail view
}

async function processEstimate(id) {
    try {
        showLoading('Processing estimate...');
        
        const estimate = await EstimateService.getEstimate(id);
        const analysis = await AIService.analyzeEstimate(id);
        const compliance = await EstimateService.getCompliance(id);
        
        // Update UI with results
        updateEstimateDetail(estimate, analysis, compliance);
        
        // Show processing recommendations
        showProcessingRecommendations(analysis.recommendations);
        
        // Enable auto-correction if confidence is high
        if (analysis.confidence >= CONFIG.AI_CONFIDENCE_THRESHOLD) {
            enableAutoCorrection(analysis.corrections);
        }
    } catch (error) {
        ErrorHandler.showError(error);
    }
}

// Add event listeners for queue filtering
queueFilter.addEventListener('change', filterQueue);
searchQueue.addEventListener('input', filterQueue);

// Initial render of queue items
renderQueueItems(queueItems); 