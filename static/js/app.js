// VLAMy OCR Application JavaScript

// Local Storage Manager for Browser Cache Mode
class LocalStorageManager {
    constructor() {
        this.dbName = 'VLAMyOCR';
        this.dbVersion = 2;
        this.db = null;
        this.isInitialized = false;
    }

    async init() {
        if (this.isInitialized) return;
        
        // Prevent race conditions by sharing the initialization promise
        if (this.initPromise) {
            return this.initPromise;
        }
        
        this.initPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = () => {
                this.initPromise = null; // Reset on error so it can be retried
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                this.isInitialized = true;
                this.initPromise = null; // Clear the promise since we're done
                resolve();
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // Create object stores
                if (!db.objectStoreNames.contains('projects')) {
                    const projectStore = db.createObjectStore('projects', { keyPath: 'id' });
                    projectStore.createIndex('order', 'order');
                }
                
                if (!db.objectStoreNames.contains('documents')) {
                    const documentStore = db.createObjectStore('documents', { keyPath: 'id' });
                    documentStore.createIndex('project_id', 'project_id');
                }
                
                if (!db.objectStoreNames.contains('images')) {
                    const imageStore = db.createObjectStore('images', { keyPath: 'id' });
                    imageStore.createIndex('document_id', 'document_id');
                    imageStore.createIndex('order', 'order');
                }
                
                if (!db.objectStoreNames.contains('annotations')) {
                    const annotationStore = db.createObjectStore('annotations', { keyPath: 'id' });
                    annotationStore.createIndex('image_id', 'image_id');
                    annotationStore.createIndex('reading_order', 'reading_order');
                }
                
                // Handle transcriptions store - recreate with correct indexes if upgrading
                if (db.objectStoreNames.contains('transcriptions')) {
                    db.deleteObjectStore('transcriptions');
                }
                const transcriptionStore = db.createObjectStore('transcriptions', { keyPath: 'id' });
                transcriptionStore.createIndex('image', 'image');
                transcriptionStore.createIndex('annotation', 'annotation');
                
                if (!db.objectStoreNames.contains('user_settings')) {
                    db.createObjectStore('user_settings', { keyPath: 'key' });
                }
            };
        });
        
        return this.initPromise;
    }

    generateId() {
        return 'local_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    async add(storeName, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            if (!data.id) {
                data.id = this.generateId();
            }
            data.created_at = new Date().toISOString();
            data.updated_at = new Date().toISOString();
            
            const request = store.add(data);
            request.onsuccess = () => resolve(data);
            request.onerror = () => reject(request.error);
        });
    }

    async update(storeName, data) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            
            data.updated_at = new Date().toISOString();
            
            const request = store.put(data);
            request.onsuccess = () => resolve(data);
            request.onerror = () => reject(request.error);
        });
    }

    async get(storeName, id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            const request = store.get(id);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAll(storeName, indexName = null, value = null) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const store = transaction.objectStore(storeName);
            
            let request;
            if (indexName && value !== null) {
                const index = store.index(indexName);
                request = index.getAll(value);
            } else {
                request = store.getAll();
            }
            
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    async delete(storeName, id) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            const store = transaction.objectStore(storeName);
            const request = store.delete(id);
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    async getSetting(key) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['user_settings'], 'readonly');
            const store = transaction.objectStore('user_settings');
            const request = store.get(key);
            
            request.onsuccess = () => resolve(request.result ? request.result.value : null);
            request.onerror = () => reject(request.error);
        });
    }

    async setSetting(key, value) {
        await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['user_settings'], 'readwrite');
            const store = transaction.objectStore('user_settings');
            const request = store.put({ key, value });
            
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // File handling for images
    async fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    async base64ToBlob(base64) {
        const response = await fetch(base64);
        return response.blob();
    }

    // Export all browser cache data
    async exportBrowserCacheData() {
        const data = {
            projects: await this.getAll('projects'),
            documents: await this.getAll('documents'),
            images: await this.getAll('images'),
            annotations: await this.getAll('annotations'),
            transcriptions: await this.getAll('transcriptions'),
            settings: {
                custom_prompts: await this.getSetting('custom_prompts'),
                custom_zones: await this.getSetting('custom_zones'),
                zone_colors: await this.getSetting('zone_colors'),
                enabled_zone_types: await this.getSetting('enabled_zone_types'),
                enabled_line_types: await this.getSetting('enabled_line_types'),
                custom_detection_mappings: await this.getSetting('custom_detection_mappings')
            },
            exported_at: new Date().toISOString(),
            version: '1.0'
        };
        return data;
    }

    // Import browser cache data
    async importBrowserCacheData(data) {
        try {
            // Import projects
            if (data.projects) {
                for (const project of data.projects) {
                    await this.add('projects', project);
                }
            }

            // Import documents
            if (data.documents) {
                for (const document of data.documents) {
                    await this.add('documents', document);
                }
            }

            // Import images
            if (data.images) {
                for (const image of data.images) {
                    await this.add('images', image);
                }
            }

            // Import annotations
            if (data.annotations) {
                console.log('Importing', data.annotations.length, 'annotations');
                for (const annotation of data.annotations) {
                    await this.add('annotations', annotation);
                }
                console.log('✅ All annotations imported');
            }

            // Import transcriptions
            if (data.transcriptions) {
                console.log('Importing', data.transcriptions.length, 'transcriptions');
                for (const transcription of data.transcriptions) {
                    await this.add('transcriptions', transcription);
                }
            }

            // Import settings
            if (data.settings) {
                for (const [key, value] of Object.entries(data.settings)) {
                    if (value !== null && value !== undefined) {
                        await this.setSetting(key, value);
                    }
                }
            }

            return true;
        } catch (error) {
            console.error('Error importing browser cache data:', error);
            return false;
        }
    }
}

class OCRApp {
    constructor() {
        this.apiBaseUrl = '/api';
        this.authToken = localStorage.getItem('authToken');
        this.currentUser = null;
        this.currentProject = null;
        this.currentDocument = null;
        this.currentImage = null;
        this.canvas = null;
        this.currentTool = 'select';
        this.isDrawing = false;
        this.isCreatingAnnotation = false;
        this.annotations = [];
        this.selectedAnnotations = [];
        
        // Browser cache mode
        this.isBrowserCacheMode = localStorage.getItem('browserCacheMode') === 'true';
        this.localStorage = new LocalStorageManager();
        
        // Panel state tracking
        this.leftPanelWidth = null;
        this.rightPanelWidth = null;
        this.resizeTimeout = null;
        
        // Annotation classification
        this.annotationTypes = null;
        this.userEnabledTypes = null;
        this.currentClassification = '';
        this.customZones = [];
        this.zoneColors = {};
        
        // Default color palette for zones
        this.defaultColors = [
            '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57',
            '#FF9FF3', '#54A0FF', '#5F27CD', '#00D2D3', '#FF9F43',
            '#686DE0', '#4834D4', '#130F40', '#30336B', '#6C5CE7',
            '#A29BFE', '#FD79A8', '#FDCB6E', '#E17055', '#81ECEC'
        ];
        
        // Prompts and editing
        this.customPrompts = [];
        this.currentEditingAnnotation = null;
        this.selectedPrompt = null;
        
        // Edit state tracking
        this.currentlyEditingId = null;
        this.hasUnsavedChanges = false;
        this.originalFormData = null;
        
        // Bulk selection
        this.bulkSelectMode = false;
        this.selectedItems = new Set();
        this.pendingDeleteItems = null;
        
        // Export tracking
        this.currentExportJob = null;
        
        this.init();
        
        // Add debugging function to window for console access
        window.debugVLAMy = () => this.debugBrowserCacheData();
        
        // Add emergency loading clear function
        window.clearVLAMyLoading = () => {
            console.log('Emergency loading clear triggered');
            this.showLoading(false);
        };
    }

    // Browser cache export/import methods
    async exportBrowserCacheData(format = 'json') {
        if (!this.isBrowserCacheMode) {
            this.showAlert('Export is only available in Browser Cache Mode', 'warning');
            return;
        }

        try {
            const data = await this.localStorage.exportBrowserCacheData();
            
            if (format === 'zip') {
                await this.exportAsZip(data);
            } else {
                await this.exportAsJson(data);
            }
            
            this.showAlert(`Browser cache data exported as ${format.toUpperCase()} successfully!`, 'success');
        } catch (error) {
            console.error('Export error:', error);
            this.showAlert('Failed to export browser cache data', 'danger');
        }
    }

    async exportAsJson(data) {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `vlamy-browser-cache-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async exportAsZip(data) {
        const zip = new JSZip();
        const dateStr = new Date().toISOString().split('T')[0];
        
        // Add metadata JSON file
        const metadataClone = JSON.parse(JSON.stringify(data));
        
        // Extract images to separate files and update metadata references
        if (metadataClone.images) {
            metadataClone.images.forEach((image, index) => {
                if (image.image_file && image.image_file.startsWith('data:')) {
                    // Extract base64 image
                    const [header, base64Data] = image.image_file.split(',');
                    const mimeType = header.match(/data:([^;]+)/)[1];
                    const extension = mimeType.split('/')[1];
                    const fileName = `images/${image.original_filename || `image_${index}.${extension}`}`;
                    
                    // Add image to ZIP
                    zip.file(fileName, base64Data, { base64: true });
                    
                    // Update metadata reference
                    image.image_file = fileName;
                    image.image_url = fileName;
                }
            });
        }
        
        // Add metadata file
        zip.file('vlamy_export.json', JSON.stringify(metadataClone, null, 2));
        
        // Generate ZIP and download
        const zipBlob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(zipBlob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `vlamy-browser-cache-${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async importBrowserCacheData(file) {
        if (!this.isBrowserCacheMode) {
            this.showAlert('Import is only available in Browser Cache Mode', 'warning');
            return;
        }

        try {
            let data;
            
            if (file.name.toLowerCase().endsWith('.json')) {
                // Handle JSON import
                const text = await file.text();
                data = JSON.parse(text);
            } else if (file.name.toLowerCase().endsWith('.zip')) {
                // Handle ZIP import
                data = await this.extractZipImport(file);
                if (!data) return; // Error already shown in extractZipImport
            } else {
                this.showAlert('Unsupported file format. Please use JSON or ZIP files.', 'warning');
                return;
            }
            

            
            const success = await this.localStorage.importBrowserCacheData(data);
            
            if (success) {
                await this.loadBrowserCacheSettings();
                await this.loadProjects();
                this.showAlert('Browser cache data imported successfully!', 'success');
            } else {
                this.showAlert('Failed to import browser cache data', 'danger');
            }
        } catch (error) {
            console.error('Import error:', error);
            this.showAlert('Failed to import browser cache data. Please check the file format.', 'danger');
        }
    }

    showBrowserCacheExportModal() {
        if (!this.isBrowserCacheMode) return;
        
        // Create modal HTML if it doesn't exist
        let modal = document.getElementById('browserCacheExportModal');
        if (!modal) {
            const modalHtml = `
                <div class="modal fade" id="browserCacheExportModal" tabindex="-1">
                    <div class="modal-dialog">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">
                                    <i class="fas fa-database me-2"></i>Browser Cache Data
                                </h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <div class="alert alert-info">
                                    <i class="fas fa-info-circle me-2"></i>
                                    Export your browser cache data as a JSON file for backup, or import a previously exported file.
                                </div>
                                
                                <div class="row">
                                    <div class="col-md-6">
                                        <div class="card">
                                            <div class="card-header">
                                                <h6><i class="fas fa-download me-2"></i>Export Data</h6>
                                            </div>
                                            <div class="card-body text-center">
                                                                                                 <p class="text-muted">Download all your projects, images, and annotations.</p>
                                                <div class="btn-group d-grid">
                                                    <button class="btn btn-primary" onclick="app.exportBrowserCacheData('json')">
                                                        <i class="fas fa-download me-2"></i>Export JSON
                                                    </button>
                                                    <button class="btn btn-success" onclick="app.exportBrowserCacheData('zip')">
                                                        <i class="fas fa-file-archive me-2"></i>Export ZIP
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col-md-6">
                                        <div class="card">
                                            <div class="card-header">
                                                <h6><i class="fas fa-upload me-2"></i>Import Data</h6>
                                            </div>
                                                                                         <div class="card-body text-center">
                                                 <p class="text-muted">Load a previously exported JSON or ZIP file to restore your data.</p>
                                                                                                 <input type="file" id="browserCacheImportFile" accept=".json,.zip" style="display: none" onchange="app.handleBrowserCacheImport(this)">
                                                <button class="btn btn-success" onclick="document.getElementById('browserCacheImportFile').click()">
                                                    <i class="fas fa-upload me-2"></i>Import Data
                                                </button>
                                                <div class="mt-2">
                                                    <small class="text-muted">Supports JSON and ZIP files</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                
                                <div class="row mt-3">
                                    <div class="col-12">
                                        <div class="card border-danger">
                                            <div class="card-header bg-danger text-white">
                                                <h6 class="mb-0"><i class="fas fa-trash-alt me-2"></i>Clear Browser Cache</h6>
                                            </div>
                                            <div class="card-body text-center">
                                                <p class="text-muted">Permanently delete all your local data and reset browser cache.</p>
                                                <button class="btn btn-danger" onclick="app.clearBrowserCache()">
                                                    <i class="fas fa-trash-alt me-2"></i>Clear All Data
                                                </button>
                                                <div class="mt-2">
                                                    <small class="text-danger">⚠️ This action cannot be undone</small>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
        
        const bsModal = new bootstrap.Modal(document.getElementById('browserCacheExportModal'));
        bsModal.show();
    }

    handleBrowserCacheImport(input) {
        const file = input.files[0];
        if (file) {
            this.importBrowserCacheData(file);
            // Reset the input
            input.value = '';
        }
    }

    async extractZipImport(zipFile) {
        try {
            console.log('Starting ZIP import, file size:', zipFile.size);
            const zip = new JSZip();
            const zipData = await zip.loadAsync(zipFile);
            console.log('ZIP loaded successfully, found files:', Object.keys(zipData.files));
            
            // Look for VLAMy export structure
            let metadataFile = null;
            const imageFiles = {};
            const jsonFiles = [];
            
            // First pass - identify all files
            Object.keys(zipData.files).forEach(fileName => {
                const file = zipData.files[fileName];
                console.log(`File: ${fileName}, isDir: ${file.dir}, size: ${file._data ? file._data.uncompressedSize : 'unknown'}`);
                
                if (fileName.toLowerCase().endsWith('.json') && !file.dir) {
                    jsonFiles.push(fileName);
                }
            });
            
            console.log('Found JSON files:', jsonFiles);
            
            // Find the metadata JSON file - be more flexible
            await Promise.all(Object.keys(zipData.files).map(async (fileName) => {
                const file = zipData.files[fileName];
                
                if (fileName.toLowerCase().endsWith('.json') && !file.dir) {
                    console.log('Processing JSON file:', fileName);
                    try {
                        const content = await file.async('text');
                        console.log(`JSON file ${fileName} content preview:`, content.substring(0, 200));
                        const jsonData = JSON.parse(content);
                        
                                                 // More flexible metadata detection
                         const hasVLAMyData = jsonData.projects || jsonData.images || jsonData.documents || 
                                            jsonData.annotations || jsonData.user_settings ||
                                            (jsonData.export_metadata && jsonData.export_metadata.app === 'VLAMy') ||
                                            // Check if it's a direct export with nested structure
                                            (Array.isArray(jsonData.projects) || Array.isArray(jsonData.images)) ||
                                            // Check if it's a single project export from server
                                            (jsonData.project_id && jsonData.name && (jsonData.owner || jsonData.created_at));
                        
                                                 console.log(`JSON file ${fileName} analysis:`, {
                             hasProjects: !!jsonData.projects,
                             hasImages: !!jsonData.images,
                             hasDocuments: !!jsonData.documents,
                             hasAnnotations: !!jsonData.annotations,
                             hasUserSettings: !!jsonData.user_settings,
                             hasExportMetadata: !!jsonData.export_metadata,
                             isSingleProject: !!(jsonData.project_id && jsonData.name),
                             topLevelKeys: Object.keys(jsonData).slice(0, 10)
                         });
                        
                        if (hasVLAMyData) {
                            metadataFile = jsonData;
                            console.log('✅ Found VLAMy metadata JSON:', fileName);
                        } else {
                            console.log('❌ JSON file does not contain VLAMy data:', fileName);
                        }
                    } catch (e) {
                        console.log('❌ Failed to parse JSON file:', fileName, e.message);
                    }
                } else if (fileName.match(/\.(jpg|jpeg|png|tiff|tif|bmp|gif)$/i)) {
                    console.log('Processing image file:', fileName);
                    // Image file - convert to base64
                    const imageBlob = await file.async('blob');
                    const base64 = await this.blobToBase64(imageBlob);
                    imageFiles[fileName] = base64;
                }
            }));
            
            if (!metadataFile) {
                console.log('No VLAMy metadata found. Available JSON files:', jsonFiles);
                if (jsonFiles.length > 0) {
                    // Try to use the first JSON file if no clear metadata was found
                    console.log('Attempting to use first JSON file as metadata:', jsonFiles[0]);
                    try {
                        const firstJsonFile = zipData.files[jsonFiles[0]];
                        const content = await firstJsonFile.async('text');
                        metadataFile = JSON.parse(content);
                        console.log('Using first JSON file as metadata:', jsonFiles[0]);
                        this.showAlert('No clear VLAMy metadata found, using first JSON file. Some data may not import correctly.', 'warning');
                    } catch (e) {
                        console.error('Failed to parse first JSON file:', e);
                        this.showAlert('Invalid ZIP file: No valid JSON metadata found', 'danger');
                        return null;
                    }
                } else {
                    this.showAlert('Invalid ZIP file: No JSON metadata found', 'danger');
                    return null;
                }
            }
            
            console.log('Processing metadata file. Type:', metadataFile.project_id ? 'Single Project Export' : 'Browser Cache Export');
            
            // Convert single project export to browser cache format if needed
            if (metadataFile.project_id && metadataFile.name && !metadataFile.projects) {
                console.log('Converting single project export to browser cache format');
                const convertedMetadata = await this.convertServerExportToBrowserCache(metadataFile, imageFiles, zipData);
                if (convertedMetadata) {
                    metadataFile = convertedMetadata;
                    console.log('Conversion completed successfully');
                } else {
                    this.showAlert('Failed to convert server export format', 'danger');
                    return null;
                }
            }
            
            // Update image paths in metadata to use base64
            if (metadataFile.images) {
                metadataFile.images.forEach(image => {
                    // Find corresponding image file in ZIP
                    const imagePath = Object.keys(imageFiles).find(path => 
                        path.includes(image.original_filename) || 
                        path.endsWith(image.image_file.split('/').pop())
                    );
                    
                    if (imagePath) {
                        image.image_file = imageFiles[imagePath];
                        image.image_url = imageFiles[imagePath];
                    }
                });
            }
            
            this.showAlert('ZIP file extracted successfully!', 'success');
            return metadataFile;
            
        } catch (error) {
            console.error('ZIP extraction error:', error);
            this.showAlert('Failed to extract ZIP file. Please check the file format.', 'danger');
            return null;
        }
    }

    async convertServerExportToBrowserCache(projectMetadata, imageFiles, zipData) {
        try {
            console.log('Converting server export, project metadata:', projectMetadata);
            console.log('Available image files:', Object.keys(imageFiles));
            console.log('All ZIP files:', Object.keys(zipData.files));
            
            // Create browser cache format structure
            const browserCacheData = {
                projects: [],
                documents: [],
                images: [],
                annotations: [],
                transcriptions: [],
                user_settings: {}
            };
            
            // Create project
            const project = {
                id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                name: projectMetadata.name,
                description: projectMetadata.description || '',
                created_at: projectMetadata.created_at || new Date().toISOString(),
                updated_at: projectMetadata.updated_at || new Date().toISOString(),
                order: 0
            };
            browserCacheData.projects.push(project);
            
            // Create document (one document per project in server exports)
            const document = {
                id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                project_id: project.id,
                name: projectMetadata.name + ' Document',
                description: '',
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            };
            browserCacheData.documents.push(document);
            
            // Process images and extract annotations from XML files
            let imageOrder = 0;
            for (const [imagePath, base64Data] of Object.entries(imageFiles)) {
                console.log('Processing image:', imagePath);
                
                // Extract filename from path
                const fileName = imagePath.split('/').pop();
                const baseName = fileName.split('.')[0];
                
                // Create image record
                const image = {
                    id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                    document_id: document.id,
                    original_filename: fileName,
                    image_file: base64Data,
                    image_url: base64Data,
                    order: imageOrder++,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                browserCacheData.images.push(image);
                
                // Look for corresponding XML file with annotations
                const xmlPath = Object.keys(zipData.files).find(path => 
                    path.includes(baseName) && path.toLowerCase().endsWith('.xml')
                );
                
                if (xmlPath) {
                    console.log('Found XML file for image:', xmlPath);
                                         try {
                         const xmlContent = await zipData.files[xmlPath].async('text');
                         const annotations = this.parsePageXMLAnnotations(xmlContent, image.id);
                         
                         // Add annotations and extract transcriptions
                         annotations.forEach(annotation => {
                             browserCacheData.annotations.push(annotation);
                             
                             // Add transcription if available
                             if (annotation._transcription) {
                                 browserCacheData.transcriptions.push(annotation._transcription);
                                 delete annotation._transcription; // Clean up temporary property
                             }
                         });
                         
                         console.log(`Extracted ${annotations.length} annotations from ${xmlPath}`);
                     } catch (e) {
                         console.error('Failed to parse XML file:', xmlPath, e);
                     }
                }
            }
            
            console.log('Conversion result:', {
                projects: browserCacheData.projects.length,
                documents: browserCacheData.documents.length,
                images: browserCacheData.images.length,
                annotations: browserCacheData.annotations.length,
                transcriptions: browserCacheData.transcriptions.length
            });
            
            return browserCacheData;
            
        } catch (error) {
            console.error('Server export conversion error:', error);
            return null;
        }
    }

    parsePageXMLAnnotations(xmlContent, imageId) {
        try {
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
            const annotations = [];
            
            // Parse PageXML format - look for TextRegion elements
            const textRegions = xmlDoc.querySelectorAll('TextRegion');
            
            textRegions.forEach((region, index) => {
                const coords = region.querySelector('Coords');
                const textEquiv = region.querySelector('TextEquiv Unicode');
                
                if (coords) {
                    const points = coords.getAttribute('points');
                    if (points) {
                        // Parse coordinates
                        const coordPairs = points.split(' ').map(pair => {
                            const [x, y] = pair.split(',').map(Number);
                            return { x, y };
                        });
                        
                        if (coordPairs.length >= 4) {
                                                         // Create annotation  
                             const annotation = {
                                 id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                 image_id: imageId,
                                 annotation_type: 'polygon',
                                 type: 'polygon',
                                 classification: region.getAttribute('type') || 'paragraph',
                                 coordinates: {
                                     points: coordPairs
                                 },
                                 reading_order: index,
                                 label: '',
                                 metadata: {},
                                 created_at: new Date().toISOString(),
                                 updated_at: new Date().toISOString()
                             };
                             

                            
                            annotations.push(annotation);
                            
                            // Add transcription if available
                            if (textEquiv) {
                                const transcription = {
                                    id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                                    image: imageId,
                                    annotation: annotation.id,
                                    transcription_type: 'annotation',
                                    api_endpoint: 'pagexml_import',
                                    api_model: 'pagexml',
                                    status: 'completed',
                                    text_content: textEquiv.textContent || '',
                                    confidence_score: null,
                                    api_response_raw: null,
                                    is_current: true,
                                    created_at: new Date().toISOString(),
                                    updated_at: new Date().toISOString()
                                };
                                
                                // Add to transcriptions (will be added by caller)
                                annotation._transcription = transcription;
                            }
                        }
                    }
                }
            });
            
            return annotations;
            
        } catch (error) {
            console.error('PageXML parsing error:', error);
            return [];
        }
    }

    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    exitBrowserCacheMode() {
        if (confirm('Are you sure you want to exit Browser Cache Mode? Your local data will remain in your browser but you will return to the login screen.')) {
            this.isBrowserCacheMode = false;
            localStorage.removeItem('browserCacheMode');
            this.currentUser = null;
            this.showWelcomeScreen();
            this.showAlert('Exited Browser Cache Mode. Your local data is still stored in your browser.', 'info');
        }
    }

    async clearBrowserCache() {
        if (!this.isBrowserCacheMode) {
            this.showAlert('Clear cache is only available in Browser Cache Mode', 'warning');
            return;
        }
        
        if (confirm('Are you sure you want to clear all browser cache data? This cannot be undone.')) {
            try {
                // Close database connection
                if (this.localStorage.db) {
                    this.localStorage.db.close();
                }
                
                // Delete the database
                await new Promise((resolve, reject) => {
                    const deleteRequest = indexedDB.deleteDatabase(this.localStorage.dbName);
                    deleteRequest.onsuccess = () => resolve();
                    deleteRequest.onerror = () => reject(deleteRequest.error);
                });
                
                // Reset localStorage manager
                this.localStorage.isInitialized = false;
                this.localStorage.db = null;
                
                // Clear UI
                this.clearProjectTree();
                this.clearCanvas();
                this.clearImageList();
                
                this.showAlert('Browser cache cleared successfully!', 'success');
            } catch (error) {
                console.error('Error clearing browser cache:', error);
                this.showAlert('Failed to clear browser cache', 'danger');
            }
        }
    }
    
    async debugBrowserCacheData() {
        if (!this.isBrowserCacheMode) {
            console.log('Not in browser cache mode');
            return;
        }
        
        try {
            const projects = await this.localStorage.getAll('projects');
            const documents = await this.localStorage.getAll('documents');
            const images = await this.localStorage.getAll('images');
            const annotations = await this.localStorage.getAll('annotations');
            const transcriptions = await this.localStorage.getAll('transcriptions');
            
            console.log('=== BROWSER CACHE DEBUG ===');
            console.log('Projects:', projects.length, projects);
            console.log('Documents:', documents.length, documents);
            console.log('Images:', images.length, images);
            console.log('Annotations:', annotations.length, annotations);
            console.log('Transcriptions:', transcriptions.length, transcriptions);
            
            // Check for current image annotations
            if (this.currentImage) {
                const imageAnnotations = await this.getAnnotationsForImage(this.currentImage.id);
                console.log(`Annotations for current image (${this.currentImage.id}):`, imageAnnotations.length, imageAnnotations);
            }
        } catch (error) {
            console.error('Debug error:', error);
        }
    }

    clearProjectTree() {
        const projectTree = document.getElementById('projectTree');
        if (projectTree) {
            projectTree.innerHTML = '<div class="text-center text-muted p-3">No projects available</div>';
        }
    }

    clearCanvas() {
        if (this.canvas) {
            this.canvas.clear();
        }
        this.currentImage = null;
        this.annotations = [];
    }

    clearImageList() {
        const imageGrid = document.getElementById('imageGrid');
        if (imageGrid) {
            imageGrid.innerHTML = '<div class="text-center text-muted p-3">No images available</div>';
        }
    }

    async startBrowserCacheMode() {
        this.isBrowserCacheMode = true;
        localStorage.setItem('browserCacheMode', 'true');
        
        try {
            await this.localStorage.init();
            await this.loadBrowserCacheSettings();
            this.showAppInterface();
            await this.loadProjects();
            this.showAlert('Browser Cache Mode activated! All data will be stored locally in your browser.', 'success');
        } catch (error) {
            console.error('Failed to initialize browser cache mode:', error);
            this.showAlert('Failed to initialize browser cache mode. Please check your browser compatibility.', 'danger');
        }
    }

    async loadBrowserCacheSettings() {
        // Load or create default user settings for browser cache mode
        let customPrompts = await this.localStorage.getSetting('custom_prompts');
        let customZones = await this.localStorage.getSetting('custom_zones'); 
        let zoneColors = await this.localStorage.getSetting('zone_colors');
        let enabledZoneTypes = await this.localStorage.getSetting('enabled_zone_types');
        let enabledLineTypes = await this.localStorage.getSetting('enabled_line_types');

        // Set defaults if not found
        if (!customPrompts) {
            customPrompts = [
                {
                    id: 'default_main',
                    name: 'Main Zone Default',
                    prompt: 'Transcribe this text accurately, preserving formatting and structure.',
                    zones: ['MainZone'],
                    metadata_fields: [
                        { name: 'handwritten', type: 'boolean', default: false },
                        { name: 'typed', type: 'boolean', default: true },
                        { name: 'language', type: 'string', default: 'en' }
                    ],
                    is_default: true
                }
            ];
            await this.localStorage.setSetting('custom_prompts', customPrompts);
        }

        if (!customZones) {
            customZones = [];
            await this.localStorage.setSetting('custom_zones', customZones);
        }

        if (!zoneColors) {
            zoneColors = {};
            await this.localStorage.setSetting('zone_colors', zoneColors);
        }

        if (!enabledZoneTypes) {
            enabledZoneTypes = ['MainZone', 'GraphicZone', 'TableZone', 'DropCapitalZone', 'MusicZone', 'MarginTextZone', 'CustomZone'];
            await this.localStorage.setSetting('enabled_zone_types', enabledZoneTypes);
        }

        if (!enabledLineTypes) {
            enabledLineTypes = ['DefaultLine', 'HeadingLine', 'DropCapitalLine', 'InterlinearLine', 'CustomLine'];
            await this.localStorage.setSetting('enabled_line_types', enabledLineTypes);
        }

        // Create a mock user object for browser cache mode
        this.currentUser = {
            user: { username: 'Browser User' },
            custom_prompts: customPrompts,
            custom_zones: customZones,
            zone_colors: zoneColors,
            enabled_zone_types: enabledZoneTypes,
            enabled_line_types: enabledLineTypes,
            custom_detection_mappings: await this.localStorage.getSetting('custom_detection_mappings') || {}
        };

        this.customPrompts = customPrompts;
        this.customZones = customZones;
        this.zoneColors = zoneColors;
        
        // Set user enabled types
        this.userEnabledTypes = {
            zones: enabledZoneTypes,
            lines: enabledLineTypes
        };

        // Update UI
        document.getElementById('username').textContent = this.currentUser.user.username;
        this.initializeDefaultColors();
        this.updateCredentialsStatus();
        this.populatePromptsList();
    }

    // Override the init method to support browser cache mode
    async init() {
        this.setupEventListeners();
        
        if (this.isBrowserCacheMode) {
            try {
                // Explicitly initialize localStorage before any operations
                console.log('Initializing browser cache database...');
                await this.localStorage.init();
                console.log('Browser cache database initialized successfully');
                
                await this.loadBrowserCacheSettings();
                await this.loadAnnotationTypes();
                this.showAppInterface();
                await this.loadProjects();
            } catch (error) {
                console.error('Failed to load browser cache mode:', error);
                this.showLoading(false); // Ensure loading is hidden on error
                this.showWelcomeScreen();
            }
        } else if (this.authToken) {
            try {
                await this.loadUserProfile();
                await this.loadAnnotationTypes();
                this.showAppInterface();
                await this.loadProjects();
            } catch (error) {
                console.error('Failed to load user profile:', error);
                this.showLoading(false); // Ensure loading is hidden on error
                this.logout();
            }
        } else {
            this.showLoading(false); // Ensure loading is hidden
            this.showWelcomeScreen();
        }
    }

    // Debug helper function to diagnose prompt/classification issues
    debugPromptClassifications() {
        console.group('🔍 Prompt & Classification Debug Info');
        
        // Show all available zone types
        console.log('📝 Available Zone Types:');
        if (this.annotationTypes) {
            this.annotationTypes.all_types.zones.forEach(zone => {
                console.log(`  • ${zone.label} (value: "${zone.value}")`);
            });
        }
        
        // Show custom zones
        if (this.customZones.length > 0) {
            console.log('🎨 Custom Zones:');
            this.customZones.forEach(zone => {
                console.log(`  • ${zone.label} (value: "${zone.value}")`);
            });
        }
        
        // Show current prompts and their zones
        console.log('💬 Current Prompts:');
        this.customPrompts.forEach(prompt => {
            console.log(`  • "${prompt.name}": zones [${prompt.zones.join(', ')}]`);
        });
        
        // Show current annotations and their classifications
        if (this.annotations.length > 0) {
            console.log('📍 Current Annotations:');
            this.annotations.forEach((ann, i) => {
                const prompt = this.getPromptForAnnotation(ann);
                console.log(`  • Annotation ${i+1}: classification "${ann.classification}" → prompt "${prompt.name || 'default'}"`);
            });
        }
        
        // Show detection mappings
        if (this.currentUser && this.currentUser.custom_detection_mappings) {
            console.log('🔄 Detection Mappings:');
            Object.entries(this.currentUser.custom_detection_mappings).forEach(([from, to]) => {
                console.log(`  • "${from}" → "${to}"`);
            });
        }
        
        console.groupEnd();
    }

    // Helper function to ensure prompts include main zone types
    async ensureMainZonePrompt() {
        if (!this.annotationTypes || !this.customPrompts) return;
        
        // Find the main zone type value
        const mainZoneType = this.annotationTypes.all_types.zones.find(z => 
            z.label.toLowerCase().includes('main') || z.value.toLowerCase().includes('main')
        );
        
        if (!mainZoneType) {
            console.log('No main zone type found in annotation types');
            return;
        }
        
        // Check if any prompt includes the main zone
        const hasMainZonePrompt = this.customPrompts.some(prompt => 
            prompt.zones && prompt.zones.includes(mainZoneType.value)
        );
        
        if (!hasMainZonePrompt) {
            console.log(`Creating default prompt for Main Zone (${mainZoneType.value})`);
            
            // Create a default prompt for Main Zone
            const mainZonePrompt = {
                id: 'main_zone_default_' + Date.now(),
                name: 'Main Zone Default',
                prompt: 'Transcribe this text accurately, preserving formatting and structure.',
                zones: [mainZoneType.value],
                metadata_fields: [
                    { name: 'handwritten', type: 'boolean', default: false },
                    { name: 'typed', type: 'boolean', default: true },
                    { name: 'language', type: 'string', default: 'en' }
                ],
                is_default: false
            };
            
            const updatedPrompts = [...this.customPrompts, mainZonePrompt];
            
            try {
                if (this.isBrowserCacheMode) {
                    // Save to browser cache
                    await this.localStorage.setSetting('custom_prompts', updatedPrompts);
                    this.customPrompts = updatedPrompts;
                    this.currentUser.custom_prompts = updatedPrompts;
                } else {
                    // Save to backend
                    const response = await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${this.authToken}`
                        },
                        body: JSON.stringify({
                            custom_prompts: updatedPrompts
                        })
                    });
                    
                    if (response.ok) {
                        this.customPrompts = updatedPrompts;
                    }
                }
                
                this.populatePromptsList();
                console.log('✅ Main Zone prompt created successfully');
                this.showAlert('Main Zone prompt created automatically', 'info');
            } catch (error) {
                console.error('Error creating main zone prompt:', error);
            }
        }
    }

    setupEventListeners() {
        // Form submissions
        document.getElementById('loginForm').addEventListener('submit', (e) => this.login(e));
        document.getElementById('registerForm').addEventListener('submit', (e) => this.register(e));
        
        // Create Project Form - Enter key support
        const createProjectForm = document.getElementById('createProjectForm');
        if (createProjectForm) {
            createProjectForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createProject();
            });
            
            // Allow Enter in text inputs but not textareas
            createProjectForm.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    this.createProject();
                }
            });
        }
        
        // Create Document Form - Enter key support  
        const createDocumentForm = document.getElementById('createDocumentForm');
        if (createDocumentForm) {
            createDocumentForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.createDocument();
            });
            
            // Allow Enter in text inputs but not textareas
            createDocumentForm.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    this.createDocument();
                }
            });
        }
        
        // Confidence threshold slider
        const confidenceThreshold = document.getElementById('confidenceThreshold');
        if (confidenceThreshold) {
            confidenceThreshold.addEventListener('input', (e) => {
                const value = parseFloat(e.target.value);
                const percentage = Math.round(value * 100);
                document.getElementById('confidenceValue').textContent = `${percentage}%`;
            });
        }
        
        // Navigation
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));
        
        // Window resize
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    // Authentication Methods
    async login(event) {
        event.preventDefault();
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;

        try {
            this.showLoading(true);
            const response = await this.fetchWithTimeout(`${this.apiBaseUrl}/auth/login/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password })
            }, 8000); // 8 second timeout for login

            if (response.ok) {
                const data = await response.json();
                this.authToken = data.token;
                localStorage.setItem('authToken', this.authToken);
                
                try {
                    await this.loadUserProfile();
                    await this.loadAnnotationTypes();
                    this.showAppInterface();
                    await this.loadProjects();
                    this.showAlert('Login successful!', 'success');
                } catch (initError) {
                    console.error('Error during post-login initialization:', initError);
                    this.showAlert('Login succeeded but failed to load data. Please refresh.', 'warning');
                }
            } else {
                const error = await response.json();
                this.showAlert(error.detail || 'Login failed', 'danger');
            }
        } catch (error) {
            console.error('Login error:', error);
            this.showAlert('Login failed. Please try again.', 'danger');
        } finally {
            this.showLoading(false);
        }
    }

    async register(event) {
        event.preventDefault();
        const formData = {
            first_name: document.getElementById('regFirstName').value,
            last_name: document.getElementById('regLastName').value,
            username: document.getElementById('regUsername').value,
            email: document.getElementById('regEmail').value,
            password: document.getElementById('regPassword').value,
            password_confirm: document.getElementById('regPasswordConfirm').value,
            request_reason: document.getElementById('regRequestReason').value
        };

        if (formData.password !== formData.password_confirm) {
            this.showAlert('Passwords do not match', 'danger');
            return;
        }

        try {
            this.showLoading(true);
            const response = await fetch(`${this.apiBaseUrl}/auth/request-account/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(formData)
            });

            if (response.ok) {
                const data = await response.json();
                this.showAlert(data.message, 'success');
                
                // Clear the form
                document.getElementById('registerForm').reset();
                
                // Show additional info about the approval process
                setTimeout(() => {
                    this.showAlert('Your account request has been submitted successfully. You will receive an email notification once your account is approved by an administrator.', 'info');
                }, 2000);
                
                // Optionally redirect to login after a delay
                setTimeout(() => {
                    this.showLogin();
                }, 4000);
            } else {
                const error = await response.json();
                
                // Handle specific error cases
                if (error.redirect_to_account_request) {
                    this.showAlert('Registration system has been updated. Please use the account request form.', 'info');
                    return;
                }
                
                // Handle validation errors
                let errorMessage = '';
                if (typeof error === 'object') {
                    // Handle field-specific errors
                    for (const [field, messages] of Object.entries(error)) {
                        if (Array.isArray(messages)) {
                            errorMessage += messages.join(' ') + ' ';
                        } else {
                            errorMessage += messages + ' ';
                        }
                    }
                } else {
                    errorMessage = error.message || 'Registration failed. Please try again.';
                }
                
                this.showAlert(errorMessage.trim(), 'danger');
            }
        } catch (error) {
            console.error('Registration error:', error);
            // Check if it's a JSON parsing error (which was the original issue)
            if (error.message && error.message.includes('Unexpected token')) {
                this.showAlert('Server returned an unexpected response. Please try again or contact support.', 'danger');
            } else {
                this.showAlert('Registration failed. Please check your connection and try again.', 'danger');
            }
        } finally {
            this.showLoading(false);
        }
    }

    async loadUserProfile() {
        const response = await this.fetchWithTimeout(`${this.apiBaseUrl}/auth/profile/`, {
            headers: {
                'Authorization': `Token ${this.authToken}`
            }
        }, 8000); // 8 second timeout

        if (response.ok) {
            this.currentUser = await response.json();
            document.getElementById('username').textContent = this.currentUser.user.username;
            this.customPrompts = this.currentUser.custom_prompts || [];
            this.customZones = this.currentUser.custom_zones || [];
            this.zoneColors = this.currentUser.zone_colors || {};
            this.initializeDefaultColors();
            this.updateCredentialsStatus();
            this.populatePromptsList();
            
            // Ensure main zone prompt exists after loading annotation types
            if (this.annotationTypes) {
                await this.ensureMainZonePrompt();
            }
        } else {
            throw new Error('Failed to load user profile');
        }
    }

    async loadAnnotationTypes() {
        try {
            if (this.isBrowserCacheMode) {
                // Load annotation types from static data for browser cache mode
                const data = {
                    all_types: {
                        zones: [
                            { value: 'MainZone', label: 'Main Zone' },
                            { value: 'GraphicZone', label: 'Graphic Zone' },
                            { value: 'TableZone', label: 'Table Zone' },
                            { value: 'DropCapitalZone', label: 'Drop Capital Zone' },
                            { value: 'MusicZone', label: 'Music Zone' },
                            { value: 'MarginTextZone', label: 'Margin Text Zone' },
                            { value: 'CustomZone', label: 'Custom Zone' },
                            { value: 'DamageZone', label: 'Damage Zone' },
                            { value: 'DigitizationArtefactZone', label: 'Digitization Artefact Zone' },
                            { value: 'NumberingZone', label: 'Numbering Zone' },
                            { value: 'QuireMarksZone', label: 'Quire Marks Zone' },
                            { value: 'RunningTitleZone', label: 'Running Title Zone' },
                            { value: 'SealZone', label: 'Seal Zone' },
                            { value: 'StampZone', label: 'Stamp Zone' },
                            { value: 'TitlePageZone', label: 'Title Page Zone' }
                        ],
                        lines: [
                            { value: 'DefaultLine', label: 'Default Line' },
                            { value: 'HeadingLine', label: 'Heading Line' },
                            { value: 'DropCapitalLine', label: 'Drop Capital Line' },
                            { value: 'InterlinearLine', label: 'Interlinear Line' },
                            { value: 'CustomLine', label: 'Custom Line' },
                            { value: 'MusicLine', label: 'Music Line' }
                        ]
                    },
                    user_enabled: this.userEnabledTypes || {
                        zones: ['MainZone', 'GraphicZone', 'TableZone', 'DropCapitalZone', 'MusicZone', 'MarginTextZone', 'CustomZone'],
                        lines: ['DefaultLine', 'HeadingLine', 'DropCapitalLine', 'InterlinearLine', 'CustomLine']
                    }
                };
                
                this.annotationTypes = data;
                this.userEnabledTypes = data.user_enabled;
                this.initializeDefaultColors();
                this.populateClassificationSelector();
                this.populateAnnotationTypesChecklist();
                
                // Update tool UI in case bbox tool is already selected
                if (this.currentTool === 'bbox') {
                    const classificationSelector = document.getElementById('classificationSelector');
                    if (classificationSelector) {
                        classificationSelector.style.display = 'flex';
                    }
                }
                
                // Ensure main zone prompt exists after annotation types are loaded
                if (this.currentUser) {
                    await this.ensureMainZonePrompt();
                }
            } else {
                const response = await fetch(`${this.apiBaseUrl}/annotation-types/`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    this.annotationTypes = data;
                    this.userEnabledTypes = data.user_enabled;
                    this.initializeDefaultColors();
                    this.populateClassificationSelector();
                    this.populateAnnotationTypesChecklist();
                    
                    // Ensure main zone prompt exists after annotation types are loaded
                    if (this.currentUser) {
                        await this.ensureMainZonePrompt();
                    }
                } else {
                    console.error('Failed to load annotation types');
                }
            }
        } catch (error) {
            console.error('Error loading annotation types:', error);
        }
    }

    logout() {
        this.authToken = null;
        this.currentUser = null;
        localStorage.removeItem('authToken');
        this.showWelcomeScreen();
    }

    // UI State Management
    showWelcomeScreen() {
        document.getElementById('welcomeScreen').style.display = 'block';
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('registerScreen').style.display = 'none';
        document.getElementById('adminScreen').style.display = 'none';
        document.getElementById('appInterface').style.display = 'none';
        document.getElementById('userMenu').style.display = 'none';
        document.getElementById('loginButton').style.display = 'block';
        
        // Hide admin nav
        const adminNav = document.getElementById('adminNav');
        if (adminNav) {
            adminNav.style.display = 'none';
        }
    }

    showLogin() {
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'block';
        document.getElementById('registerScreen').style.display = 'none';
        document.getElementById('adminScreen').style.display = 'none';
        document.getElementById('appInterface').style.display = 'none';
    }

    showRegister() {
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('registerScreen').style.display = 'block';
        document.getElementById('adminScreen').style.display = 'none';
        document.getElementById('appInterface').style.display = 'none';
    }

    showAppInterface() {
        // Ensure loading spinner is hidden when showing app interface
        this.showLoading(false);
        
        document.getElementById('welcomeScreen').style.display = 'none';
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('registerScreen').style.display = 'none';
        document.getElementById('adminScreen').style.display = 'none';
        document.getElementById('appInterface').style.display = 'block';
        document.getElementById('userMenu').style.display = 'block';
        document.getElementById('loginButton').style.display = 'none';
        
        // Show/hide admin navigation based on user privileges
        const adminNav = document.getElementById('adminNav');
        if (adminNav && this.currentUser && this.currentUser.user.is_staff) {
            adminNav.style.display = 'block';
        } else if (adminNav) {
            adminNav.style.display = 'none';
        }
        
        // Show/hide navigation items based on mode
        if (this.isBrowserCacheMode) {
            document.getElementById('serverExportsNav').style.display = 'none';
            document.getElementById('serverImportsNav').style.display = 'none';
            document.getElementById('browserCacheDataNav').style.display = 'block';
            document.getElementById('browserCacheExitOption').style.display = 'block';
            document.getElementById('logoutOption').style.display = 'none';
        } else {
            document.getElementById('serverExportsNav').style.display = 'block';
            document.getElementById('serverImportsNav').style.display = 'block';
            document.getElementById('browserCacheDataNav').style.display = 'none';
            document.getElementById('browserCacheExitOption').style.display = 'none';
            document.getElementById('logoutOption').style.display = 'block';
        }
        
        if (!this.canvas) {
            this.initCanvas();
        }
        
        // Initialize panel resize functionality
        this.initPanelResize();
        
        // Initialize model selection
        this.populateModelSelection();
    }

    showLoading(show) {
        const spinner = document.getElementById('loadingSpinner');
        if (spinner) {
            // Use CSS classes instead of inline styles to override !important
            if (show) {
                spinner.classList.remove('d-none');
                spinner.classList.add('d-flex');
                spinner.style.display = ''; // Clear any inline display style
            } else {
                spinner.classList.remove('d-flex');
                spinner.classList.add('d-none');
            }
        }
        
        // Auto-clear loading after 5 seconds to prevent stuck loading states in server mode
        if (show) {
            if (this.loadingTimeout) {
                clearTimeout(this.loadingTimeout);
            }
            this.loadingTimeout = setTimeout(() => {
                console.warn('Loading spinner auto-cleared after timeout - this may indicate a hanging request');
                this.showLoading(false);
                this.showAlert('Operation timed out. Please try again.', 'warning');
            }, 5000); // Reduced from 10 seconds to 5 seconds
        } else {
            if (this.loadingTimeout) {
                clearTimeout(this.loadingTimeout);
                this.loadingTimeout = null;
            }
        }
    }

    // Helper method to create fetch requests with timeout
    async fetchWithTimeout(url, options = {}, timeout = 10000) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            return response;
        } catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error('Request timed out');
            }
            throw error;
        }
    }

    showAlert(message, type = 'info') {
        const alertContainer = document.getElementById('alertContainer');
        const alertId = 'alert_' + Date.now();
        
        const alertHtml = `
            <div id="${alertId}" class="alert alert-${type} alert-dismissible fade show" role="alert">
                ${message}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            </div>
        `;
        
        alertContainer.insertAdjacentHTML('beforeend', alertHtml);
        
        // Auto-remove after 5 seconds
        setTimeout(() => {
            const alert = document.getElementById(alertId);
            if (alert) {
                alert.remove();
            }
        }, 5000);
    }

    // Canvas and Annotation Methods
    initCanvas() {
        this.canvas = new fabric.Canvas('fabricCanvas', {
            width: 1200,
            height: 800,
            backgroundColor: 'white',
            uniformScaling: false,
            uniScaleTransform: false
        });

        this.canvas.on('mouse:down', (event) => this.onMouseDown(event));
        this.canvas.on('mouse:move', (event) => this.onMouseMove(event));
        this.canvas.on('mouse:up', (event) => this.onMouseUp(event));
        this.canvas.on('selection:created', (event) => this.onSelectionCreated(event));
        this.canvas.on('selection:updated', (event) => this.onSelectionUpdated(event));
        this.canvas.on('selection:cleared', () => this.onSelectionCleared());
        this.canvas.on('object:modified', (event) => this.onObjectModified(event));
        
        // Force disable uniform scaling on all objects when selected
        this.canvas.on('selection:created', (event) => this.disableUniformScaling(event));
        this.canvas.on('selection:updated', (event) => this.disableUniformScaling(event));

        this.resizeCanvas();
        
        // Set global Fabric.js settings to disable uniform scaling
        if (typeof fabric !== 'undefined') {
            fabric.Object.prototype.uniformScaling = false;
            fabric.Object.prototype.uniScaleTransform = false;
            fabric.Object.prototype.lockUniScaling = false;
        }
    }

    resizeCanvas() {
        if (!this.canvas) return;
        
        const container = document.querySelector('.canvas-container');
        const maxWidth = container.clientWidth - 40;
        const maxHeight = container.clientHeight - 40;
        
        // Use much more of the available space
        this.canvas.setDimensions({
            width: Math.max(1200, maxWidth),
            height: Math.max(800, maxHeight)
        });
        
        // If we have a current image, recalculate its position and refresh annotations
        if (this.currentFabricImage && this.currentImage) {
            this.repositionImageAndAnnotations();
        }
    }

    repositionImageAndAnnotations() {
        if (!this.currentFabricImage || !this.imageTransform) return;
        
        const canvasWidth = this.canvas.getWidth();
        const canvasHeight = this.canvas.getHeight();
        const imgWidth = this.imageTransform.originalWidth;
        const imgHeight = this.imageTransform.originalHeight;
        
        // Recalculate scale and position
        const scaleX = canvasWidth / imgWidth;
        const scaleY = canvasHeight / imgHeight;
        let scale = Math.min(scaleX, scaleY, 1);
        
        // For small images, allow some scaling up (up to 2x)
        if (scale === 1 && imgWidth < 400 && imgHeight < 400) {
            scale = Math.min(2, Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight));
        }
        
        // Update image position and scale
        const scaledWidth = imgWidth * scale;
        const scaledHeight = imgHeight * scale;
        const left = (canvasWidth - scaledWidth) / 2;
        const top = (canvasHeight - scaledHeight) / 2;
        
        this.currentFabricImage.set({
            scaleX: scale,
            scaleY: scale,
            left: left,
            top: top
        });
        
        // Update image transform
        this.imageTransform = {
            scale: scale,
            left: left,
            top: top,
            originalWidth: imgWidth,
            originalHeight: imgHeight
        };
        
        // Refresh annotation positions
        this.refreshAnnotationPositions();
    }

    // Throttled version for smooth performance during resize
    throttledResizeCanvas() {
        if (this.resizeTimeout) {
            clearTimeout(this.resizeTimeout);
        }
        this.resizeTimeout = setTimeout(() => {
            this.resizeCanvas();
        }, 16); // ~60fps
    }

    setTool(tool) {
        this.currentTool = tool;
        
        // Reset drawing state when switching tools
        if (this.isDrawing) {
            this.isDrawing = false;
        }
        
        // Update tool buttons
        document.querySelectorAll('.toolbar .btn').forEach(btn => {
            btn.classList.remove('active');
        });
        document.getElementById(tool + 'Tool').classList.add('active');
        
        // Show/hide classification selector
        const classificationSelector = document.getElementById('classificationSelector');
        if (tool === 'bbox' && this.annotationTypes) {
            classificationSelector.style.display = 'flex';
            // Make sure the selector is populated
            if (!classificationSelector.querySelector('select').children.length > 1) {
                this.populateClassificationSelector();
            }
        } else {
            classificationSelector.style.display = 'none';
        }
        
        // Update canvas selection mode
        if (tool === 'select') {
            this.canvas.selection = true;
            this.canvas.defaultCursor = 'default';
            // Ensure all objects are selectable when switching to select mode
            this.canvas.forEachObject((obj) => {
                if (obj.annotationId) {
                    obj.selectable = true;
                }
            });
        } else {
            this.canvas.selection = false;
            this.canvas.defaultCursor = 'crosshair';
        }
        
        // Refresh canvas to apply changes
        this.canvas.renderAll();
    }

    populateClassificationSelector() {
        if (!this.annotationTypes || !this.userEnabledTypes) return;
        
        const selector = document.getElementById('annotationClassification');
        if (!selector) return;
        
        // Clear existing options except the first one
        while (selector.children.length > 1) {
            selector.removeChild(selector.lastChild);
        }
        
        // Add zone types (including custom zones)
        if (this.userEnabledTypes.zones && this.userEnabledTypes.zones.length > 0) {
            const zoneGroup = document.createElement('optgroup');
            zoneGroup.label = 'Zone Types';
            
            this.userEnabledTypes.zones.forEach(zoneCode => {
                // First check built-in zones
                let zoneType = this.annotationTypes.all_types.zones.find(z => z.value === zoneCode);
                
                // Then check custom zones
                if (!zoneType) {
                    zoneType = this.customZones.find(z => z.value === zoneCode);
                }
                
                if (zoneType) {
                    const option = document.createElement('option');
                    option.value = zoneType.value;
                    option.textContent = zoneType.label;
                    zoneGroup.appendChild(option);
                }
            });
            
            if (zoneGroup.children.length > 0) {
                selector.appendChild(zoneGroup);
            }
        }
        
        // Add line types
        if (this.userEnabledTypes.lines && this.userEnabledTypes.lines.length > 0) {
            const lineGroup = document.createElement('optgroup');
            lineGroup.label = 'Line Types';
            
            this.userEnabledTypes.lines.forEach(lineCode => {
                const lineType = this.annotationTypes.all_types.lines.find(l => l.value === lineCode);
                if (lineType) {
                    const option = document.createElement('option');
                    option.value = lineType.value;
                    option.textContent = lineType.label;
                    lineGroup.appendChild(option);
                }
            });
            
            if (lineGroup.children.length > 0) {
                selector.appendChild(lineGroup);
            }
        }
        
        // Listen for changes
        selector.addEventListener('change', (e) => {
            this.currentClassification = e.target.value;
        });
    }

    initializeDefaultColors() {
        // Initialize colors for built-in zones if not already set
        if (this.annotationTypes) {
            let colorIndex = 0;
            
            // Assign colors to built-in zone types
            this.annotationTypes.all_types.zones.forEach(zoneType => {
                if (!this.zoneColors[zoneType.value]) {
                    this.zoneColors[zoneType.value] = this.defaultColors[colorIndex % this.defaultColors.length];
                    colorIndex++;
                }
            });
            
            // Assign colors to built-in line types
            this.annotationTypes.all_types.lines.forEach(lineType => {
                if (!this.zoneColors[lineType.value]) {
                    this.zoneColors[lineType.value] = this.defaultColors[colorIndex % this.defaultColors.length];
                    colorIndex++;
                }
            });
        }
        
        // Assign colors to custom zones
        this.customZones.forEach(customZone => {
            if (!this.zoneColors[customZone.value]) {
                const usedColors = Object.values(this.zoneColors);
                const availableColors = this.defaultColors.filter(color => !usedColors.includes(color));
                this.zoneColors[customZone.value] = availableColors.length > 0 ? 
                    availableColors[0] : this.defaultColors[Object.keys(this.zoneColors).length % this.defaultColors.length];
            }
        });
    }

    populateAnnotationTypesChecklist() {
        if (!this.annotationTypes || !this.userEnabledTypes) return;

        const checklist = document.getElementById('annotationTypesChecklist');
        if (!checklist) return;

        checklist.innerHTML = '';

        // Create three columns - reordered: Zones, Lines, Custom Zones
        const zonesColumn = document.createElement('div');
        zonesColumn.className = 'annotation-type-column';
        
        const linesColumn = document.createElement('div');
        linesColumn.className = 'annotation-type-column';
        
        const customZonesColumn = document.createElement('div');
        customZonesColumn.className = 'annotation-type-column';
        customZonesColumn.id = 'customZonesColumn';

        // Add Zone Types column
        zonesColumn.innerHTML = '<h6><i class="fas fa-square me-2"></i>Zone Types</h6>';
        
        this.annotationTypes.all_types.zones.forEach(zoneType => {
            const isEnabled = this.userEnabledTypes.zones.includes(zoneType.value);
            const color = this.zoneColors[zoneType.value] || '#0066cc';
            const checkboxHtml = `
                <div class="form-check zone-type-item" data-zone-type="${zoneType.value}">
                    <input class="form-check-input" type="checkbox" value="${zoneType.value}" 
                           id="type_${zoneType.value}" ${isEnabled ? 'checked' : ''}
                           onchange="app.handleAnnotationTypeChange()">
                    <label class="form-check-label" for="type_${zoneType.value}">
                        ${zoneType.label}
                    </label>
                    <input type="color" class="form-control form-control-sm zone-color-picker" 
                           value="${color}" title="Change color"
                           onchange="app.updateZoneColor('${zoneType.value}', this.value)">
                </div>
            `;
            zonesColumn.insertAdjacentHTML('beforeend', checkboxHtml);
        });

        // Add Line Types column
        linesColumn.innerHTML = '<h6><i class="fas fa-minus me-2"></i>Line Types</h6>';
        
        this.annotationTypes.all_types.lines.forEach(lineType => {
            const isEnabled = this.userEnabledTypes.lines.includes(lineType.value);
            const color = this.zoneColors[lineType.value] || '#0066cc';
            const checkboxHtml = `
                <div class="form-check zone-type-item" data-zone-type="${lineType.value}">
                    <input class="form-check-input" type="checkbox" value="${lineType.value}" 
                           id="type_${lineType.value}" ${isEnabled ? 'checked' : ''}
                           onchange="app.handleAnnotationTypeChange()">
                    <label class="form-check-label" for="type_${lineType.value}">
                        ${lineType.label}
                    </label>
                    <input type="color" class="form-control form-control-sm zone-color-picker" 
                           value="${color}" title="Change color"
                           onchange="app.updateZoneColor('${lineType.value}', this.value)">
                </div>
            `;
            linesColumn.insertAdjacentHTML('beforeend', checkboxHtml);
        });

        // Add Custom Zones column
        customZonesColumn.innerHTML = `
            <h6>
                <i class="fas fa-layer-group me-2"></i>Custom Zones
                <button class="btn btn-xs btn-outline-success" onclick="app.showAddCustomZoneModal()" title="Add Custom Zone">
                    <i class="fas fa-plus"></i>
                </button>
            </h6>
        `;
        
        this.customZones.forEach(customZone => {
            const isEnabled = this.userEnabledTypes.zones.includes(customZone.value);
            const color = this.zoneColors[customZone.value] || '#0066cc';
            const checkboxHtml = `
                <div class="form-check zone-type-item custom-zone-item" data-zone-type="${customZone.value}">
                    <input class="form-check-input" type="checkbox" value="${customZone.value}" 
                           id="type_${customZone.value}" ${isEnabled ? 'checked' : ''}
                           onchange="app.handleAnnotationTypeChange()">
                    <label class="form-check-label" for="type_${customZone.value}">
                        ${customZone.label}
                    </label>
                    <div class="custom-zone-controls">
                        <input type="color" class="form-control form-control-sm zone-color-picker" 
                               value="${color}" title="Change color"
                               onchange="app.updateZoneColor('${customZone.value}', this.value)">
                        <button class="btn btn-xs btn-outline-danger" onclick="app.removeCustomZone('${customZone.value}')" title="Remove">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            `;
            customZonesColumn.insertAdjacentHTML('beforeend', checkboxHtml);
        });

        // Append columns in new order: Zones, Lines, Custom Zones
        checklist.appendChild(zonesColumn);
        checklist.appendChild(linesColumn);
        checklist.appendChild(customZonesColumn);

        // Set initial visibility based on toggle state
        this.updateCustomZonesVisibility();
    }

    toggleCustomZones(enabled) {
        // Store the setting in localStorage
        localStorage.setItem('customZonesEnabled', enabled);
        this.updateCustomZonesVisibility();
    }

    updateCustomZonesVisibility() {
        const checkbox = document.getElementById('enableCustomZones');
        const customZonesColumn = document.getElementById('customZonesColumn');
        
        if (!checkbox || !customZonesColumn) return;

        // Get the setting from localStorage (default to false)
        const enabled = localStorage.getItem('customZonesEnabled') === 'true';
        
        // Update checkbox state
        checkbox.checked = enabled;
        
        // Show/hide the custom zones column
        customZonesColumn.style.display = enabled ? 'block' : 'none';
    }

    async handleAnnotationTypeChange() {
        // Collect selected types from the checklist
        const selectedZones = [];
        const selectedLines = [];

        // Get all checked zone types (including custom zones)
        const allZoneTypes = [...this.annotationTypes.all_types.zones, ...this.customZones];
        allZoneTypes.forEach(zoneType => {
            const checkbox = document.getElementById(`type_${zoneType.value}`);
            if (checkbox && checkbox.checked) {
                selectedZones.push(zoneType.value);
            }
        });

        // Get all checked line types
        this.annotationTypes.all_types.lines.forEach(lineType => {
            const checkbox = document.getElementById(`type_${lineType.value}`);
            if (checkbox && checkbox.checked) {
                selectedLines.push(lineType.value);
            }
        });

        try {
            if (this.isBrowserCacheMode) {
                // Save to browser cache
                await this.localStorage.setSetting('enabled_zone_types', selectedZones);
                await this.localStorage.setSetting('enabled_line_types', selectedLines);
                await this.localStorage.setSetting('custom_zones', this.customZones);
                await this.localStorage.setSetting('zone_colors', this.zoneColors);
                
                // Update local state
                this.userEnabledTypes.zones = selectedZones;
                this.userEnabledTypes.lines = selectedLines;
                
                // Update current user object
                this.currentUser.enabled_zone_types = selectedZones;
                this.currentUser.enabled_line_types = selectedLines;
                this.currentUser.custom_zones = this.customZones;
                this.currentUser.zone_colors = this.zoneColors;
                
                // Refresh UI components
                this.populateClassificationSelector();
            } else {
                // Save to backend
                const response = await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({
                        enabled_zone_types: selectedZones,
                        enabled_line_types: selectedLines,
                        custom_zones: this.customZones,
                        zone_colors: this.zoneColors
                    })
                });

                if (response.ok) {
                    // Update local state
                    this.userEnabledTypes.zones = selectedZones;
                    this.userEnabledTypes.lines = selectedLines;
                    
                    // Refresh UI components
                    this.populateClassificationSelector();
                }
            }
        } catch (error) {
            console.error('Error saving annotation type change:', error);
        }
    }

    async updateZoneColor(zoneValue, newColor) {
        this.zoneColors[zoneValue] = newColor;
        
        // Update colors of existing annotations on canvas
        this.updateCanvasAnnotationColors();
        
        // Update colors in right sidebar
        this.updateCombinedTranscription();
        
        // Save to backend or browser cache
        try {
            if (this.isBrowserCacheMode) {
                await this.localStorage.setSetting('zone_colors', this.zoneColors);
                this.currentUser.zone_colors = this.zoneColors;
            } else {
                await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({
                        zone_colors: this.zoneColors
                    })
                });
            }
        } catch (error) {
            console.error('Error saving zone color:', error);
        }
    }

    updateCanvasAnnotationColors() {
        if (!this.canvas || !this.annotations) return;
        
        this.annotations.forEach(annotation => {
            if (annotation.fabricObject && annotation.classification) {
                const color = this.zoneColors[annotation.classification] || '#0066cc';
                const fillColor = this.hexToRgba(color, 0.1);
                
                annotation.fabricObject.set({
                    stroke: color,
                    fill: fillColor,
                    cornerColor: color
                });
            }
        });
        
        this.canvas.renderAll();
    }

    hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    formatClassificationName(classification) {
        if (!classification) return '';
        
        // Convert camelCase/PascalCase to readable format
        // MainZone -> Main Zone, StampZone -> Stamp Zone, etc.
        return classification
            .replace(/([A-Z])/g, ' $1') // Add space before capital letters
            .replace(/^Zone$/, 'Zone') // Keep standalone "Zone" as is
            .replace(/^Line$/, 'Line') // Keep standalone "Line" as is
            .trim(); // Remove leading space
    }

    canvasToImageCoordinates(canvasCoords) {
        if (!this.imageTransform) return canvasCoords;
        
        const scale = this.imageTransform.scale;
        const left = this.imageTransform.left;
        const top = this.imageTransform.top;
        
        return {
            x: (canvasCoords.x - left) / scale,
            y: (canvasCoords.y - top) / scale,
            width: canvasCoords.width / scale,
            height: canvasCoords.height / scale
        };
    }

    imageToCanvasCoordinates(imageCoords) {
        if (!this.imageTransform) return imageCoords;
        
        const scale = this.imageTransform.scale;
        const left = this.imageTransform.left;
        const top = this.imageTransform.top;
        
        return {
            x: (imageCoords.x * scale) + left,
            y: (imageCoords.y * scale) + top,
            width: imageCoords.width * scale,
            height: imageCoords.height * scale
        };
    }

    showAddCustomZoneModal() {
        // Create modal HTML if it doesn't exist
        let modal = document.getElementById('addCustomZoneModal');
        if (!modal) {
            const modalHtml = `
                <div class="modal fade" id="addCustomZoneModal" tabindex="-1">
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">
                                    <i class="fas fa-plus me-2"></i>Add Custom Zone
                                </h5>
                                <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                            </div>
                            <div class="modal-body">
                                <form id="addCustomZoneForm">
                                    <div class="mb-3">
                                        <label for="customZoneName" class="form-label">Zone Name</label>
                                        <input type="text" class="form-control" id="customZoneName" required>
                                    </div>
                                    <div class="mb-3">
                                        <label for="customZoneColor" class="form-label">Zone Color</label>
                                        <input type="color" class="form-control form-control-color" id="customZoneColor" value="#FF6B6B">
                                    </div>
                                </form>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                                <button type="button" class="btn btn-success" onclick="app.addCustomZone()">
                                    <i class="fas fa-plus me-1"></i>Add Zone
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            document.body.insertAdjacentHTML('beforeend', modalHtml);
        }
        
        // Reset form and show modal
        document.getElementById('addCustomZoneForm').reset();
        
        // Set a unique color
        const usedColors = Object.values(this.zoneColors);
        const availableColors = this.defaultColors.filter(color => !usedColors.includes(color));
        const suggestedColor = availableColors.length > 0 ? availableColors[0] : this.defaultColors[0];
        document.getElementById('customZoneColor').value = suggestedColor;
        
        const bsModal = new bootstrap.Modal(document.getElementById('addCustomZoneModal'));
        bsModal.show();
    }

    async addCustomZone() {
        const zoneName = document.getElementById('customZoneName').value.trim();
        const zoneColor = document.getElementById('customZoneColor').value;
        
        if (!zoneName) {
            this.showAlert('Please enter a zone name', 'warning');
            return;
        }
        
        // Create zone value from name (lowercase, replace spaces with underscores)
        const zoneValue = 'custom_' + zoneName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        
        // Check if zone already exists
        const allZones = [...this.annotationTypes.all_types.zones, ...this.customZones];
        if (allZones.some(zone => zone.value === zoneValue)) {
            this.showAlert('A zone with this name already exists', 'warning');
            return;
        }
        
        // Add to custom zones
        const newZone = {
            value: zoneValue,
            label: zoneName
        };
        
        this.customZones.push(newZone);
        this.zoneColors[zoneValue] = zoneColor;
        
        // Enable the new zone by default
        this.userEnabledTypes.zones.push(zoneValue);
        
        try {
            if (this.isBrowserCacheMode) {
                // Save to browser cache
                await this.localStorage.setSetting('custom_zones', this.customZones);
                await this.localStorage.setSetting('zone_colors', this.zoneColors);
                await this.localStorage.setSetting('enabled_zone_types', this.userEnabledTypes.zones);
                await this.localStorage.setSetting('enabled_line_types', this.userEnabledTypes.lines);
                
                // Update current user object
                this.currentUser.custom_zones = this.customZones;
                this.currentUser.zone_colors = this.zoneColors;
                this.currentUser.enabled_zone_types = this.userEnabledTypes.zones;
                this.currentUser.enabled_line_types = this.userEnabledTypes.lines;
                
                // Refresh UI
                this.populateAnnotationTypesChecklist();
                this.populateClassificationSelector();
                
                // Hide modal
                const modal = bootstrap.Modal.getInstance(document.getElementById('addCustomZoneModal'));
                modal.hide();
                
                this.showAlert('Custom zone added successfully!', 'success');
            } else {
                // Save to backend
                const response = await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({
                        custom_zones: this.customZones,
                        zone_colors: this.zoneColors,
                        enabled_zone_types: this.userEnabledTypes.zones,
                        enabled_line_types: this.userEnabledTypes.lines
                    })
                });

                if (response.ok) {
                    // Refresh UI
                    this.populateAnnotationTypesChecklist();
                    this.populateClassificationSelector();
                    
                    // Hide modal
                    const modal = bootstrap.Modal.getInstance(document.getElementById('addCustomZoneModal'));
                    modal.hide();
                    
                    this.showAlert('Custom zone added successfully!', 'success');
                } else {
                    throw new Error('Failed to save custom zone');
                }
            }
        } catch (error) {
            console.error('Error adding custom zone:', error);
            this.showAlert('Failed to add custom zone', 'danger');
        }
    }

    async removeCustomZone(zoneValue) {
        if (!confirm('Are you sure you want to remove this custom zone? All annotations using this zone will lose their classification.')) {
            return;
        }
        
        // Remove from custom zones
        this.customZones = this.customZones.filter(zone => zone.value !== zoneValue);
        
        // Remove from enabled zones
        this.userEnabledTypes.zones = this.userEnabledTypes.zones.filter(z => z !== zoneValue);
        
        // Remove color
        delete this.zoneColors[zoneValue];
        
        try {
            if (this.isBrowserCacheMode) {
                // Save to browser cache
                await this.localStorage.setSetting('custom_zones', this.customZones);
                await this.localStorage.setSetting('zone_colors', this.zoneColors);
                await this.localStorage.setSetting('enabled_zone_types', this.userEnabledTypes.zones);
                await this.localStorage.setSetting('enabled_line_types', this.userEnabledTypes.lines);
                
                // Update current user object
                this.currentUser.custom_zones = this.customZones;
                this.currentUser.zone_colors = this.zoneColors;
                this.currentUser.enabled_zone_types = this.userEnabledTypes.zones;
                this.currentUser.enabled_line_types = this.userEnabledTypes.lines;
                
                // Refresh UI
                this.populateAnnotationTypesChecklist();
                this.populateClassificationSelector();
                this.updateCombinedTranscription();
                
                this.showAlert('Custom zone removed successfully!', 'success');
            } else {
                // Save to backend
                const response = await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({
                        custom_zones: this.customZones,
                        zone_colors: this.zoneColors,
                        enabled_zone_types: this.userEnabledTypes.zones,
                        enabled_line_types: this.userEnabledTypes.lines
                    })
                });

                if (response.ok) {
                    // Refresh UI
                    this.populateAnnotationTypesChecklist();
                    this.populateClassificationSelector();
                    this.updateCombinedTranscription();
                    
                    this.showAlert('Custom zone removed successfully!', 'success');
                } else {
                    throw new Error('Failed to remove custom zone');
                }
            }
        } catch (error) {
            console.error('Error removing custom zone:', error);
            this.showAlert('Failed to remove custom zone', 'danger');
        }
    }



    onMouseDown(event) {
        if (this.currentTool === 'select') return;
        
        // Prevent creating new objects if we're clicking on an existing object
        const target = this.canvas.findTarget(event.e);
        if (target && target.annotationId) {
            return; // Let Fabric.js handle the interaction with existing objects
        }

        const pointer = this.canvas.getPointer(event.e);
        this.isDrawing = true;
        this.startPoint = pointer;

        if (this.currentTool === 'bbox') {
            // Get color for current classification
            const color = this.currentClassification ? (this.zoneColors[this.currentClassification] || '#0066cc') : '#0066cc';
            const fillColor = this.hexToRgba(color, 0.1);
            
            this.currentRect = new fabric.Rect({
                left: pointer.x,
                top: pointer.y,
                width: 0,
                height: 0,
                fill: fillColor,
                stroke: color,
                strokeWidth: 2,
                selectable: true,
                lockUniScaling: false, // Allow free resizing
                lockScalingFlip: false, // Allow negative scaling
                uniformScaling: false, // Disable aspect ratio locking
                uniScaleTransform: false, // Additional property to disable uniform scaling
                centeredScaling: false, // Disable centered scaling
                hasRotatingPoint: false, // Disable rotation
                cornerStyle: 'rect', // Square corners for better UX
                cornerSize: 8,
                transparentCorners: false,
                cornerColor: color,
                lockMovementX: false,
                lockMovementY: false
            });
            this.canvas.add(this.currentRect);
        } else if (this.currentTool === 'polygon') {
            // Get color for current classification
            const color = this.currentClassification ? (this.zoneColors[this.currentClassification] || '#0066cc') : '#0066cc';
            const fillColor = this.hexToRgba(color, 0.1);
            
            if (!this.currentPolygon) {
                this.polygonPoints = [pointer];
                this.currentPolygon = new fabric.Polygon([pointer], {
                    fill: fillColor,
                    stroke: color,
                    strokeWidth: 2,
                    selectable: true,
                    hasRotatingPoint: false, // Disable rotation
                    cornerStyle: 'circle', // Circle corners for polygons
                    cornerSize: 6,
                    transparentCorners: false,
                    cornerColor: color
                });
                this.canvas.add(this.currentPolygon);
            } else {
                this.polygonPoints.push(pointer);
                this.currentPolygon.set('points', this.polygonPoints);
                this.canvas.renderAll();
            }
        }
    }

    onMouseMove(event) {
        if (!this.isDrawing || this.currentTool === 'polygon') return;

        const pointer = this.canvas.getPointer(event.e);

        if (this.currentTool === 'bbox' && this.currentRect) {
            const width = pointer.x - this.startPoint.x;
            const height = pointer.y - this.startPoint.y;
            
            this.currentRect.set({
                width: Math.abs(width),
                height: Math.abs(height),
                left: width > 0 ? this.startPoint.x : pointer.x,
                top: height > 0 ? this.startPoint.y : pointer.y
            });
            this.canvas.renderAll();
        }
    }

    async onMouseUp(event) {
        if (this.currentTool === 'polygon') return;

        this.isDrawing = false;

        if (this.currentTool === 'bbox' && this.currentRect) {
            if (this.currentRect.width < 5 || this.currentRect.height < 5) {
                this.canvas.remove(this.currentRect);
            } else {
                await this.addAnnotation(this.currentRect, 'bbox');
            }
            this.currentRect = null;
        }
    }

    async finishPolygon() {
        if (this.currentPolygon && this.polygonPoints.length > 2) {
            await this.addAnnotation(this.currentPolygon, 'polygon');
            this.currentPolygon = null;
            this.polygonPoints = [];
        }
    }

    async addAnnotation(fabricObject, type) {
        // Prevent concurrent annotation creation
        if (this.isCreatingAnnotation) {
            console.warn('Annotation creation already in progress');
            return;
        }
        
        this.isCreatingAnnotation = true;
        const tempId = 'temp_' + Date.now();
        const coordinates = this.getAnnotationCoordinates(fabricObject, type);
        const readingOrder = this.annotations.length;
        
        // Create local annotation with temp ID first
        const localAnnotation = {
            id: tempId,
            type: type,
            image_id: this.currentImage.id, // Add image reference for consistency
            fabricObject: fabricObject,
            coordinates: coordinates,
            classification: this.currentClassification || null,
            label: '',
            reading_order: readingOrder,
            transcription: null
        };

        this.annotations.push(localAnnotation);
        fabricObject.annotationId = tempId;
        this.updateAnnotationsList();

        // Save to database or local storage
        try {
            if (!this.currentImage) {
                console.error('No current image selected');
                return;
            }

            const annotationData = {
                image_id: this.currentImage.id,
                image: this.currentImage.id, // Add both fields for compatibility
                annotation_type: type,
                type: type, // Add both type fields for compatibility
                coordinates: coordinates,
                classification: this.currentClassification || null,
                label: '',
                reading_order: readingOrder,
                metadata: {}
            };

            if (this.isBrowserCacheMode) {
                // Save to browser cache
                const savedAnnotation = await this.localStorage.add('annotations', annotationData);
                
                // Update local annotation with real ID and reading order
                const annotationIndex = this.annotations.findIndex(a => a.id === tempId);
                if (annotationIndex !== -1) {
                    this.annotations[annotationIndex].id = savedAnnotation.id;
                    this.annotations[annotationIndex].image_id = savedAnnotation.image_id; // Preserve image reference
                    this.annotations[annotationIndex].annotation_type = savedAnnotation.annotation_type; // Preserve type field
                    this.annotations[annotationIndex].reading_order = savedAnnotation.reading_order;
                    this.annotations[annotationIndex].classification = savedAnnotation.classification;
                    this.annotations[annotationIndex].created_at = savedAnnotation.created_at;
                    this.annotations[annotationIndex].updated_at = savedAnnotation.updated_at;
                    fabricObject.annotationId = savedAnnotation.id;
                    
                    // Update the annotation list to reflect the new annotation
                    this.updateAnnotationsList();
                }
                
                console.log('Annotation saved successfully:', savedAnnotation.id);
            } else {
                // Use server API
                annotationData.image = this.currentImage.id; // Server expects 'image' not 'image_id'
                delete annotationData.image_id;

                const response = await fetch(`${this.apiBaseUrl}/annotations/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify(annotationData)
                });

                if (response.ok) {
                    const savedAnnotation = await response.json();
                    
                    // Update local annotation with real ID and reading order
                    const annotationIndex = this.annotations.findIndex(a => a.id === tempId);
                    if (annotationIndex !== -1) {
                        this.annotations[annotationIndex].id = savedAnnotation.id;
                        this.annotations[annotationIndex].image = savedAnnotation.image; // Server uses 'image' field
                        this.annotations[annotationIndex].annotation_type = savedAnnotation.annotation_type;
                        this.annotations[annotationIndex].reading_order = savedAnnotation.reading_order;
                        this.annotations[annotationIndex].classification = savedAnnotation.classification;
                        this.annotations[annotationIndex].created_at = savedAnnotation.created_at;
                        this.annotations[annotationIndex].updated_at = savedAnnotation.updated_at;
                        fabricObject.annotationId = savedAnnotation.id;
                        
                        // Update the annotation list to reflect the new annotation
                        this.updateAnnotationsList();
                    }
                    
                    console.log('Annotation saved successfully:', savedAnnotation.id);
                } else {
                    console.error('Failed to save annotation:', await response.text());
                    this.showAlert('Failed to save annotation', 'warning');
                }
            }
        } catch (error) {
            console.error('Error saving annotation:', error);
            this.showAlert('Error saving annotation', 'warning');
        }
        
        // Automatically switch to select mode after creating annotation
        this.setTool('select');
        
        // Ensure the canvas is properly refreshed and the new object is selectable
        this.canvas.renderAll();
        
        // Force canvas to recognize the new object for selection
        this.canvas.discardActiveObject();
        
        // Make the newly created object immediately selectable by setting it as active
        if (fabricObject && fabricObject.selectable) {
            // Small delay to ensure canvas is ready, then select the new object
            setTimeout(() => {
                this.canvas.setActiveObject(fabricObject);
                this.canvas.renderAll();
            }, 10);
        }
        
        // Reset creation flag
        this.isCreatingAnnotation = false;
    }

    getAnnotationCoordinates(fabricObject, type) {
        let canvasCoords;
        
        if (type === 'bbox') {
            canvasCoords = {
                x: fabricObject.left,
                y: fabricObject.top,
                width: fabricObject.width,
                height: fabricObject.height
            };
        } else if (type === 'polygon') {
            canvasCoords = {
                points: fabricObject.points.map(point => ({
                    x: point.x,
                    y: point.y
                }))
            };
        }
        
        // Transform back to original image coordinates
        return this.transformToOriginal(canvasCoords, type);
    }

    onSelectionCreated(event) {
        this.selectedAnnotations = event.selected.map(obj => obj.annotationId).filter(Boolean);
        this.updateAnnotationsList();
    }

    onSelectionUpdated(event) {
        this.selectedAnnotations = event.selected.map(obj => obj.annotationId).filter(Boolean);
        this.updateAnnotationsList();
    }

    onSelectionCleared() {
        this.selectedAnnotations = [];
        this.updateAnnotationsList();
    }

    disableUniformScaling(event) {
        // Force disable uniform scaling on selected objects
        const selectedObjects = event.selected || [event.target];
        selectedObjects.forEach(obj => {
            if (obj && obj.type === 'rect') {
                obj.set({
                    lockUniScaling: false,
                    uniformScaling: false,
                    uniScaleTransform: false,
                    centeredScaling: false,
                    lockScalingX: false,
                    lockScalingY: false
                });
                
                // Override the scaling methods to force non-uniform behavior
                obj._setOriginToCenter = function() {};
                obj._resetOrigin = function() {};
                
                // Override corner controls to disable uniform scaling
                if (obj.controls) {
                    Object.keys(obj.controls).forEach(controlKey => {
                        const control = obj.controls[controlKey];
                        if (control && control.actionHandler === 'scalingEqually') {
                            control.actionHandler = 'scalingXorY';
                        }
                    });
                }
            }
        });
        
        // Also disable uniform scaling at canvas level for this interaction
        this.canvas.uniformScaling = false;
        this.canvas.uniScaleTransform = false;
    }

    async onObjectModified(event) {
        const modifiedObject = event.target;
        if (modifiedObject.annotationId && !modifiedObject.annotationId.startsWith('temp_')) {
            // Debounce rapid modifications to avoid excessive API calls
            if (this.updateTimeout) {
                clearTimeout(this.updateTimeout);
            }
            
            this.updateTimeout = setTimeout(async () => {
                // Save the updated annotation coordinates
                await this.updateAnnotationCoordinates(modifiedObject);
                this.updateTimeout = null;
            }, 300); // Wait 300ms after last modification
        }
    }

    async updateAnnotationCoordinates(fabricObject) {
        try {
            const annotation = this.annotations.find(a => a.id === fabricObject.annotationId);
            if (!annotation) return;

            let canvasCoordinates;
            if (annotation.type === 'bbox') {
                canvasCoordinates = {
                    x: fabricObject.left,
                    y: fabricObject.top,
                    width: fabricObject.width * fabricObject.scaleX,
                    height: fabricObject.height * fabricObject.scaleY
                };
                
                // Reset scale after getting scaled dimensions to avoid compound scaling
                fabricObject.set({
                    width: canvasCoordinates.width,
                    height: canvasCoordinates.height,
                    scaleX: 1,
                    scaleY: 1,
                    // Ensure free-form scaling properties are maintained
                    lockUniScaling: false,
                    uniformScaling: false,
                    uniScaleTransform: false,
                    centeredScaling: false
                });
                
                // Force canvas refresh to ensure visual consistency
                this.canvas.renderAll();
            } else if (annotation.type === 'polygon') {
                canvasCoordinates = {
                    points: fabricObject.points.map(point => ({
                        x: point.x,
                        y: point.y
                    }))
                };
            }

            // Transform canvas coordinates back to original image coordinates
            const newCoordinates = this.transformToOriginal(canvasCoordinates, annotation.type);

            // Update local annotation
            annotation.coordinates = newCoordinates;

            // Save to backend or browser cache
            if (this.isBrowserCacheMode) {
                // Update annotation in browser cache
                const storedAnnotation = await this.localStorage.get('annotations', annotation.id);
                if (storedAnnotation) {
                    storedAnnotation.coordinates = newCoordinates;
                    storedAnnotation.updated_at = new Date().toISOString();
                    await this.localStorage.update('annotations', storedAnnotation);
                }
            } else {
                const response = await fetch(`${this.apiBaseUrl}/annotations/${annotation.id}/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({ coordinates: newCoordinates })
                });

                if (!response.ok) {
                    console.error('Failed to update annotation coordinates');
                    this.showAlert('Failed to save annotation changes', 'warning');
                }
            }
        } catch (error) {
            console.error('Error updating annotation coordinates:', error);
            this.showAlert('Error saving annotation changes', 'warning');
        }
    }

    // Project Management
    async loadProjects() {
        try {
            // Double-check browser cache mode status
            const storedMode = localStorage.getItem('browserCacheMode') === 'true';
            if (this.isBrowserCacheMode !== storedMode) {
                console.warn('Browser cache mode mismatch detected, correcting...');
                this.isBrowserCacheMode = storedMode;
            }
            
            if (this.isBrowserCacheMode) {
                const projects = await this.localStorage.getAll('projects');
                // Sort by order
                projects.sort((a, b) => (a.order || 0) - (b.order || 0));
                this.renderProjectTree(projects);
            } else {
                // Only make server calls if we have proper authentication
                if (!this.authToken) {
                    console.warn('No auth token available for server API call');
                    this.showAlert('Please sign in to access server data', 'warning');
                    return;
                }
                
                const response = await this.fetchWithTimeout(`${this.apiBaseUrl}/projects/`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                }, 8000); // 8 second timeout

                if (response.ok) {
                    const data = await response.json();
                    this.renderProjectTree(data.results);
                } else {
                    this.showAlert('Failed to load projects', 'danger');
                }
            }
        } catch (error) {
            console.error('Error loading projects:', error);
            this.showAlert('Failed to load projects', 'danger');
            // Ensure we show an empty state instead of leaving loading spinner
            const treeContainer = document.getElementById('projectTree');
            if (treeContainer) {
                treeContainer.innerHTML = '<div class="p-3 text-muted">Failed to load projects. Please try refreshing.</div>';
            }
        }
    }

    renderProjectTree(projects) {
        const treeContainer = document.getElementById('projectTree');
        treeContainer.innerHTML = '';

        if (projects.length === 0) {
            treeContainer.innerHTML = '<div class="p-3 text-muted">No projects yet. Create your first project!</div>';
            return;
        }

        // Add Edit Structure button at the top
        const editStructureHeader = document.createElement('div');
        editStructureHeader.className = 'edit-structure-header p-2 border-bottom';
        editStructureHeader.innerHTML = `
            <button class="btn btn-sm btn-outline-primary w-100" onclick="app.showEditStructureModal()">
                <i class="fas fa-edit me-2"></i>Edit Structure
            </button>
        `;
        treeContainer.appendChild(editStructureHeader);

        projects.forEach(project => {
            const projectElement = this.createProjectTreeItem(project);
            treeContainer.appendChild(projectElement);
        });
    }

    createProjectTreeItem(project) {
        const projectDiv = document.createElement('div');
        projectDiv.className = 'tree-item project-item';
        projectDiv.dataset.projectId = project.id;
        
        projectDiv.innerHTML = `
            <div class="tree-item-content" onclick="app.toggleProject('${project.id}')">
                <i class="fas fa-caret-right tree-toggle"></i>
                <i class="fas fa-folder tree-icon"></i>
                <span class="tree-text editable-text" onclick="event.stopPropagation(); app.startRename('project', '${project.id}', this)" title="Click to rename">${project.name}</span>
                <div class="tree-reorder-controls">
                    <button class="btn btn-xs btn-outline-secondary" onclick="event.stopPropagation(); app.moveItem('project', '${project.id}', 'up')" title="Move Up">
                        <i class="fas fa-chevron-up"></i>
                    </button>
                    <button class="btn btn-xs btn-outline-secondary" onclick="event.stopPropagation(); app.moveItem('project', '${project.id}', 'down')" title="Move Down">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
                <div class="tree-actions level-actions">
                    <div class="level-action-dropdown">
                        <button class="btn btn-sm btn-detect" onclick="event.stopPropagation(); app.showProjectDetectMenu('${project.id}', this)" title="Detect Zones/Lines">
                            <i class="fas fa-search-location"></i>
                        </button>
                        <div class="level-action-menu" id="project-detect-menu-${project.id}">
                            <div class="level-action-menu-item" onclick="app.detectProjectZones('${project.id}', 'unannotated')">
                                <h6>Detect on Unannotated Pages</h6>
                                <p>Only detect zones/lines on pages without existing annotations</p>
                            </div>
                            <div class="level-action-menu-item warning" onclick="app.detectProjectZones('${project.id}', 'all')">
                                <h6>Detect on All Pages</h6>
                                <p>⚠️ This will remove existing zones and transcriptions</p>
                            </div>
                        </div>
                    </div>
                    <div class="level-action-dropdown">
                        <button class="btn btn-sm btn-transcribe" onclick="event.stopPropagation(); app.showProjectTranscribeMenu('${project.id}', this)" title="Transcribe">
                            <i class="fas fa-robot"></i>
                        </button>
                        <div class="level-action-menu" id="project-transcribe-menu-${project.id}">
                            <div class="level-action-menu-item" onclick="app.transcribeProject('${project.id}', 'full_image')">
                                <h6>Transcribe Full Images</h6>
                                <p>Transcribe entire images without zone detection</p>
                            </div>
                            <div class="level-action-menu-item" onclick="app.transcribeProject('${project.id}', 'zones_only')">
                                <h6>Transcribe Zones/Lines Only</h6>
                                <p>Transcribe detected zones and lines (detection required first)</p>
                            </div>
                            <div class="level-action-menu-item" onclick="app.transcribeProject('${project.id}', 'untranscribed_images')">
                                <h6>Untranscribed Images Only</h6>
                                <p>Only transcribe images without existing transcriptions</p>
                            </div>
                            <div class="level-action-menu-item" onclick="app.transcribeProject('${project.id}', 'untranscribed_zones')">
                                <h6>Untranscribed Zones Only</h6>
                                <p>Only transcribe zones/lines without existing transcriptions</p>
                            </div>
                            <div class="level-action-menu-item" onclick="app.showTranscriptionZoneSelectionModal('project', '${project.id}')">
                                <h6>Selected Zones Only</h6>
                                <p>Choose specific zone types to transcribe</p>
                            </div>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-outline-primary" onclick="event.stopPropagation(); app.showCreateDocumentModal('${project.id}')" title="Add Document">
                        <i class="fas fa-plus"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); app.deleteProject('${project.id}')" title="Delete Project">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="tree-children" style="display: none;"></div>
        `;
        
        return projectDiv;
    }

    createTreeItem(text, icon, indent, onClick) {
        const item = document.createElement('div');
        item.className = `tree-item indent-${indent}`;
        item.innerHTML = `
            <i class="${icon} tree-icon"></i>
            <span>${text}</span>
        `;
        item.addEventListener('click', onClick);
        return item;
    }

    async toggleProject(projectId) {
        const projectItem = document.querySelector(`[data-project-id="${projectId}"]`);
        const toggle = projectItem.querySelector('.tree-toggle');
        const children = projectItem.querySelector('.tree-children');
        
        if (children.style.display === 'none') {
            // Expand project
            toggle.classList.remove('fa-caret-right');
            toggle.classList.add('fa-caret-down');
            children.style.display = 'block';
            
            // Load documents if not already loaded
            if (children.children.length === 0) {
                await this.loadProjectDocuments(projectId, children);
            }
        } else {
            // Collapse project
            toggle.classList.remove('fa-caret-down');
            toggle.classList.add('fa-caret-right');
            children.style.display = 'none';
        }
    }

    async loadProjectDocuments(projectId, container) {
        try {
            if (this.isBrowserCacheMode) {
                const documents = await this.localStorage.getAll('documents', 'project_id', projectId);
                this.renderDocuments(documents, container);
            } else {
                const response = await fetch(`${this.apiBaseUrl}/documents/?project=${projectId}`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    this.renderDocuments(data.results, container);
                }
            }
        } catch (error) {
            console.error('Error loading documents:', error);
            container.innerHTML = '<div class="text-muted p-2">Error loading documents</div>';
        }
    }

    renderDocuments(documents, container) {
        if (documents.length === 0) {
            container.innerHTML = '<div class="text-muted p-2 ms-3">No documents yet</div>';
            return;
        }

        documents.forEach(docItem => {
            const documentElement = this.createDocumentTreeItem(docItem);
            container.appendChild(documentElement);
            // Set up drag and drop for the new document item
            // Removed old drag and drop setup - using professional controls now
        });
    }

    createDocumentTreeItem(docItem) {
        const documentDiv = document.createElement('div');
        documentDiv.className = 'tree-item document-item ms-3';
        documentDiv.dataset.documentId = docItem.id;
        
        // Generate status icons
        const statusIcons = this.generateDocumentStatusIcons(docItem);
        
        documentDiv.innerHTML = `
            <div class="tree-item-content" onclick="app.handleDocumentClick('${docItem.id}', event)">
                <i class="fas fa-caret-right tree-toggle"></i>
                <i class="fas fa-file-alt tree-icon"></i>
                <span class="tree-text editable-text" onclick="event.stopPropagation(); app.startRename('document', '${docItem.id}', this)" title="Click to rename">${docItem.name}</span>
                <div class="tree-reorder-controls">
                    <button class="btn btn-xs btn-outline-secondary" onclick="event.stopPropagation(); app.moveItem('document', '${docItem.id}', 'up')" title="Move Up">
                        <i class="fas fa-chevron-up"></i>
                    </button>
                    <button class="btn btn-xs btn-outline-secondary" onclick="event.stopPropagation(); app.moveItem('document', '${docItem.id}', 'down')" title="Move Down">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
                <div class="document-status-icons">${statusIcons}</div>
                <div class="tree-actions level-actions">
                    <div class="level-action-dropdown">
                        <button class="btn btn-sm btn-detect" onclick="event.stopPropagation(); app.showDocumentDetectMenu('${docItem.id}', this)" title="Detect Zones/Lines">
                            <i class="fas fa-search-location"></i>
                        </button>
                        <div class="level-action-menu" id="document-detect-menu-${docItem.id}">
                            <div class="level-action-menu-item" onclick="app.detectDocumentZones('${docItem.id}', 'unannotated')">
                                <h6>Detect on Unannotated Pages</h6>
                                <p>Only detect zones/lines on pages without existing annotations</p>
                            </div>
                            <div class="level-action-menu-item warning" onclick="app.detectDocumentZones('${docItem.id}', 'all')">
                                <h6>Detect on All Pages</h6>
                                <p>⚠️ This will remove existing zones and transcriptions</p>
                            </div>
                        </div>
                    </div>
                    <div class="level-action-dropdown">
                        <button class="btn btn-sm btn-transcribe" onclick="event.stopPropagation(); app.showDocumentTranscribeMenu('${docItem.id}', this)" title="Transcribe">
                            <i class="fas fa-robot"></i>
                        </button>
                        <div class="level-action-menu" id="document-transcribe-menu-${docItem.id}">
                            <div class="level-action-menu-item" onclick="app.transcribeDocument('${docItem.id}', 'full_image')">
                                <h6>Transcribe Full Images</h6>
                                <p>Transcribe entire images without zone detection</p>
                            </div>
                            <div class="level-action-menu-item" onclick="app.transcribeDocument('${docItem.id}', 'zones_only')">
                                <h6>Transcribe Zones/Lines Only</h6>
                                <p>Transcribe detected zones and lines (detection required first)</p>
                            </div>
                            <div class="level-action-menu-item" onclick="app.transcribeDocument('${docItem.id}', 'untranscribed_images')">
                                <h6>Untranscribed Images Only</h6>
                                <p>Only transcribe images without existing transcriptions</p>
                            </div>
                            <div class="level-action-menu-item" onclick="app.transcribeDocument('${docItem.id}', 'untranscribed_zones')">
                                <h6>Untranscribed Zones Only</h6>
                                <p>Only transcribe zones/lines without existing transcriptions</p>
                            </div>
                            <div class="level-action-menu-item" onclick="app.showTranscriptionZoneSelectionModal('document', '${docItem.id}')">
                                <h6>Selected Zones Only</h6>
                                <p>Choose specific zone types to transcribe</p>
                            </div>
                        </div>
                    </div>
                    <button class="btn btn-sm btn-outline-success" onclick="event.stopPropagation(); app.showUploadImageModal('${docItem.id}')" title="Add Images">
                        <i class="fas fa-image"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); app.deleteDocument('${docItem.id}')" title="Delete Document">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="tree-children" style="display: none;"></div>
        `;
        
        return documentDiv;
    }

    generateDocumentStatusIcons(docItem) {
        let icons = '';
        
        // Check if document has zone detection
        if (docItem.has_zone_detection) {
            icons += '<div class="status-icon zones-detected" data-tooltip="Has zone detection"><i class="fas fa-search-location"></i></div>';
        }
        
        // Check if document has transcriptions
        if (docItem.has_transcriptions === 'full') {
            icons += '<div class="status-icon transcribed" data-tooltip="Fully transcribed"><i class="fas fa-check"></i></div>';
        } else if (docItem.has_transcriptions === 'partial') {
            icons += '<div class="status-icon partial" data-tooltip="Partially transcribed"><i class="fas fa-check-circle"></i></div>';
        }
        
        return icons;
    }

    async toggleDocument(documentId) {
        const documentItem = document.querySelector(`[data-document-id="${documentId}"]`);
        const toggle = documentItem.querySelector('.tree-toggle');
        const children = documentItem.querySelector('.tree-children');
        
        if (children.style.display === 'none') {
            // Expand document
            toggle.classList.remove('fa-caret-right');
            toggle.classList.add('fa-caret-down');
            children.style.display = 'block';
            
            // Load images if not already loaded
            if (children.children.length === 0) {
                await this.loadDocumentImages(documentId, children);
            }
        } else {
            // Collapse document
            toggle.classList.remove('fa-caret-down');
            toggle.classList.add('fa-caret-right');
            children.style.display = 'none';
        }
    }

    async loadDocumentImages(documentId, container) {
        try {
            if (this.isBrowserCacheMode) {
                const images = await this.localStorage.getAll('images', 'document_id', documentId);
                // Sort by order
                images.sort((a, b) => (a.order || 0) - (b.order || 0));
                // Add document_id for compatibility
                images.forEach(img => {
                    if (!img.document_id) img.document_id = documentId;
                });
                this.renderImages(images, container);
            } else {
                // Add cache-busting parameter to ensure fresh data
                const response = await fetch(`${this.apiBaseUrl}/images/?document=${documentId}&_t=${Date.now()}`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    this.renderImages(data.results, container);
                }
            }
        } catch (error) {
            console.error('Error loading images:', error);
            container.innerHTML = '<div class="text-muted p-2">Error loading images</div>';
        }
    }

    renderImages(images, container) {
        if (images.length === 0) {
            container.innerHTML = '<div class="text-muted p-2 ms-3">No images yet</div>';
            return;
        }

        // Debug: Check if images have document_id field
        if (images.length > 0) {
            const firstImage = images[0];
            if (!firstImage.document_id) {
                console.error('Images API response missing document_id field. Available fields:', Object.keys(firstImage));
                console.error('First image data:', firstImage);
            }
        }

        images.forEach(image => {
            const imageElement = this.createImageTreeItem(image);
            container.appendChild(imageElement);
            // Set up drag and drop for the new image item
            // Removed old drag and drop setup - using professional controls now
        });
    }

    createImageTreeItem(image) {
        const imageDiv = document.createElement('div');
        imageDiv.className = 'tree-item image-item ms-4';
        imageDiv.dataset.imageId = image.id;
        
        // Store document ID for easy access during reordering
        if (image.document_id) {
            imageDiv.dataset.documentId = image.document_id;
        } else {
            console.warn('No document_id found for image:', image.name, 'Available fields:', Object.keys(image));
        }
        
        imageDiv.innerHTML = `
            <div class="tree-item-content" onclick="app.handleImageClick('${image.id}', event)">
                <i class="fas fa-image tree-icon"></i>
                <span class="tree-text editable-text" onclick="event.stopPropagation(); app.startRename('image', '${image.id}', this)" title="Click to rename">${image.name}</span>
                <div class="tree-reorder-controls">
                    <button class="btn btn-xs btn-outline-secondary" onclick="event.stopPropagation(); app.moveItem('image', '${image.id}', 'up')" title="Move Up">
                        <i class="fas fa-chevron-up"></i>
                    </button>
                    <button class="btn btn-xs btn-outline-secondary" onclick="event.stopPropagation(); app.moveItem('image', '${image.id}', 'down')" title="Move Down">
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
                <div class="tree-actions">
                    <button class="btn btn-sm btn-outline-danger" onclick="event.stopPropagation(); app.deleteImage('${image.id}')" title="Delete Image">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="tree-status">
                    ${image.is_processed ? 
                        '<i class="fas fa-check-circle text-success" title="Processed"></i>' : 
                        '<i class="fas fa-clock text-warning" title="Processing"></i>'
                    }
                </div>
            </div>
        `;
        
        return imageDiv;
    }

    // OCR and Transcription
    async transcribeFullImage() {
        if (!this.currentImage) {
            this.showAlert('Please select an image first', 'warning');
            return;
        }

        const credentials = this.getStoredCredentials();
        const provider = this.getActiveProvider();
        if (!provider) {
            this.showAlert('Please configure your API credentials first', 'warning');
            this.showCredentialsModal();
            return;
        }

        try {
            // Show processing indicator in the transcription section
            this.showFullImageTranscriptionProgress(true);
            
            const selectedModel = this.getSelectedModel();
            const requestData = {
                transcription_type: 'full_image',
                api_endpoint: selectedModel.provider,
                api_model: selectedModel.model
            };

            if (selectedModel.provider === 'openai') {
                requestData.openai_api_key = credentials.openai_api_key;
            } else if (selectedModel.provider === 'vertex') {
                requestData.vertex_access_token = credentials.vertex_access_token;
                requestData.vertex_project_id = credentials.vertex_project_id;
                requestData.vertex_location = credentials.vertex_location;
                requestData.vertex_model = selectedModel.model;
            } else if (selectedModel.provider === 'custom') {
                requestData.custom_endpoint_url = credentials.custom_endpoint_url;
                requestData.custom_endpoint_auth = credentials.custom_endpoint_auth;
            }

            if (this.isBrowserCacheMode) {
                // Handle full image transcription locally for browser cache mode
                const transcription = await this.performLocalImageTranscription(this.currentImage.id, requestData);
                if (transcription) {
                    // Store transcription in local storage
                    const transcriptionData = {
                        id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        image: this.currentImage.id,
                        annotation: null,
                        transcription_type: 'full_image',
                        api_endpoint: selectedModel.provider,
                        api_model: selectedModel.model,
                        status: 'completed',
                        text_content: transcription.text_content,
                        confidence_score: transcription.confidence_score || null,
                        api_response_raw: transcription.api_response_raw || null,
                        is_current: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    
                    await this.localStorage.add('transcriptions', transcriptionData);
                    this.updateTranscriptionDisplay(transcription);
                    // Refresh transcription list
                    await this.loadImageTranscriptions();
                    this.showAlert('Transcription completed!', 'success');
                }
            } else {
                const response = await fetch(`${this.apiBaseUrl}/images/${this.currentImage.id}/transcribe/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify(requestData)
                });

                if (response.ok) {
                    const transcription = await response.json();
                    this.updateTranscriptionDisplay(transcription);
                    this.showAlert('Transcription completed!', 'success');
                } else {
                    const error = await response.json();
                    this.showAlert(error.error || 'Transcription failed', 'danger');
                }
            }
        } catch (error) {
            console.error('Transcription error:', error);
            this.showAlert('Transcription failed', 'danger');
        } finally {
            this.showFullImageTranscriptionProgress(false);
        }
    }

    async transcribeSelectedAnnotations() {
        if (this.selectedAnnotations.length === 0) {
            this.showAlert('Please select annotations to transcribe', 'warning');
            return;
        }

        const credentials = this.getStoredCredentials();
        const provider = this.getActiveProvider();
        if (!provider) {
            this.showAlert('Please configure your API credentials first', 'warning');
            this.showCredentialsModal();
            return;
        }

        for (const annotationId of this.selectedAnnotations) {
            this.showAnnotationProgress(annotationId, true);
            await this.transcribeAnnotation(annotationId, credentials);
            this.showAnnotationProgress(annotationId, false);
        }
    }

    async transcribeAnnotation(annotationId, credentials) {
        try {
            const annotation = this.annotations.find(a => a.id === annotationId);
            if (!annotation) {
                console.error('Annotation not found:', annotationId);
                return;
            }

            // Find the appropriate prompt for this annotation's classification
            const prompt = this.getPromptForAnnotation(annotation);
            let finalPrompt = prompt.prompt;
            
            const selectedModel = this.getSelectedModel();
            const requestData = {
                transcription_type: 'annotation',
                api_endpoint: selectedModel.provider,
                api_model: selectedModel.model,
                custom_prompt: finalPrompt,
                expected_metadata: prompt.metadata_fields || []
            };

            if (selectedModel.provider === 'openai') {
                requestData.openai_api_key = credentials.openai_api_key;
                // For OpenAI, use structured output if metadata is expected
                if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                    requestData.use_structured_output = true;
                    requestData.metadata_schema = this.createMetadataSchema(prompt.metadata_fields);
                } else {
                    // For OpenAI without structured output, still format the prompt for JSON response
                    finalPrompt += '\n\nReturn the transcription as plain text. The main text should be clean and readable.';
                    requestData.custom_prompt = finalPrompt;
                }
            } else if (selectedModel.provider === 'vertex') {
                requestData.vertex_access_token = credentials.vertex_access_token;
                requestData.vertex_project_id = credentials.vertex_project_id;
                requestData.vertex_location = credentials.vertex_location;
                requestData.vertex_model = selectedModel.model;
                // For Vertex, modify prompt to request JSON output
                if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                    finalPrompt += '\n\nPlease also return metadata in JSON format with the following fields: ' +
                        prompt.metadata_fields.map(f => `${f.name} (${f.type})`).join(', ') +
                        '. Return both the transcription and metadata in a JSON object with "text" and "metadata" keys in the following format:\n\n```json\n{"text": "your transcription here", "metadata": {"field1": value1, "field2": value2}}\n```';
                }
                requestData.custom_prompt = finalPrompt;
            } else if (selectedModel.provider === 'custom') {
                // For other models, modify prompt to request JSON output
                if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                    finalPrompt += '\n\nPlease also return metadata in JSON format with the following fields: ' +
                        prompt.metadata_fields.map(f => `${f.name} (${f.type})`).join(', ') +
                        '. Return both the transcription and metadata in a JSON object with "text" and "metadata" keys in the following format:\n\n```json\n{"text": "your transcription here", "metadata": {"field1": value1, "field2": value2}}\n```';
                }
                requestData.custom_prompt = finalPrompt;
                requestData.custom_endpoint_auth = credentials.custom_endpoint_auth;
            }

            if (this.isBrowserCacheMode) {
                // Handle transcription locally for browser cache mode
                const transcription = await this.performLocalTranscription(annotation, requestData);
                if (transcription) {
                    // Store transcription in local storage
                    const transcriptionData = {
                        id: `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                        image: this.currentImage.id,
                        annotation: annotationId,
                        transcription_type: 'annotation',
                        api_endpoint: selectedModel.provider,
                        api_model: selectedModel.model,
                        status: 'completed',
                        text_content: transcription.text_content,
                        confidence_score: transcription.confidence_score || null,
                        api_response_raw: transcription.api_response_raw || null,
                        is_current: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    
                    await this.localStorage.add('transcriptions', transcriptionData);
                    this.updateAnnotationTranscription(annotationId, transcription);
                    // Refresh transcription list
                    await this.loadImageTranscriptions();
                }
            } else {
                const response = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/transcribe/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify(requestData)
                });

                if (response.ok) {
                    const transcription = await response.json();
                    this.updateAnnotationTranscription(annotationId, transcription);
                }
            }
        } catch (error) {
            console.error('Annotation transcription error:', error);
        }
    }

    async performLocalTranscriptionWithImage(annotation, requestData, imageData) {
        // Version that accepts image data directly to avoid cache lookup issues
        try {
            // Get the image region for the annotation using provided image data
            const imageCanvas = await this.getAnnotationImageDataFromImage(annotation, imageData);
            
            if (requestData.api_endpoint === 'openai') {
                return await this.transcribeWithOpenAI(imageCanvas, requestData);
            } else if (requestData.api_endpoint === 'vertex') {
                return await this.transcribeWithVertexAI(imageCanvas, requestData);
            } else if (requestData.api_endpoint === 'custom') {
                return await this.transcribeWithCustomEndpoint(imageCanvas, requestData);
            }
            
            throw new Error('Unsupported API endpoint');
        } catch (error) {
            console.error('Local transcription error:', error);
            this.showAlert(`Transcription failed: ${error.message}`, 'danger');
            return null;
        }
    }

    async performLocalTranscription(annotation, requestData) {
        try {
            // Get the image region for the annotation
            const imageCanvas = await this.getAnnotationImageData(annotation);
            
            if (requestData.api_endpoint === 'openai') {
                return await this.transcribeWithOpenAI(imageCanvas, requestData);
            } else if (requestData.api_endpoint === 'vertex') {
                return await this.transcribeWithVertexAI(imageCanvas, requestData);
            } else if (requestData.api_endpoint === 'custom') {
                return await this.transcribeWithCustomEndpoint(imageCanvas, requestData);
            }
            
            throw new Error('Unsupported API endpoint');
        } catch (error) {
            console.error('Local transcription error:', error);
            this.showAlert(`Transcription failed: ${error.message}`, 'danger');
            return null;
        }
    }

    async getAnnotationImageDataFromImage(annotation, imageData) {
        // Version that accepts image data directly to avoid cache lookup issues
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Use provided image data
        const imageSrc = imageData.image_data || imageData.image_file;
        if (!imageSrc) {
            throw new Error('No image data provided');
        }
        

        
        // Get the image element
        const imgElement = new Image();
        imgElement.src = imageSrc;
        
        return new Promise((resolve, reject) => {
            imgElement.onload = () => {
                const coords = annotation.coordinates;
                const annotationType = annotation.type || annotation.annotation_type;
                

                
                if (!coords) {
                    reject(new Error('No coordinates found for annotation'));
                    return;
                }
                
                if (annotationType === 'bbox') {
                    // Ensure coordinates are valid
                    const x = Math.max(0, Math.floor(coords.x || 0));
                    const y = Math.max(0, Math.floor(coords.y || 0));
                    const width = Math.max(1, Math.floor(coords.width || 0));
                    const height = Math.max(1, Math.floor(coords.height || 0));
                    
                    // Make sure crop doesn't exceed image bounds
                    const actualWidth = Math.min(width, imgElement.width - x);
                    const actualHeight = Math.min(height, imgElement.height - y);
                    
                    if (actualWidth <= 0 || actualHeight <= 0) {
                        reject(new Error(`Invalid crop dimensions: ${actualWidth}x${actualHeight} at ${x},${y}`));
                        return;
                    }
                    
                    canvas.width = actualWidth;
                    canvas.height = actualHeight;
                    

                    
                    // Draw the cropped region
                    ctx.drawImage(
                        imgElement,
                        x, y, actualWidth, actualHeight,
                        0, 0, actualWidth, actualHeight
                    );
                } else if (annotationType === 'polygon') {
                    // For polygons, find bounding box
                    if (!coords.points || coords.points.length === 0) {
                        reject(new Error('No points found for polygon annotation'));
                        return;
                    }
                    
                    const xs = coords.points.map(p => p.x);
                    const ys = coords.points.map(p => p.y);
                    const minX = Math.max(0, Math.floor(Math.min(...xs)));
                    const minY = Math.max(0, Math.floor(Math.min(...ys)));
                    const maxX = Math.min(imgElement.width, Math.ceil(Math.max(...xs)));
                    const maxY = Math.min(imgElement.height, Math.ceil(Math.max(...ys)));
                    
                    const width = maxX - minX;
                    const height = maxY - minY;
                    
                    if (width <= 0 || height <= 0) {
                        reject(new Error(`Invalid polygon bounds: ${width}x${height}`));
                        return;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    

                    
                    // Draw the bounding box region
                    ctx.drawImage(
                        imgElement,
                        minX, minY, width, height,
                        0, 0, width, height
                    );
                } else {
                    reject(new Error(`Unsupported annotation type: ${annotationType}`));
                    return;
                }
                
                const croppedDataUrl = canvas.toDataURL('image/png');
                resolve(croppedDataUrl);
            };
            
            imgElement.onerror = (error) => {
                console.error('Failed to load image for annotation extraction:', error);
                reject(error);
            };
        });
    }

    async getAnnotationImageData(annotation) {
        // Create a canvas to extract the annotation region from the current image
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Get the image data - different approach for browser cache vs server mode
        let imageSrc;
        if (this.isBrowserCacheMode) {
            // Get image from IndexedDB - handle both field names for backwards compatibility
            let imageId = annotation.image_id || annotation.image;
            
            // If no image reference, try to use current image ID (fallback for annotations without proper references)
            if (!imageId && this.currentImage) {
                console.warn('Annotation missing image reference, using current image as fallback:', annotation.id);
                imageId = this.currentImage.id;
            }
            
            if (!imageId) {
                throw new Error('Annotation has no image reference and no current image available');
            }
            
            const image = await this.localStorage.get('images', imageId);
            if (!image || !image.image_data) {
                // Try to find the image by looking at current document images
                if (this.currentImage && this.currentImage.document_id) {
                    const documentImages = await this.localStorage.getAll('images', 'document_id', this.currentImage.document_id);
                    
                    // If annotation has no valid image reference but we're in a single-image context, use current image
                    if (documentImages.length === 1 || (this.currentImage && documentImages.find(img => img.id === this.currentImage.id))) {
                        imageSrc = this.currentImage.image_data || this.currentImage.image_file;
                        if (!imageSrc) {
                            throw new Error('Current image has no image data available');
                        }
                        // Continue processing with current image data instead of returning early
                    } else {
                        throw new Error(`Image not found in cache: ${imageId}`);
                    }
                } else {
                    throw new Error(`Image not found in cache: ${imageId}`);
                }
            } else {
                imageSrc = image.image_data;
            }
        } else {
            // Use current image file from server
            if (!this.currentImage || !this.currentImage.image_file) {
                throw new Error('No current image available');
            }
            imageSrc = this.currentImage.image_file;
        }
        
        // Get the image element
        const imgElement = new Image();
        imgElement.src = imageSrc;
        
        return new Promise((resolve, reject) => {
            imgElement.onload = () => {
                const coords = annotation.coordinates;
                const annotationType = annotation.annotation_type || annotation.type;
                
                if (annotationType === 'bbox') {
                    canvas.width = coords.width;
                    canvas.height = coords.height;
                    
                    // Draw the cropped region
                    ctx.drawImage(
                        imgElement,
                        coords.x, coords.y, coords.width, coords.height,
                        0, 0, coords.width, coords.height
                    );
                } else if (annotationType === 'polygon') {
                    // For polygons, find bounding box
                    const xs = coords.points.map(p => p.x);
                    const ys = coords.points.map(p => p.y);
                    const minX = Math.min(...xs);
                    const minY = Math.min(...ys);
                    const maxX = Math.max(...xs);
                    const maxY = Math.max(...ys);
                    
                    canvas.width = maxX - minX;
                    canvas.height = maxY - minY;
                    
                    // Draw the bounding box region (for simplicity)
                    ctx.drawImage(
                        imgElement,
                        minX, minY, maxX - minX, maxY - minY,
                        0, 0, maxX - minX, maxY - minY
                    );
                }
                
                resolve(canvas.toDataURL('image/png'));
            };
            
            imgElement.onerror = reject;
        });
    }

    async transcribeWithOpenAI(imageDataUrl, requestData) {
        // Optimize image for OpenAI API (max 20MB, recommended 2048px max dimension)
        const optimizedImageUrl = await this.optimizeImageForAPI(imageDataUrl, 2048);
        
        const payload = {
            model: requestData.api_model,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: requestData.custom_prompt
                        },
                        {
                            type: 'image_url',
                            image_url: {
                                url: optimizedImageUrl
                            }
                        }
                    ]
                }
            ],
            max_tokens: 1000
        };
        
        // Add structured output for metadata extraction (matches server behavior)
        if (requestData.use_structured_output && requestData.metadata_schema) {
            payload.response_format = {
                type: 'json_schema',
                json_schema: requestData.metadata_schema
            };
        }
        
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${requestData.openai_api_key}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            let errorMessage = 'OpenAI API request failed';
            try {
                const error = await response.json();
                errorMessage = error.error?.message || errorMessage;
            } catch (e) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        // Validate response structure
        if (!data.choices || !data.choices[0] || !data.choices[0].message) {
            throw new Error('Invalid response format from OpenAI');
        }
        
        // Extract text and metadata from response (matches server behavior)
        let text_content = "";
        let metadata = {};
        const content = data.choices[0].message.content;
        
        if (requestData.use_structured_output && requestData.metadata_schema) {
            try {
                // Parse JSON response for structured output
                const parsed_content = JSON.parse(content);
                text_content = parsed_content.text || '';
                metadata = parsed_content.metadata || {};
                console.log('Extracted metadata from structured output:', metadata);
            } catch (error) {
                console.warn('Failed to parse structured output, using as plain text:', error);
                // Fallback to plain text if JSON parsing fails
                text_content = content;
            }
        } else {
            text_content = content;
        }
        
        return {
            text_content: text_content,
            metadata: metadata,
            api_response_raw: data,
            confidence_score: null
        };
    }

    async optimizeImageForAPI(imageDataUrl, maxDimension = 2048, quality = 0.8) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // Calculate new dimensions maintaining aspect ratio
                let { width, height } = img;
                
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = (height * maxDimension) / width;
                        width = maxDimension;
                    } else {
                        width = (width * maxDimension) / height;
                        height = maxDimension;
                    }
                }
                
                canvas.width = width;
                canvas.height = height;
                
                // Draw image with new dimensions
                ctx.drawImage(img, 0, 0, width, height);
                
                // Convert to optimized JPEG with specified quality (matches server behavior)
                const optimizedDataUrl = canvas.toDataURL('image/jpeg', quality);
                
                console.log(`Image optimized: ${img.width}x${img.height} -> ${width}x${height}`);
                console.log(`Size reduced: ${Math.round(imageDataUrl.length / 1024)}KB -> ${Math.round(optimizedDataUrl.length / 1024)}KB`);
                console.log(`Format: JPEG quality ${quality * 100}%`);
                
                resolve(optimizedDataUrl);
            };
            
            img.onerror = () => {
                console.warn('Image optimization failed, using original');
                resolve(imageDataUrl);
            };
            
            img.src = imageDataUrl;
        });
    }

    async transcribeWithVertexAI(imageDataUrl, requestData) {
        // Optimize image for Vertex AI (similar limits to OpenAI)
        const optimizedImageUrl = await this.optimizeImageForAPI(imageDataUrl, 2048);
        
        // Remove data URL prefix to get base64
        const base64Image = optimizedImageUrl.split(',')[1];
        
        // Clean up the model name - remove 'google/' prefix if present
        const modelName = requestData.vertex_model.replace('google/', '');
        
        const response = await fetch(`https://${requestData.vertex_location}-aiplatform.googleapis.com/v1/projects/${requestData.vertex_project_id}/locations/${requestData.vertex_location}/publishers/google/models/${modelName}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${requestData.vertex_access_token}`
            },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: requestData.custom_prompt },
                        {
                            inline_data: {
                                mime_type: 'image/png',
                                data: base64Image
                            }
                        }
                    ]
                }]
            })
        });

        if (!response.ok) {
            let errorMessage = 'Vertex AI API request failed';
            try {
                const error = await response.json();
                errorMessage = error.error?.message || errorMessage;
            } catch (e) {
                errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const data = await response.json();
        
        // Validate response structure
        if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || !data.candidates[0].content.parts) {
            throw new Error('Invalid response format from Vertex AI');
        }
        
        return {
            text_content: data.candidates[0].content.parts[0].text,
            api_response_raw: data,
            confidence_score: null
        };
    }

    async transcribeWithCustomEndpoint(imageDataUrl, requestData) {
        // Optimize image for custom endpoint
        const optimizedImageUrl = await this.optimizeImageForAPI(imageDataUrl, 2048);
        
        // Convert to blob for custom endpoint
        const response = await fetch(optimizedImageUrl);
        const blob = await response.blob();
        
        const formData = new FormData();
        formData.append('image', blob, 'annotation.png');
        formData.append('prompt', requestData.custom_prompt);

        const apiResponse = await fetch(requestData.custom_endpoint_url, {
            method: 'POST',
            headers: {
                'Authorization': requestData.custom_endpoint_auth
            },
            body: formData
        });

        if (!apiResponse.ok) {
            throw new Error('Custom endpoint request failed');
        }

        const data = await apiResponse.json();
        return {
            text_content: data.text || data.transcription || JSON.stringify(data),
            api_response_raw: data,
            confidence_score: data.confidence || null
        };
    }

    async performLocalImageTranscription(imageId, requestData) {
        try {
            // Get the full image for transcription
            let imageDataUrl;
            if (this.isBrowserCacheMode) {
                // Get image from IndexedDB
                const image = await this.localStorage.get('images', imageId);
                if (!image || !image.image_data) {
                    throw new Error(`Image not found in cache: ${imageId}`);
                }
                imageDataUrl = image.image_data;
            } else {
                // Use current image file from server
                if (!this.currentImage || !this.currentImage.image_file) {
                    throw new Error('No current image available');
                }
                imageDataUrl = this.currentImage.image_file;
            }
            
            if (requestData.api_endpoint === 'openai') {
                requestData.custom_prompt = requestData.custom_prompt || 'Transcribe all the text in this image accurately, preserving formatting and structure.';
                return await this.transcribeWithOpenAI(imageDataUrl, requestData);
            } else if (requestData.api_endpoint === 'vertex') {
                requestData.custom_prompt = requestData.custom_prompt || 'Transcribe all the text in this image accurately, preserving formatting and structure.';
                return await this.transcribeWithVertexAI(imageDataUrl, requestData);
            } else if (requestData.api_endpoint === 'custom') {
                requestData.custom_prompt = requestData.custom_prompt || 'Transcribe all the text in this image accurately, preserving formatting and structure.';
                return await this.transcribeWithCustomEndpoint(imageDataUrl, requestData);
            }
            
            throw new Error('Unsupported API endpoint');
        } catch (error) {
            console.error('Local image transcription error:', error);
            this.showAlert(`Transcription failed: ${error.message}`, 'danger');
            return null;
        }
    }

    getPromptForAnnotation(annotation) {
        // If no classification, use default prompt
        if (!annotation.classification) {
            return this.getDefaultPrompt();
        }

        // Find prompt that applies to this classification
        const applicablePrompt = this.customPrompts.find(prompt => 
            prompt.zones && prompt.zones.includes(annotation.classification)
        );

        // Debug: Log prompt matching for troubleshooting
        if (!applicablePrompt && annotation.classification) {
            console.log(`No prompt found for classification: "${annotation.classification}"`);
            console.log('Available prompts and their zones:', this.customPrompts.map(p => ({
                name: p.name,
                zones: p.zones
            })));
        }

        return applicablePrompt || this.getDefaultPrompt();
    }

    getDefaultPrompt() {
        // Look for default prompt first
        const defaultPrompt = this.customPrompts.find(p => p.is_default);
        if (defaultPrompt) return defaultPrompt;

        // Fallback prompt
        return {
            prompt: 'Transcribe this text accurately, preserving formatting and structure.',
            metadata_fields: [
                { name: 'handwritten', type: 'boolean', default: false },
                { name: 'typed', type: 'boolean', default: true },
                { name: 'language', type: 'string', default: 'en' }
            ]
        };
    }

    createMetadataSchema(metadataFields) {
        const properties = {};
        const required = [];

        metadataFields.forEach(field => {
            switch (field.type) {
                case 'boolean':
                    properties[field.name] = { 
                        type: 'boolean',
                        description: `Whether the text is ${field.name}`
                    };
                    break;
                case 'string':
                    properties[field.name] = { 
                        type: 'string',
                        description: `The ${field.name} of the text`
                    };
                    break;
                case 'number':
                    properties[field.name] = { 
                        type: 'number',
                        description: `The ${field.name} value`
                    };
                    break;
            }
            required.push(field.name);
        });

        return {
            type: 'object',
            properties: {
                text: {
                    type: 'string',
                    description: 'The transcribed text content'
                },
                metadata: {
                    type: 'object',
                    properties: properties,
                    required: required
                }
            },
            required: ['text', 'metadata']
        };
    }

    async updateAnnotationMetadata(annotationId, metadata) {
        try {
    
            
            if (this.isBrowserCacheMode) {
                // Update annotation metadata in browser cache
                const annotation = await this.localStorage.get('annotations', annotationId);
                if (annotation) {
                    annotation.metadata = { ...annotation.metadata, ...metadata };
                    annotation.updated_at = new Date().toISOString();
                    await this.localStorage.update('annotations', annotation);
                    
                    // Update local annotation in memory
                    const localAnnotation = this.annotations.find(a => a.id === annotationId);
                    if (localAnnotation) {
                        localAnnotation.metadata = { ...localAnnotation.metadata, ...metadata };
                    }
                    

                }
            } else {
                const response = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({ metadata: metadata })
                });

                if (response.ok) {
                    // Update local annotation
                    const annotation = this.annotations.find(a => a.id === annotationId);
                    if (annotation) {
                        annotation.metadata = { ...annotation.metadata, ...metadata };
                    }
                    

                }
            }
            
            // Update UI to show new metadata
            this.updateCombinedTranscription();
        } catch (error) {
            console.error('Error updating annotation metadata:', error);
        }
    }

    updateTranscriptionDisplay(transcription) {
        // Store the image transcription and update combined view
        this.currentImageTranscription = transcription;
        this.updateCombinedTranscription();
    }

    updateAnnotationTranscription(annotationId, transcription) {
        // Find and update the annotation with its transcription
        const annotation = this.annotations.find(a => a.id === annotationId);
        if (annotation) {
            // Parse and clean the transcription response
            const processedTranscription = this.processTranscriptionResponse(transcription);
            annotation.transcription = processedTranscription;
            
            // Store the model information in the annotation metadata
            const selectedModel = this.getSelectedModel();
            if (!annotation.metadata) {
                annotation.metadata = {};
            }
            annotation.metadata.transcription_model = selectedModel.model;
            annotation.metadata.transcription_provider = selectedModel.provider;
            
            // If the processed transcription contains metadata, update the annotation
            if (processedTranscription.parsed_metadata && Object.keys(processedTranscription.parsed_metadata).length > 0) {
                this.updateAnnotationMetadata(annotationId, processedTranscription.parsed_metadata);
            }
        }
        
        // Update the UI
        this.updateAnnotationsList();
        
        // Refresh canvas to reflect any visual changes from transcription
        this.canvas.renderAll();
    }
    
    processTranscriptionResponse(transcription) {
        // Clone the original transcription
        const processed = { ...transcription };
        let textContent = transcription.text_content || '';
        let parsedMetadata = {};
        
        try {
            // First try to parse the entire text_content as JSON (for Vertex AI responses)
            if (textContent.trim().startsWith('{') && textContent.trim().endsWith('}')) {
                try {
                    const jsonData = JSON.parse(textContent.trim());
                    // Handle Vertex AI format: {"text": "", "metadata": {...}}
                    if (jsonData.hasOwnProperty('text') && jsonData.hasOwnProperty('metadata')) {
                        textContent = jsonData.text || '';
                        parsedMetadata = jsonData.metadata || {};
                        processed.text_content = textContent;
                        processed.parsed_metadata = parsedMetadata;
                        return processed;
                    }
                    // Handle other formats where only text field exists
                    else if (jsonData.hasOwnProperty('text')) {
                        textContent = jsonData.text || '';
                        processed.text_content = textContent;
                        return processed;
                    }
                } catch (e) {
                    console.log('Failed to parse text_content as direct JSON:', e);
                }
            }
            
            // If direct JSON parsing failed, try to extract JSON from text content if it looks like it contains JSON
            if (textContent.includes('{') && textContent.includes('}')) {
                // Try to extract JSON from markdown code blocks
                const jsonBlockMatch = textContent.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
                if (jsonBlockMatch) {
                    try {
                        const jsonData = JSON.parse(jsonBlockMatch[1]);
                        if (jsonData.hasOwnProperty('text') && jsonData.hasOwnProperty('metadata')) {
                            textContent = jsonData.text || '';
                            parsedMetadata = jsonData.metadata || {};
                            processed.text_content = textContent;
                            processed.parsed_metadata = parsedMetadata;
                            return processed;
                        } else if (jsonData.hasOwnProperty('text')) {
                            textContent = jsonData.text || '';
                            processed.text_content = textContent;
                            return processed;
                        }
                    } catch (e) {
                        console.log('Failed to parse JSON from code block:', e);
                    }
                }
                
                // Try to extract plain JSON object
                const jsonMatch = textContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try {
                        const jsonData = JSON.parse(jsonMatch[0]);
                        if (jsonData.hasOwnProperty('text') && jsonData.hasOwnProperty('metadata')) {
                            textContent = jsonData.text || '';
                            parsedMetadata = jsonData.metadata || {};
                            processed.text_content = textContent;
                            processed.parsed_metadata = parsedMetadata;
                            return processed;
                        } else if (jsonData.hasOwnProperty('text')) {
                            textContent = jsonData.text || '';
                            processed.text_content = textContent;
                            return processed;
                        }
                    } catch (e) {
                        console.log('Failed to parse JSON object:', e);
                    }
                }
            }
            
            // If no JSON found or parsing failed, check if we have metadata in the transcription object itself
            if (transcription.metadata && Object.keys(transcription.metadata).length > 0) {
                parsedMetadata = transcription.metadata;
                processed.parsed_metadata = parsedMetadata;
            }
            
        } catch (error) {
            console.error('Error processing transcription response:', error);
        }
        
        return processed;
    }

    updateAnnotationsList() {
        // This function now just updates the combined transcription
        // since the old annotations list has been removed
        this.updateCombinedTranscription();
    }

    selectAnnotation(annotationId) {
        const annotation = this.annotations.find(a => a.id === annotationId);
        if (annotation && annotation.fabricObject) {
            this.canvas.setActiveObject(annotation.fabricObject);
            this.canvas.renderAll();
        }
    }

    // Note: Old annotation drag handlers removed since annotations section was removed

    async reorderAnnotations(draggedId, targetId) {
        // Find indices of dragged and target annotations
        const sortedAnnotations = [...this.annotations].sort((a, b) => {
            const orderA = a.reading_order !== undefined ? a.reading_order : 999999;
            const orderB = b.reading_order !== undefined ? b.reading_order : 999999;
            return orderA - orderB;
        });

        const draggedIndex = sortedAnnotations.findIndex(a => a.id === draggedId);
        const targetIndex = sortedAnnotations.findIndex(a => a.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        // Reorder locally
        const [draggedAnnotation] = sortedAnnotations.splice(draggedIndex, 1);
        sortedAnnotations.splice(targetIndex, 0, draggedAnnotation);

        // Update reading orders
        sortedAnnotations.forEach((annotation, index) => {
            annotation.reading_order = index;
        });

        // Update the main annotations array
        this.annotations.forEach(annotation => {
            const reorderedAnnotation = sortedAnnotations.find(a => a.id === annotation.id);
            if (reorderedAnnotation) {
                annotation.reading_order = reorderedAnnotation.reading_order;
            }
        });

        // Save to backend
        await this.saveAnnotationOrder();

        // Update UI
        this.updateAnnotationsList();
    }

    async saveAnnotationOrder() {
        try {
            const orderData = this.annotations.map(annotation => ({
                id: annotation.id,
                reading_order: annotation.reading_order
            }));

            await fetch(`${this.apiBaseUrl}/images/${this.currentImage.id}/annotations/reorder/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Token ${this.authToken}`
                },
                body: JSON.stringify({ annotations: orderData })
            });
        } catch (error) {
            console.error('Error saving annotation order:', error);
            this.showAlert('Failed to save annotation order', 'warning');
        }
    }

    updateCombinedTranscription() {
        const transcriptionContent = document.getElementById('transcriptionContent');
        
        // Get current image transcription
        const imageTranscription = this.currentImageTranscription;
        
        // Get all annotations in reading order  
        const sortedAnnotations = [...this.annotations]
            .sort((a, b) => {
                const orderA = a.reading_order !== undefined ? a.reading_order : 999999;
                const orderB = b.reading_order !== undefined ? b.reading_order : 999999;
                return orderA - orderB;
            });

        // Get only transcribed annotations for combined text
        const transcribedAnnotations = sortedAnnotations.filter(a => a.transcription && a.transcription.text_content);

        let content = '';

        if (imageTranscription && imageTranscription.text_content) {
            const isExpanded = localStorage.getItem('fullImageExpanded') !== 'false';
            content += `
                <div class="transcription-section mb-3 collapsible-section">
                    <div class="section-header" onclick="app.toggleSection('fullImage', this)">
                        <h6><i class="fas fa-image me-2"></i>Full Image Transcription</h6>
                        <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} toggle-icon"></i>
                    </div>
                    <div class="section-content" ${isExpanded ? '' : 'style="display: none;"'}>
                        <div class="transcription-text border p-2 rounded">${this.escapeHtml(imageTranscription.text_content)}</div>
                        <div class="mt-2">
                            <span class="badge bg-${imageTranscription.status === 'completed' ? 'success' : 'warning'}">
                                ${imageTranscription.status}
                            </span>
                            ${imageTranscription.confidence_score ? 
                                `<span class="badge bg-info ms-2">Confidence: ${(imageTranscription.confidence_score * 100).toFixed(1)}%</span>` 
                                : ''
                            }
                        </div>
                    </div>
                </div>
            `;
        }

        if (transcribedAnnotations.length > 0) {
            const combinedText = transcribedAnnotations.map(a => a.transcription.text_content).join('\n\n');
            const isCombinedExpanded = localStorage.getItem('combinedExpanded') !== 'false';
            content += `
                <div class="transcription-section mb-3 collapsible-section">
                    <div class="section-header" onclick="app.toggleSection('combined', this)">
                        <h6><i class="fas fa-puzzle-piece me-2"></i>Combined Annotation Transcription</h6>
                        <i class="fas fa-chevron-${isCombinedExpanded ? 'down' : 'right'} toggle-icon"></i>
                    </div>
                    <div class="section-content" ${isCombinedExpanded ? '' : 'style="display: none;"'}>
                        <div class="transcription-text border p-2 rounded">${this.escapeHtml(combinedText)}</div>
                        <small class="text-muted">Assembled from ${transcribedAnnotations.length} annotations in reading order</small>
                    </div>
                </div>
            `;

        }

        // Always show Individual Annotations section if there are any annotations
        if (sortedAnnotations.length > 0) {
            const isIndividualExpanded = localStorage.getItem('individualExpanded') !== 'false';
            content += `
                <div class="transcription-section collapsible-section">
                    <div class="section-header" onclick="app.toggleSection('individual', this)">
                        <h6><i class="fas fa-list me-2"></i>Individual Annotations</h6>
                        <i class="fas fa-chevron-${isIndividualExpanded ? 'down' : 'right'} toggle-icon"></i>
                    </div>
                    <div class="section-content" ${isIndividualExpanded ? '' : 'style="display: none;"'}>
                        <div class="annotation-transcriptions" id="transcriptionList">
                            ${sortedAnnotations.map((annotation, index) => {
                                const hasTranscription = annotation.transcription && annotation.transcription.text_content;
                                const classificationType = this.getClassificationType(annotation.classification);
                                const metadataDisplay = this.formatMetadataDisplay(annotation.metadata);
                                const modelInfo = this.formatTranscriptionModelInfo(annotation);
                                const classificationColor = annotation.classification ? (this.zoneColors[annotation.classification] || '#6c757d') : '#6c757d';
                                const borderColor = annotation.classification ? classificationColor : '#dee2e6';
                                return `
                                <div class="transcription-item mb-2 p-2 border rounded ${this.selectedAnnotations.includes(annotation.id) ? 'selected' : ''}" 
                                     data-annotation-id="${annotation.id}" 
                                     draggable="true"
                                     onclick="app.selectAnnotationFromItem(event, '${annotation.id}')"
                                     style="cursor: pointer; border-left: 4px solid ${borderColor} !important;">
                                    <div class="d-flex justify-content-between align-items-center mb-1">
                                        <div class="d-flex align-items-center">
                                            <i class="fas fa-grip-vertical text-muted me-2" style="cursor: grab;"></i>
                                            <span class="badge bg-primary me-2">${index + 1}</span>
                                            <small class="text-muted">${annotation.type}</small>
                                            <span class="badge classification-badge ms-2" 
                                                  onclick="app.quickEditClassification(event, '${annotation.id}')" 
                                                  style="cursor: pointer; background-color: ${classificationColor} !important; color: white;" 
                                                  title="Click to change classification"
                                                  id="classification-display-${annotation.id}">
                                                ${annotation.classification || 'No Zone Selected'}
                                            </span>
                                        </div>
                                        <div class="btn-group" role="group">
                                            <button class="btn btn-sm btn-outline-primary" onclick="app.selectAnnotationFromTranscription('${annotation.id}')" title="Select on canvas">
                                                <i class="fas fa-crosshairs"></i>
                                            </button>
                                            <button class="btn btn-sm btn-outline-secondary" onclick="app.toggleInlineEdit('${annotation.id}')" title="Edit annotation" id="edit-btn-${annotation.id}">
                                                <i class="fas fa-edit"></i>
                                            </button>
                                            ${hasTranscription ? `
                                                <button class="btn btn-sm btn-outline-danger" onclick="app.removeTranscription('${annotation.id}')" title="Remove transcription">
                                                    <i class="fas fa-times"></i>
                                                </button>
                                            ` : `
                                                <button class="btn btn-sm btn-outline-success" onclick="app.transcribeAnnotationFromList('${annotation.id}')" title="Transcribe annotation">
                                                    <i class="fas fa-robot"></i>
                                                </button>
                                            `}
                                        </div>
                                    </div>
                                    
                                    <!-- Inline Edit Form (hidden by default) -->
                                    <div class="inline-edit-form" id="inline-edit-${annotation.id}" style="display: none;">
                                        <div class="mb-2">
                                            <label class="form-label small">Classification:</label>
                                            <select class="form-select form-select-sm" id="inline-classification-${annotation.id}">
                                                <option value="">NoZoneSelected</option>
                                                ${this.generateClassificationOptions(annotation.classification)}
                                            </select>
                                        </div>
                                        <div class="mb-2">
                                            <label class="form-label small">Label:</label>
                                            <input type="text" class="form-control form-control-sm" 
                                                   id="inline-label-${annotation.id}" value="${annotation.label || ''}">
                                        </div>
                                        <div class="mb-3" id="inline-metadata-${annotation.id}">
                                            ${this.generateInlineMetadataFields(annotation)}
                                        </div>
                                    </div>
                                    
                                    ${metadataDisplay ? `
                                        <div class="metadata-display mb-2" id="metadata-display-${annotation.id}">
                                            <small class="text-muted">Metadata:</small>
                                            <div class="metadata-content small">${metadataDisplay}</div>
                                        </div>
                                    ` : ''}
                                    ${modelInfo ? `
                                        <div class="model-info mb-2">
                                            ${modelInfo}
                                        </div>
                                    ` : ''}
                                    <div class="transcription-text-content">
                                        ${hasTranscription ? `
                                            <div class="transcription-display" id="transcription-display-${annotation.id}">
                                                <div class="small transcription-text-item">${this.escapeHtml(annotation.transcription.text_content)}</div>
                                            </div>
                                            <div class="transcription-edit-form" id="transcription-edit-${annotation.id}" style="display: none;">
                                                <label class="form-label small">Transcription:</label>
                                                <textarea class="form-control form-control-sm" id="transcription-textarea-${annotation.id}" rows="8">${annotation.transcription.text_content}</textarea>
                                                
                                                <!-- Save buttons at the bottom -->
                                                <div class="d-flex gap-1 mt-3">
                                                    <button class="btn btn-sm btn-success" onclick="app.saveInlineEdit('${annotation.id}')">
                                                        <i class="fas fa-check"></i> Save All Changes
                                                    </button>
                                                    <button class="btn btn-sm btn-secondary" onclick="app.cancelInlineEdit('${annotation.id}')">
                                                        <i class="fas fa-times"></i> Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        ` : `
                                            <div class="small text-muted not-transcribed" id="transcription-display-${annotation.id}">
                                                <i class="fas fa-robot me-1"></i>Not transcribed yet
                                            </div>
                                            
                                            <!-- Manual transcription form (hidden by default) -->
                                            <div class="transcription-edit-form" id="transcription-edit-${annotation.id}" style="display: none;">
                                                <label class="form-label small">Add Transcription:</label>
                                                <textarea class="form-control form-control-sm" id="transcription-textarea-${annotation.id}" rows="8" placeholder="Type the transcription here..."></textarea>
                                            </div>
                                            
                                            <!-- Save buttons for non-transcribed annotations in edit mode -->
                                            <div class="edit-only-buttons" id="edit-buttons-${annotation.id}" style="display: none;">
                                                <div class="d-flex gap-1 mt-3">
                                                    <button class="btn btn-sm btn-success" onclick="app.saveInlineEdit('${annotation.id}')">
                                                        <i class="fas fa-check"></i> Save All Changes
                                                    </button>
                                                    <button class="btn btn-sm btn-secondary" onclick="app.cancelInlineEdit('${annotation.id}')">
                                                        <i class="fas fa-times"></i> Cancel
                                                    </button>
                                                </div>
                                            </div>
                                        `}
                                    </div>
                                </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                </div>
            `;
        }

        if (!content) {
            content = '<p class="text-muted">No transcriptions available. Transcribe the image or annotations to see results.</p>';
        }

        transcriptionContent.innerHTML = content;
        
        // Add drag and drop handlers for transcription items
        this.initializeTranscriptionDragDrop();
    }

    toggleSection(sectionType, headerElement) {
        const sectionElement = headerElement.closest('.collapsible-section');
        const content = sectionElement.querySelector('.section-content');
        const icon = sectionElement.querySelector('.toggle-icon');
        
        const isCurrentlyVisible = content.style.display !== 'none';
        
        if (isCurrentlyVisible) {
            content.style.display = 'none';
            icon.className = 'fas fa-chevron-right toggle-icon';
            localStorage.setItem(`${sectionType}Expanded`, 'false');
        } else {
            content.style.display = 'block';
            icon.className = 'fas fa-chevron-down toggle-icon';
            localStorage.setItem(`${sectionType}Expanded`, 'true');
        }
    }

    initializeTranscriptionDragDrop() {
        const transcriptionList = document.getElementById('transcriptionList');
        if (!transcriptionList) return;

        const transcriptionItems = transcriptionList.querySelectorAll('.transcription-item');
        transcriptionItems.forEach(item => {
            item.addEventListener('dragstart', (e) => this.handleTranscriptionDragStart(e));
            item.addEventListener('dragover', (e) => this.handleTranscriptionDragOver(e));
            item.addEventListener('dragenter', (e) => this.handleTranscriptionDragEnter(e));
            item.addEventListener('dragleave', (e) => this.handleTranscriptionDragLeave(e));
            item.addEventListener('drop', (e) => this.handleTranscriptionDrop(e));
            item.addEventListener('dragend', (e) => this.handleTranscriptionDragEnd(e));
        });
    }

    handleTranscriptionDragStart(e) {
        this.draggedTranscriptionId = e.currentTarget.dataset.annotationId;
        this.draggedElement = e.currentTarget;
        
        e.currentTarget.style.opacity = '0.5';
        e.currentTarget.classList.add('dragging');
        
        // Set drag effect
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', e.currentTarget.outerHTML);
    }

    handleTranscriptionDragEnter(e) {
        e.preventDefault();
        if (e.currentTarget !== this.draggedElement) {
            e.currentTarget.classList.add('drag-over');
        }
    }

    handleTranscriptionDragLeave(e) {
        // Only remove the class if we're actually leaving the element (not just moving to a child)
        if (!e.currentTarget.contains(e.relatedTarget)) {
            e.currentTarget.classList.remove('drag-over');
        }
    }

    handleTranscriptionDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        if (e.currentTarget === this.draggedElement) return;
        
        // Get the position within the element to determine insert position
        const rect = e.currentTarget.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const mouseY = e.clientY;
        
        // Add visual indicator for drop position
        e.currentTarget.classList.remove('drag-insert-above', 'drag-insert-below');
        if (mouseY < midpoint) {
            e.currentTarget.classList.add('drag-insert-above');
            this.dropPosition = 'above';
        } else {
            e.currentTarget.classList.add('drag-insert-below');
            this.dropPosition = 'below';
        }
    }

    handleTranscriptionDrop(e) {
        e.preventDefault();
        
        const targetElement = e.currentTarget;
        const targetTranscriptionId = targetElement.dataset.annotationId;
        
        // Clean up visual indicators
        this.clearDragVisualIndicators();
        
        if (this.draggedTranscriptionId && targetTranscriptionId && 
            this.draggedTranscriptionId !== targetTranscriptionId) {
            
            // Determine if we should insert above or below the target
            const insertAbove = this.dropPosition === 'above';
            this.reorderTranscriptions(this.draggedTranscriptionId, targetTranscriptionId, insertAbove);
        }
    }

    handleTranscriptionDragEnd(e) {
        this.clearDragVisualIndicators();
        
        if (e.currentTarget) {
            e.currentTarget.style.opacity = '1';
            e.currentTarget.classList.remove('dragging');
        }
        
        this.draggedTranscriptionId = null;
        this.draggedElement = null;
        this.dropPosition = null;
    }
    
    clearDragVisualIndicators() {
        const items = document.querySelectorAll('.transcription-item');
        items.forEach(item => {
            item.classList.remove('drag-over', 'drag-insert-above', 'drag-insert-below');
        });
    }

    // Old Tree Drag and Drop Functionality - DISABLED
    initializeTreeDragDrop() {
        // Disabled in favor of professional controls (up/down arrows + edit structure modal)
        return;
    }

    // Old drag and drop setup function - DISABLED  
    setupTreeItemDragDrop(item) {
        // Disabled - using professional controls instead
        return;
        
        // Remove any existing listeners to avoid duplicates
        const existingHandler = item._dragHandler;
        if (existingHandler) {
            item.removeEventListener('dragstart', existingHandler);
        }
        
        // Add drag event listeners
        const dragHandler = (e) => this.handleTreeDragStart(e);
        item._dragHandler = dragHandler;
        
        item.addEventListener('dragstart', dragHandler);
        item.addEventListener('dragover', (e) => this.handleTreeDragOver(e));
        item.addEventListener('dragenter', (e) => this.handleTreeDragEnter(e));
        item.addEventListener('dragleave', (e) => this.handleTreeDragLeave(e));
        item.addEventListener('drop', (e) => this.handleTreeDrop(e));
        item.addEventListener('dragend', (e) => this.handleTreeDragEnd(e));
        
        // Add mousedown event to distinguish between click and drag
        item.addEventListener('mousedown', (e) => this.handleTreeMouseDown(e));
        
        // Prevent default drag behavior on the content element
        const contentElement = item.querySelector('.tree-item-content');
        if (contentElement) {
            contentElement.addEventListener('dragstart', (e) => {
                // Allow the parent item to handle the drag
                e.preventDefault();
            });
        }
    }

    handleTreeMouseDown(e) {
        // Track mouse position to detect drag vs click
        this.mouseDownPos = { x: e.clientX, y: e.clientY };
        this.mouseDownTime = Date.now();
        
        // Add mouse move and up listeners to detect drag intent
        const handleMouseMove = (e) => {
            const distance = Math.sqrt(
                Math.pow(e.clientX - this.mouseDownPos.x, 2) + 
                Math.pow(e.clientY - this.mouseDownPos.y, 2)
            );
            
            // If moved more than 5 pixels, it's likely a drag
            if (distance > 5) {
                this.isDragIntent = true;
            }
        };
        
        const handleMouseUp = () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            
            // Reset drag intent after a short delay
            setTimeout(() => {
                this.isDragIntent = false;
            }, 100);
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
    }

    // Smart click handlers that respect drag intent
    handleDocumentClick(documentId, event) {
        // If this was a drag intent, don't execute the click
        if (this.isDragIntent) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        
        // Small delay to ensure drag detection has completed
        setTimeout(() => {
            if (!this.isDragIntent) {
                this.toggleDocument(documentId);
            }
        }, 10);
    }

    handleImageClick(imageId, event) {
        // If this was a drag intent, don't execute the click
        if (this.isDragIntent) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        
        // Small delay to ensure drag detection has completed
        setTimeout(() => {
            if (!this.isDragIntent) {
                this.selectImage(imageId);
            }
        }, 10);
    }

    handleTreeDragStart(e) {
        // Stop click events from interfering with drag
        e.stopPropagation();
        
        const item = e.currentTarget;
        this.draggedTreeItem = {
            element: item,
            id: this.getTreeItemId(item),
            type: this.getTreeItemType(item),
            projectId: this.getTreeItemProjectId(item),
            documentId: this.getTreeItemDocumentId(item)
        };
        
        // Add dragging state
        item.classList.add('dragging');
        
        // Create a smooth drag ghost image
        this.createDragGhost(item, e);
        
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/html', item.outerHTML);
        
        // Add body class for global drag state
        document.body.classList.add('tree-dragging');
    }

    handleTreeDragOver(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const targetItem = e.currentTarget;
        const targetType = this.getTreeItemType(targetItem);
        
        if (!this.isValidDropTarget(targetItem)) {
            e.dataTransfer.dropEffect = 'none';
            this.clearSlidingAnimations();
            return;
        }
        
        e.dataTransfer.dropEffect = 'move';
        
        // Clear previous indicators
        this.clearTreeDragVisualIndicators();
        
        const rect = targetItem.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        const mouseY = e.clientY;
        
        const insertAbove = mouseY < midpoint;
        this.treeDropPosition = insertAbove ? 'above' : 'below';
        
        // Add drop indicators
        if (insertAbove) {
            targetItem.classList.add('tree-drag-insert-above');
        } else {
            targetItem.classList.add('tree-drag-insert-below');
        }
        
        // Apply smooth sliding animations
        this.applySlidingAnimations(targetItem, insertAbove);
    }

    applySlidingAnimations(targetItem, insertAbove) {
        // Clear any existing sliding animations
        this.clearSlidingAnimations();
        
        // Get all sibling items at the same level
        const siblings = this.getSiblingItems(targetItem);
        const targetIndex = siblings.indexOf(targetItem);
        const draggedElement = this.draggedTreeItem.element;
        const draggedIndex = siblings.indexOf(draggedElement);
        
        if (draggedIndex === -1 || targetIndex === -1) return;
        
        // Calculate new position for dragged item
        let newIndex = insertAbove ? targetIndex : targetIndex + 1;
        
        // Apply sliding transformations
        siblings.forEach((item, index) => {
            if (item === draggedElement) return; // Skip the dragged item
            
            let translateY = 0;
            
            if (draggedIndex < newIndex) {
                // Dragging down: items between old and new position slide up
                if (index > draggedIndex && index < newIndex) {
                    translateY = -draggedElement.offsetHeight - 4; // Item height + margin
                }
            } else {
                // Dragging up: items between new and old position slide down
                if (index >= newIndex && index < draggedIndex) {
                    translateY = draggedElement.offsetHeight + 4; // Item height + margin
                }
            }
            
            if (translateY !== 0) {
                item.style.transform = `translateY(${translateY}px)`;
                item.style.transition = 'transform 0.3s ease';
                item.classList.add('sliding');
            }
        });
    }

    getSiblingItems(item) {
        const itemType = this.getTreeItemType(item);
        
        if (itemType === 'project') {
            return Array.from(document.querySelectorAll('.project-item'));
        } else if (itemType === 'document') {
            // Get documents within the same project
            const projectItem = item.closest('.project-item');
            return Array.from(projectItem.querySelectorAll('.document-item'));
        } else if (itemType === 'image') {
            // Get images within the same document
            const documentItem = item.closest('.document-item');
            return Array.from(documentItem.querySelectorAll('.image-item'));
        }
        
        return [];
    }

    clearSlidingAnimations() {
        const slidingItems = document.querySelectorAll('.sliding');
        slidingItems.forEach(item => {
            item.style.transform = '';
            item.style.transition = '';
            item.classList.remove('sliding');
        });
    }

    handleTreeDragEnter(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    handleTreeDragLeave(e) {
        e.preventDefault();
        e.stopPropagation();
        
        // Only clear if we're actually leaving the item
        if (!e.currentTarget.contains(e.relatedTarget)) {
            e.currentTarget.classList.remove('tree-drag-insert-above', 'tree-drag-insert-below');
            // Clear sliding animations when leaving the drag area
            this.clearSlidingAnimations();
        }
    }

    async handleTreeDrop(e) {
        e.preventDefault();
        e.stopPropagation();
        
        const targetItem = e.currentTarget;
        this.clearTreeDragVisualIndicators();
        
        if (!this.isValidDropTarget(targetItem)) {
            return;
        }
        
        const targetId = this.getTreeItemId(targetItem);
        const targetType = this.getTreeItemType(targetItem);
        
        if (this.draggedTreeItem.id === targetId) {
            return; // Can't drop on self
        }
        
        try {
            // Add success animation before refresh
            this.addMoveSuccessAnimation(this.draggedTreeItem.element);
            
            await this.performTreeMove(targetItem, targetType);
            await this.loadProjects(); // Refresh the tree
            
            this.showAlert('Item moved successfully!', 'success');
        } catch (error) {
            console.error('Error moving tree item:', error);
            this.showAlert('Error moving item: ' + error.message, 'error');
        }
    }

    handleTreeDragEnd(e) {
        const item = e.currentTarget;
        item.classList.remove('dragging');
        this.clearTreeDragVisualIndicators();
        this.clearSlidingAnimations();
        
        // Remove global drag state
        document.body.classList.remove('tree-dragging');
        
        // Clean up
        this.draggedTreeItem = null;
        this.treeDropPosition = null;
        
        // Remove any temporary styles
        if (this.dragGhost) {
            this.dragGhost.remove();
            this.dragGhost = null;
        }
    }

    createDragGhost(item, e) {
        // Create a custom drag ghost for smoother visuals
        const ghost = item.cloneNode(true);
        ghost.style.position = 'absolute';
        ghost.style.top = '-1000px';
        ghost.style.left = '-1000px';
        ghost.style.width = item.offsetWidth + 'px';
        ghost.style.opacity = '0.8';
        ghost.style.transform = 'rotate(3deg)';
        ghost.style.boxShadow = '0 8px 24px rgba(0,0,0,0.3)';
        ghost.style.borderRadius = '6px';
        ghost.style.border = '2px solid #0066cc';
        ghost.style.backgroundColor = '#f8f9fa';
        ghost.style.zIndex = '9999';
        
        document.body.appendChild(ghost);
        this.dragGhost = ghost;
        
        // Set the custom drag image
        if (e.dataTransfer.setDragImage) {
            e.dataTransfer.setDragImage(ghost, e.offsetX, e.offsetY);
        }
    }

    addMoveSuccessAnimation(element) {
        // Add success animation
        element.classList.add('move-success');
        
        // Remove the class after animation completes
        setTimeout(() => {
            element.classList.remove('move-success');
        }, 600);
    }

    clearTreeDragVisualIndicators() {
        const allItems = document.querySelectorAll('.tree-item');
        allItems.forEach(item => {
            item.classList.remove('tree-drag-insert-above', 'tree-drag-insert-below');
        });
    }

    // Helper methods for tree drag and drop
    getTreeItemId(item) {
        if (item.classList.contains('project-item')) {
            return item.dataset.projectId;
        } else if (item.classList.contains('document-item')) {
            return item.dataset.documentId;
        } else if (item.classList.contains('image-item')) {
            return item.dataset.imageId;
        }
        return null;
    }

    getTreeItemType(item) {
        if (item.classList.contains('project-item')) {
            return 'project';
        } else if (item.classList.contains('document-item')) {
            return 'document';
        } else if (item.classList.contains('image-item')) {
            return 'image';
        }
        return null;
    }

    getTreeItemProjectId(item) {
        if (item.classList.contains('project-item')) {
            return item.dataset.projectId;
        } else if (item.classList.contains('document-item')) {
            // Find parent project
            const projectItem = item.closest('.project-item');
            return projectItem ? projectItem.dataset.projectId : null;
        } else if (item.classList.contains('image-item')) {
            // Find parent project
            const projectItem = item.closest('.project-item');
            return projectItem ? projectItem.dataset.projectId : null;
        }
        return null;
    }

    getTreeItemDocumentId(item) {
        if (item.classList.contains('document-item')) {
            return item.dataset.documentId;
        } else if (item.classList.contains('image-item')) {
            // Find parent document
            const documentItem = item.closest('.document-item');
            return documentItem ? documentItem.dataset.documentId : null;
        }
        return null;
    }

    isValidDropTarget(targetItem) {
        if (!this.draggedTreeItem) return false;
        
        const draggedType = this.draggedTreeItem.type;
        const targetType = this.getTreeItemType(targetItem);
        
        // Define valid drop combinations
        const validCombinations = {
            'project': ['project'], // Projects can be dropped on other projects (reordering)
            'document': ['document', 'project'], // Documents can be dropped on documents (reordering) or projects (moving)
            'image': ['image', 'document'] // Images can be dropped on images (reordering) or documents (moving)
        };
        
        return validCombinations[draggedType]?.includes(targetType) || false;
    }

    async performTreeMove(targetItem, targetType) {
        const draggedType = this.draggedTreeItem.type;
        const draggedId = this.draggedTreeItem.id;
        const targetId = this.getTreeItemId(targetItem);
        
        if (draggedType === 'project' && targetType === 'project') {
            // Reorder projects
            await this.reorderProjects(draggedId, targetId);
        } else if (draggedType === 'document' && targetType === 'document') {
            // Reorder documents within same project
            await this.reorderDocuments(draggedId, targetId);
        } else if (draggedType === 'document' && targetType === 'project') {
            // Move document to different project
            await this.moveDocumentToProject(draggedId, targetId);
        } else if (draggedType === 'image' && targetType === 'image') {
            // Reorder images within same document
            await this.reorderImages(draggedId, targetId);
        } else if (draggedType === 'image' && targetType === 'document') {
            // Move image to different document
            await this.moveImageToDocument(draggedId, targetId);
        }
    }

    // API methods for reordering and moving
    async reorderProjects(draggedId, targetId) {
        // Get all projects to calculate new orders
        const projectItems = Array.from(document.querySelectorAll('.project-item'));
        const projects = projectItems.map((item, index) => ({
            id: item.dataset.projectId,
            order: index
        }));
        
        // Find current positions
        const draggedIndex = projects.findIndex(p => p.id === draggedId);
        const targetIndex = projects.findIndex(p => p.id === targetId);
        
        if (draggedIndex === -1 || targetIndex === -1) return;
        
        // Remove dragged project and insert at new position
        const [draggedProject] = projects.splice(draggedIndex, 1);
        const insertIndex = this.treeDropPosition === 'above' ? targetIndex : targetIndex + 1;
        projects.splice(insertIndex, 0, draggedProject);
        
        // Update orders
        projects.forEach((project, index) => {
            project.order = index;
        });
        
        // Send to API
        const response = await fetch('/api/projects/reorder/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ projects })
        });
        
        if (!response.ok) {
            throw new Error('Failed to reorder projects');
        }
    }

    async reorderDocuments(draggedId, targetId) {
        const projectId = this.draggedTreeItem.projectId;
        if (!projectId) throw new Error('Project ID not found');
        
        // Get all document items within the same project
        const projectElement = document.querySelector(`[data-project-id="${projectId}"]`);
        const documentItems = Array.from(projectElement.querySelectorAll('.document-item'));
        
        const documents = documentItems.map((item, index) => ({
            id: item.dataset.documentId,
            reading_order: index
        }));
        
        // Find positions and reorder
        const draggedIndex = documents.findIndex(d => d.id === draggedId);
        const targetIndex = documents.findIndex(d => d.id === targetId);
        
        if (draggedIndex === -1 || targetIndex === -1) return;
        
        const [draggedDocument] = documents.splice(draggedIndex, 1);
        const insertIndex = this.treeDropPosition === 'above' ? targetIndex : targetIndex + 1;
        documents.splice(insertIndex, 0, draggedDocument);
        
        // Update reading orders
        documents.forEach((document, index) => {
            document.reading_order = index;
        });
        
        // Send to API
        const response = await fetch('/api/documents/reorder/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ 
                documents,
                project_id: projectId
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to reorder documents');
        }
    }

    async moveDocumentToProject(documentId, targetProjectId) {
        const response = await fetch(`/api/projects/${targetProjectId}/move_document/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ 
                document_id: documentId,
                order: 0 // Place at beginning for now
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to move document');
        }
    }

    async reorderImages(draggedId, targetId) {
        const documentId = this.draggedTreeItem.documentId;
        if (!documentId) throw new Error('Document ID not found');
        
        // Get all image items within the same document
        const documentElement = document.querySelector(`[data-document-id="${documentId}"]`);
        const imageItems = Array.from(documentElement.querySelectorAll('.image-item'));
        
        const images = imageItems.map((item, index) => ({
            id: item.dataset.imageId,
            order: index
        }));
        
        // Find positions and reorder
        const draggedIndex = images.findIndex(i => i.id === draggedId);
        const targetIndex = images.findIndex(i => i.id === targetId);
        
        if (draggedIndex === -1 || targetIndex === -1) return;
        
        const [draggedImage] = images.splice(draggedIndex, 1);
        const insertIndex = this.treeDropPosition === 'above' ? targetIndex : targetIndex + 1;
        images.splice(insertIndex, 0, draggedImage);
        
        // Update orders
        images.forEach((image, index) => {
            image.order = index;
        });
        
        // Send to API
        const response = await fetch('/api/images/reorder/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ 
                images,
                document_id: documentId
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to reorder images');
        }
    }

    async moveImageToDocument(imageId, targetDocumentId) {
        const response = await fetch(`/api/documents/${targetDocumentId}/move_image/`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Token ${localStorage.getItem('authToken')}`
            },
            body: JSON.stringify({ 
                image_id: imageId,
                order: 0 // Place at beginning for now
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to move image');
        }
    }

    // New Professional Interface Methods

    startRename(type, id, element) {
        const currentName = element.textContent;
        
        // Create input field
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentName;
        input.className = 'form-control form-control-sm tree-rename-input';
        input.style.fontSize = '14px';
        input.style.padding = '2px 6px';
        
        // Replace text with input
        element.style.display = 'none';
        element.parentNode.insertBefore(input, element.nextSibling);
        
        // Focus and select all text
        input.focus();
        input.select();
        
        // Handle save on Enter or blur
        const saveRename = async () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                try {
                    await this.saveRename(type, id, newName);
                    element.textContent = newName;
                    this.showAlert(`${type.charAt(0).toUpperCase() + type.slice(1)} renamed successfully!`, 'success');
                } catch (error) {
                    this.showAlert(`Failed to rename ${type}: ${error.message}`, 'error');
                }
            }
            
            // Restore original element
            element.style.display = '';
            input.remove();
        };
        
        // Handle cancel on Escape
        const cancelRename = () => {
            element.style.display = '';
            input.remove();
        };
        
        input.addEventListener('blur', saveRename);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveRename();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelRename();
            }
        });
    }

    async saveRename(type, id, newName) {
        if (this.isBrowserCacheMode) {
            // Handle browser cache mode
            try {
                const storeNames = {
                    'project': 'projects',
                    'document': 'documents',
                    'image': 'images'
                };
                
                const storeName = storeNames[type];
                if (!storeName) {
                    throw new Error(`Unknown item type: ${type}`);
                }
                
                // Get the current item
                const item = await this.localStorage.get(storeName, id);
                if (!item) {
                    throw new Error(`${type.charAt(0).toUpperCase() + type.slice(1)} not found`);
                }
                
                // Update the name
                item.name = newName;
                item.updated_at = new Date().toISOString();
                
                // Save back to browser cache
                await this.localStorage.update(storeName, item);
                
                return item;
            } catch (error) {
                throw new Error(error.message || 'Failed to rename item');
            }
        } else {
            // Handle server mode
            const endpoints = {
                'project': `/api/projects/${id}/`,
                'document': `/api/documents/${id}/`,
                'image': `/api/images/${id}/`
            };
            
            const response = await fetch(endpoints[type], {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Token ${localStorage.getItem('authToken')}`
                },
                body: JSON.stringify({ name: newName })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to rename item');
            }
            
            return response.json();
        }
    }

    async moveItem(type, id, direction) {
        try {
            await this.performSimpleMove(type, id, direction);
            
            // Only reload projects for project moves to preserve expanded state
            if (type === 'project') {
                await this.loadProjects();
            }
            // For documents and images, the order change will be visible on next expand
            
            this.showAlert(`${type.charAt(0).toUpperCase() + type.slice(1)} moved ${direction} successfully!`, 'success');
        } catch (error) {
            this.showAlert(`Failed to move ${type}: ${error.message}`, 'error');
        }
    }

    async performSimpleMove(type, id, direction) {
        // Get current siblings and find positions
        const siblings = this.getCurrentSiblings(type, id);
        
        if (!siblings || siblings.length <= 1) {
            return;
        }
        
        const currentIndex = siblings.findIndex(item => this.getItemId(item, type) === id);
        
        if (currentIndex === -1) {
            return;
        }
        
        let newIndex;
        if (direction === 'up') {
            newIndex = Math.max(0, currentIndex - 1);
        } else {
            newIndex = Math.min(siblings.length - 1, currentIndex + 1);
        }
        
        if (newIndex === currentIndex) return; // No movement needed
        
        // Reorder the array
        const [movedItem] = siblings.splice(currentIndex, 1);
        siblings.splice(newIndex, 0, movedItem);
        
        // Send to appropriate API
        await this.sendReorderData(type, siblings, id);
    }

    getCurrentSiblings(type, id) {
        switch (type) {
            case 'project':
                return Array.from(document.querySelectorAll('.project-item'));
            case 'document':
                const projectId = this.getProjectIdForDocument(id);
                const projectElement = document.querySelector(`[data-project-id="${projectId}"]`);
                return Array.from(projectElement.querySelectorAll('.document-item'));
            case 'image':
                const documentId = this.getDocumentIdForImage(id);
                const documentElement = document.querySelector(`[data-document-id="${documentId}"]`);
                const imageItems = documentElement ? Array.from(documentElement.querySelectorAll('.image-item')) : [];
                return imageItems;
            default:
                return [];
        }
    }

    getItemId(element, type) {
        switch (type) {
            case 'project': return element.dataset.projectId;
            case 'document': return element.dataset.documentId;
            case 'image': return element.dataset.imageId;
            default: return null;
        }
    }

    getProjectIdForDocument(documentId) {
        const documentElement = document.querySelector(`[data-document-id="${documentId}"]`);
        return documentElement?.closest('.project-item')?.dataset.projectId;
    }

    getDocumentIdForImage(imageId) {
        const imageElement = document.querySelector(`[data-image-id="${imageId}"]`);
        
        // First try to get document ID directly from the image element
        if (imageElement?.dataset.documentId) {
            return imageElement.dataset.documentId;
        }
        
        // Fallback to finding the closest document item
        const documentId = imageElement?.closest('.document-item')?.dataset.documentId;
        if (!documentId) {
            console.error('Could not find document ID for image:', imageId, 'Image element:', imageElement);
        }
        return documentId;
    }

    isValidUUID(uuid) {
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        return uuidRegex.test(uuid);
    }

    async sendReorderData(type, siblings, movedItemId) {
        if (this.isBrowserCacheMode) {
            // Handle browser cache mode reordering
            switch (type) {
                case 'project':
                    const projectUpdates = siblings.map((item, index) => ({
                        id: item.dataset.projectId,
                        order: index
                    }));
                    
                    for (const update of projectUpdates) {
                        const project = await this.localStorage.get('projects', update.id);
                        if (project) {
                            project.order = update.order;
                            project.updated_at = new Date().toISOString();
                            await this.localStorage.update('projects', project);
                        }
                    }
                    break;
                    
                case 'document':
                    const documentUpdates = siblings.map((item, index) => ({
                        id: item.dataset.documentId,
                        reading_order: index
                    }));
                    
                    for (const update of documentUpdates) {
                        const document = await this.localStorage.get('documents', update.id);
                        if (document) {
                            document.reading_order = update.reading_order;
                            document.updated_at = new Date().toISOString();
                            await this.localStorage.update('documents', document);
                        }
                    }
                    break;
                    
                case 'image':
                    const imageUpdates = siblings.map((item, index) => ({
                        id: item.dataset.imageId,
                        order: index
                    }));
                    
                    for (const update of imageUpdates) {
                        const image = await this.localStorage.get('images', update.id);
                        if (image) {
                            image.order = update.order;
                            image.updated_at = new Date().toISOString();
                            await this.localStorage.update('images', image);
                        }
                    }
                    break;
            }
        } else {
            // Handle server mode reordering
            switch (type) {
                case 'project':
                    const projects = siblings.map((item, index) => ({
                        id: item.dataset.projectId,
                        order: index
                    }));
                    
                    const projectResponse = await fetch('/api/projects/reorder/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${localStorage.getItem('authToken')}`
                        },
                        body: JSON.stringify({ projects })
                    });
                    
                    if (!projectResponse.ok) throw new Error('Failed to reorder projects');
                    break;
                    
                case 'document':
                    const projectId = this.getProjectIdForDocument(movedItemId);
                    const documents = siblings.map((item, index) => ({
                        id: item.dataset.documentId,
                        reading_order: index
                    }));
                    
                    console.log('Document reorder data:', { documents, project_id: projectId });
                    console.log('ProjectId for document', movedItemId, ':', projectId);
                    console.log('Documents array:', documents);
                    
                    const documentResponse = await fetch('/api/documents/reorder/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${localStorage.getItem('authToken')}`
                        },
                        body: JSON.stringify({ documents, project_id: projectId })
                    });
                    
                    if (!documentResponse.ok) {
                        const errorText = await documentResponse.text();
                        console.error('Document reorder error:', errorText);
                        throw new Error('Failed to reorder documents');
                    }
                    break;
                    
                case 'image':
                    const documentId = this.getDocumentIdForImage(movedItemId);
                    const images = siblings.map((item, index) => ({
                        id: item.dataset.imageId,
                        order: index
                    }));
                    
                    if (!documentId) {
                        throw new Error('Document ID not found for image reordering');
                    }
                    
                    if (!this.isValidUUID(documentId)) {
                        console.error('Invalid document ID:', documentId, 'for image:', movedItemId);
                        console.error('Image element:', document.querySelector(`[data-image-id="${movedItemId}"]`));
                        throw new Error(`Invalid document ID format: ${documentId}`);
                    }
                    
                    const imageResponse = await fetch('/api/images/reorder/', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${localStorage.getItem('authToken')}`
                        },
                        body: JSON.stringify({ images, document_id: documentId })
                    });
                    
                    if (!imageResponse.ok) {
                        const errorData = await imageResponse.json();
                        throw new Error(`Failed to reorder images: ${errorData.error || 'Unknown error'}`);
                    }
                    break;
            }
        }
    }

    showEditStructureModal() {
        // Create and show the edit structure modal
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'editStructureModal';
        modal.setAttribute('tabindex', '-1');
        
        modal.innerHTML = `
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">
                            <i class="fas fa-edit me-2"></i>Edit Project Structure
                        </h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="row">
                            <div class="col-md-4">
                                <div class="structure-section">
                                    <h6 class="section-title">
                                        <i class="fas fa-folder text-warning"></i> Projects
                                    </h6>
                                    <div id="structureProjects" class="structure-list"></div>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="structure-section">
                                    <h6 class="section-title">
                                        <i class="fas fa-file-alt text-primary"></i> Documents
                                    </h6>
                                    <div id="structureDocuments" class="structure-list">
                                        <div class="text-muted text-center p-3">Select a project to view documents</div>
                                    </div>
                                </div>
                            </div>
                            <div class="col-md-4">
                                <div class="structure-section">
                                    <h6 class="section-title">
                                        <i class="fas fa-image text-success"></i> Images
                                    </h6>
                                    <div id="structureImages" class="structure-list">
                                        <div class="text-muted text-center p-3">Select a document to view images</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        <button type="button" class="btn btn-primary" onclick="app.saveStructureChanges()">Save Changes</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Initialize Bootstrap modal
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
        
        // Load structure data
        this.loadStructureData();
        
        // Clean up when modal is hidden
        modal.addEventListener('hidden.bs.modal', () => {
            modal.remove();
        });
    }

    async loadStructureData() {
        try {
            if (this.isBrowserCacheMode) {
                // Load projects from browser cache
                const projects = await this.localStorage.getAll('projects');
                // Sort by order
                projects.sort((a, b) => (a.order || 0) - (b.order || 0));
                this.renderStructureProjects(projects);
            } else {
                // Load projects from server
                const response = await fetch('/api/projects/', {
                    headers: {
                        'Authorization': `Token ${localStorage.getItem('authToken')}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.renderStructureProjects(data.results);
                }
            }
        } catch (error) {
            console.error('Error loading structure data:', error);
        }
    }

    renderStructureProjects(projects) {
        const container = document.getElementById('structureProjects');
        container.innerHTML = '';
        
        projects.forEach(project => {
            const projectItem = document.createElement('div');
            projectItem.className = 'structure-item project-structure-item';
            projectItem.dataset.projectId = project.id;
            
            projectItem.innerHTML = `
                <div class="structure-item-content" onclick="app.selectStructureProject('${project.id}')">
                    <i class="fas fa-folder structure-icon"></i>
                    <span class="structure-text">${project.name}</span>
                    <div class="structure-controls">
                        <button class="btn btn-xs btn-outline-primary" onclick="event.stopPropagation(); app.structureMove('project', '${project.id}', 'up')" title="Move Up">
                            <i class="fas fa-arrow-up"></i>
                        </button>
                        <button class="btn btn-xs btn-outline-primary" onclick="event.stopPropagation(); app.structureMove('project', '${project.id}', 'down')" title="Move Down">
                            <i class="fas fa-arrow-down"></i>
                        </button>
                    </div>
                </div>
            `;
            
            container.appendChild(projectItem);
        });
    }

    async selectStructureProject(projectId) {
        // Highlight selected project
        document.querySelectorAll('.project-structure-item').forEach(item => {
            item.classList.remove('selected');
        });
        document.querySelector(`[data-project-id="${projectId}"]`).classList.add('selected');
        
        // Load documents for this project
        try {
            if (this.isBrowserCacheMode) {
                // Load documents from browser cache
                const documents = await this.localStorage.getAll('documents', 'project_id', projectId);
                // Sort by reading_order
                documents.sort((a, b) => (a.reading_order || 0) - (b.reading_order || 0));
                this.renderStructureDocuments(documents, projectId);
            } else {
                // Load documents from server
                const response = await fetch(`/api/documents/?project=${projectId}`, {
                    headers: {
                        'Authorization': `Token ${localStorage.getItem('authToken')}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.renderStructureDocuments(data.results, projectId);
                }
            }
        } catch (error) {
            console.error('Error loading documents:', error);
        }
        
        // Clear images section
        document.getElementById('structureImages').innerHTML = '<div class="text-muted text-center p-3">Select a document to view images</div>';
    }

    renderStructureDocuments(documents, projectId) {
        const container = document.getElementById('structureDocuments');
        container.innerHTML = '';
        
        if (documents.length === 0) {
            container.innerHTML = '<div class="text-muted text-center p-3">No documents in this project</div>';
            return;
        }
        
        documents.forEach(doc => {
            const documentItem = document.createElement('div');
            documentItem.className = 'structure-item document-structure-item';
            documentItem.dataset.documentId = doc.id;
            documentItem.dataset.projectId = projectId;
            
            documentItem.innerHTML = `
                <div class="structure-item-content" onclick="app.selectStructureDocument('${doc.id}')">
                    <i class="fas fa-file-alt structure-icon"></i>
                    <span class="structure-text">${doc.name}</span>
                    <div class="structure-controls">
                        <button class="btn btn-xs btn-outline-primary" onclick="event.stopPropagation(); app.structureMove('document', '${doc.id}', 'up')" title="Move Up">
                            <i class="fas fa-arrow-up"></i>
                        </button>
                        <button class="btn btn-xs btn-outline-primary" onclick="event.stopPropagation(); app.structureMove('document', '${doc.id}', 'down')" title="Move Down">
                            <i class="fas fa-arrow-down"></i>
                        </button>
                        <button class="btn btn-xs btn-outline-warning" onclick="event.stopPropagation(); app.moveToProject('${doc.id}')" title="Move to Different Project">
                            <i class="fas fa-exchange-alt"></i>
                        </button>
                    </div>
                </div>
            `;
            
            container.appendChild(documentItem);
        });
    }

    async selectStructureDocument(documentId) {
        // Highlight selected document
        document.querySelectorAll('.document-structure-item').forEach(item => {
            item.classList.remove('selected');
        });
        document.querySelector(`[data-document-id="${documentId}"]`).classList.add('selected');
        
        // Load images for this document
        try {
            if (this.isBrowserCacheMode) {
                // Load images from browser cache
                const images = await this.localStorage.getAll('images', 'document_id', documentId);
                // Sort by order
                images.sort((a, b) => (a.order || 0) - (b.order || 0));
                this.renderStructureImages(images, documentId);
            } else {
                // Load images from server
                const response = await fetch(`/api/images/?document=${documentId}&_t=${Date.now()}`, {
                    headers: {
                        'Authorization': `Token ${localStorage.getItem('authToken')}`
                    }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    this.renderStructureImages(data.results, documentId);
                }
            }
        } catch (error) {
            console.error('Error loading images:', error);
        }
    }

    renderStructureImages(images, documentId) {
        const container = document.getElementById('structureImages');
        container.innerHTML = '';
        
        if (images.length === 0) {
            container.innerHTML = '<div class="text-muted text-center p-3">No images in this document</div>';
            return;
        }
        
        images.forEach(image => {
            const imageItem = document.createElement('div');
            imageItem.className = 'structure-item image-structure-item';
            imageItem.dataset.imageId = image.id;
            imageItem.dataset.documentId = documentId;
            
            imageItem.innerHTML = `
                <div class="structure-item-content">
                    <i class="fas fa-image structure-icon"></i>
                    <span class="structure-text">${image.name}</span>
                    <div class="structure-controls">
                        <button class="btn btn-xs btn-outline-primary" onclick="app.structureMove('image', '${image.id}', 'up')" title="Move Up">
                            <i class="fas fa-arrow-up"></i>
                        </button>
                        <button class="btn btn-xs btn-outline-primary" onclick="app.structureMove('image', '${image.id}', 'down')" title="Move Down">
                            <i class="fas fa-arrow-down"></i>
                        </button>
                        <button class="btn btn-xs btn-outline-warning" onclick="app.moveToDocument('${image.id}')" title="Move to Different Document">
                            <i class="fas fa-exchange-alt"></i>
                        </button>
                    </div>
                </div>
            `;
            
            container.appendChild(imageItem);
        });
    }

    async structureMove(type, id, direction) {
        try {
            // Structure modal has different DOM, so we need custom logic
            await this.performStructureMove(type, id, direction);
            
            // Refresh the current view
            if (type === 'project') {
                await this.loadStructureData();
            } else if (type === 'document') {
                const projectId = document.querySelector(`[data-document-id="${id}"]`).dataset.projectId;
                await this.selectStructureProject(projectId);
            } else if (type === 'image') {
                const documentId = document.querySelector(`[data-image-id="${id}"]`).dataset.documentId;
                await this.selectStructureDocument(documentId);
            }
            this.showAlert(`${type.charAt(0).toUpperCase() + type.slice(1)} moved ${direction}!`, 'success');
        } catch (error) {
            this.showAlert(`Failed to move ${type}: ${error.message}`, 'error');
        }
    }

    async performStructureMove(type, id, direction) {
        // Get siblings from structure modal
        let siblings;
        switch (type) {
            case 'project':
                siblings = Array.from(document.querySelectorAll('.project-structure-item'));
                break;
            case 'document':
                siblings = Array.from(document.querySelectorAll('.document-structure-item'));
                break;
            case 'image':
                siblings = Array.from(document.querySelectorAll('.image-structure-item'));
                break;
            default:
                throw new Error(`Unknown type: ${type}`);
        }
        
        if (!siblings || siblings.length <= 1) {
            return;
        }
        
        const currentIndex = siblings.findIndex(item => this.getItemId(item, type) === id);
        
        if (currentIndex === -1) {
            return;
        }
        
        let newIndex;
        if (direction === 'up') {
            newIndex = Math.max(0, currentIndex - 1);
        } else {
            newIndex = Math.min(siblings.length - 1, currentIndex + 1);
        }
        
        if (newIndex === currentIndex) return; // No movement needed
        
        // Reorder the array
        const [movedItem] = siblings.splice(currentIndex, 1);
        siblings.splice(newIndex, 0, movedItem);
        
        // Send to appropriate API
        await this.sendReorderData(type, siblings, id);
    }

    saveStructureChanges() {
        // Close modal and refresh main tree
        const modal = bootstrap.Modal.getInstance(document.getElementById('editStructureModal'));
        modal.hide();
        this.loadProjects();
        this.showAlert('Structure changes saved!', 'success');
    }

    moveToProject(documentId) {
        // Show modal to select target project
        this.showMoveToProjectModal(documentId);
    }

    moveToDocument(imageId) {
        console.log('moveToDocument called for image:', imageId);
        // Show modal to select target document
        this.showMoveToDocumentModal(imageId);
    }

    showMoveToProjectModal(documentId) {
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'moveToProjectModal';
        
        modal.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Move Document to Project</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label">Select Target Project:</label>
                            <select class="form-select" id="targetProjectSelect">
                                <option value="">Loading projects...</option>
                            </select>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="app.confirmMoveToProject('${documentId}')">Move Document</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        const bsModal = new bootstrap.Modal(modal);
        bsModal.show();
        
        // Load projects for selection
        this.loadProjectsForMove(documentId);
        
        modal.addEventListener('hidden.bs.modal', () => modal.remove());
    }

    showMoveToDocumentModal(imageId) {
        console.log('showMoveToDocumentModal called for image:', imageId);
        
        // Remove any existing modal first
        const existingModal = document.getElementById('moveToDocumentModal');
        if (existingModal) {
            existingModal.remove();
        }
        
        const modal = document.createElement('div');
        modal.className = 'modal fade';
        modal.id = 'moveToDocumentModal';
        
        modal.innerHTML = `
            <div class="modal-dialog">
                <div class="modal-content">
                    <div class="modal-header">
                        <h5 class="modal-title">Move Image to Document</h5>
                        <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                    </div>
                    <div class="modal-body">
                        <div class="mb-3">
                            <label class="form-label">Select Target Project:</label>
                            <select class="form-select" id="targetProjectSelectForImage" onchange="app.loadDocumentsForImageMove(this.value)">
                                <option value="">Select a project...</option>
                            </select>
                        </div>
                        <div class="mb-3">
                            <label class="form-label">Select Target Document:</label>
                            <select class="form-select" id="targetDocumentSelect" disabled>
                                <option value="">Select a project first...</option>
                            </select>
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                        <button type="button" class="btn btn-primary" onclick="app.confirmMoveToDocument('${imageId}')">Move Image</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Initialize Bootstrap modal
        let bsModal;
        try {
            bsModal = new bootstrap.Modal(modal);
            bsModal.show();
            console.log('Modal shown successfully');
        } catch (error) {
            console.error('Error creating Bootstrap modal:', error);
            // Fallback: show modal manually
            modal.style.display = 'block';
            modal.classList.add('show');
        }
        
        // Load projects for selection
        this.loadProjectsForImageMove();
        
        modal.addEventListener('hidden.bs.modal', () => modal.remove());
    }

    async loadProjectsForMove(excludeDocumentId) {
        try {
            let projects;
            if (this.isBrowserCacheMode) {
                // Load projects from browser cache
                projects = await this.localStorage.getAll('projects');
                projects.sort((a, b) => (a.order || 0) - (b.order || 0));
            } else {
                // Load projects from server
                const response = await fetch('/api/projects/', {
                    headers: { 'Authorization': `Token ${localStorage.getItem('authToken')}` }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    projects = data.results;
                } else {
                    throw new Error('Failed to load projects');
                }
            }
            
            const select = document.getElementById('targetProjectSelect');
            select.innerHTML = '<option value="">Select a project...</option>';
            
            projects.forEach(project => {
                select.innerHTML += `<option value="${project.id}">${project.name}</option>`;
            });
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    async loadProjectsForImageMove() {
        try {
            let projects;
            if (this.isBrowserCacheMode) {
                // Load projects from browser cache
                projects = await this.localStorage.getAll('projects');
                projects.sort((a, b) => (a.order || 0) - (b.order || 0));
            } else {
                // Load projects from server
                const response = await fetch('/api/projects/', {
                    headers: { 'Authorization': `Token ${localStorage.getItem('authToken')}` }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    projects = data.results;
                } else {
                    throw new Error('Failed to load projects');
                }
            }
            
            const select = document.getElementById('targetProjectSelectForImage');
            select.innerHTML = '<option value="">Select a project...</option>';
            
            projects.forEach(project => {
                select.innerHTML += `<option value="${project.id}">${project.name}</option>`;
            });
        } catch (error) {
            console.error('Error loading projects:', error);
        }
    }

    async loadDocumentsForImageMove(projectId) {
        const select = document.getElementById('targetDocumentSelect');
        
        if (!projectId) {
            select.innerHTML = '<option value="">Select a project first...</option>';
            select.disabled = true;
            return;
        }
        
        try {
            let documents;
            if (this.isBrowserCacheMode) {
                // Load documents from browser cache
                documents = await this.localStorage.getAll('documents', 'project_id', projectId);
                documents.sort((a, b) => (a.reading_order || 0) - (b.reading_order || 0));
            } else {
                // Load documents from server
                const response = await fetch(`/api/documents/?project=${projectId}`, {
                    headers: { 'Authorization': `Token ${localStorage.getItem('authToken')}` }
                });
                
                if (response.ok) {
                    const data = await response.json();
                    documents = data.results;
                } else {
                    throw new Error('Failed to load documents');
                }
            }
            
            select.innerHTML = '<option value="">Select a document...</option>';
            
            documents.forEach(doc => {
                select.innerHTML += `<option value="${doc.id}">${doc.name}</option>`;
            });
            
            select.disabled = false;
        } catch (error) {
            console.error('Error loading documents:', error);
        }
    }

    async confirmMoveToProject(documentId) {
        const targetProjectId = document.getElementById('targetProjectSelect').value;
        
        if (!targetProjectId) {
            this.showAlert('Please select a target project', 'warning');
            return;
        }
        
        try {
            if (this.isBrowserCacheMode) {
                // Handle browser cache mode
                const document = await this.localStorage.get('documents', documentId);
                if (!document) {
                    throw new Error('Document not found');
                }
                
                // Update the document's project_id
                document.project_id = targetProjectId;
                document.updated_at = new Date().toISOString();
                
                // Save the updated document
                await this.localStorage.update('documents', document);
                
                this.showAlert('Document moved successfully!', 'success');
            } else {
                // Handle server mode
                const response = await fetch(`/api/projects/${targetProjectId}/move_document/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${localStorage.getItem('authToken')}`
                    },
                    body: JSON.stringify({ document_id: documentId })
                });
                
                if (response.ok) {
                    this.showAlert('Document moved successfully!', 'success');
                } else {
                    const errorData = await response.json();
                    this.showAlert(`Failed to move document: ${errorData.error}`, 'error');
                    return;
                }
            }
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('moveToProjectModal'));
            modal.hide();
            this.loadStructureData(); // Refresh structure modal
            this.loadProjects(); // Refresh main tree
        } catch (error) {
            this.showAlert('Failed to move document', 'error');
        }
    }

    async confirmMoveToDocument(imageId) {
        const targetDocumentId = document.getElementById('targetDocumentSelect').value;
        
        if (!targetDocumentId) {
            this.showAlert('Please select a target document', 'warning');
            return;
        }
        
        try {
            if (this.isBrowserCacheMode) {
                // Handle browser cache mode
                const image = await this.localStorage.get('images', imageId);
                if (!image) {
                    throw new Error('Image not found');
                }
                
                // Update the image's document_id
                image.document_id = targetDocumentId;
                image.updated_at = new Date().toISOString();
                
                // Save the updated image
                await this.localStorage.update('images', image);
                
                this.showAlert('Image moved successfully!', 'success');
            } else {
                // Handle server mode
                const response = await fetch(`/api/documents/${targetDocumentId}/move_image/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${localStorage.getItem('authToken')}`
                    },
                    body: JSON.stringify({ image_id: imageId })
                });
                
                if (response.ok) {
                    this.showAlert('Image moved successfully!', 'success');
                } else {
                    const errorData = await response.json();
                    this.showAlert(`Failed to move image: ${errorData.error}`, 'error');
                    return;
                }
            }
            
            const modal = bootstrap.Modal.getInstance(document.getElementById('moveToDocumentModal'));
            modal.hide();
            
            // Refresh structure modal views
            const currentProjectId = document.querySelector('.project-structure-item.selected')?.dataset.projectId;
            const currentDocumentId = document.querySelector('.document-structure-item.selected')?.dataset.documentId;
            
            if (currentProjectId) {
                await this.selectStructureProject(currentProjectId);
                if (currentDocumentId) {
                    await this.selectStructureDocument(currentDocumentId);
                }
            }
        } catch (error) {
            console.error('Move image error:', error);
            this.showAlert('Failed to move image', 'error');
        }
    }

    async reorderTranscriptions(draggedId, targetId, insertAbove = false) {
        // Find all annotations sorted by reading order
        const sortedAnnotations = [...this.annotations]
            .sort((a, b) => {
                const orderA = a.reading_order !== undefined ? a.reading_order : 999999;
                const orderB = b.reading_order !== undefined ? b.reading_order : 999999;
                return orderA - orderB;
            });

        const draggedIndex = sortedAnnotations.findIndex(a => a.id === draggedId);
        const targetIndex = sortedAnnotations.findIndex(a => a.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1 || draggedIndex === targetIndex) return;

        // Remove the dragged annotation
        const [draggedAnnotation] = sortedAnnotations.splice(draggedIndex, 1);
        
        // Calculate the new target index after removal
        let newTargetIndex = targetIndex;
        if (draggedIndex < targetIndex) {
            newTargetIndex = targetIndex - 1;
        }
        
        // Insert above or below the target
        if (insertAbove) {
            sortedAnnotations.splice(newTargetIndex, 0, draggedAnnotation);
        } else {
            sortedAnnotations.splice(newTargetIndex + 1, 0, draggedAnnotation);
        }

        // Update reading orders for all annotations
        sortedAnnotations.forEach((annotation, index) => {
            annotation.reading_order = index;
            // Also update in the main annotations array
            const mainAnnotation = this.annotations.find(a => a.id === annotation.id);
            if (mainAnnotation) {
                mainAnnotation.reading_order = index;
            }
        });

        // Save to backend
        await this.saveAnnotationOrder();

        // Update UI
        this.updateAnnotationsList();
        this.updateCombinedTranscription();
    }

    async selectAnnotationFromTranscription(annotationId) {
        // Check for unsaved changes before switching selection
        if (this.currentlyEditingId && this.currentlyEditingId !== annotationId && this.hasUnsavedChanges) {
            const shouldProceed = await this.checkUnsavedChanges();
            if (!shouldProceed) {
                return; // User cancelled
            }
        }
        
        const annotation = this.annotations.find(a => a.id === annotationId);
        if (annotation && annotation.fabricObject) {
            // Clear current selection
            this.canvas.discardActiveObject();
            
            // Select the annotation
            this.canvas.setActiveObject(annotation.fabricObject);
            this.canvas.renderAll();
            
            // Update selected annotations
            this.selectedAnnotations = [annotationId];
            this.updateCombinedTranscription();
        }
    }

    async selectAnnotationFromItem(event, annotationId) {
        // Don't select if clicking on buttons or other interactive elements
        const target = event.target;
        if (target.tagName === 'BUTTON' || 
            target.tagName === 'I' || 
            target.tagName === 'TEXTAREA' ||
            target.closest('button') ||
            target.closest('.btn-group') ||
            target.closest('.transcription-edit-form') ||
            target.closest('.inline-edit-form')) {
            return;
        }

        // Check for unsaved changes before switching
        if (this.currentlyEditingId && this.currentlyEditingId !== annotationId && this.hasUnsavedChanges) {
            const shouldProceed = await this.checkUnsavedChanges();
            if (!shouldProceed) {
                return; // User cancelled, don't switch
            }
        }

        // Prevent event bubbling
        event.stopPropagation();
        
        // Select the annotation
        this.selectAnnotationFromTranscription(annotationId);
    }

    editTranscription(annotationId) {
        const textDiv = document.getElementById(`transcription-display-${annotationId}`);
        const editDiv = document.getElementById(`transcription-edit-${annotationId}`);
        
        if (textDiv && editDiv) {
            textDiv.style.display = 'none';
            editDiv.style.display = 'block';
            
            // Focus on textarea
            const textarea = document.getElementById(`transcription-textarea-${annotationId}`);
            if (textarea) {
                textarea.focus();
                textarea.select();
            }
        }
    }

    async saveTranscriptionEdit(annotationId) {
        const textarea = document.getElementById(`transcription-textarea-${annotationId}`);
        if (!textarea) return; // No transcription to save
        
        const newText = textarea.value.trim();
        
        // Allow empty transcriptions (user might want to clear it)
        try {
            const annotation = this.annotations.find(a => a.id === annotationId);
            if (!annotation) return true;
            
            // If no text provided, don't create/update anything
            if (!newText) {
                return true;
            }
            
            if (annotation.transcription) {
                // Update existing transcription
                if (this.isBrowserCacheMode) {
                    // Update transcription in browser cache
                    try {
                        annotation.transcription.text_content = newText;
                        
                        // Find and update the transcription in IndexedDB
                        const transcriptionId = annotation.transcription.id;
                        const transcription = await this.localStorage.get('transcriptions', transcriptionId);
                        if (transcription) {
                            transcription.text_content = newText;
                            transcription.updated_at = new Date().toISOString();
                            await this.localStorage.update('transcriptions', transcription);
                        }
                        
                        return true; // Indicate success
                    } catch (error) {
                        console.error('Failed to update transcription in browser cache:', error);
                        this.showAlert('Failed to update transcription', 'danger');
                        return false;
                    }
                } else {
                    // Update transcription in backend
                    const response = await fetch(`${this.apiBaseUrl}/transcriptions/${annotation.transcription.id}/`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${this.authToken}`
                        },
                        body: JSON.stringify({ text_content: newText })
                    });

                    if (response.ok) {
                        // Update local annotation
                        annotation.transcription.text_content = newText;
                        return true; // Indicate success
                    } else {
                        this.showAlert('Failed to update transcription', 'danger');
                        return false;
                    }
                }
            } else {
                // Create new transcription
                return await this.createManualTranscription(annotationId, newText);
            }
            return true;
        } catch (error) {
            console.error('Error updating transcription:', error);
            this.showAlert('Error updating transcription', 'danger');
            return false;
        }
    }

    async createManualTranscription(annotationId, textContent) {
        try {
            const annotation = this.annotations.find(a => a.id === annotationId);
            if (!annotation) return false;

            if (this.isBrowserCacheMode) {
                // Create transcription in browser cache
                const transcriptionData = {
                    image: this.currentImage.id,
                    annotation: annotationId,
                    transcription_type: 'annotation',
                    api_endpoint: 'manual',
                    api_model: 'manual_entry',
                    status: 'completed',
                    text_content: textContent,
                    confidence_score: null,
                    api_response_raw: null,
                    is_current: true,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };

                const savedTranscription = await this.localStorage.add('transcriptions', transcriptionData);
                
                // Update annotation with new transcription
                annotation.transcription = savedTranscription;
                
                return true;
            } else {
                // Create transcription on server via annotation update (more reliable than direct transcription creation)
                try {
                    const response = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/`, {
                        method: 'PATCH',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${this.authToken}`
                        },
                        body: JSON.stringify({
                            manual_transcription: textContent
                        })
                    });
                    
                    if (response.ok) {
                        // Create a local transcription object for the UI
                        const localTranscription = {
                            id: `manual_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                            text_content: textContent,
                            api_endpoint: 'manual',
                            api_model: 'manual_entry',
                            status: 'completed',
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        };
                        annotation.transcription = localTranscription;
                        return true;
                    } else {
                        const errorText = await response.text();
                        console.error('Failed to save manual transcription:', errorText);
                        this.showAlert('Failed to save transcription', 'danger');
                        return false;
                    }
                } catch (error) {
                    console.error('Error saving manual transcription:', error);
                    this.showAlert('Error saving transcription', 'danger');
                    return false;
                }
            }
        } catch (error) {
            console.error('Error creating manual transcription:', error);
            this.showAlert('Error creating transcription', 'danger');
            return false;
        }
    }

    cancelTranscriptionEdit(annotationId) {
        const textDiv = document.getElementById(`transcription-display-${annotationId}`);
        const editDiv = document.getElementById(`transcription-edit-${annotationId}`);
        
        if (editDiv) {
            // Reset textarea to original value
            const textarea = document.getElementById(`transcription-textarea-${annotationId}`);
            const annotation = this.annotations.find(a => a.id === annotationId);
            if (textarea) {
                if (annotation && annotation.transcription) {
                    textarea.value = annotation.transcription.text_content;
                } else {
                    // Clear textarea for annotations without transcriptions
                    textarea.value = '';
                }
            }
            
            // Only hide/show if not in inline editing mode
            const inlineEditForm = document.getElementById(`inline-edit-${annotationId}`);
            if (!inlineEditForm || inlineEditForm.style.display === 'none') {
                if (textDiv) textDiv.style.display = 'block';
                editDiv.style.display = 'none';
            }
        }
    }

    async transcribeAnnotationFromList(annotationId) {
        const credentials = this.getStoredCredentials();
        const provider = this.getActiveProvider();
        if (!provider) {
            this.showAlert('Please configure your API credentials first', 'warning');
            this.showCredentialsModal();
            return;
        }

        try {
            this.showAnnotationProgress(annotationId, true);
            await this.transcribeAnnotation(annotationId, credentials);
            this.showAlert('Annotation transcribed successfully!', 'success');
        } catch (error) {
            console.error('Annotation transcription error:', error);
            this.showAlert('Transcription failed', 'danger');
        } finally {
            this.showAnnotationProgress(annotationId, false);
        }
    }

    async removeTranscription(annotationId) {
        if (confirm('Are you sure you want to remove this transcription?')) {
            try {
                const annotation = this.annotations.find(a => a.id === annotationId);
                if (annotation && annotation.transcription) {
                    if (this.isBrowserCacheMode) {
                        // Delete from browser cache
                        await this.localStorage.delete('transcriptions', annotation.transcription.id);
                        
                        // Remove from local annotation
                        annotation.transcription = null;
                        this.updateCombinedTranscription();
                        this.showAlert('Transcription removed successfully', 'success');
                    } else {
                        // Remove transcription from backend
                        const response = await fetch(`${this.apiBaseUrl}/transcriptions/${annotation.transcription.id}/`, {
                            method: 'DELETE',
                            headers: {
                                'Authorization': `Token ${this.authToken}`
                            }
                        });

                        if (response.ok) {
                            // Remove from local annotation
                            annotation.transcription = null;
                            this.updateCombinedTranscription();
                            this.showAlert('Transcription removed successfully', 'success');
                        } else {
                            this.showAlert('Failed to remove transcription', 'danger');
                        }
                    }
                }
            } catch (error) {
                console.error('Error removing transcription:', error);
                this.showAlert('Error removing transcription', 'danger');
            }
        }
    }

    // Inline editing functions
    generateClassificationOptions(currentClassification) {
        let options = '';
        
        if (this.annotationTypes) {
            // Add zone types (including custom zones)
            if (this.userEnabledTypes.zones && this.userEnabledTypes.zones.length > 0) {
                options += '<optgroup label="Zone Types">';
                this.userEnabledTypes.zones.forEach(zoneCode => {
                    // First check built-in zones
                    let zoneType = this.annotationTypes.all_types.zones.find(z => z.value === zoneCode);
                    
                    // Then check custom zones
                    if (!zoneType) {
                        zoneType = this.customZones.find(z => z.value === zoneCode);
                    }
                    
                    if (zoneType) {
                        const selected = currentClassification === zoneType.value ? 'selected' : '';
                        options += `<option value="${zoneType.value}" ${selected}>${zoneType.label}</option>`;
                    }
                });
                options += '</optgroup>';
            }
            
            // Add line types
            if (this.userEnabledTypes.lines && this.userEnabledTypes.lines.length > 0) {
                options += '<optgroup label="Line Types">';
                this.userEnabledTypes.lines.forEach(lineCode => {
                    const lineType = this.annotationTypes.all_types.lines.find(l => l.value === lineCode);
                    if (lineType) {
                        const selected = currentClassification === lineType.value ? 'selected' : '';
                        options += `<option value="${lineType.value}" ${selected}>${lineType.label}</option>`;
                    }
                });
                options += '</optgroup>';
            }
        }
        
        return options;
    }
    
    generateInlineMetadataFields(annotation) {
        const metadataFields = this.getMetadataFieldsForClassification(annotation.classification);
        
        // Add existing metadata that's not in the template
        if (annotation.metadata && typeof annotation.metadata === 'object') {
            const existingKeys = Object.keys(annotation.metadata);
            const templateKeys = metadataFields.map(f => f.name);
            
            existingKeys.forEach(key => {
                if (!templateKeys.includes(key)) {
                    metadataFields.push({
                        name: key,
                        type: 'string',
                        default: 'unparsed'
                    });
                }
            });
        }
        
        return metadataFields.map(field => {
            const currentValue = annotation.metadata && annotation.metadata[field.name] !== undefined
                ? annotation.metadata[field.name] 
                : field.default;
                
            return this.createInlineMetadataFieldHtml(field, currentValue, annotation.id);
        }).join('');
    }
    
    createInlineMetadataFieldHtml(field, value, annotationId) {
        const fieldId = `inline-meta-${annotationId}-${field.name}`;
        const displayName = field.name.charAt(0).toUpperCase() + field.name.slice(1).replace(/_/g, ' ');
        const isUnparsed = field.default === 'unparsed' || (typeof value === 'object' && value !== null);
        
        switch (field.type) {
            case 'boolean':
                return `
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" id="${fieldId}" ${value ? 'checked' : ''}>
                        <label class="form-check-label small" for="${fieldId}">
                            ${displayName}
                            ${isUnparsed ? '<span class="badge bg-warning ms-1">unparsed</span>' : ''}
                        </label>
                    </div>
                `;
            case 'string':
                const stringValue = isUnparsed && typeof value === 'object' ? 'unparsed' : (value || '');
                const currentLength = stringValue.length;
                
                // Calculate rows based on content length
                // For content < 1000 chars, size to fit content with minimum of 3 rows
                // For content >= 1000 chars, start with size to accommodate ~1000 chars
                let rows;
                if (currentLength === 0) {
                    rows = 3; // Empty content
                } else if (currentLength < 1000) {
                    // Size to fit content, minimum 3 rows
                    rows = Math.max(3, Math.ceil(currentLength / 80));
                } else {
                    // Content is long, size for approximately 1000 characters
                    rows = Math.ceil(1000 / 80);
                }
                
                // Cap maximum rows at 15 for initial display
                rows = Math.min(rows, 15);
                
                return `
                    <div class="mb-1">
                        <label for="${fieldId}" class="form-label small">
                            ${displayName}
                            ${isUnparsed ? '<span class="badge bg-warning ms-1">unparsed</span>' : ''}
                        </label>
                        <textarea class="form-control form-control-sm expandable-text" 
                                  id="${fieldId}" rows="${rows}" 
                                  placeholder="Enter ${displayName.toLowerCase()}...">${stringValue}</textarea>
                    </div>
                `;
            case 'number':
                return `
                    <div class="mb-1">
                        <label for="${fieldId}" class="form-label small">
                            ${displayName}
                            ${isUnparsed ? '<span class="badge bg-warning ms-1">unparsed</span>' : ''}
                        </label>
                        <input type="number" class="form-control form-control-sm" 
                               id="${fieldId}" value="${value || ''}">
                    </div>
                `;
            default:
                return '';
        }
    }
    
    async toggleInlineEdit(annotationId) {
        const editForm = document.getElementById(`inline-edit-${annotationId}`);
        const metadataDisplay = document.getElementById(`metadata-display-${annotationId}`);
        const transcriptionDisplay = document.getElementById(`transcription-display-${annotationId}`);
        const transcriptionEdit = document.getElementById(`transcription-edit-${annotationId}`);
        const editButtons = document.getElementById(`edit-buttons-${annotationId}`);
        const editBtn = document.getElementById(`edit-btn-${annotationId}`);
        
        const isEditing = editForm.style.display !== 'none';
        
        if (isEditing) {
            // Check for unsaved changes before canceling
            if (this.hasUnsavedChanges) {
                const shouldProceed = await this.checkUnsavedChanges();
                if (!shouldProceed) {
                    return; // User cancelled
                }
            }
            // Cancel editing
            this.cancelInlineEdit(annotationId);
        } else {
            // Check if another annotation is being edited
            if (this.currentlyEditingId && this.currentlyEditingId !== annotationId && this.hasUnsavedChanges) {
                const shouldProceed = await this.checkUnsavedChanges();
                if (!shouldProceed) {
                    return; // User cancelled
                }
            }
            
            // Start editing
            this.startInlineEdit(annotationId);
            editForm.style.display = 'block';
            if (metadataDisplay) metadataDisplay.style.display = 'none';
            if (transcriptionDisplay) transcriptionDisplay.style.display = 'none';
            if (transcriptionEdit) {
                transcriptionEdit.style.display = 'block';
            }
            if (editButtons) {
                // Show save buttons for all annotations in edit mode
                editButtons.style.display = 'block';
            }
            
            editBtn.innerHTML = '<i class="fas fa-times"></i>';
            editBtn.classList.remove('btn-outline-secondary');
            editBtn.classList.add('btn-outline-warning');
            editBtn.title = 'Cancel editing';
            
            // Add auto-resize functionality to text areas
            this.setupAutoResizeTextareas(annotationId);
            
            // Start tracking changes
            this.setupChangeTracking(annotationId);
        }
    }
    
    async saveInlineEdit(annotationId) {
        const annotation = this.annotations.find(a => a.id === annotationId);
        if (!annotation) return;
        
        try {
            // Collect form data
            const classification = document.getElementById(`inline-classification-${annotationId}`).value || null;
            const label = document.getElementById(`inline-label-${annotationId}`).value || '';
            
            // Collect metadata
            const metadata = {};
            const metadataFields = this.getMetadataFieldsForClassification(classification);
            
            // Add existing metadata that might not be in template
            if (annotation.metadata && typeof annotation.metadata === 'object') {
                const existingKeys = Object.keys(annotation.metadata);
                const templateKeys = metadataFields.map(f => f.name);
                
                existingKeys.forEach(key => {
                    if (!templateKeys.includes(key)) {
                        metadataFields.push({
                            name: key,
                            type: 'string',
                            default: 'unparsed'
                        });
                    }
                });
            }
            
            metadataFields.forEach(field => {
                const fieldElement = document.getElementById(`inline-meta-${annotationId}-${field.name}`);
                if (fieldElement) {
                    if (field.type === 'boolean') {
                        metadata[field.name] = fieldElement.checked;
                    } else if (field.type === 'number') {
                        const numValue = parseFloat(fieldElement.value);
                        metadata[field.name] = isNaN(numValue) ? 0 : numValue;
                    } else {
                        const value = fieldElement.value.trim();
                        if (value !== '') {
                            metadata[field.name] = value;
                        }
                    }
                }
            });
            
            // Save annotation changes
            if (this.isBrowserCacheMode) {
                // Update annotation in browser cache
                annotation.classification = classification;
                annotation.label = label;
                annotation.metadata = metadata;
                
                try {
                    // Ensure annotation has required fields for IndexedDB
                    if (!annotation.id) {
                        throw new Error('Annotation missing required id field');
                    }
                    
                    // Create a clean copy without fabricObject for IndexedDB storage
                    // Ensure image reference is always present (critical for finding annotations later)
                    const imageId = annotation.image_id || annotation.image || this.currentImage.id;
                    const cleanAnnotation = {
                        id: annotation.id,
                        image_id: imageId, // Always ensure image_id is set
                        image: imageId, // Preserve both fields for backwards compatibility
                        annotation_type: annotation.annotation_type || annotation.type,
                        type: annotation.type || annotation.annotation_type, // Preserve both type fields
                        coordinates: annotation.coordinates,
                        classification: classification,
                        label: label,
                        reading_order: annotation.reading_order,
                        metadata: metadata,
                        created_at: annotation.created_at,
                        updated_at: new Date().toISOString()
                    };
                    
                    await this.localStorage.update('annotations', cleanAnnotation);
                    
                    // Update the in-memory annotation object (keeping fabricObject)
                    annotation.classification = classification;
                    annotation.label = label;
                    annotation.metadata = metadata;
                    annotation.updated_at = cleanAnnotation.updated_at;
                    // Ensure in-memory annotation also has image references for future saves
                    annotation.image_id = imageId;
                    annotation.image = imageId;
                    
                    // Save transcription if it was edited
                    const transcriptionSaved = await this.saveTranscriptionEdit(annotationId);
                    
                    // Reset edit state
                    this.currentlyEditingId = null;
                    this.hasUnsavedChanges = false;
                    this.originalFormData = null;
                    
                    // Cancel editing mode
                    this.cancelInlineEdit(annotationId);
                    
                    // Update UI without triggering full reload (which can lose annotations)
                    this.updateCombinedTranscription();
                    
                    if (transcriptionSaved) {
                        this.showAlert('All changes saved successfully!', 'success');
                    } else {
                        this.showAlert('Annotation updated, but transcription save failed', 'warning');
                    }
                    
                    return true; // Indicate successful save
                } catch (error) {
                    console.error('Browser cache update error:', error);
                    throw new Error('Failed to update annotation in browser cache');
                }
            } else {
                // Update annotation on server
                const response = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({
                        classification: classification,
                        label: label,
                        metadata: metadata
                    })
                });
                
                if (response.ok) {
                    // Update local annotation
                    annotation.classification = classification;
                    annotation.label = label;
                    annotation.metadata = metadata;
                    
                    // Save transcription if it was edited
                    const transcriptionSaved = await this.saveTranscriptionEdit(annotationId);
                    
                    // Reset edit state
                    this.currentlyEditingId = null;
                    this.hasUnsavedChanges = false;
                    this.originalFormData = null;
                    
                    // Cancel editing mode
                    this.cancelInlineEdit(annotationId);
                    
                    // Update UI without triggering full reload (which can lose annotations)
                    this.updateCombinedTranscription();
                    
                    if (transcriptionSaved) {
                        this.showAlert('All changes saved successfully!', 'success');
                    } else {
                        this.showAlert('Annotation updated, but transcription save failed', 'warning');
                    }
                    
                    return true; // Indicate successful save
                } else {
                    throw new Error('Failed to update annotation');
                }
            }
        } catch (error) {
            console.error('Error saving inline edit:', error);
            this.showAlert('Failed to save changes', 'danger');
            return false; // Indicate failed save
        }
    }
    
    setupAutoResizeTextareas(annotationId) {
        // Find all textareas in the inline edit form
        const editForm = document.getElementById(`inline-edit-${annotationId}`);
        if (!editForm) return;
        
        const textareas = editForm.querySelectorAll('textarea');
        textareas.forEach(textarea => {
            // Initial resize
            this.autoResizeTextarea(textarea);
            
            // Add event listeners for auto-resize
            textarea.addEventListener('input', () => this.autoResizeTextarea(textarea));
            textarea.addEventListener('paste', () => {
                // Delay to allow paste content to be processed
                setTimeout(() => this.autoResizeTextarea(textarea), 10);
            });
        });
    }
    
    autoResizeTextarea(textarea) {
        // Reset height to auto to get proper scrollHeight
        textarea.style.height = 'auto';
        
        // Different min heights for different types of textareas
        let minHeight = 60; // Default minimum height
        if (textarea.id.includes('transcription-textarea')) {
            minHeight = 150; // Larger minimum for transcription
        } else if (textarea.classList.contains('expandable-text')) {
            minHeight = 60; // Standard for metadata fields
        }
        
        const maxHeight = 500; // Maximum height in pixels
        const newHeight = Math.max(minHeight, Math.min(maxHeight, textarea.scrollHeight + 10));
        
        textarea.style.height = newHeight + 'px';
    }
    
    startInlineEdit(annotationId) {
        // End previous editing session if any
        if (this.currentlyEditingId && this.currentlyEditingId !== annotationId) {
            this.cancelInlineEdit(this.currentlyEditingId);
        }
        
        this.currentlyEditingId = annotationId;
        this.hasUnsavedChanges = false;
        this.captureOriginalFormData(annotationId);
    }
    
    captureOriginalFormData(annotationId) {
        const annotation = this.annotations.find(a => a.id === annotationId);
        if (!annotation) return;
        
        this.originalFormData = {
            classification: annotation.classification || '',
            label: annotation.label || '',
            metadata: { ...annotation.metadata },
            transcription: annotation.transcription ? annotation.transcription.text_content : ''
        };
    }
    
    setupChangeTracking(annotationId) {
        // Track changes in all form inputs
        const editForm = document.getElementById(`inline-edit-${annotationId}`);
        const transcriptionTextarea = document.getElementById(`transcription-textarea-${annotationId}`);
        
        if (editForm) {
            const inputs = editForm.querySelectorAll('input, select, textarea');
            inputs.forEach(input => {
                input.addEventListener('input', () => this.markAsChanged());
                input.addEventListener('change', () => this.markAsChanged());
            });
        }
        
        if (transcriptionTextarea) {
            transcriptionTextarea.addEventListener('input', () => this.markAsChanged());
            transcriptionTextarea.addEventListener('change', () => this.markAsChanged());
        }
    }
    
    markAsChanged() {
        this.hasUnsavedChanges = true;
    }
    
    async checkUnsavedChanges() {
        return new Promise((resolve) => {
            // Create a custom confirmation dialog
            const modalHtml = `
                <div class="modal fade" id="unsavedChangesModal" tabindex="-1" data-bs-backdrop="static">
                    <div class="modal-dialog modal-dialog-centered">
                        <div class="modal-content">
                            <div class="modal-header">
                                <h5 class="modal-title">
                                    <i class="fas fa-exclamation-triangle text-warning me-2"></i>
                                    Unsaved Changes
                                </h5>
                            </div>
                            <div class="modal-body">
                                <p>You have unsaved changes to the current annotation. What would you like to do?</p>
                                <div class="alert alert-info small">
                                    <i class="fas fa-info-circle me-1"></i>
                                    Your changes will be lost if you don't save them.
                                </div>
                            </div>
                            <div class="modal-footer">
                                <button type="button" class="btn btn-success" id="saveChangesBtn">
                                    <i class="fas fa-save me-1"></i>Save Changes
                                </button>
                                <button type="button" class="btn btn-outline-danger" id="discardChangesBtn">
                                    <i class="fas fa-trash me-1"></i>Discard Changes
                                </button>
                                <button type="button" class="btn btn-secondary" id="cancelActionBtn">
                                    <i class="fas fa-times me-1"></i>Cancel
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            
            // Remove existing modal if any
            const existingModal = document.getElementById('unsavedChangesModal');
            if (existingModal) {
                existingModal.remove();
            }
            
            // Add modal to page
            document.body.insertAdjacentHTML('beforeend', modalHtml);
            
            const modal = new bootstrap.Modal(document.getElementById('unsavedChangesModal'));
            const saveBtn = document.getElementById('saveChangesBtn');
            const discardBtn = document.getElementById('discardChangesBtn');
            const cancelBtn = document.getElementById('cancelActionBtn');
            
            // Handle save
            saveBtn.addEventListener('click', async () => {
                modal.hide();
                const saved = await this.saveInlineEdit(this.currentlyEditingId);
                resolve(saved); // Proceed if save was successful
            });
            
            // Handle discard
            discardBtn.addEventListener('click', () => {
                modal.hide();
                this.cancelInlineEdit(this.currentlyEditingId);
                resolve(true); // Proceed
            });
            
            // Handle cancel
            cancelBtn.addEventListener('click', () => {
                modal.hide();
                resolve(false); // Don't proceed
            });
            
            // Clean up modal after it's hidden
            document.getElementById('unsavedChangesModal').addEventListener('hidden.bs.modal', () => {
                document.getElementById('unsavedChangesModal').remove();
            });
            
            modal.show();
        });
    }

    cancelInlineEdit(annotationId) {
        const editForm = document.getElementById(`inline-edit-${annotationId}`);
        const metadataDisplay = document.getElementById(`metadata-display-${annotationId}`);
        const transcriptionDisplay = document.getElementById(`transcription-display-${annotationId}`);
        const transcriptionEdit = document.getElementById(`transcription-edit-${annotationId}`);
        const editButtons = document.getElementById(`edit-buttons-${annotationId}`);
        const editBtn = document.getElementById(`edit-btn-${annotationId}`);
        
        // Reset edit state tracking
        if (this.currentlyEditingId === annotationId) {
            this.currentlyEditingId = null;
            this.hasUnsavedChanges = false;
            this.originalFormData = null;
        }
        
        // Hide editing elements
        editForm.style.display = 'none';
        if (metadataDisplay) metadataDisplay.style.display = 'block';
        if (transcriptionDisplay) transcriptionDisplay.style.display = 'block';
        if (transcriptionEdit) transcriptionEdit.style.display = 'none';
        if (editButtons) editButtons.style.display = 'none';
        
        // Reset button
        editBtn.innerHTML = '<i class="fas fa-edit"></i>';
        editBtn.classList.remove('btn-outline-warning');
        editBtn.classList.add('btn-outline-secondary');
        editBtn.title = 'Edit annotation';
        
        // Reset transcription textarea
        this.cancelTranscriptionEdit(annotationId);
    }

    // Quick edit classification
    quickEditClassification(event, annotationId) {
        event.stopPropagation();
        event.preventDefault();
        
        const annotation = this.annotations.find(a => a.id === annotationId);
        if (!annotation) return;
        
        // Create a dropdown for quick selection
        const target = event.target;
        const dropdown = document.createElement('select');
        dropdown.className = 'form-select form-select-sm';
        dropdown.style.position = 'absolute';
        dropdown.style.zIndex = '1000';
        dropdown.style.minWidth = '150px';
        
        // Add options
        dropdown.innerHTML = '<option value="">NoZoneSelected</option>';
        
        if (this.annotationTypes) {
            // Add zone types (including custom zones)
            if (this.userEnabledTypes.zones && this.userEnabledTypes.zones.length > 0) {
                const zoneGroup = document.createElement('optgroup');
                zoneGroup.label = 'Zone Types';
                
                this.userEnabledTypes.zones.forEach(zoneCode => {
                    // First check built-in zones
                    let zoneType = this.annotationTypes.all_types.zones.find(z => z.value === zoneCode);
                    
                    // Then check custom zones
                    if (!zoneType) {
                        zoneType = this.customZones.find(z => z.value === zoneCode);
                    }
                    
                    if (zoneType) {
                        const option = document.createElement('option');
                        option.value = zoneType.value;
                        option.textContent = zoneType.label;
                        if (annotation.classification === zoneType.value) {
                            option.selected = true;
                        }
                        zoneGroup.appendChild(option);
                    }
                });
                
                dropdown.appendChild(zoneGroup);
            }
            
            // Add line types
            if (this.userEnabledTypes.lines && this.userEnabledTypes.lines.length > 0) {
                const lineGroup = document.createElement('optgroup');
                lineGroup.label = 'Line Types';
                
                this.userEnabledTypes.lines.forEach(lineCode => {
                    const lineType = this.annotationTypes.all_types.lines.find(l => l.value === lineCode);
                    if (lineType) {
                        const option = document.createElement('option');
                        option.value = lineType.value;
                        option.textContent = lineType.label;
                        if (annotation.classification === lineType.value) {
                            option.selected = true;
                        }
                        lineGroup.appendChild(option);
                    }
                });
                
                dropdown.appendChild(lineGroup);
            }
        }
        
        // Position dropdown
        const rect = target.getBoundingClientRect();
        dropdown.style.left = rect.left + 'px';
        dropdown.style.top = (rect.bottom + 5) + 'px';
        
        // Add to body temporarily
        document.body.appendChild(dropdown);
        dropdown.focus();
        
        // Handle selection
        dropdown.addEventListener('change', async () => {
            const newClassification = dropdown.value || null;
            await this.updateAnnotationClassification(annotationId, newClassification);
            this.safeRemoveDropdown(dropdown);
        });
        
        // Handle click away
        dropdown.addEventListener('blur', () => {
            this.safeRemoveDropdown(dropdown);
        });
    }

    safeRemoveDropdown(dropdown) {
        try {
            if (dropdown && dropdown.parentNode) {
                dropdown.parentNode.removeChild(dropdown);
            }
        } catch (error) {
            // Dropdown already removed, ignore
        }
    }
    
    async updateAnnotationClassification(annotationId, newClassification) {
        try {
            console.log('updateAnnotationClassification - Browser Cache Mode:', this.isBrowserCacheMode, 'Annotation ID:', annotationId);
            if (this.isBrowserCacheMode) {
                // Update annotation in browser cache
                const annotation = await this.localStorage.get('annotations', annotationId);
                if (annotation) {
                    annotation.classification = newClassification;
                    annotation.updated_at = new Date().toISOString();
                    await this.localStorage.update('annotations', annotation);
                    
                    // Update local annotation in memory
                    const localAnnotation = this.annotations.find(a => a.id === annotationId);
                    if (localAnnotation) {
                        localAnnotation.classification = newClassification;
                    }
                    
                    // Update UI
                    this.updateCombinedTranscription();
                    this.showAlert('Classification updated successfully!', 'success');
                }
            } else {
                const response = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({
                        classification: newClassification
                    })
                });

                if (response.ok) {
                    // Update local annotation
                    const annotation = this.annotations.find(a => a.id === annotationId);
                    if (annotation) {
                        annotation.classification = newClassification;
                    }
                    
                    // Update UI
                    this.updateCombinedTranscription();
                    this.showAlert('Classification updated successfully!', 'success');
                } else {
                    throw new Error('Failed to update classification');
                }
            }
        } catch (error) {
            console.error('Error updating classification:', error);
            this.showAlert('Failed to update classification', 'danger');
        }
    }
    
    getClassificationType(classification) {
        if (!classification || !this.annotationTypes) return null;
        
        // Check zones
        const zoneType = this.annotationTypes.all_types.zones.find(z => z.value === classification);
        if (zoneType) return zoneType.label;
        
        // Check lines
        const lineType = this.annotationTypes.all_types.lines.find(l => l.value === classification);
        if (lineType) return lineType.label;
        
        return classification;
    }
    
    formatMetadataDisplay(metadata) {
        if (!metadata || typeof metadata !== 'object' || Object.keys(metadata).length === 0) {
            return null;
        }
        
        try {
            const metadataItems = Object.entries(metadata).map(([key, value]) => {
                let displayValue;
                if (typeof value === 'boolean') {
                    displayValue = value ? '✓' : '✗';
                } else if (typeof value === 'object') {
                    displayValue = 'unparsed';
                } else {
                    displayValue = String(value);
                }
                return `<span class="metadata-item"><strong>${key}:</strong> ${displayValue}</span>`;
            });
            return metadataItems.join(' ');
        } catch (error) {
            return '<span class="text-warning">unparsed</span>';
        }
    }

    formatTranscriptionModelInfo(annotation) {
        if (!annotation.metadata) return '';
        
        const model = annotation.metadata.transcription_model;
        const provider = annotation.metadata.transcription_provider;
        
        if (!model || !provider) return '';
        
        let modelLabel = model;
        if (provider === 'openai') {
            if (model === 'gpt-4o-mini') modelLabel = 'GPT-4o Mini';
            else if (model === 'gpt-4o') modelLabel = 'GPT-4o';
        } else if (provider === 'vertex') {
            if (model === 'google/gemini-2.0-flash-lite-001') modelLabel = 'Gemini 2.0 Flash Lite';
            else if (model === 'google/gemini-2.0-flash-001') modelLabel = 'Gemini 2.0 Flash';
            else if (model === 'google/gemini-2.5-flash') modelLabel = 'Gemini 2.5 Flash';
            else if (model === 'google/gemini-2.5-pro') modelLabel = 'Gemini 2.5 Pro';
        }
        
        return `<span class="badge bg-secondary me-2" title="Transcription Model"><i class="fas fa-robot me-1"></i>${modelLabel}</span>`;
    }

    // Progress Indicator Methods
    showAnnotationProgress(annotationId, show) {
        // Show spinner on canvas annotation
        const annotation = this.annotations.find(a => a.id === annotationId);
        if (annotation && annotation.fabricObject) {
            if (show) {
                // Add a spinning overlay to the fabric object
                annotation.fabricObject.set({
                    stroke: '#ff6600',
                    strokeWidth: 3,
                    strokeDashArray: [5, 5]
                });
                
                // Animate the dash offset for a moving effect
                this.animateAnnotationProgress(annotation.fabricObject);
            } else {
                // Reset to original styling
                annotation.fabricObject.set({
                    stroke: '#0066cc',
                    strokeWidth: 2,
                    strokeDashArray: null
                });
                
                // Stop animation
                if (annotation.fabricObject._progressAnimation) {
                    clearInterval(annotation.fabricObject._progressAnimation);
                    annotation.fabricObject._progressAnimation = null;
                }
            }
            this.canvas.renderAll();
        }

        // Show spinner in transcription list
        const transcriptionItem = document.querySelector(`[data-annotation-id="${annotationId}"]`);
        if (transcriptionItem) {
            let spinner = transcriptionItem.querySelector('.transcription-progress-spinner');
            if (show) {
                if (!spinner) {
                    spinner = document.createElement('div');
                    spinner.className = 'transcription-progress-spinner';
                    spinner.innerHTML = '<i class="fas fa-spinner fa-spin text-primary me-2"></i>';
                    
                    const header = transcriptionItem.querySelector('.d-flex.justify-content-between');
                    if (header) {
                        header.appendChild(spinner);
                    }
                }
            } else {
                if (spinner) {
                    spinner.remove();
                }
            }
        }
    }

    animateAnnotationProgress(fabricObject) {
        let offset = 0;
        fabricObject._progressAnimation = setInterval(() => {
            offset += 1;
            fabricObject.set('strokeDashOffset', -offset);
            if (this.canvas) {
                this.canvas.renderAll();
            }
        }, 100);
    }

    showFullImageTranscriptionProgress(show) {
        const transcriptionContent = document.getElementById('transcriptionContent');
        if (!transcriptionContent) return;

        let progressIndicator = document.getElementById('fullImageProgressIndicator');
        
        if (show) {
            if (!progressIndicator) {
                progressIndicator = document.createElement('div');
                progressIndicator.id = 'fullImageProgressIndicator';
                progressIndicator.className = 'alert alert-info d-flex align-items-center';
                progressIndicator.innerHTML = `
                    <i class="fas fa-spinner fa-spin me-2"></i>
                    <span>Transcribing full image...</span>
                `;
                transcriptionContent.insertBefore(progressIndicator, transcriptionContent.firstChild);
            }
        } else {
            if (progressIndicator) {
                progressIndicator.remove();
            }
        }
    }

    // Utility Methods
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Credentials Management
    getStoredCredentials() {
        return {
            openai_api_key: localStorage.getItem('openai_api_key'),
            openai_model: localStorage.getItem('openai_model') || 'gpt-4o-mini',
            custom_endpoint_url: localStorage.getItem('custom_endpoint_url'),
            custom_endpoint_auth: localStorage.getItem('custom_endpoint_auth'),
            vertex_access_token: localStorage.getItem('vertex_access_token'),
            vertex_project_id: localStorage.getItem('vertex_project_id'),
            vertex_location: localStorage.getItem('vertex_location') || 'us-central1',
            vertex_model: localStorage.getItem('vertex_model') || 'google/gemini-2.0-flash-lite-001',
            roboflow_api_key: localStorage.getItem('roboflow_api_key'),
            roboflow_workspace_name: localStorage.getItem('roboflow_workspace_name'),
            roboflow_workflow_id: localStorage.getItem('roboflow_workflow_id')
        };
    }

    getActiveProvider() {
        const credentials = this.getStoredCredentials();
        
        // Priority: OpenAI > Vertex > Custom
        if (credentials.openai_api_key) {
            return 'openai';
        } else if (credentials.vertex_access_token && credentials.vertex_project_id) {
            return 'vertex';
        } else if (credentials.custom_endpoint_url) {
            return 'custom';
        }
        
        return null;
    }

    getActiveModel() {
        const credentials = this.getStoredCredentials();
        const provider = this.getActiveProvider();
        
        switch (provider) {
            case 'openai':
                return credentials.openai_model;
            case 'vertex':
                return credentials.vertex_model;
            default:
                return 'gpt-4o-mini'; // fallback
        }
    }

    getAvailableModels() {
        const credentials = this.getStoredCredentials();
        const models = [];
        
        if (credentials.openai_api_key) {
            models.push({
                provider: 'openai',
                value: 'gpt-4o-mini',
                label: 'GPT-4o Mini (OpenAI)'
            });
            models.push({
                provider: 'openai',
                value: 'gpt-4o',
                label: 'GPT-4o (OpenAI)'
            });
        }
        
        if (credentials.vertex_access_token && credentials.vertex_project_id) {
            models.push({
                provider: 'vertex',
                value: 'google/gemini-2.0-flash-lite-001',
                label: 'Gemini 2.0 Flash Lite (Vertex)'
            });
            models.push({
                provider: 'vertex',
                value: 'google/gemini-2.0-flash-001',
                label: 'Gemini 2.0 Flash (Vertex)'
            });
            models.push({
                provider: 'vertex',
                value: 'google/gemini-2.5-flash',
                label: 'Gemini 2.5 Flash (Vertex)'
            });
            models.push({
                provider: 'vertex',
                value: 'google/gemini-2.5-pro',
                label: 'Gemini 2.5 Pro (Vertex)'
            });
        }
        
        if (credentials.custom_endpoint_url) {
            models.push({
                provider: 'custom',
                value: 'custom',
                label: 'Custom Endpoint'
            });
        }
        
        return models;
    }

    populateModelSelection() {
        const modelSelect = document.getElementById('transcriptionModel');
        if (!modelSelect) return;
        
        const models = this.getAvailableModels();
        const currentModel = this.getActiveModel();
        
        modelSelect.innerHTML = '';
        
        if (models.length === 0) {
            const option = document.createElement('option');
            option.value = '';
            option.textContent = 'No models available';
            option.disabled = true;
            modelSelect.appendChild(option);
            return;
        }
        
        models.forEach(model => {
            const option = document.createElement('option');
            option.value = `${model.provider}:${model.value}`;
            option.textContent = model.label;
            if (model.value === currentModel) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        });
    }

    getSelectedModel() {
        const modelSelect = document.getElementById('transcriptionModel');
        if (!modelSelect || !modelSelect.value) {
            // fallback to active provider/model
            const provider = this.getActiveProvider();
            const model = this.getActiveModel();
            return { provider, model };
        }
        
        const [provider, model] = modelSelect.value.split(':');
        return { provider, model };
    }

    saveCredentials() {
        const openaiKey = document.getElementById('openaiApiKey').value;
        const openaiModel = document.getElementById('openaiModel').value;
        const customEndpoint = document.getElementById('customEndpoint').value;
        const customAuth = document.getElementById('customAuth').value;
        const vertexAccessToken = document.getElementById('vertexAccessToken').value;
        const vertexProjectId = document.getElementById('vertexProjectId').value;
        const vertexLocation = document.getElementById('vertexLocation').value;
        const vertexModel = document.getElementById('vertexModel').value;
        const roboflowKey = document.getElementById('roboflowApiKey').value;
        const roboflowWorkspace = document.getElementById('roboflowWorkspace').value;
        const roboflowWorkflowId = document.getElementById('roboflowWorkflowId').value;

        if (openaiKey) {
            localStorage.setItem('openai_api_key', openaiKey);
        } else {
            localStorage.removeItem('openai_api_key');
        }

        if (openaiModel) {
            localStorage.setItem('openai_model', openaiModel);
        } else {
            localStorage.removeItem('openai_model');
        }

        // Save batch processing preference
        const batchEnabled = document.getElementById('enableBatchProcessing').checked;
        localStorage.setItem('enable_batch_processing', batchEnabled.toString());

        if (customEndpoint) {
            localStorage.setItem('custom_endpoint_url', customEndpoint);
        } else {
            localStorage.removeItem('custom_endpoint_url');
        }

        if (customAuth) {
            localStorage.setItem('custom_endpoint_auth', customAuth);
        } else {
            localStorage.removeItem('custom_endpoint_auth');
        }

        if (vertexAccessToken) {
            localStorage.setItem('vertex_access_token', vertexAccessToken);
        } else {
            localStorage.removeItem('vertex_access_token');
        }

        if (vertexProjectId) {
            localStorage.setItem('vertex_project_id', vertexProjectId);
        } else {
            localStorage.removeItem('vertex_project_id');
        }

        if (vertexLocation) {
            localStorage.setItem('vertex_location', vertexLocation);
        } else {
            localStorage.removeItem('vertex_location');
        }

        if (vertexModel) {
            localStorage.setItem('vertex_model', vertexModel);
        } else {
            localStorage.removeItem('vertex_model');
        }

        if (roboflowKey) {
            localStorage.setItem('roboflow_api_key', roboflowKey);
        } else {
            localStorage.removeItem('roboflow_api_key');
        }

        if (roboflowWorkspace) {
            localStorage.setItem('roboflow_workspace_name', roboflowWorkspace);
        } else {
            localStorage.removeItem('roboflow_workspace_name');
        }

        if (roboflowWorkflowId) {
            localStorage.setItem('roboflow_workflow_id', roboflowWorkflowId);
        } else {
            localStorage.removeItem('roboflow_workflow_id');
        }

        this.updateCredentialsStatus();
        this.updateRoboflowProfileSettings(roboflowKey, roboflowWorkspace, roboflowWorkflowId);
        bootstrap.Modal.getInstance(document.getElementById('credentialsModal')).hide();
        this.showAlert('Credentials saved successfully', 'success');
    }

    updateCredentialsStatus() {
        const credentials = this.getStoredCredentials();
        const statusBadge = document.getElementById('credentialsStatus');
        
        if (credentials.openai_api_key || credentials.custom_endpoint_url || 
            (credentials.vertex_access_token && credentials.vertex_project_id)) {
            statusBadge.textContent = 'Configured';
            statusBadge.className = 'badge bg-success ms-2';
        } else {
            statusBadge.textContent = 'Not Set';
            statusBadge.className = 'badge bg-warning ms-2';
        }
    }

    showCredentialsModal() {
        const modal = new bootstrap.Modal(document.getElementById('credentialsModal'));
        
        // Pre-fill existing values
        const credentials = this.getStoredCredentials();
        document.getElementById('openaiApiKey').value = credentials.openai_api_key || '';
        document.getElementById('openaiModel').value = credentials.openai_model || 'gpt-4o-mini';
        document.getElementById('customEndpoint').value = credentials.custom_endpoint_url || '';
        document.getElementById('customAuth').value = credentials.custom_endpoint_auth || '';
        document.getElementById('vertexAccessToken').value = credentials.vertex_access_token || '';
        document.getElementById('vertexProjectId').value = credentials.vertex_project_id || '';
        document.getElementById('vertexLocation').value = credentials.vertex_location || 'us-central1';
        document.getElementById('vertexModel').value = credentials.vertex_model || 'google/gemini-2.0-flash-lite-001';
        document.getElementById('roboflowApiKey').value = credentials.roboflow_api_key || '';
        document.getElementById('roboflowWorkspace').value = credentials.roboflow_workspace_name || '';
        document.getElementById('roboflowWorkflowId').value = credentials.roboflow_workflow_id || '';
        
        // Load batch processing preference (default to enabled)
        const batchEnabled = localStorage.getItem('enable_batch_processing');
        document.getElementById('enableBatchProcessing').checked = batchEnabled !== 'false';
        
        // Populate model selection after credentials are loaded
        this.populateModelSelection();
        
        modal.show();
    }



    // Legacy Annotation Editing (replaced by inline editing)
    openAnnotationEditor(annotation) {
        this.currentEditingAnnotation = annotation;
        
        // Populate form
        document.getElementById('editAnnotationClassification').value = annotation.classification || '';
        document.getElementById('editAnnotationLabel').value = annotation.label || '';
        
        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('editAnnotationModal'));
        modal.show();
    }

    getMetadataFieldsForClassification(classification) {
        // Find the prompt that applies to this classification
        const applicablePrompt = this.customPrompts.find(prompt => 
            prompt.zones && prompt.zones.includes(classification)
        );
        
        if (applicablePrompt && applicablePrompt.metadata_fields) {
            return [...applicablePrompt.metadata_fields]; // Return a copy
        }
        
        // Default metadata fields
        return [
            { name: 'handwritten', type: 'boolean', default: false },
            { name: 'typed', type: 'boolean', default: true },
            { name: 'language', type: 'string', default: 'en' }
        ];
    }

    // Detection Mapper Functions
    toggleDetectionMapper() {
        const content = document.getElementById('detectionMapperContent');
        const chevron = document.getElementById('mapperChevron');
        
        if (content.style.display === 'none') {
            content.style.display = 'block';
            chevron.className = 'fas fa-chevron-up';
            this.loadDetectionMappings();
            this.populateMappingTargetDropdown();
        } else {
            content.style.display = 'none';
            chevron.className = 'fas fa-chevron-down';
        }
    }

    loadDetectionMappings() {
        if (!this.currentUser) return;
        
        // Ensure the field exists
        if (!this.currentUser.custom_detection_mappings) {
            this.currentUser.custom_detection_mappings = {};
        }
        
        const mappings = this.currentUser.custom_detection_mappings;
        const container = document.getElementById('detectionMappingsList');
        
        container.innerHTML = '';
        
        Object.entries(mappings).forEach(([detectionClass, mappedClass]) => {
            const mappingDiv = document.createElement('div');
            mappingDiv.className = 'd-flex align-items-center justify-content-between mb-1 p-1 bg-light rounded';
            mappingDiv.innerHTML = `
                <small class="text-truncate me-2">
                    <strong>${detectionClass}</strong> → ${this.formatClassificationName(mappedClass)}
                </small>
                <button class="btn btn-xs btn-outline-danger" onclick="app.removeDetectionMapping('${detectionClass}')" title="Remove mapping">
                    <i class="fas fa-times"></i>
                </button>
            `;
            container.appendChild(mappingDiv);
        });
        
        if (Object.keys(mappings).length === 0) {
            container.innerHTML = '<small class="text-muted">No custom mappings yet</small>';
        }
    }

    populateMappingTargetDropdown() {
        const dropdown = document.getElementById('newMappingTarget');
        dropdown.innerHTML = '<option value="">Select zone...</option>';
        
        if (!this.annotationTypes || !this.userEnabledTypes) return;
        
        // Add built-in zone types
        if (this.userEnabledTypes.zones) {
            const zoneGroup = document.createElement('optgroup');
            zoneGroup.label = 'Zone Types';
            
            this.userEnabledTypes.zones.forEach(zoneCode => {
                const zoneType = this.annotationTypes.all_types.zones.find(z => z.value === zoneCode);
                if (zoneType) {
                    const option = document.createElement('option');
                    option.value = zoneType.value;
                    option.textContent = zoneType.label;
                    zoneGroup.appendChild(option);
                }
            });
            
            if (zoneGroup.children.length > 0) {
                dropdown.appendChild(zoneGroup);
            }
        }
        
        // Add custom zones
        if (this.customZones && this.customZones.length > 0) {
            const customGroup = document.createElement('optgroup');
            customGroup.label = 'Custom Zones';
            
            this.customZones.forEach(customZone => {
                if (this.userEnabledTypes.zones.includes(customZone.value)) {
                    const option = document.createElement('option');
                    option.value = customZone.value;
                    option.textContent = customZone.label;
                    customGroup.appendChild(option);
                }
            });
            
            if (customGroup.children.length > 0) {
                dropdown.appendChild(customGroup);
            }
        }
        
        // Add line types
        if (this.userEnabledTypes.lines) {
            const lineGroup = document.createElement('optgroup');
            lineGroup.label = 'Line Types';
            
            this.userEnabledTypes.lines.forEach(lineCode => {
                const lineType = this.annotationTypes.all_types.lines.find(l => l.value === lineCode);
                if (lineType) {
                    const option = document.createElement('option');
                    option.value = lineType.value;
                    option.textContent = lineType.label;
                    lineGroup.appendChild(option);
                }
            });
            
            if (lineGroup.children.length > 0) {
                dropdown.appendChild(lineGroup);
            }
        }
    }

    async addDetectionMapping() {
        const detectionClass = document.getElementById('newDetectionClass').value.trim();
        const mappingTarget = document.getElementById('newMappingTarget').value;
        
        if (!detectionClass || !mappingTarget) {
            this.showAlert('Please enter both detection class and target zone', 'warning');
            return;
        }
        
        // Ensure user profile exists
        if (!this.currentUser) {
            this.showAlert('User profile not loaded', 'danger');
            return;
        }
        
        // Update local copy
        if (!this.currentUser.custom_detection_mappings) {
            this.currentUser.custom_detection_mappings = {};
        }
        this.currentUser.custom_detection_mappings[detectionClass] = mappingTarget;
        
        // Save to backend
        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Token ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    custom_detection_mappings: this.currentUser.custom_detection_mappings
                })
            });
            
            if (response.ok) {
                // Update current user profile with response
                const updatedProfile = await response.json();
                this.currentUser = updatedProfile;
                
                // Clear inputs
                document.getElementById('newDetectionClass').value = '';
                document.getElementById('newMappingTarget').value = '';
                
                // Reload mappings display
                this.loadDetectionMappings();
                this.showAlert('Detection mapping added successfully', 'success');
            } else {
                throw new Error('Failed to save mapping');
            }
        } catch (error) {
            console.error('Error saving detection mapping:', error);
            this.showAlert('Failed to save detection mapping', 'danger');
        }
    }

    async removeDetectionMapping(detectionClass) {
        if (!this.currentUser || !this.currentUser.custom_detection_mappings) return;
        
        // Remove from local copy
        delete this.currentUser.custom_detection_mappings[detectionClass];
        
        // Save to backend
        try {
            const response = await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Token ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    custom_detection_mappings: this.currentUser.custom_detection_mappings
                })
            });
            
            if (response.ok) {
                // Update current user profile with response
                const updatedProfile = await response.json();
                this.currentUser = updatedProfile;
                
                this.loadDetectionMappings();
                this.showAlert('Detection mapping removed', 'success');
            } else {
                throw new Error('Failed to remove mapping');
            }
        } catch (error) {
            console.error('Error removing detection mapping:', error);
            this.showAlert('Failed to remove detection mapping', 'danger');
        }
    }

    // Roboflow Zone/Line Detection Methods
    updateRoboflowProfileSettings(apiKey, workspaceName, workflowId) {
        // Update the user profile with Roboflow settings status
        const profileData = {
            roboflow_api_key_set: !!apiKey,
            roboflow_workspace_name: workspaceName || '',
            roboflow_workflow_id: workflowId || ''
        };

        fetch(`${this.apiBaseUrl}/auth/profile/`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Token ${this.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(profileData)
        }).catch(error => {
            console.error('Failed to update Roboflow profile settings:', error);
        });
    }

    showDetectZonesLinesModal() {
        if (!this.currentImage) {
            this.showAlert('Please select an image first', 'warning');
            return;
        }

        // Check if Roboflow credentials are configured
        const credentials = this.getStoredCredentials();
        if (!credentials.roboflow_api_key || !credentials.roboflow_workspace_name || !credentials.roboflow_workflow_id) {
            this.showAlert('Please configure Roboflow API settings in the credentials modal first', 'warning');
            return;
        }

        // Populate zone/line type options
        this.populateDetectionTypeOptions();

        // Set up event listeners for the filter checkbox
        const filterCheckbox = document.getElementById('filterSelectedTypes');
        const filterOptions = document.getElementById('detectionFilterOptions');
        
        filterCheckbox.addEventListener('change', function() {
            filterOptions.style.display = this.checked ? 'block' : 'none';
        });

        // Reset modal state
        document.getElementById('detectionProgress').style.display = 'none';
        document.getElementById('detectionResults').style.display = 'none';
        filterCheckbox.checked = false;
        filterOptions.style.display = 'none';

        // Show modal
        const modal = new bootstrap.Modal(document.getElementById('detectZonesLinesModal'));
        modal.show();
    }

    populateDetectionTypeOptions() {
        if (!this.annotationTypes || !this.userEnabledTypes) return;

        const zoneContainer = document.getElementById('detectionZoneTypes');
        const lineContainer = document.getElementById('detectionLineTypes');

        // Clear existing options
        zoneContainer.innerHTML = '';
        lineContainer.innerHTML = '';

        // Add zone type checkboxes
        this.annotationTypes.all_types.zones.forEach(zoneType => {
            if (this.userEnabledTypes.zones.includes(zoneType.value)) {
                const checkbox = this.createDetectionTypeCheckbox(zoneType, 'zone');
                zoneContainer.appendChild(checkbox);
            }
        });

        // Add line type checkboxes
        this.annotationTypes.all_types.lines.forEach(lineType => {
            if (this.userEnabledTypes.lines.includes(lineType.value)) {
                const checkbox = this.createDetectionTypeCheckbox(lineType, 'line');
                lineContainer.appendChild(checkbox);
            }
        });
    }

    createDetectionTypeCheckbox(typeInfo, category) {
        const div = document.createElement('div');
        div.className = 'form-check';

        const checkbox = document.createElement('input');
        checkbox.className = 'form-check-input';
        checkbox.type = 'checkbox';
        checkbox.id = `detection_${category}_${typeInfo.value}`;
        checkbox.value = typeInfo.value;
        checkbox.checked = true; // Default to checked

        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.setAttribute('for', checkbox.id);
        label.textContent = typeInfo.label;

        div.appendChild(checkbox);
        div.appendChild(label);

        return div;
    }

    async startZoneLineDetection() {
        if (!this.currentImage) {
            this.showAlert('No image selected', 'error');
            return;
        }

        // Check if in browser cache mode - use client-side detection
        if (this.isBrowserCacheMode) {
            return await this.startZoneLineDetectionBrowserCache();
        }

        const credentials = this.getStoredCredentials();
        const filterSelected = document.getElementById('filterSelectedTypes').checked;
        const confidenceThreshold = parseFloat(document.getElementById('confidenceThreshold').value);
        
        // Collect selected types if filtering is enabled
        let selectedZoneTypes = [];
        let selectedLineTypes = [];
        
        if (filterSelected) {
            const zoneCheckboxes = document.querySelectorAll('#detectionZoneTypes input[type="checkbox"]:checked');
            const lineCheckboxes = document.querySelectorAll('#detectionLineTypes input[type="checkbox"]:checked');
            
            selectedZoneTypes = Array.from(zoneCheckboxes).map(cb => cb.value);
            selectedLineTypes = Array.from(lineCheckboxes).map(cb => cb.value);
            
            if (selectedZoneTypes.length === 0 && selectedLineTypes.length === 0) {
                this.showAlert('Please select at least one zone or line type to detect', 'warning');
                return;
            }
        }

        // Close modal immediately and show progress
        bootstrap.Modal.getInstance(document.getElementById('detectZonesLinesModal')).hide();
        document.getElementById('startDetectionBtn').disabled = true;

        try {
            const response = await fetch(`${this.apiBaseUrl}/images/${this.currentImage.id}/detect-zones-lines/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.authToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    roboflow_api_key: credentials.roboflow_api_key,
                    filter_selected_types: filterSelected,
                    selected_zone_types: selectedZoneTypes,
                    selected_line_types: selectedLineTypes,
                    confidence_threshold: confidenceThreshold
                })
            });

            const result = await response.json();

            if (response.ok) {
                const detections = result.detections.detections;

                // Add detected annotations to the canvas
                await this.addDetectedAnnotations(detections);
                
                // Show success message
                this.showAlert(`Detection completed! Found ${detections.length} zones/lines.`, 'success');

            } else {
                throw new Error(result.error || 'Detection failed');
            }

        } catch (error) {
            console.error('Zone/line detection error:', error);
            this.showAlert(`Detection failed: ${error.message}`, 'danger');
        } finally {
            document.getElementById('startDetectionBtn').disabled = false;
        }
    }

    async startZoneLineDetectionBrowserCache() {
        const filterSelected = document.getElementById('filterSelectedTypes').checked;
        const confidenceThreshold = parseFloat(document.getElementById('confidenceThreshold').value);
        
        // Collect selected types if filtering is enabled
        let selectedZoneTypes = [];
        let selectedLineTypes = [];
        
        if (filterSelected) {
            const zoneCheckboxes = document.querySelectorAll('#detectionZoneTypes input[type="checkbox"]:checked');
            const lineCheckboxes = document.querySelectorAll('#detectionLineTypes input[type="checkbox"]:checked');
            
            selectedZoneTypes = Array.from(zoneCheckboxes).map(cb => cb.value);
            selectedLineTypes = Array.from(lineCheckboxes).map(cb => cb.value);
            
            if (selectedZoneTypes.length === 0 && selectedLineTypes.length === 0) {
                this.showAlert('Please select at least one zone or line type to detect', 'warning');
                return;
            }
        }

        // Close modal immediately and show progress
        bootstrap.Modal.getInstance(document.getElementById('detectZonesLinesModal')).hide();
        document.getElementById('startDetectionBtn').disabled = true;

        try {
            // Get current image data as base64
            let imageData = this.currentImage.image_file;
            
            // If image_file is not base64, we need to convert it
            if (!imageData || !imageData.startsWith('data:')) {
                throw new Error('Image data not available for detection');
            }

            // Call Roboflow serverless API
            const response = await fetch('https://serverless.roboflow.com/infer/workflows/yale-ai/page-xml', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    api_key: 'gcV24jJosN6XtPnBp7x1',
                    inputs: {
                        "image": {"type": "base64", "value": imageData}
                    }
                })
            });

            if (!response.ok) {
                throw new Error(`Detection API error: ${response.status} ${response.statusText}`);
            }

            const result = await response.json();
            console.log('Roboflow detection result:', result);

            // Process the results - Handle the nested Roboflow workflow structure
            let detections = [];
            
            if (result && result.outputs && result.outputs.length > 0) {
                // Roboflow workflow format: outputs[0].predictions.predictions
                const output = result.outputs[0];
                if (output.predictions && output.predictions.predictions) {
                    detections = output.predictions.predictions
                        .filter(pred => pred.confidence >= confidenceThreshold)
                        .map(pred => ({
                            coordinates: {
                                x: pred.x - pred.width / 2,  // Convert center to top-left
                                y: pred.y - pred.height / 2,
                                width: pred.width,
                                height: pred.height
                            },
                            classification: pred.class || pred.class_name || 'detected_region',
                            confidence: pred.confidence,
                            original_class: pred.class || pred.class_name || 'detected_region'
                        }));
                }
            } else if (result && result.predictions) {
                // Simple predictions format
                detections = result.predictions
                    .filter(pred => pred.confidence >= confidenceThreshold)
                    .map(pred => ({
                        coordinates: {
                            x: pred.x - pred.width / 2,  // Convert center to top-left
                            y: pred.y - pred.height / 2,
                            width: pred.width,
                            height: pred.height
                        },
                        classification: pred.class || pred.class_name || 'detected_region',
                        confidence: pred.confidence || 0.8,
                        original_class: pred.class || pred.class_name || 'detected_region'
                    }));
            } else if (result && result.detections && result.detections.detections) {
                // Already in our expected format
                detections = result.detections.detections.filter(det => det.confidence >= confidenceThreshold);
            } else if (result && Array.isArray(result)) {
                // Array of detections
                detections = result
                    .filter(det => (det.confidence || 0.8) >= confidenceThreshold)
                    .map(det => ({
                        coordinates: det.coordinates || {
                            x: det.x - (det.width || 0) / 2,
                            y: det.y - (det.height || 0) / 2,
                            width: det.width || 0,
                            height: det.height || 0
                        },
                        classification: det.class || det.classification || 'detected_region',
                        confidence: det.confidence || 0.8,
                        original_class: det.class || det.classification || 'detected_region'
                    }));
            }

            // Filter by selected types if filtering is enabled
            if (filterSelected && (selectedZoneTypes.length > 0 || selectedLineTypes.length > 0)) {
                const allowedTypes = [...selectedZoneTypes, ...selectedLineTypes];
                detections = detections.filter(det => 
                    allowedTypes.includes(det.classification) || 
                    allowedTypes.includes(det.original_class)
                );
            }

            // Add detected annotations to the canvas
            await this.addDetectedAnnotations(detections);
            
            // Show success message
            this.showAlert(`Detection completed! Found ${detections.length} zones/lines.`, 'success');

        } catch (error) {
            console.error('Zone/line detection error:', error);
            this.showAlert(`Detection failed: ${error.message}`, 'danger');
        } finally {
            document.getElementById('startDetectionBtn').disabled = false;
        }
    }

    async addDetectedAnnotations(detections) {
        if (!detections || detections.length === 0) {
            this.showAlert('No zones or lines detected', 'info');
            return;
        }

        let successCount = 0;
        const totalCount = detections.length;

        for (const detection of detections) {
            try {
                // Convert detection to our annotation format
                const coords = detection.coordinates;
                const classification = detection.classification;
                const confidence = detection.confidence;
                const originalClass = detection.original_class;

                // Get color for this classification
                const color = this.zoneColors[classification] || '#999999'; // Grey for unknown
                const fillColor = this.hexToRgba(color, 0.1);

                // Convert coordinates to canvas coordinates for display
                const canvasCoords = this.imageToCanvasCoordinates(coords);

                // Create fabric object  
                const rect = new fabric.Rect({
                    left: canvasCoords.x,
                    top: canvasCoords.y,
                    width: canvasCoords.width,
                    height: canvasCoords.height,
                    fill: fillColor,
                    stroke: color,
                    strokeWidth: 2,
                    selectable: true,
                    lockUniScaling: false,
                    lockScalingFlip: false,
                    uniformScaling: false,
                    uniScaleTransform: false,
                    centeredScaling: false,
                    hasRotatingPoint: false,
                    cornerStyle: 'rect',
                    cornerSize: 8,
                    transparentCorners: false,
                    cornerColor: color,
                    lockMovementX: false,
                    lockMovementY: false
                });

                // Add to canvas first
                this.canvas.add(rect);

                // Save to database using the same pattern as manual annotations
                const tempId = 'temp_' + Date.now() + '_' + Math.random();
                const readingOrder = this.annotations.length;
                
                // Create local annotation
                const formattedClass = this.formatClassificationName(classification);
                const localAnnotation = {
                    id: tempId,
                    type: 'bbox',
                    annotation_type: 'bbox', // Add both type fields for compatibility
                    image_id: this.currentImage.id,
                    image: this.currentImage.id, // Add both image fields for compatibility
                    fabricObject: rect,
                    coordinates: coords, // Store original image coordinates
                    classification: classification,
                    label: `${formattedClass} (${Math.round(confidence * 100)}%)`,
                    reading_order: readingOrder,
                    metadata: {
                        confidence: confidence,
                        original_class: originalClass,
                        detected_by: 'roboflow'
                    },
                    transcription: null
                };

                this.annotations.push(localAnnotation);
                rect.annotationId = tempId;

                                // Save to database or local storage
                const annotationData = {
                    image_id: this.currentImage.id,
                    image: this.currentImage.id, // Add both fields for compatibility
                    annotation_type: 'bbox',
                    type: 'bbox', // Add both type fields for compatibility
                    coordinates: coords, // Use original image coordinates
                    classification: classification,
                    label: `${formattedClass} (${Math.round(confidence * 100)}%)`,
                    reading_order: readingOrder,
                    metadata: {
                        confidence: confidence,
                        original_class: originalClass,
                        detected_by: 'roboflow'
                    }
                };

                if (this.isBrowserCacheMode) {
                    // Save to IndexedDB in browser cache mode
                    try {
                        const savedAnnotation = await this.localStorage.add('annotations', annotationData);
                        
                        // Update local annotation with real ID and preserve all fields
                        const annotationIndex = this.annotations.findIndex(a => a.id === tempId);
                        if (annotationIndex !== -1) {
                            this.annotations[annotationIndex].id = savedAnnotation.id;
                            this.annotations[annotationIndex].image_id = savedAnnotation.image_id; // Preserve image reference
                            this.annotations[annotationIndex].annotation_type = savedAnnotation.annotation_type; // Preserve type field
                            this.annotations[annotationIndex].reading_order = savedAnnotation.reading_order;
                            this.annotations[annotationIndex].created_at = savedAnnotation.created_at;
                            this.annotations[annotationIndex].updated_at = savedAnnotation.updated_at;
                            rect.annotationId = savedAnnotation.id;
                        }
                        
                        successCount++;
                    } catch (error) {
                        console.error('Failed to save detected annotation to IndexedDB:', error);
                        // Remove from local array and canvas if save failed
                        const failedIndex = this.annotations.findIndex(a => a.id === tempId);
                        if (failedIndex !== -1) {
                            this.annotations.splice(failedIndex, 1);
                        }
                        this.canvas.remove(rect);
                    }
                } else {
                    // Save to server in normal mode
                    const response = await fetch(`${this.apiBaseUrl}/annotations/`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${this.authToken}`
                        },
                        body: JSON.stringify(annotationData)
                    });

                    if (response.ok) {
                        const savedAnnotation = await response.json();
                        
                        // Update local annotation with real ID and preserve all fields
                        const annotationIndex = this.annotations.findIndex(a => a.id === tempId);
                        if (annotationIndex !== -1) {
                            this.annotations[annotationIndex].id = savedAnnotation.id;
                            this.annotations[annotationIndex].image = savedAnnotation.image; // Server uses 'image' field
                            this.annotations[annotationIndex].annotation_type = savedAnnotation.annotation_type; // Preserve type field
                            this.annotations[annotationIndex].reading_order = savedAnnotation.reading_order;
                            this.annotations[annotationIndex].created_at = savedAnnotation.created_at;
                            this.annotations[annotationIndex].updated_at = savedAnnotation.updated_at;
                            rect.annotationId = savedAnnotation.id;
                        }
                        
                        successCount++;
                    } else {
                        console.error('Failed to save detected annotation:', await response.text());
                        // Remove from local array and canvas if save failed
                        const failedIndex = this.annotations.findIndex(a => a.id === tempId);
                        if (failedIndex !== -1) {
                            this.annotations.splice(failedIndex, 1);
                        }
                        this.canvas.remove(rect);
                    }
                }

            } catch (error) {
                console.error('Error processing detected annotation:', error);
            }
        }

        // Update the annotations list in the sidebar
        this.updateAnnotationsList();
        this.canvas.renderAll();

        if (successCount === totalCount) {
            this.showAlert(`Successfully added ${successCount} detected annotations`, 'success');
        } else if (successCount > 0) {
            this.showAlert(`Added ${successCount} of ${totalCount} detected annotations (${totalCount - successCount} failed)`, 'warning');
        } else {
            this.showAlert('Failed to save detected annotations', 'danger');
        }
    }

    // Prompts Management
    populatePromptsList() {
        const container = document.getElementById('promptsList');
        if (!container || !this.customPrompts) return;

        container.innerHTML = '';

        this.customPrompts.forEach(prompt => {
            const promptHtml = `
                <div class="prompt-item ${this.selectedPrompt === prompt.id ? 'active' : ''}" 
                     data-prompt-id="${prompt.id}">
                    <div class="prompt-item-header">
                        <h6 class="prompt-item-title">${prompt.name}</h6>
                        <div class="prompt-item-actions">
                            <button class="btn btn-xs btn-outline-primary" 
                                    onclick="app.editPrompt('${prompt.id}')" title="Edit">
                                <i class="fas fa-edit"></i>
                            </button>
                            ${!prompt.is_default ? `
                                <button class="btn btn-xs btn-outline-danger" 
                                        onclick="app.deletePrompt('${prompt.id}')" title="Delete">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </div>
                    </div>
                    <div class="prompt-item-preview">${prompt.prompt}</div>
                    <div class="prompt-item-zones">
                        ${prompt.zones.map(zone => {
                            const zoneColor = this.zoneColors[zone] || '#6c757d';
                            return `<span class="badge prompt-zone-badge" style="background-color: ${zoneColor}; color: white;">${zone}</span>`;
                        }).join('')}
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', promptHtml);
        });

        // Add click handlers for prompt selection
        container.querySelectorAll('.prompt-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (!e.target.closest('button')) {
                    this.selectPrompt(item.dataset.promptId);
                }
            });
        });
    }

    selectPrompt(promptId) {
        this.selectedPrompt = promptId;
        
        // Update UI
        document.querySelectorAll('.prompt-item').forEach(item => {
            item.classList.remove('active');
        });
        
        const selectedItem = document.querySelector(`[data-prompt-id="${promptId}"]`);
        if (selectedItem) {
            selectedItem.classList.add('active');
        }
    }

    showAddPromptModal() {
        this.currentEditingPrompt = null;
        this.populatePromptModal();
        document.getElementById('promptModalTitle').innerHTML = '<i class="fas fa-comment-dots me-2"></i>Add Prompt';
        
        const modal = new bootstrap.Modal(document.getElementById('promptModal'));
        modal.show();
    }

    editPrompt(promptId) {
        const prompt = this.customPrompts.find(p => p.id === promptId);
        if (!prompt) return;

        this.currentEditingPrompt = prompt;
        this.populatePromptModal(prompt);
        document.getElementById('promptModalTitle').innerHTML = '<i class="fas fa-edit me-2"></i>Edit Prompt';
        
        const modal = new bootstrap.Modal(document.getElementById('promptModal'));
        modal.show();
    }

    populatePromptModal(prompt = null) {
        // Clear form
        document.getElementById('promptForm').reset();
        
        if (prompt) {
            document.getElementById('promptName').value = prompt.name;
            document.getElementById('promptText').value = prompt.prompt;
        }

        // Populate zone types
        this.populatePromptZoneTypes(prompt);
        
        // Populate metadata fields
        this.populatePromptMetadataFields(prompt);
    }

    populatePromptZoneTypes(prompt = null) {
        const container = document.getElementById('promptZoneTypes');
        container.innerHTML = '';

        if (!this.annotationTypes) return;

        // Add zone types
        this.annotationTypes.all_types.zones.forEach(zoneType => {
            const isChecked = prompt && prompt.zones && prompt.zones.includes(zoneType.value);
            const checkboxHtml = `
                <div class="col-md-6">
                    <div class="form-check">
                        <input class="form-check-input" type="checkbox" value="${zoneType.value}" 
                               id="prompt_zone_${zoneType.value}" ${isChecked ? 'checked' : ''}>
                        <label class="form-check-label" for="prompt_zone_${zoneType.value}">
                            ${zoneType.label}
                        </label>
                    </div>
                </div>
            `;
            container.insertAdjacentHTML('beforeend', checkboxHtml);
        });
    }

    populatePromptMetadataFields(prompt = null) {
        const container = document.getElementById('promptMetadataFields');
        container.innerHTML = '';

        const metadataFields = prompt && prompt.metadata_fields ? prompt.metadata_fields : [
            { name: 'handwritten', type: 'boolean', default: false },
            { name: 'typed', type: 'boolean', default: true },
            { name: 'language', type: 'string', default: 'en' }
        ];

        metadataFields.forEach((field, index) => {
            this.addMetadataFieldToPrompt(field, index);
        });
    }

    addMetadataField() {
        const defaultField = { name: '', type: 'string', default: '' };
        const container = document.getElementById('promptMetadataFields');
        const index = container.children.length;
        this.addMetadataFieldToPrompt(defaultField, index);
    }

    addMetadataFieldToPrompt(field, index) {
        const container = document.getElementById('promptMetadataFields');
        
        const fieldHtml = `
            <div class="metadata-field" data-field-index="${index}">
                <div class="metadata-field-header">
                    <h6 class="metadata-field-title">Metadata Field ${index + 1}</h6>
                    <button type="button" class="btn btn-sm btn-outline-danger" 
                            onclick="this.closest('.metadata-field').remove()">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
                <div class="metadata-field-controls">
                    <div>
                        <label class="form-label">Name</label>
                        <input type="text" class="form-control form-control-sm" 
                               name="metadata_name_${index}" value="${field.name}" required>
                    </div>
                    <div>
                        <label class="form-label">Type</label>
                        <select class="form-select form-select-sm" name="metadata_type_${index}">
                            <option value="string" ${field.type === 'string' ? 'selected' : ''}>Text</option>
                            <option value="boolean" ${field.type === 'boolean' ? 'selected' : ''}>Boolean</option>
                            <option value="number" ${field.type === 'number' ? 'selected' : ''}>Number</option>
                        </select>
                    </div>
                    <div>
                        <label class="form-label">Default</label>
                        <input type="text" class="form-control form-control-sm" 
                               name="metadata_default_${index}" value="${field.default}">
                    </div>
                </div>
            </div>
        `;
        
        container.insertAdjacentHTML('beforeend', fieldHtml);
    }

    async savePrompt() {
        const name = document.getElementById('promptName').value.trim();
        const promptText = document.getElementById('promptText').value.trim();

        if (!name || !promptText) {
            this.showAlert('Please fill in all required fields', 'warning');
            return;
        }

        // Collect selected zones
        const selectedZones = [];
        document.querySelectorAll('#promptZoneTypes input[type="checkbox"]:checked').forEach(checkbox => {
            selectedZones.push(checkbox.value);
        });

        if (selectedZones.length === 0) {
            this.showAlert('Please select at least one zone type', 'warning');
            return;
        }

        // Collect metadata fields
        const metadataFields = [];
        document.querySelectorAll('.metadata-field').forEach(fieldElement => {
            const index = fieldElement.dataset.fieldIndex;
            const nameInput = fieldElement.querySelector(`input[name="metadata_name_${index}"]`);
            const typeSelect = fieldElement.querySelector(`select[name="metadata_type_${index}"]`);
            const defaultInput = fieldElement.querySelector(`input[name="metadata_default_${index}"]`);

            if (nameInput && nameInput.value.trim()) {
                let defaultValue = defaultInput.value;
                if (typeSelect.value === 'boolean') {
                    defaultValue = defaultValue.toLowerCase() === 'true';
                } else if (typeSelect.value === 'number') {
                    defaultValue = parseFloat(defaultValue) || 0;
                }

                metadataFields.push({
                    name: nameInput.value.trim(),
                    type: typeSelect.value,
                    default: defaultValue
                });
            }
        });

        const promptData = {
            id: this.currentEditingPrompt ? this.currentEditingPrompt.id : 'prompt_' + Date.now(),
            name: name,
            prompt: promptText,
            zones: selectedZones,
            metadata_fields: metadataFields,
            is_default: false
        };

        try {
            let updatedPrompts;
            if (this.currentEditingPrompt) {
                // Update existing prompt
                const index = this.customPrompts.findIndex(p => p.id === this.currentEditingPrompt.id);
                if (index !== -1) {
                    this.customPrompts[index] = promptData;
                }
                updatedPrompts = this.customPrompts;
            } else {
                // Add new prompt
                updatedPrompts = [...this.customPrompts, promptData];
            }

            if (this.isBrowserCacheMode) {
                // Save to browser cache (no loading spinner needed for instant local operations)
                await this.localStorage.setSetting('custom_prompts', updatedPrompts);
                
                this.customPrompts = updatedPrompts;
                this.populatePromptsList();
                
                bootstrap.Modal.getInstance(document.getElementById('promptModal')).hide();
                this.showAlert('Prompt saved successfully!', 'success');
            } else {
                // Server operations need loading spinner
                this.showLoading(true);
                
                // Save to backend
                const response = await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({
                        custom_prompts: updatedPrompts
                    })
                });

                if (response.ok) {
                    this.customPrompts = updatedPrompts;
                    this.populatePromptsList();
                    
                    bootstrap.Modal.getInstance(document.getElementById('promptModal')).hide();
                    this.showAlert('Prompt saved successfully!', 'success');
                } else {
                    throw new Error('Failed to save prompt');
                }
            }
        } catch (error) {
            console.error('Error saving prompt:', error);
            this.showAlert('Failed to save prompt', 'danger');
        } finally {
            // Only clear loading if we're in server mode (browser cache mode doesn't use loading spinner)
            if (!this.isBrowserCacheMode) {
                this.showLoading(false);
            }
            this.currentEditingPrompt = null;
        }
    }

    async deletePrompt(promptId) {
        const prompt = this.customPrompts.find(p => p.id === promptId);
        if (!prompt || prompt.is_default) return;

        if (!confirm(`Are you sure you want to delete the prompt "${prompt.name}"?`)) return;

        try {
            const updatedPrompts = this.customPrompts.filter(p => p.id !== promptId);

            if (this.isBrowserCacheMode) {
                // Delete from browser cache (no loading spinner needed for instant local operations)
                await this.localStorage.setSetting('custom_prompts', updatedPrompts);
                
                this.customPrompts = updatedPrompts;
                this.populatePromptsList();
                this.showAlert('Prompt deleted successfully!', 'success');
            } else {
                // Server operations need loading spinner
                this.showLoading(true);
                
                const response = await fetch(`${this.apiBaseUrl}/auth/profile/`, {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({
                        custom_prompts: updatedPrompts
                    })
                });

                if (response.ok) {
                    this.customPrompts = updatedPrompts;
                    this.populatePromptsList();
                    this.showAlert('Prompt deleted successfully!', 'success');
                } else {
                    throw new Error('Failed to delete prompt');
                }
            }
        } catch (error) {
            console.error('Error deleting prompt:', error);
            this.showAlert('Failed to delete prompt', 'danger');
        } finally {
            // Only clear loading if we're in server mode (browser cache mode doesn't use loading spinner)
            if (!this.isBrowserCacheMode) {
                this.showLoading(false);
            }
        }
    }

    // Project and Document Creation
    showCreateProjectModal() {
        const modal = new bootstrap.Modal(document.getElementById('createProjectModal'));
        modal.show();
    }

    async createProject() {
        const name = document.getElementById('projectName').value;
        const description = document.getElementById('projectDescription').value;

        if (!name.trim()) {
            this.showAlert('Project name is required', 'warning');
            return;
        }

        try {
            if (this.isBrowserCacheMode) {
                // Create project in browser cache (no loading spinner needed for instant local operations)
                try {
                    // Ensure database is initialized
                    await this.localStorage.init();
                    
                    const existingProjects = await this.localStorage.getAll('projects');
                    const maxOrder = existingProjects.reduce((max, p) => Math.max(max, p.order || 0), 0);
                    
                    const projectData = {
                        name,
                        description: description || '',
                        order: maxOrder + 1,
                        is_public: false
                    };
                    
                    console.log('Creating project in browser cache:', projectData);
                    const project = await this.localStorage.add('projects', projectData);
                    console.log('Project created successfully:', project);
                    
                    bootstrap.Modal.getInstance(document.getElementById('createProjectModal')).hide();
                    document.getElementById('createProjectForm').reset();
                    
                    // Load projects with error handling
                    try {
                        await this.loadProjects();
                    } catch (error) {
                        console.error('Error loading projects after creation:', error);
                        // Still show success message since project was created
                    }
                    
                    this.showAlert('Project created successfully!', 'success');
                } catch (initError) {
                    console.error('Error creating project in browser cache:', initError);
                    this.showAlert('Failed to create project. Please try again.', 'danger');
                    return;
                }
            } else {
                // Server operations need loading spinner
                this.showLoading(true);
                const response = await this.fetchWithTimeout(`${this.apiBaseUrl}/projects/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({ name, description })
                }, 8000); // 8 second timeout

                if (response.ok) {
                    const project = await response.json();
                    bootstrap.Modal.getInstance(document.getElementById('createProjectModal')).hide();
                    document.getElementById('createProjectForm').reset();
                    await this.loadProjects();
                    this.showAlert('Project created successfully!', 'success');
                } else {
                    const error = await response.json();
                    this.showAlert(error.error || 'Failed to create project', 'danger');
                }
            }
        } catch (error) {
            console.error('Create project error:', error);
            this.showAlert('Failed to create project', 'danger');
        } finally {
            // Only clear loading if we're in server mode (browser cache mode doesn't use loading spinner)
            if (!this.isBrowserCacheMode) {
                this.showLoading(false);
            }
        }
    }

    showCreateDocumentModal(projectId) {
        this.selectedProjectId = projectId;
        const modal = new bootstrap.Modal(document.getElementById('createDocumentModal'));
        
        // Clear form and set the project context in the modal
        document.getElementById('createDocumentForm').reset();
        const modalTitle = document.querySelector('#createDocumentModal .modal-title');
        
        // Find project name for better UX
        const projectItem = document.querySelector(`[data-project-id="${projectId}"]`);
        const projectName = projectItem ? projectItem.querySelector('.tree-text').textContent : 'Unknown Project';
        modalTitle.innerHTML = `<i class="fas fa-file-plus me-2"></i>Create Document in "${projectName}"`;
        
        modal.show();
    }

    async createDocument() {
        const name = document.getElementById('documentName').value;
        const description = document.getElementById('documentDescription').value;
        const readingOrder = document.getElementById('documentReadingOrder').value;

        if (!name.trim()) {
            this.showAlert('Document name is required', 'warning');
            return;
        }

        if (!this.selectedProjectId) {
            this.showAlert('No project selected', 'warning');
            return;
        }

        try {
            const requestData = { 
                name, 
                description, 
                project_id: this.selectedProjectId 
            };
            
            if (readingOrder) {
                requestData.reading_order = readingOrder;
            }

            if (this.isBrowserCacheMode) {
                // Create document in browser cache (no loading spinner needed for instant local operations)
                try {
                    // Ensure database is initialized
                    await this.localStorage.init();
                    
                    const documentData = {
                        name,
                        description: description || '',
                        project_id: this.selectedProjectId,
                        reading_order: readingOrder || null,
                        default_transcription_type: 'full_image'
                    };
                    
                    console.log('Creating document in browser cache:', documentData);
                    const newDocument = await this.localStorage.add('documents', documentData);
                    console.log('Document created successfully:', newDocument);
                    
                    bootstrap.Modal.getInstance(document.getElementById('createDocumentModal')).hide();
                    document.getElementById('createDocumentForm').reset();
                    
                    // Load projects with error handling
                    try {
                        await this.loadProjects();
                    } catch (error) {
                        console.error('Error loading projects after document creation:', error);
                        // Still show success message since document was created
                    }
                    
                    this.showAlert('Document created successfully!', 'success');
                } catch (initError) {
                    console.error('Error creating document in browser cache:', initError);
                    this.showAlert('Failed to create document. Please try again.', 'danger');
                    return;
                }
            } else {
                // Server operations need loading spinner
                this.showLoading(true);
                
                const response = await this.fetchWithTimeout(`${this.apiBaseUrl}/documents/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify(requestData)
                }, 8000); // 8 second timeout

                if (response.ok) {
                    const newDocument = await response.json();
                    bootstrap.Modal.getInstance(document.getElementById('createDocumentModal')).hide();
                    document.getElementById('createDocumentForm').reset();
                    
                    // Refresh the project tree to show the new document
                    const projectContainer = document.querySelector(`[data-project-id="${this.selectedProjectId}"] .tree-children`);
                    if (projectContainer && projectContainer.style.display !== 'none') {
                        projectContainer.innerHTML = ''; // Clear existing content
                        await this.loadProjectDocuments(this.selectedProjectId, projectContainer);
                    }
                    
                    this.showAlert('Document created successfully!', 'success');
                } else {
                    const error = await response.json();
                    this.showAlert(error.error || 'Failed to create document', 'danger');
                }
            }
        } catch (error) {
            console.error('Create document error:', error);
            this.showAlert('Failed to create document', 'danger');
        } finally {
            // Only clear loading if we're in server mode (browser cache mode doesn't use loading spinner)
            if (!this.isBrowserCacheMode) {
                this.showLoading(false);
            }
        }
    }

    showUploadImageModal(documentId) {
        this.selectedDocumentId = documentId;
        const modal = new bootstrap.Modal(document.getElementById('uploadImageModal'));
        
        // Clear form and reset progress
        document.getElementById('uploadImageForm').reset();
        document.getElementById('uploadProgress').style.display = 'none';
        
        // Set context in modal title
        const modalTitle = document.querySelector('#uploadImageModal .modal-title');
        const documentItem = document.querySelector(`[data-document-id="${documentId}"]`);
        const documentName = documentItem ? documentItem.querySelector('.tree-text').textContent : 'Unknown Document';
        modalTitle.innerHTML = `<i class="fas fa-image me-2"></i>Upload Images to "${documentName}"`;
        
        modal.show();
    }

    async uploadImages() {
        const fileInput = document.getElementById('imageFiles');
        const autoTranscribe = document.getElementById('autoTranscribe').checked;
        
        if (!fileInput.files.length) {
            this.showAlert('Please select at least one image', 'warning');
            return;
        }

        if (!this.selectedDocumentId) {
            this.showAlert('No document selected', 'warning');
            return;
        }

        const progressContainer = document.getElementById('uploadProgress');
        const progressBar = progressContainer.querySelector('.progress-bar');
        const statusDiv = document.getElementById('uploadStatus');
        
        progressContainer.style.display = 'block';
        
        const files = Array.from(fileInput.files);
        let uploaded = 0;

                         try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                statusDiv.textContent = `Uploading ${file.name}...`;
                
                if (this.isBrowserCacheMode) {
                    // Store image in browser cache
                    const base64Data = await this.localStorage.fileToBase64(file);
                    
                    // Create image in a way that works with the existing logic
                    const img = new Image();
                    await new Promise((resolve) => {
                        img.onload = async () => {
                            const imageData = {
                                name: file.name.split('.')[0],
                                document_id: this.selectedDocumentId,
                                original_filename: file.name,
                                file_size: file.size,
                                width: img.width,
                                height: img.height,
                                is_processed: true,
                                order: i,
                                image_file: base64Data, // Store as base64
                                image_url: base64Data   // Use base64 as URL for display
                            };
                            
                            const imageRecord = await this.localStorage.add('images', imageData);
                            uploaded++;
                            const progress = (uploaded / files.length) * 100;
                            progressBar.style.width = `${progress}%`;
                            
                            // Auto-transcribe if requested
                            if (autoTranscribe) {
                                statusDiv.textContent = `Transcribing ${file.name}...`;
                                // Note: Auto-transcribe in browser cache mode will be handled separately
                            }
                            
                            resolve();
                        };
                        img.src = base64Data;
                    });
                } else {
                    // Create FormData with image file and metadata
                    const formData = new FormData();
                    formData.append('image_file', file);
                    formData.append('name', file.name.split('.')[0]); // Remove extension for name
                    formData.append('document_id', this.selectedDocumentId);
                    if (i !== undefined) {
                        formData.append('order', i.toString());
                    }

                    const uploadResponse = await fetch(`${this.apiBaseUrl}/images/`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Token ${this.authToken}`
                        },
                        body: formData
                    });

                    if (uploadResponse.ok) {
                        const imageRecord = await uploadResponse.json();
                        uploaded++;
                        const progress = (uploaded / files.length) * 100;
                        progressBar.style.width = `${progress}%`;
                        
                        // Auto-transcribe if requested
                        if (autoTranscribe) {
                            statusDiv.textContent = `Transcribing ${file.name}...`;
                            await this.transcribeImageById(imageRecord.id);
                        }
                    } else {
                        const error = await uploadResponse.json();
                        console.error(`Failed to upload ${file.name}:`, error);
                        this.showAlert(`Failed to upload ${file.name}: ${JSON.stringify(error)}`, 'danger');
                    }
                }
            }

            statusDiv.textContent = `Uploaded ${uploaded} of ${files.length} images`;
            
            // Refresh the document tree to show new images
            const documentContainer = document.querySelector(`[data-document-id="${this.selectedDocumentId}"] .tree-children`);
            if (documentContainer && documentContainer.style.display !== 'none') {
                documentContainer.innerHTML = '';
                await this.loadDocumentImages(this.selectedDocumentId, documentContainer);
            }

            setTimeout(() => {
                bootstrap.Modal.getInstance(document.getElementById('uploadImageModal')).hide();
                this.showAlert(`Successfully uploaded ${uploaded} images!`, 'success');
            }, 1000);

        } catch (error) {
            console.error('Upload error:', error);
            this.showAlert('Upload failed', 'danger');
        }
    }

    async selectImage(imageId) {
        try {
            // Update active state
            document.querySelectorAll('.image-item').forEach(item => {
                item.classList.remove('active');
            });
            document.querySelector(`[data-image-id="${imageId}"]`).classList.add('active');

            // Clear previous image data
            this.clearImageData();

            if (this.isBrowserCacheMode) {
                // Load image from browser cache
                this.currentImage = await this.localStorage.get('images', imageId);
                if (this.currentImage) {
                    this.clearImageData();
                    await this.loadImageInCanvas();
                    // Transcriptions now loaded inside loadImageInCanvas after annotations
                    
                    // Refresh annotation positions after image and transform are set
                    this.refreshAnnotationPositions();
                    
                    // Show image viewer
                    document.getElementById('defaultView').style.display = 'none';
                    document.getElementById('imageViewer').style.display = 'block';
                }
            } else {
                // Load image details from server
                const response = await fetch(`${this.apiBaseUrl}/images/${imageId}/`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                });

                if (response.ok) {
                    this.currentImage = await response.json();
                    this.clearImageData();
                    await this.loadImageInCanvas();
                    // Annotations and transcriptions now loaded inside loadImageInCanvas after proper sequencing
                    
                    // Refresh annotation positions after image and transform are set
                    this.refreshAnnotationPositions();
                    
                    // Show image viewer
                    document.getElementById('defaultView').style.display = 'none';
                    document.getElementById('imageViewer').style.display = 'block';
                }
            }
        } catch (error) {
            console.error('Error selecting image:', error);
            this.showAlert('Failed to load image', 'danger');
        }
    }

    clearImageData() {
        // Clear canvas
        if (this.canvas) {
            this.canvas.clear();
        }
        
        // Clear annotations
        this.annotations = [];
        this.selectedAnnotations = [];
        
        // Clear transcription display
        const transcriptionContent = document.getElementById('transcriptionContent');
        transcriptionContent.innerHTML = '<p class="text-muted">Select an image to view transcription</p>';
        
        // Reset current references
        this.currentFabricImage = null;
        this.originalImageScale = null;
        this.currentImageTranscription = null;
        this.imageTransform = null;
    }

    // Transform coordinates from original image space to canvas space
    transformToCanvas(originalCoords, type) {
        if (!this.imageTransform) return originalCoords;
        
        const { scale, left, top } = this.imageTransform;
        
        if (type === 'bbox') {
            return {
                x: originalCoords.x * scale + left,
                y: originalCoords.y * scale + top,
                width: originalCoords.width * scale,
                height: originalCoords.height * scale
            };
        } else if (type === 'polygon') {
            return {
                points: originalCoords.points.map(point => ({
                    x: point.x * scale + left,
                    y: point.y * scale + top
                }))
            };
        }
        return originalCoords;
    }

    // Transform coordinates from canvas space to original image space
    transformToOriginal(canvasCoords, type) {
        if (!this.imageTransform) return canvasCoords;
        
        const { scale, left, top } = this.imageTransform;
        
        if (type === 'bbox') {
            return {
                x: (canvasCoords.x - left) / scale,
                y: (canvasCoords.y - top) / scale,
                width: canvasCoords.width / scale,
                height: canvasCoords.height / scale
            };
        } else if (type === 'polygon') {
            return {
                points: canvasCoords.points.map(point => ({
                    x: (point.x - left) / scale,
                    y: (point.y - top) / scale
                }))
            };
        }
        return canvasCoords;
    }

    // Refresh annotation positions after image transform changes
    refreshAnnotationPositions() {
        if (!this.annotations || !this.imageTransform) return;
        
        this.annotations.forEach(annotation => {
            if (annotation.fabricObject) {
                const transformedCoords = this.transformToCanvas(annotation.coordinates, annotation.type);
                
                if (annotation.type === 'bbox') {
                    annotation.fabricObject.set({
                        left: transformedCoords.x,
                        top: transformedCoords.y,
                        width: transformedCoords.width,
                        height: transformedCoords.height
                    });
                } else if (annotation.type === 'polygon') {
                    annotation.fabricObject.set({
                        points: transformedCoords.points
                    });
                }
            }
        });
        
        this.canvas.renderAll();
    }

    async loadImageInCanvas() {
        if (!this.currentImage || !this.canvas) return;

        try {
            const imgElement = new Image();
            imgElement.crossOrigin = 'anonymous';
            
            imgElement.onload = async () => {
                // Clear canvas
                this.canvas.clear();
                
                // Get container dimensions
                const container = document.querySelector('.canvas-container');
                const maxContainerWidth = container.clientWidth - 40;
                const maxContainerHeight = container.clientHeight - 40;
                
                // Determine optimal canvas size based on image dimensions
                const imgWidth = imgElement.width;
                const imgHeight = imgElement.height;
                
                // For high-resolution images, allow them to display at full size up to container limits
                let canvasWidth = Math.min(imgWidth, maxContainerWidth, 2000); // Max 2000px wide
                let canvasHeight = Math.min(imgHeight, maxContainerHeight, 1500); // Max 1500px tall
                
                // Ensure minimum canvas size
                canvasWidth = Math.max(canvasWidth, 800);
                canvasHeight = Math.max(canvasHeight, 600);
                
                // Resize canvas to accommodate the image better
                this.canvas.setDimensions({
                    width: canvasWidth,
                    height: canvasHeight
                });
                
                // Create fabric image
                const fabricImg = new fabric.Image(imgElement, {
                    left: 0,
                    top: 0,
                    selectable: false,
                    evented: false
                });

                // Calculate scale - prefer showing image at full resolution when possible
                const scaleX = canvasWidth / imgWidth;
                const scaleY = canvasHeight / imgHeight;
                let scale = Math.min(scaleX, scaleY, 1); // Don't scale up, only down if necessary
                
                // For small images, allow some scaling up (up to 2x)
                if (scale === 1 && imgWidth < 400 && imgHeight < 400) {
                    scale = Math.min(2, Math.min(canvasWidth / imgWidth, canvasHeight / imgHeight));
                }

                fabricImg.scale(scale);
                
                // Center the image
                const scaledWidth = imgWidth * scale;
                const scaledHeight = imgHeight * scale;
                fabricImg.set({
                    left: (canvasWidth - scaledWidth) / 2,
                    top: (canvasHeight - scaledHeight) / 2
                });

                this.canvas.add(fabricImg);
                this.canvas.sendToBack(fabricImg);
                this.canvas.renderAll();
                
                // Store image reference and transformation info for annotations
                this.currentFabricImage = fabricImg;
                this.originalImageScale = scale;
                this.imageTransform = {
                    scale: scale,
                    left: fabricImg.left,
                    top: fabricImg.top,
                    originalWidth: imgWidth,
                    originalHeight: imgHeight
                };

                // Load annotations AFTER image transform is set up
                await this.loadImageAnnotations();
                
                // Load transcriptions AFTER annotations are loaded (for proper linking)
                await this.loadImageTranscriptions();
            };

            // Set image source - in browser cache mode this is base64, in server mode it's a URL
            if (this.isBrowserCacheMode) {
                imgElement.src = this.currentImage.image_file; // Already base64 data URL
            } else {
                imgElement.src = this.currentImage.image_file; // Server URL path
            }
        } catch (error) {
            console.error('Error loading image in canvas:', error);
        }
    }

    async loadImageAnnotations() {
        if (!this.currentImage) return;

        try {
            if (this.isBrowserCacheMode) {
                // Load annotations from browser cache
                const annotations = await this.getAnnotationsForImage(this.currentImage.id);
                // Annotations loaded successfully
                // Sort by reading order
                annotations.sort((a, b) => (a.reading_order || 0) - (b.reading_order || 0));
                this.renderAnnotationsOnCanvas(annotations);
            } else {
                const response = await fetch(`${this.apiBaseUrl}/images/${this.currentImage.id}/annotations/`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                });

                if (response.ok) {
                    const annotations = await response.json();
                    this.renderAnnotationsOnCanvas(annotations);
                }
            }
        } catch (error) {
            console.error('Error loading annotations:', error);
        }
    }

    renderAnnotationsOnCanvas(annotations) {
        // Ensure image transform is ready before rendering annotations
        if (!this.imageTransform) {
            console.warn('Image transform not ready, deferring annotation rendering');
            return;
        }

        // Clear existing annotations from canvas and array
        if (this.canvas) {
            // Remove only annotation objects, preserve the background image
            const objectsToRemove = this.canvas.getObjects().filter(obj => obj.annotationId);
            objectsToRemove.forEach(obj => this.canvas.remove(obj));
        }
        this.annotations = [];
        
        annotations.forEach(annotation => {
            let fabricObject;
            
            // Transform coordinates from original image space to canvas space
            const transformedCoords = this.transformToCanvas(annotation.coordinates, annotation.annotation_type);
            
            // Get color for annotation classification
            const color = annotation.classification ? (this.zoneColors[annotation.classification] || '#0066cc') : '#0066cc';
            const fillColor = this.hexToRgba(color, 0.1);
            
            if (annotation.annotation_type === 'bbox') {
                fabricObject = new fabric.Rect({
                    left: transformedCoords.x,
                    top: transformedCoords.y,
                    width: transformedCoords.width,
                    height: transformedCoords.height,
                    fill: fillColor,
                    stroke: color,
                    strokeWidth: 2,
                    selectable: true,
                    lockUniScaling: false, // Allow free resizing
                    lockScalingFlip: false, // Allow negative scaling
                    uniformScaling: false, // Disable aspect ratio locking
                    uniScaleTransform: false, // Additional property to disable uniform scaling
                    centeredScaling: false, // Disable centered scaling
                    hasRotatingPoint: false, // Disable rotation
                    cornerStyle: 'rect', // Square corners for better UX
                    cornerSize: 8,
                    transparentCorners: false,
                    cornerColor: color,
                    lockMovementX: false,
                    lockMovementY: false
                });
            } else if (annotation.annotation_type === 'polygon') {
                fabricObject = new fabric.Polygon(transformedCoords.points, {
                    fill: fillColor,
                    stroke: color,
                    strokeWidth: 2,
                    selectable: true,
                    hasRotatingPoint: false, // Disable rotation
                    cornerStyle: 'circle', // Circle corners for polygons
                    cornerSize: 6,
                    transparentCorners: false,
                    cornerColor: color
                });
            }

            if (fabricObject) {
                fabricObject.annotationId = annotation.id;
                this.canvas.add(fabricObject);
                
                this.annotations.push({
                    id: annotation.id,
                    type: annotation.annotation_type,
                    fabricObject: fabricObject,
                    coordinates: annotation.coordinates, // Store original coordinates
                    classification: annotation.classification,
                    label: annotation.label,
                    reading_order: annotation.reading_order,
                    metadata: annotation.metadata || {},
                    transcription: null
                });
            }
        });

        this.updateAnnotationsList();
        this.canvas.renderAll();
    }

    async loadImageTranscriptions() {
        if (!this.currentImage) return;

        try {
            if (this.isBrowserCacheMode) {
                // Load transcriptions from browser cache
                const transcriptions = await this.localStorage.getAll('transcriptions', 'image', this.currentImage.id);
                
                // Find the latest full image transcription
                const imageTranscription = transcriptions.find(t => 
                    t.transcription_type === 'full_image' && t.is_current
                );
                
                // Store current image transcription
                this.currentImageTranscription = imageTranscription;

                // Update annotation transcriptions
                transcriptions.forEach(transcription => {
                    if (transcription.transcription_type === 'annotation' && transcription.is_current) {
                        this.updateAnnotationTranscription(transcription.annotation, transcription);
                    }
                });

                // Update the combined transcription display
                this.updateCombinedTranscription();
            } else {
                const response = await fetch(`${this.apiBaseUrl}/transcriptions/?image=${this.currentImage.id}`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                });

                if (response.ok) {
                    const data = await response.json();
                    const transcriptions = data.results;
                    
                    // Find the latest full image transcription
                    const imageTranscription = transcriptions.find(t => 
                        t.transcription_type === 'full_image' && t.is_current
                    );
                    
                    // Store current image transcription
                    this.currentImageTranscription = imageTranscription;

                    // Update annotation transcriptions
                    transcriptions.forEach(transcription => {
                        if (transcription.transcription_type === 'annotation' && transcription.is_current) {
                            this.updateAnnotationTranscription(transcription.annotation.id, transcription);
                        }
                    });

                    // Update the combined transcription display
                    this.updateCombinedTranscription();
                }
            }
        } catch (error) {
            console.error('Error loading transcriptions:', error);
        }
    }

    async transcribeImageById(imageId) {
        const credentials = this.getStoredCredentials();
        const provider = this.getActiveProvider();
        if (!provider) {
            return;
        }

        try {
            const selectedModel = this.getSelectedModel();
            const requestData = {
                transcription_type: 'full_image',
                api_endpoint: selectedModel.provider,
                api_model: selectedModel.model
            };

            if (selectedModel.provider === 'openai') {
                requestData.openai_api_key = credentials.openai_api_key;
            } else if (selectedModel.provider === 'vertex') {
                requestData.vertex_access_token = credentials.vertex_access_token;
                requestData.vertex_project_id = credentials.vertex_project_id;
                requestData.vertex_location = credentials.vertex_location;
                requestData.vertex_model = selectedModel.model;
            } else if (selectedModel.provider === 'custom') {
                requestData.custom_endpoint_url = credentials.custom_endpoint_url;
                requestData.custom_endpoint_auth = credentials.custom_endpoint_auth;
            }

            await fetch(`${this.apiBaseUrl}/images/${imageId}/transcribe/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Token ${this.authToken}`
                },
                body: JSON.stringify(requestData)
            });
        } catch (error) {
            console.error('Auto-transcription error:', error);
        }
    }

    // Panel Management Methods
    toggleLeftPanel() {
        const leftSidebar = document.getElementById('leftSidebar');
        const leftIcon = document.getElementById('leftPanelIcon');
        const leftResizeHandle = document.getElementById('leftResizeHandle');
        const isCollapsed = leftSidebar.classList.contains('collapsed');

        if (isCollapsed) {
            leftSidebar.classList.remove('collapsed');
            leftSidebar.style.width = this.leftPanelWidth || '25%';
            leftIcon.className = 'fas fa-chevron-left';
            if (leftResizeHandle) leftResizeHandle.style.display = 'block';
        } else {
            // Store current width before collapsing
            this.leftPanelWidth = leftSidebar.style.width || '25%';
            leftSidebar.classList.add('collapsed');
            leftSidebar.style.width = '0';
            leftIcon.className = 'fas fa-chevron-right';
            if (leftResizeHandle) leftResizeHandle.style.display = 'none';
        }
        
        // Delay canvas resize to allow for smooth transition
        setTimeout(() => {
            this.resizeCanvas();
        }, 300);
    }

    toggleRightPanel() {
        const rightPanel = document.getElementById('transcriptionPanel');
        const rightIcon = document.getElementById('rightPanelIcon');
        const rightResizeHandle = document.getElementById('rightResizeHandle');
        const isCollapsed = rightPanel.classList.contains('collapsed');

        if (isCollapsed) {
            rightPanel.classList.remove('collapsed');
            rightPanel.style.width = this.rightPanelWidth || '800px';
            rightIcon.className = 'fas fa-chevron-right';
            if (rightResizeHandle) rightResizeHandle.style.display = 'block';
        } else {
            // Store current width before collapsing
            this.rightPanelWidth = rightPanel.style.width || '800px';
            rightPanel.classList.add('collapsed');
            rightPanel.style.width = '0';
            rightIcon.className = 'fas fa-chevron-left';
            if (rightResizeHandle) rightResizeHandle.style.display = 'none';
        }
        
        // Delay canvas resize to allow for smooth transition
        setTimeout(() => {
            this.resizeCanvas();
        }, 300);
    }

    // Transcribe All Regions
    transcribeAllRegions() {
        if (!this.annotations || this.annotations.length === 0) {
            this.showAlert('No annotations found. Please add some regions first.', 'warning');
            return;
        }

        // Check if any annotations already have transcriptions
        const existingTranscriptions = this.annotations.filter(a => a.transcription && a.transcription.text_content);
        
        // Update region count in modal
        document.getElementById('regionCount').textContent = this.annotations.length;
        
        if (existingTranscriptions.length > 0) {
            // Show warning modal
            const modal = new bootstrap.Modal(document.getElementById('transcribeAllModal'));
            modal.show();
        } else {
            // No existing transcriptions, proceed directly
            this.confirmTranscribeAllRegions();
        }
    }

    async confirmTranscribeAllRegions() {
        try {
            // Hide the modal if it's open
            const modalElement = document.getElementById('transcribeAllModal');
            const modal = bootstrap.Modal.getInstance(modalElement);
            if (modal) {
                modal.hide();
            }

            const credentials = this.getStoredCredentials();
            const activeProvider = this.getActiveProvider();
            if (!activeProvider) {
                this.showAlert('Please configure your API credentials first', 'warning');
                this.showCredentialsModal();
                return;
            }

            let successCount = 0;
            let errorCount = 0;

            this.showAlert(`Starting transcription of ${this.annotations.length} regions...`, 'info');

            // Transcribe all annotations with individual progress indicators
            for (const annotation of this.annotations) {
                try {
                    this.showAnnotationProgress(annotation.id, true);
                    await this.transcribeAnnotation(annotation.id, credentials);
                    this.showAnnotationProgress(annotation.id, false);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to transcribe annotation ${annotation.id}:`, error);
                    this.showAnnotationProgress(annotation.id, false);
                    errorCount++;
                }
            }

            // Reload transcriptions to get updated data
            await this.loadImageTranscriptions();

            if (errorCount === 0) {
                this.showAlert(`Successfully transcribed all ${successCount} regions!`, 'success');
            } else {
                this.showAlert(`Transcribed ${successCount} regions. ${errorCount} failed.`, 'warning');
            }

        } catch (error) {
            console.error('Transcribe all regions error:', error);
            this.showAlert('Failed to transcribe regions. Please try again.', 'danger');
        }
    }

    // Panel Resize Functionality
    initPanelResize() {
        const leftResizeHandle = document.getElementById('leftResizeHandle');
        const rightResizeHandle = document.getElementById('rightResizeHandle');
        
        if (leftResizeHandle) {
            this.setupResizeHandle(leftResizeHandle, 'left');
        }
        
        if (rightResizeHandle) {
            this.setupResizeHandle(rightResizeHandle, 'right');
        }
    }

    setupResizeHandle(handle, side) {
        let isResizing = false;
        let startX = 0;
        let startWidth = 0;
        let animationId = null;
        let lastMouseX = 0;

        const updatePanelSize = () => {
            if (!isResizing) return;

            const diff = lastMouseX - startX;
            let newWidth;

            if (side === 'left') {
                newWidth = startWidth + diff;
                const minWidth = 200;
                const maxWidth = window.innerWidth * 0.4;
                
                newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
                
                const leftSidebar = document.getElementById('leftSidebar');
                leftSidebar.style.width = newWidth + 'px';
            } else {
                newWidth = startWidth - diff;
                const minWidth = 300;
                const maxWidth = window.innerWidth * 0.6;
                
                newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
                
                const rightPanel = document.getElementById('transcriptionPanel');
                rightPanel.style.width = newWidth + 'px';
            }

            // Use throttled canvas resize for better performance
            this.throttledResizeCanvas();
        };

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            lastMouseX = e.clientX;
            
            const panel = side === 'left' ? 
                document.getElementById('leftSidebar') : 
                document.getElementById('transcriptionPanel');
            
            startWidth = parseInt(window.getComputedStyle(panel).width, 10);
            
            document.body.classList.add('resizing');
            document.body.classList.add('no-select');
            
            // Start animation loop
            const animate = () => {
                if (isResizing) {
                    updatePanelSize();
                    animationId = requestAnimationFrame(animate);
                }
            };
            animationId = requestAnimationFrame(animate);
            
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            lastMouseX = e.clientX;
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                document.body.classList.remove('resizing');
                document.body.classList.remove('no-select');
                
                if (animationId) {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
                
                // Final canvas resize
                this.resizeCanvas();
            }
        });
    }

    // Canvas Tools
    zoomIn() {
        if (this.canvas) {
            const currentZoom = this.canvas.getZoom();
            const newZoom = Math.min(currentZoom * 1.2, 5); // Max 5x zoom
            this.canvas.setZoom(newZoom);
            this.canvas.renderAll();
        }
    }

    zoomOut() {
        if (this.canvas) {
            const currentZoom = this.canvas.getZoom();
            const newZoom = Math.max(currentZoom * 0.8, 0.1); // Min 0.1x zoom
            this.canvas.setZoom(newZoom);
            this.canvas.renderAll();
        }
    }

    resetZoom() {
        if (this.canvas) {
            this.canvas.setZoom(1);
            this.canvas.absolutePan({ x: 0, y: 0 });
            this.canvas.renderAll();
        }
    }

    // Add a fit-to-screen zoom function
    fitToScreen() {
        if (this.canvas && this.currentFabricImage) {
            const canvasWidth = this.canvas.getWidth();
            const canvasHeight = this.canvas.getHeight();
            const imgWidth = this.currentFabricImage.width * this.currentFabricImage.scaleX;
            const imgHeight = this.currentFabricImage.height * this.currentFabricImage.scaleY;
            
            const scaleX = canvasWidth / imgWidth;
            const scaleY = canvasHeight / imgHeight;
            const zoom = Math.min(scaleX, scaleY, 1);
            
            this.canvas.setZoom(zoom);
            this.canvas.absolutePan({ x: 0, y: 0 });
            this.canvas.renderAll();
        }
    }

    // Keyboard Shortcuts
    async handleKeyboard(event) {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }

        switch (event.key) {
            case 'Escape':
                if (this.currentTool === 'polygon' && this.currentPolygon) {
                    await this.finishPolygon();
                }
                break;
            case 'Delete':
                await this.deleteSelectedAnnotations();
                break;
            case '1':
                this.setTool('select');
                break;
            case '2':
                this.setTool('bbox');
                break;
            case '3':
                this.setTool('polygon');
                break;
        }
    }

    async deleteSelectedAnnotations() {
        if (this.canvas && this.canvas.getActiveObjects().length > 0) {
            const objectsToDelete = this.canvas.getActiveObjects();
            
            for (const obj of objectsToDelete) {
                if (obj.annotationId) {
                    // Delete from database if it's not a temp annotation
                    if (!obj.annotationId.startsWith('temp_')) {
                        try {
                            if (this.isBrowserCacheMode) {
                                // Delete from browser cache
                                await this.localStorage.delete('annotations', obj.annotationId);
                            } else {
                                // Use server API
                                await fetch(`${this.apiBaseUrl}/annotations/${obj.annotationId}/`, {
                                    method: 'DELETE',
                                    headers: {
                                        'Authorization': `Token ${this.authToken}`
                                    }
                                });
                            }
                        } catch (error) {
                            console.error('Error deleting annotation:', obj.annotationId, error);
                        }
                    }
                    
                    // Remove from local annotations array
                    this.annotations = this.annotations.filter(a => a.id !== obj.annotationId);
                }
                
                // Remove from canvas
                this.canvas.remove(obj);
            }
            
            this.canvas.discardActiveObject();
            this.updateAnnotationsList();
        }
    }

    // IIIF Import Methods
    showIIIFImportModal() {
        const modalElement = document.getElementById('iiifImportModal');
        const modal = new bootstrap.Modal(modalElement);
        
        // Reset form when modal is closed
        modalElement.addEventListener('hidden.bs.modal', () => {
            document.getElementById('iiifManifestUrl').value = '';
            document.getElementById('iiifMaxWidth').value = '1000';
            document.getElementById('iiifImportProgress').style.display = 'none';
        }, { once: true });
        
        modal.show();
    }

    setExampleManifest(url) {
        document.getElementById('iiifManifestUrl').value = url;
    }

    async importIIIFManifest() {
        const manifestUrl = document.getElementById('iiifManifestUrl').value.trim();
        const maxWidth = document.getElementById('iiifMaxWidth').value;
        
        if (!manifestUrl) {
            this.showAlert('Please enter a manifest URL', 'warning');
            return;
        }

        const progressDiv = document.getElementById('iiifImportProgress');
        const statusDiv = document.getElementById('iiifImportStatus');
        
        try {
            progressDiv.style.display = 'block';
            statusDiv.textContent = 'Fetching manifest...';
            
            if (this.isBrowserCacheMode) {
                // Handle IIIF import in browser cache mode
                await this.importIIIFToBrowserCache(manifestUrl, maxWidth, statusDiv);
            } else {
                // Handle IIIF import in server mode
                const response = await fetch(`${this.apiBaseUrl}/iiif/import/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify({ 
                        manifest_url: manifestUrl,
                        max_width: maxWidth
                    })
                });

                if (response.ok) {
                    const result = await response.json();
                    statusDiv.textContent = `Success! Created project "${result.project.name}" with ${result.images_created} images.`;
                    
                    // Close modal after 2 seconds and refresh projects
                    setTimeout(() => {
                        const modal = bootstrap.Modal.getInstance(document.getElementById('iiifImportModal'));
                        modal.hide();
                        this.loadProjects();
                        progressDiv.style.display = 'none';
                        document.getElementById('iiifManifestUrl').value = '';
                        document.getElementById('iiifMaxWidth').value = '1000';
                    }, 2000);
                    
                    this.showAlert(result.message, 'success');
                } else {
                    const error = await response.json();
                    statusDiv.textContent = `Error: ${error.error}`;
                    this.showAlert(error.error || 'Import failed', 'danger');
                }
            }
        } catch (error) {
            console.error('IIIF import error:', error);
            statusDiv.textContent = `Error: ${error.message}`;
            this.showAlert('Import failed', 'danger');
        }
    }

    async importIIIFToBrowserCache(manifestUrl, maxWidth, statusDiv) {
        try {
            // Ensure database is initialized
            await this.localStorage.init();
            
            statusDiv.textContent = 'Fetching IIIF manifest...';
            
            // Fetch the IIIF manifest
            const manifestResponse = await fetch(manifestUrl);
            if (!manifestResponse.ok) {
                throw new Error(`Failed to fetch manifest: ${manifestResponse.status}`);
            }
            
            const manifest = await manifestResponse.json();
            
            // Validate it's a IIIF manifest
            if (!manifest['@context']) {
                throw new Error('Invalid IIIF manifest - missing @context');
            }
            
            // Extract metadata
            let title = manifest.label || 'IIIF Document';
            if (Array.isArray(title)) {
                title = title[0] || 'IIIF Document';
            } else if (typeof title === 'object') {
                title = Object.values(title)[0]?.[0] || 'IIIF Document';
            }
            
            let description = manifest.description || '';
            if (Array.isArray(description)) {
                description = description[0] || '';
            } else if (typeof description === 'object') {
                description = Object.values(description)[0]?.[0] || '';
            }
            
            statusDiv.textContent = 'Creating project and document...';
            
            // Create project
            const existingProjects = await this.localStorage.getAll('projects');
            const maxOrder = existingProjects.reduce((max, p) => Math.max(max, p.order || 0), 0);
            
            const projectData = {
                name: `IIIF: ${title}`,
                description: `Imported from IIIF manifest: ${manifestUrl}\n\n${description}`,
                order: maxOrder + 1,
                is_public: false
            };
            
            const project = await this.localStorage.add('projects', projectData);
            
            // Create document
            const documentData = {
                name: title,
                description: description,
                project_id: project.id,
                reading_order: 0,
                default_transcription_type: 'full_image'
            };
            
            const document = await this.localStorage.add('documents', documentData);
            
            // Extract canvases (support both IIIF 2.0 and 3.0)
            let canvases = [];
            
            if (manifest.sequences) {
                // IIIF 2.0 format
                for (const sequence of manifest.sequences) {
                    canvases = canvases.concat(sequence.canvases || []);
                }
            } else if (manifest.items) {
                // IIIF 3.0 format
                canvases = manifest.items;
            }
            
            if (canvases.length === 0) {
                throw new Error('No canvases found in manifest');
            }
            
            statusDiv.textContent = `Processing ${canvases.length} images...`;
            let imagesCreated = 0;
            
            // Process each canvas/image
            for (let i = 0; i < canvases.length; i++) {
                const canvas = canvases[i];
                
                try {
                    statusDiv.textContent = `Processing image ${i + 1} of ${canvases.length}...`;
                    
                    // Extract canvas label
                    let canvasLabel = canvas.label || `Image ${i + 1}`;
                    if (Array.isArray(canvasLabel)) {
                        canvasLabel = canvasLabel[0] || `Image ${i + 1}`;
                    } else if (typeof canvasLabel === 'object') {
                        canvasLabel = Object.values(canvasLabel)[0]?.[0] || `Image ${i + 1}`;
                    }
                    
                    // Extract image URL (support both IIIF 2.0 and 3.0 with multiple fallbacks)
                    let imageUrl = null;
                    
                    // Debug: log canvas structure only if we can't find an image URL
                    // (moved this check to after URL extraction)
                    
                    if (canvas.images && canvas.images.length > 0) {
                        // IIIF 2.0 format
                        const imageAnnotation = canvas.images[0];
                        if (imageAnnotation && imageAnnotation.resource) {
                            imageUrl = imageAnnotation.resource['@id'] || 
                                      imageAnnotation.resource.id ||
                                      imageAnnotation.resource.service?.['@id'] ||
                                      imageAnnotation.resource.service?.id;
                            
                            // If we found a service URL, construct the full image URL
                            if (imageUrl && (imageUrl.includes('/info.json') || !imageUrl.includes('/full/'))) {
                                // It's an IIIF Image API service, construct full image URL
                                const serviceUrl = imageUrl.replace('/info.json', '');
                                imageUrl = `${serviceUrl}/full/max/0/default.jpg`;
                            }
                        }
                    } else if (canvas.items && canvas.items.length > 0) {
                        // IIIF 3.0 format - handle nested AnnotationPage structure
                        
                        // Look through all items in the canvas
                        for (const item of canvas.items) {
                            if (imageUrl) break; // Found one, stop looking
                            
                            if (item.type === 'AnnotationPage' && item.items) {
                                // This is an AnnotationPage containing Annotations
                                const paintingAnnotation = item.items.find(annotation => 
                                    annotation.motivation === 'painting' && annotation.body
                                );
                                
                                if (paintingAnnotation && paintingAnnotation.body) {
                                    if (Array.isArray(paintingAnnotation.body)) {
                                        // Multiple bodies, find the image one
                                        const imageBody = paintingAnnotation.body.find(body => 
                                            body.type === 'Image' || body.format?.startsWith('image/')
                                        );
                                        imageUrl = imageBody?.id;
                                    } else {
                                        imageUrl = paintingAnnotation.body.id || paintingAnnotation.body['@id'];
                                    }
                                }
                            } else if (item.motivation === 'painting' && item.body) {
                                // Direct annotation (not in AnnotationPage)
                                if (Array.isArray(item.body)) {
                                    const imageBody = item.body.find(body => 
                                        body.type === 'Image' || body.format?.startsWith('image/')
                                    );
                                    imageUrl = imageBody?.id;
                                } else {
                                    imageUrl = item.body.id || item.body['@id'];
                                }
                            }
                        }
                        
                        // If still no URL, try the first item's body regardless of structure
                        if (!imageUrl && canvas.items[0]) {
                            const firstItem = canvas.items[0];
                            if (firstItem.items && firstItem.items[0] && firstItem.items[0].body) {
                                // AnnotationPage -> Annotation -> body
                                const body = firstItem.items[0].body;
                                imageUrl = body.id || body['@id'];
                            } else if (firstItem.body) {
                                // Direct body
                                imageUrl = firstItem.body.id || firstItem.body['@id'];
                            }
                        }
                    }
                    
                    // Approach 3: Try direct canvas properties (some manifests have this)
                    if (!imageUrl) {
                        if (canvas.service) {
                            const service = Array.isArray(canvas.service) ? canvas.service[0] : canvas.service;
                            if (service && (service.id || service['@id'])) {
                                const serviceUrl = service.id || service['@id'];
                                imageUrl = `${serviceUrl}/full/max/0/default.jpg`;
                            }
                        } else if (canvas['@id'] && canvas['@id'].includes('/canvas/')) {
                            // Sometimes the canvas ID can help us construct the image URL
                            console.log(`Canvas ${i} has @id but no clear image URL:`, canvas['@id']);
                        }
                    }
                    
                    if (!imageUrl) {
                        console.warn(`No image URL found for canvas ${i}. Canvas keys:`, Object.keys(canvas));
                        if (i <= 5) {
                            // Only show full structure for first few failed canvases to avoid spam
                            console.warn(`Canvas ${i} full structure:`, canvas);
                        }
                        continue;
                    }
                    
                    console.log(`Canvas ${i}: Found image URL: ${imageUrl}`);
                    
                    // Add size parameter if it's an IIIF Image API URL
                    if (imageUrl && maxWidth && maxWidth !== '1000') {
                        if (imageUrl.includes('/full/max/0/default.jpg')) {
                            // Replace max with specific width
                            imageUrl = imageUrl.replace('/full/max/', `/full/${maxWidth},/`);
                        } else if (imageUrl.includes('/full/full/0/default.jpg')) {
                            // Replace second 'full' with width parameter
                            imageUrl = imageUrl.replace('/full/full/', `/full/${maxWidth},/`);
                        } else if (imageUrl.includes('/full/') && !imageUrl.includes(`${maxWidth},`)) {
                            // Add width parameter to existing full URL
                            imageUrl = imageUrl.replace('/full/', `/${maxWidth},/`);
                        }
                    }
                    
                    // Download image and convert to base64
                    const imageResponse = await fetch(imageUrl);
                    if (!imageResponse.ok) {
                        console.warn(`Failed to download image: ${imageUrl}`);
                        continue;
                    }
                    
                    const imageBlob = await imageResponse.blob();
                    const base64Data = await this.blobToBase64(imageBlob);
                    
                    // Get image dimensions by creating a temporary image element
                    const { width, height } = await this.getImageDimensions(base64Data);
                    
                    // Create image record
                    const imageData = {
                        name: canvasLabel,
                        document_id: document.id,
                        original_filename: `${canvasLabel.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`,
                        width: width,
                        height: height,
                        file_size: imageBlob.size,
                        is_processed: true,
                        order: i,
                        image_file: base64Data // Store as base64 data URL
                    };
                    
                    await this.localStorage.add('images', imageData);
                    imagesCreated++;
                    
                } catch (imageError) {
                    console.error(`Failed to process canvas ${i}:`, imageError);
                    // Continue with next image
                }
            }
            
            statusDiv.textContent = `Success! Created project "${project.name}" with ${imagesCreated} images.`;
            
            // Close modal after 2 seconds and refresh projects
            setTimeout(() => {
                const modal = bootstrap.Modal.getInstance(document.getElementById('iiifImportModal'));
                modal.hide();
                this.loadProjects();
                document.getElementById('iiifImportProgress').style.display = 'none';
                document.getElementById('iiifManifestUrl').value = '';
                document.getElementById('iiifMaxWidth').value = '1000';
            }, 2000);
            
            this.showAlert(`IIIF manifest imported successfully! Created ${imagesCreated} images.`, 'success');
            
        } catch (error) {
            throw new Error(`IIIF import failed: ${error.message}`);
        }
    }

    // Helper method to convert blob to base64
    async blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    // Helper method to get image dimensions from base64 data
    async getImageDimensions(base64Data) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.width, height: img.height });
            };
            img.onerror = reject;
            img.src = base64Data;
        });
    }

    // Bulk Selection Methods
    toggleBulkSelect() {
        this.bulkSelectMode = !this.bulkSelectMode;
        this.selectedItems = new Set();
        
        const bulkSelectBtn = document.getElementById('bulkSelectBtn');
        const bulkActionsBar = document.getElementById('bulkActionsBar');
        const projectTree = document.getElementById('projectTree');
        
        if (this.bulkSelectMode) {
            bulkSelectBtn.classList.remove('btn-outline-danger');
            bulkSelectBtn.classList.add('btn-danger');
            bulkSelectBtn.innerHTML = '<i class="fas fa-times"></i>';
            bulkActionsBar.style.display = 'block';
            projectTree.classList.add('bulk-select-mode');
            
            // Add checkboxes to all items
            this.addBulkSelectCheckboxes();
        } else {
            bulkSelectBtn.classList.remove('btn-danger');
            bulkSelectBtn.classList.add('btn-outline-danger');
            bulkSelectBtn.innerHTML = '<i class="fas fa-check-square"></i>';
            bulkActionsBar.style.display = 'none';
            projectTree.classList.remove('bulk-select-mode');
            
            // Remove checkboxes
            this.removeBulkSelectCheckboxes();
        }
        
        this.updateSelectedCount();
    }

    addBulkSelectCheckboxes() {
        const treeItems = document.querySelectorAll('.tree-item');
        treeItems.forEach(item => {
            if (item.dataset.projectId || item.dataset.documentId || item.dataset.imageId) {
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'form-check-input bulk-select-checkbox';
                checkbox.addEventListener('change', (e) => {
                    e.stopPropagation();
                    this.handleBulkSelect(item, checkbox.checked);
                });
                
                const content = item.querySelector('.tree-item-content');
                content.style.position = 'relative';
                content.appendChild(checkbox);
                
                item.classList.add('bulk-selectable');
            }
        });
    }

    removeBulkSelectCheckboxes() {
        const checkboxes = document.querySelectorAll('.bulk-select-checkbox');
        checkboxes.forEach(checkbox => checkbox.remove());
        
        const treeItems = document.querySelectorAll('.tree-item');
        treeItems.forEach(item => {
            item.classList.remove('bulk-selectable', 'bulk-selected');
        });
    }

    handleBulkSelect(item, selected) {
        const itemId = item.dataset.projectId || item.dataset.documentId || item.dataset.imageId;
        const itemType = item.dataset.projectId ? 'project' : 
                        (item.dataset.documentId ? 'document' : 'image');
        
        if (selected) {
            this.selectedItems.add({ id: itemId, type: itemType, element: item });
            item.classList.add('bulk-selected');
        } else {
            this.selectedItems = new Set([...this.selectedItems].filter(i => i.id !== itemId));
            item.classList.remove('bulk-selected');
        }
        
        this.updateSelectedCount();
    }

    updateSelectedCount() {
        const count = this.selectedItems.size;
        document.getElementById('selectedCount').textContent = `${count} selected`;
    }

    clearSelection() {
        this.selectedItems.clear();
        const checkboxes = document.querySelectorAll('.bulk-select-checkbox');
        checkboxes.forEach(checkbox => checkbox.checked = false);
        
        const selectedItems = document.querySelectorAll('.bulk-selected');
        selectedItems.forEach(item => item.classList.remove('bulk-selected'));
        
        this.updateSelectedCount();
    }

    bulkDeleteSelected() {
        if (this.selectedItems.size === 0) {
            this.showAlert('No items selected', 'warning');
            return;
        }

        // Group items by type
        const itemsByType = {
            project: [],
            document: [],
            image: []
        };
        
        this.selectedItems.forEach(item => {
            itemsByType[item.type].push(item);
        });

        // Show confirmation modal
        const modal = new bootstrap.Modal(document.getElementById('bulkDeleteModal'));
        document.getElementById('bulkDeleteCount').textContent = this.selectedItems.size;
        
        let detailsHtml = '';
        if (itemsByType.project.length > 0) {
            detailsHtml += `<strong>Projects:</strong> ${itemsByType.project.length}<br>`;
        }
        if (itemsByType.document.length > 0) {
            detailsHtml += `<strong>Documents:</strong> ${itemsByType.document.length}<br>`;
        }
        if (itemsByType.image.length > 0) {
            detailsHtml += `<strong>Images:</strong> ${itemsByType.image.length}<br>`;
        }
        
        document.getElementById('bulkDeleteDetails').innerHTML = detailsHtml;
        
        // Store items for confirmation
        this.pendingDeleteItems = itemsByType;
        
        modal.show();
    }

    async confirmBulkDelete() {
        const modal = bootstrap.Modal.getInstance(document.getElementById('bulkDeleteModal'));
        modal.hide();

        try {
            let totalDeleted = 0;

            if (this.isBrowserCacheMode) {
                // Handle browser cache mode with individual deletions
                
                // Delete in order: images first, then documents, then projects
                if (this.pendingDeleteItems.image.length > 0) {
                    for (const imageItem of this.pendingDeleteItems.image) {
                        // Delete annotations for this image
                        const annotations = await this.localStorage.getAll('annotations', 'image_id', imageItem.id);
                        for (const annotation of annotations) {
                            await this.localStorage.delete('annotations', annotation.id);
                        }
                        
                        // Delete transcriptions for this image
                        const transcriptions = await this.localStorage.getAll('transcriptions', 'image', imageItem.id);
                        for (const transcription of transcriptions) {
                            await this.localStorage.delete('transcriptions', transcription.id);
                        }
                        
                        // Delete image
                        await this.localStorage.delete('images', imageItem.id);
                        totalDeleted++;
                    }
                }

                if (this.pendingDeleteItems.document.length > 0) {
                    for (const docItem of this.pendingDeleteItems.document) {
                        // Get all images for this document
                        const images = await this.localStorage.getAll('images', 'document_id', docItem.id);
                        
                        for (const image of images) {
                            // Delete annotations for this image
                            const annotations = await this.localStorage.getAll('annotations', 'image_id', image.id);
                            for (const annotation of annotations) {
                                await this.localStorage.delete('annotations', annotation.id);
                            }
                            
                            // Delete transcriptions for this image
                            const transcriptions = await this.localStorage.getAll('transcriptions', 'image', image.id);
                            for (const transcription of transcriptions) {
                                await this.localStorage.delete('transcriptions', transcription.id);
                            }
                            
                            // Delete image
                            await this.localStorage.delete('images', image.id);
                        }
                        
                        // Delete document
                        await this.localStorage.delete('documents', docItem.id);
                        totalDeleted++;
                    }
                }

                if (this.pendingDeleteItems.project.length > 0) {
                    for (const projectItem of this.pendingDeleteItems.project) {
                        // Get all documents for this project
                        const documents = await this.localStorage.getAll('documents', 'project_id', projectItem.id);
                        
                        // Delete all related data
                        for (const document of documents) {
                            // Get all images for this document
                            const images = await this.localStorage.getAll('images', 'document_id', document.id);
                            
                            for (const image of images) {
                                // Delete annotations for this image
                                const annotations = await this.localStorage.getAll('annotations', 'image_id', image.id);
                                for (const annotation of annotations) {
                                    await this.localStorage.delete('annotations', annotation.id);
                                }
                                
                                // Delete transcriptions for this image
                                const transcriptions = await this.localStorage.getAll('transcriptions', 'image', image.id);
                                for (const transcription of transcriptions) {
                                    await this.localStorage.delete('transcriptions', transcription.id);
                                }
                                
                                // Delete image
                                await this.localStorage.delete('images', image.id);
                            }
                            
                            // Delete document
                            await this.localStorage.delete('documents', document.id);
                        }
                        
                        // Delete project
                        await this.localStorage.delete('projects', projectItem.id);
                        totalDeleted++;
                    }
                }
            } else {
                // Use server API for bulk deletions
                
                // Delete in order: images first, then documents, then projects
                if (this.pendingDeleteItems.image.length > 0) {
                    const imageIds = this.pendingDeleteItems.image.map(item => item.id);
                    const response = await fetch(`${this.apiBaseUrl}/images/bulk_delete/`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${this.authToken}`
                        },
                        body: JSON.stringify({ image_ids: imageIds })
                    });
                    
                    if (response.ok) {
                        const result = await response.json();
                        totalDeleted += result.deleted_count;
                    } else {
                        throw new Error('Failed to delete images');
                    }
                }

                if (this.pendingDeleteItems.document.length > 0) {
                    const documentIds = this.pendingDeleteItems.document.map(item => item.id);
                    const response = await fetch(`${this.apiBaseUrl}/documents/bulk_delete/`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${this.authToken}`
                        },
                        body: JSON.stringify({ document_ids: documentIds })
                    });
                    
                    if (response.ok) {
                        const result = await response.json();
                        totalDeleted += result.deleted_count;
                    } else {
                        throw new Error('Failed to delete documents');
                    }
                }

                if (this.pendingDeleteItems.project.length > 0) {
                    const projectIds = this.pendingDeleteItems.project.map(item => item.id);
                    const response = await fetch(`${this.apiBaseUrl}/projects/bulk_delete/`, {
                        method: 'DELETE',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Token ${this.authToken}`
                        },
                        body: JSON.stringify({ project_ids: projectIds })
                    });
                    
                    if (response.ok) {
                        const result = await response.json();
                        totalDeleted += result.deleted_count;
                    } else {
                        throw new Error('Failed to delete projects');
                    }
                }
            }

            this.showAlert(`Successfully deleted ${totalDeleted} items`, 'success');
            
            // Refresh the project tree and clear selection
            await this.loadProjects();
            this.clearSelection();
            this.toggleBulkSelect(); // Exit bulk select mode

        } catch (error) {
            console.error('Bulk delete error:', error);
            this.showAlert('Failed to delete some items', 'danger');
        }

        this.pendingDeleteItems = null;
    }

    // Individual delete methods
    async deleteProject(projectId) {
        if (confirm('Are you sure you want to delete this project? This will delete all documents and images in it.')) {
            try {
                if (this.isBrowserCacheMode) {
                    // Delete from browser cache
                    
                    // Get all documents for this project
                    const documents = await this.localStorage.getAll('documents', 'project_id', projectId);
                    
                    // Delete all related data
                    for (const document of documents) {
                        // Get all images for this document
                        const images = await this.localStorage.getAll('images', 'document_id', document.id);
                        
                        for (const image of images) {
                            // Delete annotations for this image
                            const annotations = await this.localStorage.getAll('annotations', 'image_id', image.id);
                            for (const annotation of annotations) {
                                await this.localStorage.delete('annotations', annotation.id);
                            }
                            
                            // Delete transcriptions for this image
                            const transcriptions = await this.localStorage.getAll('transcriptions', 'image', image.id);
                            for (const transcription of transcriptions) {
                                await this.localStorage.delete('transcriptions', transcription.id);
                            }
                            
                            // Delete image
                            await this.localStorage.delete('images', image.id);
                        }
                        
                        // Delete document
                        await this.localStorage.delete('documents', document.id);
                    }
                    
                    // Delete project
                    await this.localStorage.delete('projects', projectId);
                    
                    this.showAlert('Project deleted successfully', 'success');
                    await this.loadProjects();
                } else {
                    // Use server API
                    const response = await fetch(`${this.apiBaseUrl}/projects/${projectId}/`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Token ${this.authToken}`
                        }
                    });

                    if (response.ok) {
                        this.showAlert('Project deleted successfully', 'success');
                        await this.loadProjects();
                    } else {
                        const error = await response.json();
                        this.showAlert(error.detail || 'Failed to delete project', 'danger');
                    }
                }
            } catch (error) {
                console.error('Delete project error:', error);
                this.showAlert('Failed to delete project', 'danger');
            }
        }
    }

    async deleteDocument(documentId) {
        if (confirm('Are you sure you want to delete this document? This will delete all images in it.')) {
            try {
                if (this.isBrowserCacheMode) {
                    // Delete from browser cache
                    
                    // Get all images for this document
                    const images = await this.localStorage.getAll('images', 'document_id', documentId);
                    
                    for (const image of images) {
                        // Delete annotations for this image
                        const annotations = await this.localStorage.getAll('annotations', 'image_id', image.id);
                        for (const annotation of annotations) {
                            await this.localStorage.delete('annotations', annotation.id);
                        }
                        
                        // Delete transcriptions for this image
                        const transcriptions = await this.localStorage.getAll('transcriptions', 'image', image.id);
                        for (const transcription of transcriptions) {
                            await this.localStorage.delete('transcriptions', transcription.id);
                        }
                        
                        // Delete image
                        await this.localStorage.delete('images', image.id);
                    }
                    
                    // Delete document
                    await this.localStorage.delete('documents', documentId);
                    
                    this.showAlert('Document deleted successfully', 'success');
                    await this.loadProjects();
                } else {
                    // Use server API
                    const response = await fetch(`${this.apiBaseUrl}/documents/${documentId}/`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Token ${this.authToken}`
                        }
                    });

                    if (response.ok) {
                        this.showAlert('Document deleted successfully', 'success');
                        await this.loadProjects();
                    } else {
                        const error = await response.json();
                        this.showAlert(error.detail || 'Failed to delete document', 'danger');
                    }
                }
            } catch (error) {
                console.error('Delete document error:', error);
                this.showAlert('Failed to delete document', 'danger');
            }
        }
    }

    async deleteImage(imageId) {
        if (confirm('Are you sure you want to delete this image?')) {
            try {
                if (this.isBrowserCacheMode) {
                    // Delete from browser cache
                    
                    // Delete annotations for this image
                    const annotations = await this.localStorage.getAll('annotations', 'image_id', imageId);
                    for (const annotation of annotations) {
                        await this.localStorage.delete('annotations', annotation.id);
                    }
                    
                    // Delete transcriptions for this image
                    const transcriptions = await this.localStorage.getAll('transcriptions', 'image', imageId);
                    for (const transcription of transcriptions) {
                        await this.localStorage.delete('transcriptions', transcription.id);
                    }
                    
                    // Delete image
                    await this.localStorage.delete('images', imageId);
                    
                    this.showAlert('Image deleted successfully', 'success');
                    await this.loadProjects();
                    
                    // If this was the current image, clear the viewer
                    if (this.currentImage && this.currentImage.id === imageId) {
                        this.currentImage = null;
                        this.canvas.clear();
                        document.getElementById('transcriptionContent').innerHTML = 
                            '<p class="text-muted">Select an image to view transcription</p>';
                    }
                } else {
                    // Use server API
                    const response = await fetch(`${this.apiBaseUrl}/images/${imageId}/`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Token ${this.authToken}`
                        }
                    });

                    if (response.ok) {
                        this.showAlert('Image deleted successfully', 'success');
                        await this.loadProjects();
                        
                        // If this was the current image, clear the viewer
                        if (this.currentImage && this.currentImage.id === imageId) {
                            this.currentImage = null;
                            this.canvas.clear();
                            document.getElementById('transcriptionContent').innerHTML = 
                                '<p class="text-muted">Select an image to view transcription</p>';
                        }
                    } else {
                        const error = await response.json();
                        this.showAlert(error.detail || 'Failed to delete image', 'danger');
                    }
                }
            } catch (error) {
                console.error('Delete image error:', error);
                this.showAlert('Failed to delete image', 'danger');
            }
        }
    }

    // Export functionality
    async showExportsModal() {
        const modal = new bootstrap.Modal(document.getElementById('exportProjectsModal'));
        modal.show();
        // Load projects for export selection
        await this.loadProjectsForExport();
    }

    async loadProjectsForExport() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/export/projects/`, {
                headers: {
                    'Authorization': `Token ${this.authToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                this.renderProjectsForExport(data.projects);
            } else {
                throw new Error('Failed to load projects for export');
            }
        } catch (error) {
            console.error('Load projects for export error:', error);
            document.getElementById('exportProjectsList').innerHTML = 
                '<div class="text-center text-danger p-3"><i class="fas fa-exclamation-triangle me-2"></i>Failed to load projects</div>';
        }
    }

    renderProjectsForExport(projects) {
        const container = document.getElementById('exportProjectsList');
        
        if (projects.length === 0) {
            container.innerHTML = '<div class="text-center text-muted p-3">No projects available for export</div>';
            return;
        }

        let html = '';
        projects.forEach(project => {
            html += `
                <div class="form-check mb-2">
                    <input class="form-check-input export-project-checkbox" type="checkbox" 
                           value="${project.id}" id="exportProject_${project.id}">
                    <label class="form-check-label w-100" for="exportProject_${project.id}">
                        <div class="d-flex justify-content-between align-items-start">
                            <div>
                                <strong>${this.escapeHtml(project.name)}</strong>
                                ${project.is_owner ? '<span class="badge bg-primary ms-2">Owner</span>' : '<span class="badge bg-secondary ms-2">Shared</span>'}
                                <br>
                                <small class="text-muted">${this.escapeHtml(project.description || 'No description')}</small>
                            </div>
                            <div class="text-end">
                                <small class="text-muted">
                                    ${project.document_count} docs, ${project.total_images} images<br>
                                    Updated: ${new Date(project.updated_at).toLocaleDateString()}
                                </small>
                            </div>
                        </div>
                    </label>
                </div>
            `;
        });

        container.innerHTML = html;
    }

    selectAllProjectsForExport() {
        const checkboxes = document.querySelectorAll('.export-project-checkbox');
        checkboxes.forEach(checkbox => checkbox.checked = true);
    }

    clearAllProjectsForExport() {
        const checkboxes = document.querySelectorAll('.export-project-checkbox');
        checkboxes.forEach(checkbox => checkbox.checked = false);
    }

    async startExport() {
        const selectedProjectIds = Array.from(document.querySelectorAll('.export-project-checkbox:checked'))
            .map(checkbox => checkbox.value);

        if (selectedProjectIds.length === 0) {
            this.showAlert('Please select at least one project to export', 'warning');
            return;
        }

        const exportFormat = document.getElementById('exportFormat').value;

        // Hide the export projects modal
        const exportModal = bootstrap.Modal.getInstance(document.getElementById('exportProjectsModal'));
        exportModal.hide();

        // Show the export status modal
        const statusModal = new bootstrap.Modal(document.getElementById('exportStatusModal'), {
            backdrop: 'static',
            keyboard: false
        });
        statusModal.show();

        // Reset status modal
        document.getElementById('exportSpinner').style.display = 'block';
        document.getElementById('exportResult').style.display = 'none';
        document.getElementById('exportError').style.display = 'none';
        document.getElementById('exportStatusText').textContent = 'Processing your export...';
        document.getElementById('exportStatusDetail').textContent = 
            `Exporting ${selectedProjectIds.length} project(s) in ${exportFormat} format. This may take a few minutes.`;

        try {
            const response = await fetch(`${this.apiBaseUrl}/export/bulk/`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Token ${this.authToken}`
                },
                body: JSON.stringify({
                    project_ids: selectedProjectIds,
                    format: exportFormat
                })
            });

            if (response.ok) {
                const exportJob = await response.json();
                this.currentExportJob = exportJob;

                // Monitor export status
                this.monitorExportStatus(exportJob.id);
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Export failed');
            }
        } catch (error) {
            console.error('Export error:', error);
            
            document.getElementById('exportSpinner').style.display = 'none';
            document.getElementById('exportError').style.display = 'block';
            document.getElementById('exportErrorMessage').textContent = error.message;
        }
    }

    async monitorExportStatus(jobId) {
        const checkStatus = async () => {
            try {
                const response = await fetch(`${this.apiBaseUrl}/export-jobs/${jobId}/`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                });

                if (response.ok) {
                    const job = await response.json();
                    
                    if (job.status === 'completed') {
                        document.getElementById('exportSpinner').style.display = 'none';
                        document.getElementById('exportResult').style.display = 'block';
                        document.getElementById('exportStatusText').textContent = 'Export completed successfully!';
                        document.getElementById('exportStatusDetail').textContent = 
                            `Your export is ready for download (${this.formatFileSize(job.file_size)}).`;
                        
                        this.currentExportJob = job;
                    } else if (job.status === 'failed') {
                        throw new Error(job.error_message || 'Export failed');
                    } else {
                        // Still processing, check again in 2 seconds
                        setTimeout(checkStatus, 2000);
                    }
                } else {
                    throw new Error('Failed to check export status');
                }
            } catch (error) {
                console.error('Export status check error:', error);
                
                document.getElementById('exportSpinner').style.display = 'none';
                document.getElementById('exportError').style.display = 'block';
                document.getElementById('exportErrorMessage').textContent = error.message;
            }
        };

        // Start checking status
        setTimeout(checkStatus, 2000);
    }

    async downloadExportFile() {
        if (this.currentExportJob && this.currentExportJob.id) {
            try {
                const response = await fetch(`${this.apiBaseUrl}/export/download/${this.currentExportJob.id}/`, {
                    headers: {
                        'Authorization': `Token ${this.authToken}`
                    }
                });

                if (response.ok) {
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    
                    // Get filename from Content-Disposition header or use default
                    const contentDisposition = response.headers.get('Content-Disposition');
                    let filename = 'export.zip';
                    if (contentDisposition) {
                        const matches = /filename="([^"]*)"/.exec(contentDisposition);
                        if (matches && matches[1]) {
                            filename = matches[1];
                        }
                    }
                    
                    // Create temporary download link
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    
                    // Clean up
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                } else {
                    throw new Error('Failed to download export file');
                }
            } catch (error) {
                console.error('Download error:', error);
                this.showAlert('Failed to download export file', 'danger');
            }
        }
    }

    formatFileSize(bytes) {
        if (!bytes) return '0 B';
        
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Utility function to safely parse JSON from model responses
    parseModelResponseJson(response) {
        // If the response is already an object, return it as-is
        if (typeof response === 'object' && response !== null) {
            return response;
        }
        
        // Convert to string if not already
        const responseText = String(response || '').trim();
        
        // If empty, return original
        if (!responseText) {
            return response;
        }
        
        try {
            // First try to parse the entire response as JSON
            const parsed = JSON.parse(responseText);
            
            // Handle Vertex AI format: {"text": "", "metadata": {...}}
            if (parsed && typeof parsed === 'object' && parsed.hasOwnProperty('text')) {
                // If it's the Vertex AI format with text and metadata, extract the text content
                if (parsed.hasOwnProperty('metadata')) {
                    return {
                        text_content: parsed.text || '',
                        metadata: parsed.metadata || {},
                        original_response: parsed
                    };
                }
                // If it just has text, return the text content
                return {
                    text_content: parsed.text || '',
                    original_response: parsed
                };
            }
            
            // Return the parsed JSON as-is if it doesn't match expected formats
            return parsed;
        } catch (e) {
            // If that fails, try to extract JSON from the response
            try {
                // Look for JSON in markdown code blocks
                const jsonBlockMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
                if (jsonBlockMatch) {
                    const parsed = JSON.parse(jsonBlockMatch[1]);
                    
                    // Handle Vertex AI format in code blocks
                    if (parsed && typeof parsed === 'object' && parsed.hasOwnProperty('text')) {
                        if (parsed.hasOwnProperty('metadata')) {
                            return {
                                text_content: parsed.text || '',
                                metadata: parsed.metadata || {},
                                original_response: parsed
                            };
                        }
                        return {
                            text_content: parsed.text || '',
                            original_response: parsed
                        };
                    }
                    
                    return parsed;
                }
                
                // Look for plain JSON object
                const jsonMatch = responseText.match(/\{[\s\S]*?\}/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]);
                    
                    // Handle Vertex AI format in extracted JSON
                    if (parsed && typeof parsed === 'object' && parsed.hasOwnProperty('text')) {
                        if (parsed.hasOwnProperty('metadata')) {
                            return {
                                text_content: parsed.text || '',
                                metadata: parsed.metadata || {},
                                original_response: parsed
                            };
                        }
                        return {
                            text_content: parsed.text || '',
                            original_response: parsed
                        };
                    }
                    
                    return parsed;
                }
                
                // If no JSON patterns found, return original response
                return response;
            } catch (parseError) {
                // If all parsing attempts fail, return original response
                console.log('Could not parse JSON from model response:', parseError);
                return response;
            }
        }
    }

    // Project and Document Level Detection and Transcription
    showProjectDetectMenu(projectId, buttonElement) {
        const menuId = `project-detect-menu-${projectId}`;
        this.toggleLevelActionMenu(menuId, buttonElement);
    }

    showDocumentDetectMenu(documentId, buttonElement) {
        const menuId = `document-detect-menu-${documentId}`;
        this.toggleLevelActionMenu(menuId, buttonElement);
    }

    showProjectTranscribeMenu(projectId, buttonElement) {
        const menuId = `project-transcribe-menu-${projectId}`;
        this.toggleLevelActionMenu(menuId, buttonElement);
    }

    showDocumentTranscribeMenu(documentId, buttonElement) {
        const menuId = `document-transcribe-menu-${documentId}`;
        this.toggleLevelActionMenu(menuId, buttonElement);
    }

    toggleLevelActionMenu(menuId, buttonElement) {
        // Close all other open menus first
        document.querySelectorAll('.level-action-menu.show').forEach(menu => {
            if (menu.id !== menuId) {
                menu.classList.remove('show');
            }
        });

        const menu = document.getElementById(menuId);
        if (menu) {
            menu.classList.toggle('show');
            
            // Position menu intelligently to prevent overflow
            if (menu.classList.contains('show')) {
                this.positionDropdownMenu(menu, buttonElement);
                
                // Close menu when clicking elsewhere
                const closeMenu = (event) => {
                    if (!menu.contains(event.target) && !buttonElement.contains(event.target)) {
                        menu.classList.remove('show');
                        // Reset positioning styles
                        menu.style.left = '';
                        menu.style.top = '';
                        menu.style.position = '';
                        document.removeEventListener('click', closeMenu);
                    }
                };
                setTimeout(() => document.addEventListener('click', closeMenu), 0);
            } else {
                // Reset positioning styles when closing
                menu.style.left = '';
                menu.style.top = '';
                menu.style.position = '';
            }
        }
    }

    positionDropdownMenu(menu, buttonElement) {
        // Get viewport and element dimensions
        const buttonRect = buttonElement.getBoundingClientRect();
        const menuWidth = 280; // Our CSS min-width
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const padding = 10; // Padding from screen edges
        
        // Calculate initial position (below the button, aligned to left edge)
        let left = buttonRect.left;
        let top = buttonRect.bottom + 5; // 5px gap below button
        
        // Adjust horizontal position to prevent overflow
        const spaceOnRight = viewportWidth - buttonRect.right;
        
        if (spaceOnRight < menuWidth + padding) {
            // Not enough space on the right, try different positioning
            const spaceOnLeft = buttonRect.left;
            
            if (spaceOnLeft >= menuWidth + padding) {
                // Align to right edge of button
                left = buttonRect.right - menuWidth;
            } else {
                // Center on button if possible
                const buttonCenter = buttonRect.left + (buttonRect.width / 2);
                const menuHalfWidth = menuWidth / 2;
                
                if (buttonCenter - menuHalfWidth >= padding && 
                    buttonCenter + menuHalfWidth <= viewportWidth - padding) {
                    left = buttonCenter - menuHalfWidth;
                } else {
                    // Force it to fit within viewport
                    left = Math.max(padding, Math.min(left, viewportWidth - menuWidth - padding));
                }
            }
        }
        
        // Adjust vertical position if menu would go below viewport
        const menuHeight = 200; // Estimated menu height
        if (top + menuHeight > viewportHeight - padding) {
            // Position above the button instead
            top = buttonRect.top - menuHeight - 5;
            
            // If still doesn't fit, position it at the top of viewport
            if (top < padding) {
                top = padding;
            }
        }
        
        // Apply the calculated position
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.style.position = 'fixed';
    }

        async detectProjectZones(projectId, mode) {
        this.hideLevelActionMenus();
        
        // Check credentials first
        const credentials = this.getStoredCredentials();
        if (!credentials.roboflow_api_key || !credentials.roboflow_workspace_name || !credentials.roboflow_workflow_id) {
            this.showAlert('Please configure Roboflow API settings in the credentials modal first', 'warning');
            this.showCredentialsModal();
            return;
        }

        // Show confirmation for destructive action
        if (mode === 'all') {
            const confirmed = confirm('⚠️ This will remove all existing zones and transcriptions for all images in this project. Are you sure you want to continue?');
            if (!confirmed) return;
        }

        // Store context for zone selection modal
        this.currentDetectionContext = {
            type: 'project',
            id: projectId,
            mode: mode,
            credentials: credentials
        };

        // Show zone selection modal
        this.showZoneSelectionModal();
    }

         async detectDocumentZones(documentId, mode) {
        this.hideLevelActionMenus();
        
        // Check credentials first
        const credentials = this.getStoredCredentials();
        if (!credentials.roboflow_api_key || !credentials.roboflow_workspace_name || !credentials.roboflow_workflow_id) {
            this.showAlert('Please configure Roboflow API settings in the credentials modal first', 'warning');
            this.showCredentialsModal();
            return;
        }

        // Show confirmation for destructive action
        if (mode === 'all') {
            const confirmed = confirm('⚠️ This will remove all existing zones and transcriptions for all images in this document. Are you sure you want to continue?');
            if (!confirmed) return;
        }

        // Store context for zone selection modal
        this.currentDetectionContext = {
            type: 'document',
            id: documentId,
            mode: mode,
            credentials: credentials
        };

        // Show zone selection modal
        this.showZoneSelectionModal();
    }

     async detectZonesForImage(imageId, credentials, clearExisting = false) {
         try {
             const response = await fetch(`${this.apiBaseUrl}/images/${imageId}/detect-zones-lines/`, {
                 method: 'POST',
                 headers: {
                     'Authorization': `Token ${this.authToken}`,
                     'Content-Type': 'application/json'
                 },
                 body: JSON.stringify({
                     roboflow_api_key: credentials.roboflow_api_key,
                     filter_selected_types: false,
                     clear_existing: clearExisting,
                     selected_zone_types: [],
                     selected_line_types: []
                 })
             });

             const result = await response.json();

             if (response.ok && result.detections && result.detections.detections) {
                 return { success: true, count: result.detections.detections.length };
             } else {
                 console.error(`Detection failed for image ${imageId}:`, result.error);
                 return { success: false, count: 0 };
             }
         } catch (error) {
             console.error(`Error detecting zones for image ${imageId}:`, error);
             return { success: false, count: 0 };
         }
     }

     async transcribeProject(projectId, mode) {
         this.hideLevelActionMenus();
         
         // Check credentials first
         const credentials = this.getStoredCredentials();
         const activeProvider = this.getActiveProvider();
         if (!activeProvider) {
             this.showAlert('Please configure your API credentials first', 'warning');
             this.showCredentialsModal();
             return;
         }

         // Show confirmation for destructive actions
         if (mode !== 'untranscribed_images' && mode !== 'untranscribed_zones') {
             const confirmed = confirm('⚠️ This may override existing transcriptions. Are you sure you want to continue?');
             if (!confirmed) return;
         }

                 try {
            this.operationCancelled = false;
            this.showProgressModal('Transcribing Project', `Starting transcription for project (${this.getTranscriptionModeLabel(mode)})...`);

             // Get all documents in the project
             const docsResponse = await fetch(`${this.apiBaseUrl}/documents/?project=${projectId}`, {
                 headers: { 'Authorization': `Token ${this.authToken}` }
             });
             
             if (!docsResponse.ok) throw new Error('Failed to load project documents');
             const documents = await docsResponse.json();

             let totalProcessed = 0;
             let successCount = 0;

             // Process each document
             for (const doc of documents.results) {
                 if (this.operationCancelled) break;
                 
                 const result = await this.transcribeDocumentImages(doc.id, mode, credentials);
                 totalProcessed += result.processed;
                 successCount += result.success;
             }

             if (this.operationCancelled) {
                 this.completeProgressModal('warning', 'Operation cancelled by user');
             } else {
                 this.completeProgressModal('success', `Project transcription completed! Processed ${totalProcessed} items, ${successCount} successful.`);
                 // Refresh project tree to show updated status
                 await this.loadProjects();
             }

        } catch (error) {
            console.error('Project transcription error:', error);
            this.completeProgressModal('error', `Project transcription failed: ${error.message}`);
        }
     }

     async transcribeDocument(documentId, mode) {
         this.hideLevelActionMenus();
         
         // Check credentials first
         const credentials = this.getStoredCredentials();
         const activeProvider = this.getActiveProvider();
         if (!activeProvider) {
             this.showAlert('Please configure your API credentials first', 'warning');
             this.showCredentialsModal();
             return;
         }

         // Show confirmation for destructive actions
         if (mode !== 'untranscribed_images' && mode !== 'untranscribed_zones') {
             const confirmed = confirm('⚠️ This may override existing transcriptions. Are you sure you want to continue?');
             if (!confirmed) return;
         }

                 try {
            this.operationCancelled = false;
            // Check if using batch processing for UI feedback
            const selectedModel = this.getSelectedModel();
            const usingBatch = selectedModel.provider === 'openai' && this.shouldUseBatchAPI(mode);
            const batchIndicator = usingBatch ? ' (OpenAI Batch API - 50% cost savings!)' : '';
            
            this.showProgressModal('Transcribing Document', `Starting transcription for document (${this.getTranscriptionModeLabel(mode)})${batchIndicator}...`);

            const result = await this.transcribeDocumentImages(documentId, mode, credentials);
            
            if (this.operationCancelled) {
                this.completeProgressModal('warning', 'Operation cancelled by user');
            } else {
                this.completeProgressModal('success', `Document transcription completed! Processed ${result.processed} items, ${result.success} successful.`);
                // Refresh project tree to show updated status
                await this.loadProjects();
                
                // If current image was in this document, refresh transcriptions
                if (this.currentImage && this.currentImage.document === documentId) {
                    await this.loadImageTranscriptions();
                    this.updateCombinedTranscription();
                }
            }

        } catch (error) {
            console.error('Document transcription error:', error);
            this.completeProgressModal('error', `Document transcription failed: ${error.message}`);
        }
     }

         async transcribeDocumentImages(documentId, mode, credentials) {
        // Check if using OpenAI and batch processing is enabled
        const selectedModel = this.getSelectedModel();
        if (selectedModel.provider === 'openai' && this.shouldUseBatchAPI(mode)) {
            return await this.transcribeDocumentImagesBatch(documentId, mode, credentials);
        }
        
        // Fall back to individual processing for non-OpenAI or single items
        return await this.transcribeDocumentImagesIndividual(documentId, mode, credentials);
    }

    shouldUseBatchAPI(mode) {
        // Check if batch processing is enabled by user (default to enabled)
        const batchEnabled = localStorage.getItem('enable_batch_processing') !== 'false';
        
        if (!batchEnabled) {
            return false;
        }
        
        // Use batch API for bulk operations, but not for single image transcription
        return mode === 'zones_only' || mode === 'untranscribed_zones' || mode === 'untranscribed_images' || mode === 'full_image';
    }

    async transcribeDocumentImagesBatch(documentId, mode, credentials) {
        try {
            // Step 1: Collect all items that need transcription
            const batchItems = await this.collectBatchItems(documentId, mode);
            
            if (batchItems.length === 0) {
                this.showAlert('No items found for transcription', 'info');
                return { processed: 0, success: 0 };
            }

            // Step 2: Create batch request
            this.updateProgress(0, 1, 'Preparing', `Preparing ${batchItems.length} items for batch processing`);
            const batchId = await this.createOpenAIBatch(batchItems, credentials);
            
            if (!batchId) {
                // Fall back to individual processing
                return await this.transcribeDocumentImagesIndividual(documentId, mode, credentials);
            }

            // Step 3: Poll for completion and process results
            return await this.pollAndProcessBatch(batchId, batchItems, credentials);

        } catch (error) {
            console.error('Batch processing failed:', error);
            this.showAlert('Batch processing failed, falling back to individual processing', 'warning');
            return await this.transcribeDocumentImagesIndividual(documentId, mode, credentials);
        }
    }

    async transcribeDocumentImagesIndividual(documentId, mode, credentials) {
        let images;
        
        if (this.isBrowserCacheMode) {
            // Get all images for this document from IndexedDB
            const allImages = await this.localStorage.getAll('images', 'document_id', documentId);
            images = { results: allImages };
        } else {
            // Get all images in the document from server
            const imagesResponse = await fetch(`${this.apiBaseUrl}/images/?document=${documentId}`, {
                headers: { 'Authorization': `Token ${this.authToken}` }
            });
            
            if (!imagesResponse.ok) throw new Error('Failed to load document images');
            images = await imagesResponse.json();
        }

        let processedCount = 0;
        let successCount = 0;
        const totalImages = images.results.length;

         // Initialize progress
         this.updateProgress(0, totalImages, 'Initializing', `Found ${totalImages} images to process`);

         for (const image of images.results) {
             if (this.operationCancelled) break;

             try {
                 this.updateProgress(processedCount, totalImages, 'Processing', `Processing ${image.name}`);

                 if (mode === 'full_image' || mode === 'untranscribed_images') {
                                         // Check if we should skip already transcribed images
                    if (mode === 'untranscribed_images') {
                        let hasTranscription = false;
                        
                        if (this.isBrowserCacheMode) {
                            // Check transcriptions in IndexedDB
                            const transcriptions = await this.localStorage.getAll('transcriptions', 'image', image.id);
                            hasTranscription = transcriptions && transcriptions.some(t => t.transcription_type === 'full_image' && t.is_current);
                        } else {
                            // Check transcriptions on server
                            const transcriptionsResponse = await fetch(`${this.apiBaseUrl}/transcriptions/?image=${image.id}&transcription_type=full_image`, {
                                headers: { 'Authorization': `Token ${this.authToken}` }
                            });
                            if (transcriptionsResponse.ok) {
                                const transcriptions = await transcriptionsResponse.json();
                                hasTranscription = transcriptions.results && transcriptions.results.length > 0;
                            }
                        }
                        
                        if (hasTranscription) {
                            this.addProgressItem(image.name, 'skipped', 'Already has transcription');
                            processedCount++;
                            continue;
                        }
                    }
                     
                     const result = await this.transcribeImageById(image.id, credentials, 'full_image');
                     if (result.success) {
                         successCount++;
                         this.addProgressItem(image.name, 'success', 'Transcribed successfully');
                     } else {
                         this.addProgressItem(image.name, 'error', 'Transcription failed');
                     }
                     processedCount++;
                     
                                 } else if (mode === 'zones_only' || mode === 'untranscribed_zones') {
                    let annotations;
                    
                    // Get annotations for this image using the helper function
                    const annotationResults = await this.getAnnotationsForImage(image.id);
                    if (!annotationResults) {
                        this.addProgressItem(image.name, 'error', 'Failed to load annotations');
                        processedCount++;
                        continue;
                    }
                    annotations = { results: annotationResults };
                    
                    if (annotations.results.length === 0 && mode === 'zones_only') {
                        this.addProgressItem(image.name, 'warning', 'No zones found - run detection first');
                        processedCount++;
                        continue;
                    }

                    let imageSuccessCount = 0;
                    let imageProcessedCount = 0;

                    for (const annotation of annotations.results) {
                        // Skip if only processing untranscribed and this one is already transcribed
                        if (mode === 'untranscribed_zones') {
                            const hasTranscription = await this.checkAnnotationHasTranscription(annotation.id);
                            if (hasTranscription) continue;
                        }

                        try {
                            const result = await this.transcribeAnnotationByIdWithImage(annotation.id, credentials, image);
                            if (result.success) {
                                imageSuccessCount++;
                                successCount++;
                            }
                        } catch (error) {
                            console.error(`Failed to transcribe annotation ${annotation.id}:`, error);
                            // Continue with other annotations instead of failing completely
                            if (error.message.includes('Image not found in cache')) {
                                console.warn(`Skipping annotation ${annotation.id} - referenced image not found in cache`);
                            }
                        }
                        imageProcessedCount++;
                    }

                    // Increment image processed count once per image, not per annotation
                    processedCount++;

                    if (imageProcessedCount > 0) {
                        this.addProgressItem(image.name, 'success', `Transcribed ${imageSuccessCount}/${imageProcessedCount} zones`);
                    } else {
                        this.addProgressItem(image.name, 'skipped', 'No zones to transcribe');
                    }
                 }
                 
             } catch (error) {
                 console.error(`Failed to process image ${image.id}:`, error);
                 this.addProgressItem(image.name, 'error', error.message);
                 processedCount++;
             }

             this.updateProgress(processedCount, totalImages, 'Processing', `Image ${processedCount}/${totalImages} - ${successCount} annotations transcribed`);
         }

         return { processed: processedCount, success: successCount };
     }

     async transcribeImageById(imageId, credentials, transcriptionType = 'full_image') {
         try {
             const selectedModel = this.getSelectedModel();
             const requestData = {
                 transcription_type: transcriptionType,
                 api_endpoint: selectedModel.provider,
                 api_model: selectedModel.model
             };

             if (selectedModel.provider === 'openai') {
                 requestData.openai_api_key = credentials.openai_api_key;
             } else if (selectedModel.provider === 'vertex') {
                 requestData.vertex_access_token = credentials.vertex_access_token;
                 requestData.vertex_project_id = credentials.vertex_project_id;
                 requestData.vertex_location = credentials.vertex_location;
                 requestData.vertex_model = selectedModel.model;
             } else if (selectedModel.provider === 'custom') {
                 requestData.custom_endpoint_url = credentials.custom_endpoint_url;
                 requestData.custom_endpoint_auth = credentials.custom_endpoint_auth;
             }

                         if (this.isBrowserCacheMode) {
                // Use client-side transcription for browser cache mode
                requestData.custom_prompt = 'Transcribe all the text in this image accurately, preserving formatting and structure.';
                const transcription = await this.performLocalImageTranscription(imageId, requestData);
                if (transcription) {
                    // Store transcription in local storage
                    const transcriptionData = {
                        image: imageId,
                        annotation: null,
                        transcription_type: transcriptionType,
                        api_endpoint: selectedModel.provider,
                        api_model: selectedModel.model,
                        status: 'completed',
                        text_content: transcription.text_content,
                        confidence_score: transcription.confidence_score || null,
                        api_response_raw: transcription.api_response_raw || null,
                        is_current: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    
                    await this.localStorage.add('transcriptions', transcriptionData);
                    return { success: true };
                } else {
                    return { success: false };
                }
            } else {
                // Use server-side transcription for normal mode
                const response = await fetch(`${this.apiBaseUrl}/images/${imageId}/transcribe/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify(requestData)
                });

                return { success: response.ok };
            }
         } catch (error) {
             console.error(`Error transcribing image ${imageId}:`, error);
             return { success: false };
         }
     }

         async transcribeAnnotationByIdWithImage(annotationId, credentials, imageData) {
        // Version that accepts image data directly to avoid cache lookup issues
        try {
            let annotation;
            
            if (this.isBrowserCacheMode) {
                // Get annotation details from IndexedDB
                annotation = await this.localStorage.get('annotations', annotationId);
                if (!annotation) return { success: false };
            } else {
                // Get annotation details from server
                const annotationResponse = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/`, {
                    headers: { 'Authorization': `Token ${this.authToken}` }
                });
                
                if (!annotationResponse.ok) return { success: false };
                annotation = await annotationResponse.json();
            }
            
            // Find the appropriate prompt for this annotation's classification
            const prompt = this.getPromptForAnnotation(annotation);
            let finalPrompt = prompt.prompt;
            
            const selectedModel = this.getSelectedModel();
            const requestData = {
                transcription_type: 'annotation',
                api_endpoint: selectedModel.provider,
                api_model: selectedModel.model,
                custom_prompt: finalPrompt,
                expected_metadata: prompt.metadata_fields || []
            };

            if (selectedModel.provider === 'openai') {
                requestData.openai_api_key = credentials.openai_api_key;
                // For OpenAI, use structured output if metadata is expected
                if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                    requestData.use_structured_output = true;
                    requestData.metadata_schema = this.createMetadataSchema(prompt.metadata_fields);
                } else {
                    finalPrompt += '\n\nReturn the transcription as plain text. The main text should be clean and readable.';
                    requestData.custom_prompt = finalPrompt;
                }
            } else if (selectedModel.provider === 'vertex') {
                requestData.vertex_access_token = credentials.vertex_access_token;
                requestData.vertex_project_id = credentials.vertex_project_id;
                requestData.vertex_location = credentials.vertex_location;
                requestData.vertex_model = selectedModel.model;
                // For Vertex, modify prompt to request JSON output
                if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                    finalPrompt += '\n\nPlease also return metadata in JSON format with the following fields: ' +
                        prompt.metadata_fields.map(f => `${f.name} (${f.type})`).join(', ') +
                        '. Return both the transcription and metadata in a JSON object with "text" and "metadata" keys in the following format:\n\n```json\n{"text": "your transcription here", "metadata": {"field1": value1, "field2": value2}}\n```';
                }
                requestData.custom_prompt = finalPrompt;
            } else if (selectedModel.provider === 'custom') {
                // For other models, modify prompt to request JSON output
                if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                    finalPrompt += '\n\nPlease also return metadata in JSON format with the following fields: ' +
                        prompt.metadata_fields.map(f => `${f.name} (${f.type})`).join(', ') +
                        '. Return both the transcription and metadata in a JSON object with "text" and "metadata" keys in the following format:\n\n```json\n{"text": "your transcription here", "metadata": {"field1": value1, "field2": value2}}\n```';
                }
                requestData.custom_prompt = finalPrompt;
                requestData.custom_endpoint_auth = credentials.custom_endpoint_auth;
            }

            if (this.isBrowserCacheMode) {
                // Use client-side transcription for browser cache mode with provided image data
                const transcription = await this.performLocalTranscriptionWithImage(annotation, requestData, imageData);
                if (transcription) {
                    // Store transcription in local storage
                    const transcriptionData = {
                        image: annotation.image_id || annotation.image,
                        annotation: annotationId,
                        transcription_type: 'annotation',
                        api_endpoint: selectedModel.provider,
                        api_model: selectedModel.model,
                        status: 'completed',
                        text_content: transcription.text_content,
                        confidence_score: transcription.confidence_score || null,
                        api_response_raw: transcription.api_response_raw || null,
                        is_current: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    
                    await this.localStorage.add('transcriptions', transcriptionData);
                    return { success: true };
                } else {
                    return { success: false };
                }
            } else {
                // Use server-side transcription for normal mode
                const response = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/transcribe/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify(requestData)
                });

                return { success: response.ok };
            }
        } catch (error) {
            console.error(`Error transcribing annotation ${annotationId}:`, error);
            return { success: false };
        }
    }

    async transcribeAnnotationById(annotationId, credentials) {
        try {
            let annotation;
            
            if (this.isBrowserCacheMode) {
                // Get annotation details from IndexedDB
                annotation = await this.localStorage.get('annotations', annotationId);
                if (!annotation) return { success: false };
            } else {
                // Get annotation details from server
                const annotationResponse = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/`, {
                    headers: { 'Authorization': `Token ${this.authToken}` }
                });
                
                if (!annotationResponse.ok) return { success: false };
                annotation = await annotationResponse.json();
            }
             
             // Find the appropriate prompt for this annotation's classification
             const prompt = this.getPromptForAnnotation(annotation);
             let finalPrompt = prompt.prompt;
             
             const selectedModel = this.getSelectedModel();
             const requestData = {
                 transcription_type: 'annotation',
                 api_endpoint: selectedModel.provider,
                 api_model: selectedModel.model,
                 custom_prompt: finalPrompt,
                 expected_metadata: prompt.metadata_fields || []
             };

             if (selectedModel.provider === 'openai') {
                 requestData.openai_api_key = credentials.openai_api_key;
                 // For OpenAI, use structured output if metadata is expected
                 if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                     requestData.use_structured_output = true;
                     requestData.metadata_schema = this.createMetadataSchema(prompt.metadata_fields);
                 } else {
                     finalPrompt += '\n\nReturn the transcription as plain text. The main text should be clean and readable.';
                     requestData.custom_prompt = finalPrompt;
                 }
             } else if (selectedModel.provider === 'vertex') {
                 requestData.vertex_access_token = credentials.vertex_access_token;
                 requestData.vertex_project_id = credentials.vertex_project_id;
                 requestData.vertex_location = credentials.vertex_location;
                 requestData.vertex_model = selectedModel.model;
                 // For Vertex, modify prompt to request JSON output
                 if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                     finalPrompt += '\n\nPlease also return metadata in JSON format with the following fields: ' +
                         prompt.metadata_fields.map(f => `${f.name} (${f.type})`).join(', ') +
                         '. Return both the transcription and metadata in a JSON object with "text" and "metadata" keys in the following format:\n\n```json\n{"text": "your transcription here", "metadata": {"field1": value1, "field2": value2}}\n```';
                 }
                 requestData.custom_prompt = finalPrompt;
             } else if (selectedModel.provider === 'custom') {
                 // For other models, modify prompt to request JSON output
                 if (prompt.metadata_fields && prompt.metadata_fields.length > 0) {
                     finalPrompt += '\n\nPlease also return metadata in JSON format with the following fields: ' +
                         prompt.metadata_fields.map(f => `${f.name} (${f.type})`).join(', ') +
                         '. Return both the transcription and metadata in a JSON object with "text" and "metadata" keys in the following format:\n\n```json\n{"text": "your transcription here", "metadata": {"field1": value1, "field2": value2}}\n```';
                 }
                 requestData.custom_prompt = finalPrompt;
                 requestData.custom_endpoint_auth = credentials.custom_endpoint_auth;
             }

                         if (this.isBrowserCacheMode) {
                // Use client-side transcription for browser cache mode
                const transcription = await this.performLocalTranscription(annotation, requestData);
                if (transcription) {
                    // Store transcription in local storage
                    const transcriptionData = {
                        image: annotation.image_id || annotation.image,
                        annotation: annotationId,
                        transcription_type: 'annotation',
                        api_endpoint: selectedModel.provider,
                        api_model: selectedModel.model,
                        status: 'completed',
                        text_content: transcription.text_content,
                        confidence_score: transcription.confidence_score || null,
                        api_response_raw: transcription.api_response_raw || null,
                        is_current: true,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    };
                    
                    await this.localStorage.add('transcriptions', transcriptionData);
                    return { success: true };
                } else {
                    return { success: false };
                }
            } else {
                // Use server-side transcription for normal mode
                const response = await fetch(`${this.apiBaseUrl}/annotations/${annotationId}/transcribe/`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Token ${this.authToken}`
                    },
                    body: JSON.stringify(requestData)
                });

                return { success: response.ok };
            }
         } catch (error) {
             console.error(`Error transcribing annotation ${annotationId}:`, error);
             return { success: false };
         }
     }

         async getAnnotationsForImage(imageId) {
        // Helper function to get annotations for an image, handling backwards compatibility
        if (this.isBrowserCacheMode) {
            // Try both field names for backwards compatibility
            const annotationsByImageId = await this.localStorage.getAll('annotations', 'image_id', imageId);
            
            let annotationsByImage = [];
            try {
                // Try to get annotations by 'image' field (may not have index)
                annotationsByImage = await this.localStorage.getAll('annotations', 'image', imageId);
            } catch (error) {
                // If 'image' index doesn't exist, manually filter all annotations
                if (error.name === 'NotFoundError' || error.message.includes('index was not found')) {
                    try {
                        const allAnnotations = await this.localStorage.getAll('annotations');
                        annotationsByImage = allAnnotations.filter(annotation => annotation.image === imageId);
                    } catch (filterError) {
                        console.warn('Could not filter annotations by image field:', filterError);
                        annotationsByImage = [];
                    }
                } else {
                    console.warn('Error querying annotations by image field:', error);
                    annotationsByImage = [];
                }
            }
            
            // Combine and deduplicate annotations
            const allAnnotations = [...annotationsByImageId];
            for (const annotation of annotationsByImage) {
                if (!allAnnotations.find(a => a.id === annotation.id)) {
                    allAnnotations.push(annotation);
                }
            }
            
            return allAnnotations;
        } else {
            // In server mode, fetch from API
            const response = await fetch(`${this.apiBaseUrl}/annotations/?image=${imageId}`, {
                headers: { 'Authorization': `Token ${this.authToken}` }
            });
            if (response.ok) {
                const data = await response.json();
                return data.results;
            }
            return [];
        }
    }

    async checkAnnotationHasTranscription(annotationId) {
        try {
            if (this.isBrowserCacheMode) {
                // Check transcriptions in IndexedDB
                const transcriptions = await this.localStorage.getAll('transcriptions', 'annotation', annotationId);
                return transcriptions && transcriptions.some(t => t.is_current);
            } else {
                // Check transcriptions on server
                const response = await fetch(`${this.apiBaseUrl}/transcriptions/?annotation=${annotationId}`, {
                    headers: { 'Authorization': `Token ${this.authToken}` }
                });
                
                if (response.ok) {
                    const transcriptions = await response.json();
                    return transcriptions.results.length > 0;
                }
            }
        } catch (error) {
            console.error(`Error checking transcription for annotation ${annotationId}:`, error);
        }
        return false;
    }

     getTranscriptionModeLabel(mode) {
         const labels = {
             'full_image': 'full images',
             'zones_only': 'zones/lines only',
             'untranscribed_images': 'untranscribed images only',
             'untranscribed_zones': 'untranscribed zones only'
         };
         return labels[mode] || mode;
     }

         hideLevelActionMenus() {
        document.querySelectorAll('.level-action-menu.show').forEach(menu => {
            menu.classList.remove('show');
            // Reset positioning styles
            menu.style.left = '';
            menu.style.top = '';
            menu.style.position = '';
        });
    }

    async executeProjectTranscription(projectId, mode, credentials, selectedTypes = []) {
        this.operationCancelled = false;
        // Check if using OpenAI and batch processing is enabled
        const selectedModel = this.getSelectedModel();
        const usingBatch = selectedModel.provider === 'openai' && this.shouldUseBatchAPI(mode);
        const batchIndicator = usingBatch ? ' (OpenAI Batch API - 50% cost savings!)' : '';
        
        this.showProgressModal('Transcribing Project', `Starting transcription for project${batchIndicator}...`);
        if (selectedModel.provider === 'openai' && this.shouldUseBatchAPI(mode)) {
            return await this.executeProjectTranscriptionBatch(projectId, mode, credentials, selectedTypes);
        }

        // Fall back to individual document processing
        return await this.executeProjectTranscriptionIndividual(projectId, mode, credentials, selectedTypes);
    }

    async executeProjectTranscriptionBatch(projectId, mode, credentials, selectedTypes = []) {
        try {
            // Collect all batch items across all documents in the project
            const batchItems = await this.collectProjectBatchItems(projectId, mode, selectedTypes);
            
            if (batchItems.length === 0) {
                this.completeProgressModal('info', 'No items found for transcription');
                return { processed: 0, success: 0 };
            }

            // Use batch processing for the entire project
            this.updateProgress(0, 1, 'Preparing', `Preparing ${batchItems.length} items for batch processing across project`);
            const batchId = await this.createOpenAIBatch(batchItems, credentials);
            
            if (!batchId) {
                // Fall back to individual processing
                return await this.executeProjectTranscriptionIndividual(projectId, mode, credentials, selectedTypes);
            }

            // Poll for completion and process results
            const result = await this.pollAndProcessBatch(batchId, batchItems, credentials);
            
            this.completeProgressModal('success', `Project batch transcription completed! Processed ${result.processed} items, ${result.success} successful.`);
            await this.loadProjects();
            
            return result;

        } catch (error) {
            console.error('Project batch processing failed:', error);
            this.completeProgressModal('warning', 'Batch processing failed, falling back to individual processing');
            return await this.executeProjectTranscriptionIndividual(projectId, mode, credentials, selectedTypes);
        }
    }

    async executeProjectTranscriptionIndividual(projectId, mode, credentials, selectedTypes = []) {
        try {
            let documents;
            
            if (this.isBrowserCacheMode) {
                // Get all documents for this project from IndexedDB
                const allDocs = await this.localStorage.getAll('documents', 'project_id', projectId);
                documents = { results: allDocs };
            } else {
                // Get all documents in the project from server
                const docsResponse = await fetch(`${this.apiBaseUrl}/documents/?project=${projectId}`, {
                    headers: { 'Authorization': `Token ${this.authToken}` }
                });
                
                if (!docsResponse.ok) throw new Error('Failed to load project documents');
                documents = await docsResponse.json();
            }

            let totalProcessed = 0;
            let successCount = 0;

            // Process each document individually
            for (const doc of documents.results) {
                if (this.operationCancelled) break;
                
                const result = await this.transcribeDocumentImagesWithFilter(doc.id, credentials, selectedTypes);
                totalProcessed += result.processed;
                successCount += result.success;
            }

            if (this.operationCancelled) {
                this.completeProgressModal('warning', 'Operation cancelled by user');
            } else {
                this.completeProgressModal('success', `Project transcription completed! Processed ${totalProcessed} items, ${successCount} successful.`);
                await this.loadProjects();
            }

            return { processed: totalProcessed, success: successCount };

        } catch (error) {
            console.error('Project transcription error:', error);
            this.completeProgressModal('error', `Project transcription failed: ${error.message}`);
            return { processed: 0, success: 0 };
        }
    }

    async collectProjectBatchItems(projectId, mode, selectedTypes = []) {
        const batchItems = [];
        let documents;
        
        if (this.isBrowserCacheMode) {
            const allDocs = await this.localStorage.getAll('documents', 'project_id', projectId);
            documents = { results: allDocs };
        } else {
            const docsResponse = await fetch(`${this.apiBaseUrl}/documents/?project=${projectId}`, {
                headers: { 'Authorization': `Token ${this.authToken}` }
            });
            if (!docsResponse.ok) throw new Error('Failed to load project documents');
            documents = await docsResponse.json();
        }

        // Collect items from all documents
        for (const doc of documents.results) {
            const docBatchItems = await this.collectBatchItems(doc.id, mode);
            
            // Filter by selected types if specified
            const filteredItems = selectedTypes.length > 0 
                ? docBatchItems.filter(item => {
                    if (item.type === 'annotation') {
                        const annotationType = item.annotation.annotation_type || item.annotation.type;
                        return selectedTypes.includes(annotationType);
                    }
                    return true;
                })
                : docBatchItems;
            
            batchItems.push(...filteredItems);
        }

        return batchItems;
    }

    async showBatchStatus() {
        if (!this.isBrowserCacheMode) {
            this.showAlert('Batch status is only available in browser cache mode', 'info');
            return;
        }

        try {
            const credentials = this.getStoredCredentials();
            if (!credentials.openai_api_key) {
                this.showAlert('OpenAI API key required to check batch status', 'warning');
                return;
            }

            // Get all batch settings
            const allSettings = await this.localStorage.getAllSettings();
            const batchSettings = Object.entries(allSettings).filter(([key, value]) => 
                key.startsWith('batch_') && value && value.batchId
            );

            if (batchSettings.length === 0) {
                this.showAlert('No active batches found', 'info');
                return;
            }

            let statusHtml = '<div class="batch-status-list">';
            statusHtml += '<h5>Active OpenAI Batches:</h5>';

            for (const [settingKey, batchInfo] of batchSettings) {
                try {
                    // Check current status
                    const statusResponse = await fetch(`https://api.openai.com/v1/batches/${batchInfo.batchId}`, {
                        headers: { 'Authorization': `Bearer ${credentials.openai_api_key}` }
                    });

                    if (statusResponse.ok) {
                        const batchStatus = await statusResponse.json();
                        const createdDate = new Date(batchInfo.created_at).toLocaleString();
                        const itemCount = batchInfo.items ? batchInfo.items.length : 'Unknown';
                        
                        statusHtml += `
                            <div class="batch-item mb-3 p-3 border rounded">
                                <div class="d-flex justify-content-between align-items-start">
                                    <div>
                                        <strong>Batch ID:</strong> ${batchStatus.id}<br>
                                        <strong>Status:</strong> <span class="badge badge-${this.getBatchStatusColor(batchStatus.status)}">${batchStatus.status}</span><br>
                                        <strong>Items:</strong> ${itemCount}<br>
                                        <strong>Created:</strong> ${createdDate}<br>
                                        ${batchStatus.completed_at ? `<strong>Completed:</strong> ${new Date(batchStatus.completed_at * 1000).toLocaleString()}<br>` : ''}
                                        ${batchStatus.request_counts ? `<strong>Progress:</strong> ${batchStatus.request_counts.completed || 0}/${batchStatus.request_counts.total || 0}` : ''}
                                    </div>
                                    <div>
                                        ${batchStatus.status === 'completed' ? 
                                            `<button class="btn btn-sm btn-outline-danger" onclick="app.cleanupBatch('${settingKey}')">Remove</button>` :
                                            `<button class="btn btn-sm btn-outline-warning" onclick="app.cancelBatch('${batchInfo.batchId}', '${settingKey}')">Cancel</button>`
                                        }
                                    </div>
                                </div>
                            </div>
                        `;
                    } else {
                        statusHtml += `
                            <div class="batch-item mb-3 p-3 border rounded">
                                <div class="text-warning">
                                    <strong>Batch ID:</strong> ${batchInfo.batchId}<br>
                                    <strong>Status:</strong> Error checking status<br>
                                    <button class="btn btn-sm btn-outline-danger" onclick="app.cleanupBatch('${settingKey}')">Remove</button>
                                </div>
                            </div>
                        `;
                    }
                } catch (error) {
                    console.error('Error checking batch status:', error);
                }
            }

            statusHtml += '</div>';

            // Show in a modal
            this.showAlert(statusHtml, 'info', 'OpenAI Batch Status', true);

        } catch (error) {
            console.error('Error showing batch status:', error);
            this.showAlert('Error loading batch status', 'danger');
        }
    }

    getBatchStatusColor(status) {
        switch (status) {
            case 'validating': return 'warning';
            case 'in_progress': return 'primary';
            case 'finalizing': return 'info';
            case 'completed': return 'success';
            case 'failed': return 'danger';
            case 'expired': return 'secondary';
            case 'cancelled': return 'secondary';
            default: return 'light';
        }
    }

    async cleanupBatch(settingKey) {
        try {
            await this.localStorage.setSetting(settingKey, null);
            this.showAlert('Batch removed from local storage', 'success');
            // Refresh the batch status display
            setTimeout(() => this.showBatchStatus(), 1000);
        } catch (error) {
            console.error('Error cleaning up batch:', error);
            this.showAlert('Error removing batch', 'danger');
        }
    }

    async cancelBatch(batchId, settingKey) {
        try {
            const credentials = this.getStoredCredentials();
            const response = await fetch(`https://api.openai.com/v1/batches/${batchId}/cancel`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${credentials.openai_api_key}` }
            });

            if (response.ok) {
                this.showAlert('Batch cancellation requested', 'success');
                // Clean up local reference
                await this.localStorage.setSetting(settingKey, null);
                // Refresh the batch status display
                setTimeout(() => this.showBatchStatus(), 1000);
            } else {
                this.showAlert('Failed to cancel batch', 'danger');
            }
        } catch (error) {
            console.error('Error cancelling batch:', error);
            this.showAlert('Error cancelling batch', 'danger');
        }
    }

    async executeDocumentTranscription(documentId, mode, credentials, selectedTypes = []) {
        this.operationCancelled = false;
        this.showProgressModal('Transcribing Document', 'Starting transcription for document (selected zones only)...');

        try {
            const result = await this.transcribeDocumentImagesWithFilter(documentId, credentials, selectedTypes);
            
            if (this.operationCancelled) {
                this.completeProgressModal('warning', 'Operation cancelled by user');
            } else {
                this.completeProgressModal('success', `Document transcription completed! Processed ${result.processed} items, ${result.success} successful.`);
                await this.loadProjects();
                
                // If current image was in this document, refresh transcriptions
                if (this.currentImage && this.currentImage.document === documentId) {
                    await this.loadImageTranscriptions();
                    this.updateCombinedTranscription();
                }
            }

        } catch (error) {
            console.error('Document transcription error:', error);
            this.completeProgressModal('error', `Document transcription failed: ${error.message}`);
        }
    }

    async transcribeDocumentImagesWithFilter(documentId, credentials, selectedTypes) {
        let images;
        
        if (this.isBrowserCacheMode) {
            // Get all images for this document from IndexedDB
            const allImages = await this.localStorage.getAll('images', 'document_id', documentId);
            images = { results: allImages };
        } else {
            // Get all images in the document from server
            const imagesResponse = await fetch(`${this.apiBaseUrl}/images/?document=${documentId}`, {
                headers: { 'Authorization': `Token ${this.authToken}` }
            });
            
            if (!imagesResponse.ok) throw new Error('Failed to load document images');
            images = await imagesResponse.json();
        }

        let processedCount = 0;
        let successCount = 0;
        const totalImages = images.results.length;

        // Initialize progress
        this.updateProgress(0, totalImages, 'Initializing', `Found ${totalImages} images to process`);

        for (const image of images.results) {
            if (this.operationCancelled) break;

            try {
                this.updateProgress(processedCount, totalImages, 'Processing', `Processing ${image.name}`);

                let annotations;
                
                // Get annotations for this image using the helper function
                const annotationResults = await this.getAnnotationsForImage(image.id);
                if (!annotationResults) {
                    this.addProgressItem(image.name, 'error', 'Failed to load annotations');
                    processedCount++;
                    continue;
                }
                annotations = { results: annotationResults };
                
                // Filter annotations to only include selected types
                const filteredAnnotations = annotations.results.filter(annotation => 
                    selectedTypes.includes(annotation.classification)
                );

                if (filteredAnnotations.length === 0) {
                    this.addProgressItem(image.name, 'skipped', 'No matching zones found');
                    processedCount++;
                    continue;
                }

                let imageSuccessCount = 0;
                let imageProcessedCount = 0;

                for (const annotation of filteredAnnotations) {
                    try {
                        const result = await this.transcribeAnnotationByIdWithImage(annotation.id, credentials, image);
                        if (result.success) {
                            imageSuccessCount++;
                            successCount++;
                        }
                    } catch (error) {
                        console.error(`Failed to transcribe annotation ${annotation.id}:`, error);
                        // Continue with other annotations instead of failing completely
                        if (error.message.includes('Image not found in cache')) {
                            console.warn(`Skipping annotation ${annotation.id} - referenced image not found in cache`);
                        }
                    }
                    imageProcessedCount++;
                }

                // Increment image processed count once per image, not per annotation
                processedCount++;

                this.addProgressItem(image.name, 'success', `Transcribed ${imageSuccessCount}/${imageProcessedCount} selected zones`);
                
            } catch (error) {
                console.error(`Failed to process image ${image.id}:`, error);
                this.addProgressItem(image.name, 'error', error.message);
                processedCount++;
            }

            this.updateProgress(processedCount, totalImages, 'Processing', `Image ${processedCount}/${totalImages} - ${successCount} annotations transcribed`);
        }

        return { processed: processedCount, success: successCount };
    }

    async checkAnnotationHasTranscription(annotationId) {
        if (this.isBrowserCacheMode) {
            const transcriptions = await this.localStorage.getAll('transcriptions', 'annotation', annotationId);
            return transcriptions && transcriptions.some(t => t.is_current);
        } else {
            try {
                const response = await fetch(`${this.apiBaseUrl}/transcriptions/?annotation=${annotationId}`, {
                    headers: { 'Authorization': `Token ${this.authToken}` }
                });
                if (response.ok) {
                    const transcriptions = await response.json();
                    return transcriptions.results && transcriptions.results.length > 0;
                }
            } catch (error) {
                console.warn('Error checking transcription:', error);
            }
        }
        return false;
    }



    createMetadataSchema(metadataFields) {
        const properties = {
            text: {
                type: "string",
                description: "The transcribed text content"
            }
        };

        const metadataProps = {};
        for (const field of metadataFields) {
            metadataProps[field] = {
                type: "string",
                description: `Extract ${field} information from the text`
            };
        }

        if (Object.keys(metadataProps).length > 0) {
            properties.metadata = {
                type: "object",
                properties: metadataProps
            };
        }

        return {
            type: "object",
            properties: properties,
            required: ["text"],
            additionalProperties: false
        };
    }

    async collectBatchItems(documentId, mode) {
        const batchItems = [];
        let images;
        
        if (this.isBrowserCacheMode) {
            const allImages = await this.localStorage.getAll('images', 'document_id', documentId);
            images = { results: allImages };
        } else {
            const imagesResponse = await fetch(`${this.apiBaseUrl}/images/?document=${documentId}`, {
                headers: { 'Authorization': `Token ${this.authToken}` }
            });
            if (!imagesResponse.ok) throw new Error('Failed to load document images');
            images = await imagesResponse.json();
        }

        for (const image of images.results) {
            if (mode === 'full_image' || mode === 'untranscribed_images') {
                // Check if already transcribed for untranscribed_images mode
                if (mode === 'untranscribed_images') {
                    let hasTranscription = false;
                    if (this.isBrowserCacheMode) {
                        const transcriptions = await this.localStorage.getAll('transcriptions', 'image', image.id);
                        hasTranscription = transcriptions && transcriptions.some(t => t.transcription_type === 'full_image' && t.is_current);
                    } else {
                        const transcriptionsResponse = await fetch(`${this.apiBaseUrl}/transcriptions/?image=${image.id}&transcription_type=full_image`, {
                            headers: { 'Authorization': `Token ${this.authToken}` }
                        });
                        if (transcriptionsResponse.ok) {
                            const transcriptions = await transcriptionsResponse.json();
                            hasTranscription = transcriptions.results && transcriptions.results.length > 0;
                        }
                    }
                    if (hasTranscription) continue;
                }

                // Add full image transcription item
                batchItems.push({
                    type: 'full_image',
                    imageId: image.id,
                    imageName: image.name,
                    imageData: image,
                    prompt: 'Transcribe all the text in this image accurately, preserving formatting and structure.'
                });
            } else if (mode === 'zones_only' || mode === 'untranscribed_zones') {
                // Get annotations for this image
                const annotationResults = await this.getAnnotationsForImage(image.id);
                if (!annotationResults || annotationResults.length === 0) continue;

                for (const annotation of annotationResults) {
                    // Check if already transcribed for untranscribed_zones mode
                    if (mode === 'untranscribed_zones') {
                        const hasTranscription = await this.checkAnnotationHasTranscription(annotation.id);
                        if (hasTranscription) continue;
                    }

                    // Get appropriate prompt for this annotation
                    const prompt = this.getPromptForAnnotation(annotation);

                    batchItems.push({
                        type: 'annotation',
                        annotationId: annotation.id,
                        annotation: annotation,
                        imageId: image.id,
                        imageName: image.name,
                        imageData: image,
                        prompt: prompt.prompt,
                        metadata_fields: prompt.metadata_fields || []
                    });
                }
            }
        }

        return batchItems;
    }

    async createOpenAIBatch(batchItems, credentials) {
        try {
            // Prepare batch requests
            const requests = [];
            
            for (let i = 0; i < batchItems.length; i++) {
                const item = batchItems[i];
                
                // Get image data for the request
                let imageDataUrl;
                if (item.type === 'full_image') {
                    imageDataUrl = item.imageData.image_data || item.imageData.image_file;
                } else {
                    // Extract annotation region
                    imageDataUrl = await this.getAnnotationImageDataFromImage(item.annotation, item.imageData);
                }

                // Optimize image for API
                const optimizedImageUrl = await this.optimizeImageForAPI(imageDataUrl, 2048);

                // Create OpenAI request
                let messages = [{
                    role: 'user',
                    content: [
                        {
                            type: 'text',
                            text: item.prompt
                        },
                        {
                            type: 'image_url',
                            image_url: { url: optimizedImageUrl }
                        }
                    ]
                }];

                let requestBody = {
                    model: this.getSelectedModel().model,
                    messages: messages,
                    max_tokens: 4000
                };

                // Add structured output for metadata extraction
                if (item.metadata_fields && item.metadata_fields.length > 0) {
                    requestBody.response_format = {
                        type: "json_schema",
                        json_schema: this.createMetadataSchema(item.metadata_fields)
                    };
                }

                requests.push({
                    custom_id: `request_${i}`,
                    method: 'POST',
                    url: '/v1/chat/completions',
                    body: requestBody
                });
            }

            // Create batch file
            const batchRequestData = requests.map(req => JSON.stringify(req)).join('\n');
            
            // Upload batch file
            const fileFormData = new FormData();
            const blob = new Blob([batchRequestData], { type: 'application/jsonl' });
            fileFormData.append('file', blob, 'batch_requests.jsonl');
            fileFormData.append('purpose', 'batch');

            const fileResponse = await fetch('https://api.openai.com/v1/files', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${credentials.openai_api_key}`
                },
                body: fileFormData
            });

            if (!fileResponse.ok) {
                throw new Error('Failed to upload batch file');
            }

            const fileData = await fileResponse.json();

            // Create batch
            const batchResponse = await fetch('https://api.openai.com/v1/batches', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${credentials.openai_api_key}`
                },
                body: JSON.stringify({
                    input_file_id: fileData.id,
                    endpoint: '/v1/chat/completions',
                    completion_window: '24h',
                    metadata: {
                        purpose: 'vlamy_transcription',
                        document_id: batchItems.length > 0 ? (batchItems[0].imageData.document_id || batchItems[0].imageData.document || 'unknown') : 'unknown'
                    }
                })
            });

            if (!batchResponse.ok) {
                throw new Error('Failed to create batch');
            }

            const batchCreateData = await batchResponse.json();
            
            // Store batch info for later retrieval
            if (this.isBrowserCacheMode) {
                await this.localStorage.setSetting(`batch_${batchCreateData.id}`, {
                    batchId: batchCreateData.id,
                    items: batchItems,
                    created_at: new Date().toISOString(),
                    status: 'validating'
                });
            }

            return batchCreateData.id;

        } catch (error) {
            console.error('Failed to create OpenAI batch:', error);
            return null;
        }
    }

    async pollAndProcessBatch(batchId, batchItems, credentials) {
        const maxPollingTime = 30 * 60 * 1000; // 30 minutes
        const pollingInterval = 10000; // 10 seconds
        const startTime = Date.now();

        this.updateProgress(0, 1, 'Processing', `Batch submitted. Waiting for OpenAI to process ${batchItems.length} items...`);

        while (Date.now() - startTime < maxPollingTime) {
            if (this.operationCancelled) {
                this.showAlert('Batch processing cancelled', 'info');
                return { processed: 0, success: 0 };
            }

            try {
                // Check batch status
                const statusResponse = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
                    headers: {
                        'Authorization': `Bearer ${credentials.openai_api_key}`
                    }
                });

                if (!statusResponse.ok) {
                    throw new Error('Failed to check batch status');
                }

                const batchStatus = await statusResponse.json();
                
                // Update progress based on status
                const elapsed = Math.round((Date.now() - startTime) / 1000);
                this.updateProgress(0, 1, 'Processing', `Batch ${batchStatus.status}... (${elapsed}s elapsed)`);

                if (batchStatus.status === 'completed') {
                    // Process results
                    return await this.processBatchResults(batchId, batchItems, credentials);
                } else if (batchStatus.status === 'failed' || batchStatus.status === 'expired' || batchStatus.status === 'cancelled') {
                    throw new Error(`Batch processing ${batchStatus.status}`);
                }

                // Wait before next poll
                await new Promise(resolve => setTimeout(resolve, pollingInterval));

            } catch (error) {
                console.error('Error polling batch status:', error);
                this.showAlert('Batch processing error, falling back to individual processing', 'warning');
                // Extract documentId from batch items if available
                const documentId = batchItems.length > 0 ? batchItems[0].imageData.document_id : null;
                return await this.transcribeDocumentImagesIndividual(documentId, mode, credentials);
            }
        }

        // Timeout reached
        this.showAlert('Batch processing timeout, falling back to individual processing', 'warning');
        // Extract documentId from batch items if available
        const documentId = batchItems.length > 0 ? batchItems[0].imageData.document_id : null;
        return await this.transcribeDocumentImagesIndividual(documentId, mode, credentials);
    }

    async processBatchResults(batchId, batchItems, credentials) {
        try {
            // Get batch details
            const batchResponse = await fetch(`https://api.openai.com/v1/batches/${batchId}`, {
                headers: {
                    'Authorization': `Bearer ${credentials.openai_api_key}`
                }
            });

            const batchResultData = await batchResponse.json();

            // Download results file
            const resultsResponse = await fetch(`https://api.openai.com/v1/files/${batchResultData.output_file_id}/content`, {
                headers: {
                    'Authorization': `Bearer ${credentials.openai_api_key}`
                }
            });

            const resultsText = await resultsResponse.text();
            const results = resultsText.trim().split('\n').map(line => JSON.parse(line));

            // Process each result
            let successCount = 0;
            const selectedModel = this.getSelectedModel();

            this.updateProgress(0, results.length, 'Saving', 'Processing batch results...');

            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                const item = batchItems[parseInt(result.custom_id.replace('request_', ''))];

                if (result.response && result.response.body && result.response.body.choices) {
                    try {
                        const messageContent = result.response.body.choices[0].message.content;
                        let transcriptionText = messageContent;
                        let metadata = {};

                        // Parse structured output if applicable
                        if (item.metadata_fields && item.metadata_fields.length > 0) {
                            try {
                                const parsed = JSON.parse(messageContent);
                                transcriptionText = parsed.text || messageContent;
                                metadata = parsed.metadata || {};
                            } catch (parseError) {
                                console.warn('Failed to parse structured output:', parseError);
                            }
                        }

                        // Save transcription
                        const transcriptionData = {
                            image: item.imageId,
                            annotation: item.type === 'annotation' ? item.annotationId : null,
                            transcription_type: item.type === 'full_image' ? 'full_image' : 'annotation',
                            api_endpoint: 'openai',
                            api_model: selectedModel.model,
                            status: 'completed',
                            text_content: transcriptionText,
                            confidence_score: null,
                            api_response_raw: JSON.stringify(result.response.body),
                            is_current: true,
                            created_at: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        };



                        let savedTranscription;
                        if (this.isBrowserCacheMode) {
                            savedTranscription = await this.localStorage.add('transcriptions', transcriptionData);
                        } else {
                            // Save to server
                            const response = await fetch(`${this.apiBaseUrl}/transcriptions/`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Token ${this.authToken}`
                                },
                                body: JSON.stringify(transcriptionData)
                            });
                            if (response.ok) {
                                savedTranscription = await response.json();
                            }
                        }

                        // Update in-memory annotation object with transcription (only if it's on current image)
                        if (savedTranscription && item.type === 'annotation') {
                            // For batch transcriptions, also include metadata if available
                            if (Object.keys(metadata).length > 0) {
                                savedTranscription.parsed_metadata = metadata;
                            }
                            
                            // Only update if this annotation is currently loaded (on current image)
                            if (this.currentImage && this.currentImage.id === item.imageId) {
                                this.updateAnnotationTranscription(item.annotationId, savedTranscription);
                            }
                        }

                        successCount++;
                        this.addProgressItem(item.imageName, 'success', `Transcribed ${item.type === 'full_image' ? 'full image' : 'annotation'}`);

                    } catch (saveError) {
                        console.error('Failed to save transcription:', saveError);
                        this.addProgressItem(item.imageName, 'error', 'Failed to save transcription');
                    }
                } else {
                    console.error('Invalid result for item:', item);
                    this.addProgressItem(item.imageName, 'error', 'Invalid API response');
                }

                this.updateProgress(i + 1, results.length, 'Saving', `Saved ${successCount}/${i + 1} transcriptions`);
            }

            // Clean up batch info
            if (this.isBrowserCacheMode) {
                try {
                    await this.localStorage.setSetting(`batch_${batchId}`, null);
                } catch (cleanupError) {
                    console.warn('Failed to cleanup batch info:', cleanupError);
                }
            }

            // Refresh UI to show updated transcriptions without triggering reloads
            this.updateCombinedTranscription();
            
            this.showAlert(`Batch processing completed! ${successCount}/${results.length} transcriptions saved`, 'success');
            return { processed: results.length, success: successCount };

        } catch (error) {
            console.error('Failed to process batch results:', error);
            this.showAlert('Failed to process batch results', 'danger');
            return { processed: 0, success: 0 };
        }
    }

    // Zone Selection Modal Functions
    showZoneSelectionModal() {
        this.populateZoneSelectionModal();
        this.selectDetectionMode('auto'); // Default to auto mode
        const modal = new bootstrap.Modal(document.getElementById('zoneSelectionModal'));
        modal.show();
    }

    showTranscriptionZoneSelectionModal(type, id) {
        this.hideLevelActionMenus();
        
        // Check credentials first
        const credentials = this.getStoredCredentials();
        const provider = this.getActiveProvider();
        if (!provider) {
            this.showAlert('Please configure your API credentials first', 'warning');
            this.showCredentialsModal();
            return;
        }

        // Store context for zone selection modal
        this.currentTranscriptionContext = {
            type: type,
            id: id,
            credentials: credentials
        };

        // Set modal title
        document.getElementById('transcriptionZoneSelectionTitle').textContent = 
            `Select Zone Types for ${type === 'project' ? 'Project' : 'Document'} Transcription`;
        
        this.populateTranscriptionZoneSelectionModal();
        
        const modal = new bootstrap.Modal(document.getElementById('transcriptionZoneSelectionModal'));
        modal.show();
    }

    selectDetectionMode(mode) {
        // Update radio buttons
        document.querySelectorAll('input[name="detectionMode"]').forEach(radio => {
            radio.checked = radio.value === mode;
        });

        // Update visual selection
        document.querySelectorAll('.zone-detection-mode').forEach(div => {
            div.classList.remove('selected');
        });
        document.querySelector(`input[value="${mode}"]`).closest('.zone-detection-mode').classList.add('selected');

        // Show/hide selective options
        const selectiveOptions = document.getElementById('selectiveOptions');
        selectiveOptions.style.display = mode === 'selective' ? 'block' : 'none';

        this.selectedDetectionMode = mode;
    }

    populateZoneSelectionModal() {
        if (!this.annotationTypes || !this.userEnabledTypes) return;

        const zoneContainer = document.getElementById('zoneSelectionZoneTypes');
        const lineContainer = document.getElementById('zoneSelectionLineTypes');

        // Clear existing options
        zoneContainer.innerHTML = '';
        lineContainer.innerHTML = '';

        // Add zone type checkboxes (including custom zones)
        [...this.annotationTypes.all_types.zones, ...this.customZones].forEach(zoneType => {
            if (this.userEnabledTypes.zones.includes(zoneType.value)) {
                const checkbox = this.createZoneSelectionCheckbox(zoneType, 'zone');
                zoneContainer.appendChild(checkbox);
            }
        });

        // Add line type checkboxes
        this.annotationTypes.all_types.lines.forEach(lineType => {
            if (this.userEnabledTypes.lines.includes(lineType.value)) {
                const checkbox = this.createZoneSelectionCheckbox(lineType, 'line');
                lineContainer.appendChild(checkbox);
            }
        });
    }

    createZoneSelectionCheckbox(typeInfo, category) {
        const div = document.createElement('div');
        div.className = 'form-check';

        const checkbox = document.createElement('input');
        checkbox.className = 'form-check-input';
        checkbox.type = 'checkbox';
        checkbox.id = `zone_select_${category}_${typeInfo.value}`;
        checkbox.value = typeInfo.value;
        checkbox.checked = true; // Default to checked
        checkbox.dataset.category = category;

        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.setAttribute('for', checkbox.id);
        label.textContent = typeInfo.label;

        div.appendChild(checkbox);
        div.appendChild(label);

        return div;
    }

    toggleAllZoneTypes(selectAll) {
        document.querySelectorAll('#zoneSelectionZoneTypes input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = selectAll;
        });
    }

    toggleAllLineTypes(selectAll) {
        document.querySelectorAll('#zoneSelectionLineTypes input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = selectAll;
        });
    }

    async startSelectedZoneDetection() {
        const detectionMode = this.selectedDetectionMode || 'auto';
        let selectedZones = [];
        let selectedLines = [];
        let useFiltering = false;

        if (detectionMode === 'selective') {
            // Collect selected zone and line types
            document.querySelectorAll('#zoneSelectionZoneTypes input[type="checkbox"]:checked').forEach(checkbox => {
                selectedZones.push(checkbox.value);
            });

            document.querySelectorAll('#zoneSelectionLineTypes input[type="checkbox"]:checked').forEach(checkbox => {
                selectedLines.push(checkbox.value);
            });

            if (selectedZones.length === 0 && selectedLines.length === 0) {
                this.showAlert('Please select at least one zone or line type to detect', 'warning');
                return;
            }
            useFiltering = true;
        } else {
            // Auto mode - don't filter, let the model detect everything
            useFiltering = false;
            selectedZones = [];
            selectedLines = [];
        }

        // Close zone selection modal
        bootstrap.Modal.getInstance(document.getElementById('zoneSelectionModal')).hide();

        // Start detection with selected types and mode
        const context = this.currentDetectionContext;
        if (context.type === 'project') {
            await this.executeProjectDetection(context.id, context.mode, context.credentials, selectedZones, selectedLines, useFiltering);
        } else if (context.type === 'document') {
            await this.executeDocumentDetection(context.id, context.mode, context.credentials, selectedZones, selectedLines, useFiltering);
        }
    }

    populateTranscriptionZoneSelectionModal() {
        if (!this.annotationTypes || !this.userEnabledTypes) return;

        const zoneContainer = document.getElementById('transcriptionZoneSelectionZoneTypes');
        const lineContainer = document.getElementById('transcriptionZoneSelectionLineTypes');

        // Clear existing options
        zoneContainer.innerHTML = '';
        lineContainer.innerHTML = '';

        // Add zone type checkboxes (including custom zones)
        [...this.annotationTypes.all_types.zones, ...this.customZones].forEach(zoneType => {
            if (this.userEnabledTypes.zones.includes(zoneType.value)) {
                const checkbox = this.createTranscriptionZoneSelectionCheckbox(zoneType, 'zone');
                zoneContainer.appendChild(checkbox);
            }
        });

        // Add line type checkboxes
        this.annotationTypes.all_types.lines.forEach(lineType => {
            if (this.userEnabledTypes.lines.includes(lineType.value)) {
                const checkbox = this.createTranscriptionZoneSelectionCheckbox(lineType, 'line');
                lineContainer.appendChild(checkbox);
            }
        });
    }

    createTranscriptionZoneSelectionCheckbox(typeInfo, category) {
        const div = document.createElement('div');
        div.className = 'form-check';

        const checkbox = document.createElement('input');
        checkbox.className = 'form-check-input';
        checkbox.type = 'checkbox';
        checkbox.id = `transcription_zone_select_${category}_${typeInfo.value}`;
        checkbox.value = typeInfo.value;

        const label = document.createElement('label');
        label.className = 'form-check-label';
        label.setAttribute('for', checkbox.id);
        label.textContent = typeInfo.label;

        div.appendChild(checkbox);
        div.appendChild(label);

        return div;
    }

    toggleAllTranscriptionZoneTypes(selectAll) {
        document.querySelectorAll('#transcriptionZoneSelectionZoneTypes input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = selectAll;
        });
    }

    toggleAllTranscriptionLineTypes(selectAll) {
        document.querySelectorAll('#transcriptionZoneSelectionLineTypes input[type="checkbox"]').forEach(checkbox => {
            checkbox.checked = selectAll;
        });
    }

    async startSelectedZoneTranscription() {
        let selectedZones = [];
        let selectedLines = [];

        // Get selected zone types
        document.querySelectorAll('#transcriptionZoneSelectionZoneTypes input[type="checkbox"]:checked').forEach(checkbox => {
            selectedZones.push(checkbox.value);
        });

        // Get selected line types
        document.querySelectorAll('#transcriptionZoneSelectionLineTypes input[type="checkbox"]:checked').forEach(checkbox => {
            selectedLines.push(checkbox.value);
        });

        if (selectedZones.length === 0 && selectedLines.length === 0) {
            this.showAlert('Please select at least one zone or line type', 'warning');
            return;
        }

        // Hide the zone selection modal
        const modal = bootstrap.Modal.getInstance(document.getElementById('transcriptionZoneSelectionModal'));
        if (modal) modal.hide();

        // Execute transcription with selected types
        const context = this.currentTranscriptionContext;
        const selectedTypes = [...selectedZones, ...selectedLines];
        
        if (context.type === 'project') {
            await this.executeProjectTranscription(context.id, 'selected_zones', context.credentials, selectedTypes);
        } else if (context.type === 'document') {
            await this.executeDocumentTranscription(context.id, 'selected_zones', context.credentials, selectedTypes);
        }
    }

    // Import functionality
    async showImportsModal() {
        const modal = new bootstrap.Modal(document.getElementById('importProjectsModal'));
        modal.show();
        
        // Reset form
        document.getElementById('importProjectsForm').reset();
        document.getElementById('importProgress').style.display = 'none';
        document.getElementById('importResult').style.display = 'none';
        document.getElementById('importError').style.display = 'none';
    }

    async startImport() {
        const fileInput = document.getElementById('importFile');
        const importFormat = document.getElementById('importFormat').value;
        
        if (!fileInput.files || fileInput.files.length === 0) {
            this.showAlert('Please select a file to import', 'warning');
            return;
        }
        
        const file = fileInput.files[0];
        
        // Validate file format
        if (importFormat === 'vlamy' && !file.name.toLowerCase().endsWith('.zip')) {
            this.showAlert('Please select a ZIP file for VLAMy format', 'warning');
            return;
        }
        
        if (importFormat === 'json' && !file.name.toLowerCase().endsWith('.json')) {
            this.showAlert('Please select a JSON file for JSON format', 'warning');
            return;
        }
        
        // Show progress
        document.getElementById('importProgress').style.display = 'block';
        document.getElementById('importResult').style.display = 'none';
        document.getElementById('importError').style.display = 'none';
        document.getElementById('importButton').disabled = true;
        document.getElementById('importStatus').textContent = 'Uploading and processing file...';
        
        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('format', importFormat);
            
            const response = await fetch(`${this.apiBaseUrl}/import/project/`, {
                method: 'POST',
                headers: {
                    'Authorization': `Token ${this.authToken}`
                },
                body: formData
            });
            
            if (response.ok) {
                const result = await response.json();
                
                // Show success
                document.getElementById('importProgress').style.display = 'none';
                document.getElementById('importResult').style.display = 'block';
                document.getElementById('importResultMessage').textContent = result.message;
                
                // Show import summary
                let summaryHtml = '<div class="mt-3"><h6>Imported Projects:</h6><ul class="list-group list-group-flush">';
                for (const project of result.imported_projects) {
                    summaryHtml += `
                        <li class="list-group-item d-flex justify-content-between align-items-center">
                            <div>
                                <strong>${this.escapeHtml(project.name)}</strong>
                                <br><small class="text-muted">${project.document_count} document(s), ${project.total_images} image(s)</small>
                            </div>
                            <span class="badge bg-success rounded-pill">Imported</span>
                        </li>
                    `;
                }
                summaryHtml += '</ul></div>';
                document.getElementById('importSummary').innerHTML = summaryHtml;
                
                // Refresh projects list
                await this.loadProjects();
                
                // If we're on the projects view, make sure it's visible
                if (document.getElementById('projectsList')) {
                    this.showAppInterface();
                }
                
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Import failed');
            }
            
        } catch (error) {
            console.error('Import error:', error);
            
            document.getElementById('importProgress').style.display = 'none';
            document.getElementById('importError').style.display = 'block';
            document.getElementById('importErrorMessage').textContent = error.message;
        } finally {
            document.getElementById('importButton').disabled = false;
        }
    }

    // Background Detection Processing
    async executeProjectDetection(projectId, mode, credentials, selectedZones, selectedLines, useFiltering = false) {
        this.operationCancelled = false;
        this.showProgressModal('Detecting Zones', `Starting zone detection for project (${mode === 'all' ? 'all pages' : 'unannotated pages only'})...`);

        try {
            let documents;
            let totalImages = 0;
            let allImages = [];
            
            if (this.isBrowserCacheMode) {
                // Get all documents for this project from IndexedDB
                const allDocs = await this.localStorage.getAll('documents', 'project_id', projectId);
                documents = { results: allDocs };
                
                // Collect all images for these documents
                for (const doc of documents.results) {
                    const images = await this.localStorage.getAll('images', 'document_id', doc.id);
                    images.forEach(image => {
                        allImages.push({ ...image, documentId: doc.id, documentName: doc.name });
                    });
                    totalImages += images.length;
                }
            } else {
                // Get all documents in the project from server
                const docsResponse = await fetch(`${this.apiBaseUrl}/documents/?project=${projectId}`, {
                    headers: { 'Authorization': `Token ${this.authToken}` }
                });
                
                if (!docsResponse.ok) throw new Error('Failed to load project documents');
                documents = await docsResponse.json();

                // Collect all images
                for (const doc of documents.results) {
                    const imagesResponse = await fetch(`${this.apiBaseUrl}/images/?document=${doc.id}`, {
                        headers: { 'Authorization': `Token ${this.authToken}` }
                    });
                    
                    if (imagesResponse.ok) {
                        const images = await imagesResponse.json();
                        images.results.forEach(image => {
                            allImages.push({ ...image, documentId: doc.id, documentName: doc.name });
                        });
                        totalImages += images.results.length;
                    }
                }
            }

            this.updateProgress(0, totalImages, 'Initialized', `Found ${totalImages} images to process`);

            let processedImages = 0;
            let successCount = 0;

            // Process each image
            for (const image of allImages) {
                if (this.operationCancelled) break;

                try {
                    this.updateProgress(processedImages, totalImages, 'Processing', `Processing ${image.name} in ${image.documentName}`);

                    // Check if we should skip this image
                    if (mode === 'unannotated') {
                        let hasAnnotations = false;
                        
                        if (this.isBrowserCacheMode) {
                            // Check annotations in IndexedDB
                            const annotations = await this.localStorage.getAll('annotations', 'image_id', image.id);
                            hasAnnotations = annotations && annotations.length > 0;
                        } else {
                            // Check annotations on server
                            const annotationsResponse = await fetch(`${this.apiBaseUrl}/annotations/?image=${image.id}`, {
                                headers: { 'Authorization': `Token ${this.authToken}` }
                            });
                            if (annotationsResponse.ok) {
                                const annotations = await annotationsResponse.json();
                                hasAnnotations = annotations.results && annotations.results.length > 0;
                            }
                        }
                        
                        if (hasAnnotations) {
                            this.addProgressItem(image.name, 'skipped', 'Already has annotations');
                            processedImages++;
                            continue;
                        }
                    }

                    // Perform detection
                    const result = await this.detectZonesForImage(image.id, credentials, mode === 'all', selectedZones, selectedLines, useFiltering);
                    if (result.success) {
                        successCount += result.count;
                        this.addProgressItem(image.name, 'success', `Detected ${result.count} zones/lines`);
                    } else {
                        this.addProgressItem(image.name, 'error', result.error || 'Detection failed');
                    }
                    
                } catch (error) {
                    console.error(`Failed to process image ${image.id}:`, error);
                    this.addProgressItem(image.name, 'error', error.message);
                }
                
                processedImages++;
                this.updateProgress(processedImages, totalImages, 'Processing', `${successCount} zones detected so far`);
            }

            if (this.operationCancelled) {
                this.completeProgressModal('warning', 'Operation cancelled by user');
            } else {
                this.completeProgressModal('success', `Detection completed! Processed ${processedImages} images, detected ${successCount} zones/lines.`);
                // Refresh project tree to show status icons
                await this.loadProjects();
                
                // If the current image was part of this detection, refresh the image view
                if (this.currentImage && allImages.some(img => img.id === this.currentImage.id)) {
                    await this.loadImageAnnotations();
                    this.updateAnnotationsList();
                }
            }

        } catch (error) {
            console.error('Project detection error:', error);
            this.completeProgressModal('error', `Detection failed: ${error.message}`);
        }
    }

    async executeDocumentDetection(documentId, mode, credentials, selectedZones, selectedLines, useFiltering = false) {
        this.operationCancelled = false;
        this.showProgressModal('Detecting Zones', `Starting zone detection for document (${mode === 'all' ? 'all pages' : 'unannotated pages only'})...`);

        try {
            let images;
            
            if (this.isBrowserCacheMode) {
                // Get all images for this document from IndexedDB
                const allImages = await this.localStorage.getAll('images', 'document_id', documentId);
                images = { results: allImages };
            } else {
                // Get all images in the document from server
                const imagesResponse = await fetch(`${this.apiBaseUrl}/images/?document=${documentId}`, {
                    headers: { 'Authorization': `Token ${this.authToken}` }
                });
                
                if (!imagesResponse.ok) throw new Error('Failed to load document images');
                images = await imagesResponse.json();
            }

            const totalImages = images.results.length;
            this.updateProgress(0, totalImages, 'Initialized', `Found ${totalImages} images to process`);

            let processedImages = 0;
            let successCount = 0;

            // Process each image
            for (const image of images.results) {
                if (this.operationCancelled) break;

                try {
                    this.updateProgress(processedImages, totalImages, 'Processing', `Processing ${image.name}`);

                    // Check if we should skip this image
                    if (mode === 'unannotated') {
                        let hasAnnotations = false;
                        
                        if (this.isBrowserCacheMode) {
                            // Check annotations in IndexedDB
                            const annotations = await this.localStorage.getAll('annotations', 'image_id', image.id);
                            hasAnnotations = annotations && annotations.length > 0;
                        } else {
                            // Check annotations on server
                            const annotationsResponse = await fetch(`${this.apiBaseUrl}/annotations/?image=${image.id}`, {
                                headers: { 'Authorization': `Token ${this.authToken}` }
                            });
                            if (annotationsResponse.ok) {
                                const annotations = await annotationsResponse.json();
                                hasAnnotations = annotations.results && annotations.results.length > 0;
                            }
                        }
                        
                        if (hasAnnotations) {
                            this.addProgressItem(image.name, 'skipped', 'Already has annotations');
                            processedImages++;
                            continue;
                        }
                    }

                    // Perform detection
                    const result = await this.detectZonesForImage(image.id, credentials, mode === 'all', selectedZones, selectedLines, useFiltering);
                    if (result.success) {
                        successCount += result.count;
                        this.addProgressItem(image.name, 'success', `Detected ${result.count} zones/lines`);
                    } else {
                        this.addProgressItem(image.name, 'error', result.error || 'Detection failed');
                    }
                    
                } catch (error) {
                    console.error(`Failed to process image ${image.id}:`, error);
                    this.addProgressItem(image.name, 'error', error.message);
                }
                
                processedImages++;
                this.updateProgress(processedImages, totalImages, 'Processing', `${successCount} zones detected so far`);
            }

            if (this.operationCancelled) {
                this.completeProgressModal('warning', 'Operation cancelled by user');
            } else {
                this.completeProgressModal('success', `Detection completed! Processed ${processedImages} images, detected ${successCount} zones/lines.`);
                // Refresh document tree to show status icons
                await this.loadProjects();
                
                // If the current image was part of this detection, refresh the image view
                if (this.currentImage && images.results.some(img => img.id === this.currentImage.id)) {
                    await this.loadImageAnnotations();
                    this.updateAnnotationsList();
                }
            }

        } catch (error) {
            console.error('Document detection error:', error);
            this.completeProgressModal('error', `Detection failed: ${error.message}`);
        }
    }

    async detectZonesForImage(imageId, credentials, clearExisting = false, selectedZones = [], selectedLines = [], useFiltering = false) {
        try {
            if (this.isBrowserCacheMode) {
                // Use client-side detection for browser cache mode
                const confidenceThreshold = 0.4; // Default threshold
                
                // Get the image data
                const image = await this.localStorage.get('images', imageId);
                if (!image) {
                    return { success: false, count: 0, error: 'Image not found' };
                }
                
                // Perform client-side detection using the same logic as startZoneLineDetectionBrowserCache
                const response = await fetch('https://serverless.roboflow.com/infer/workflows/yale-ai/page-xml', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        api_key: 'gcV24jJosN6XtPnBp7x1',
                        inputs: {
                            "image": {"type": "base64", "value": image.image_file}
                        }
                    })
                });

                if (!response.ok) {
                    return { success: false, count: 0, error: `Detection API error: ${response.status}` };
                }

                const result = await response.json();
                
                // Process the results using the same logic as browser cache mode
                let detections = [];
                
                if (result && result.outputs && result.outputs.length > 0) {
                    const output = result.outputs[0];
                    if (output.predictions && output.predictions.predictions) {
                        detections = output.predictions.predictions
                            .filter(pred => pred.confidence >= confidenceThreshold)
                            .map(pred => ({
                                coordinates: {
                                    x: pred.x - pred.width / 2,
                                    y: pred.y - pred.height / 2,
                                    width: pred.width,
                                    height: pred.height
                                },
                                classification: pred.class || pred.class_name || 'detected_region',
                                confidence: pred.confidence,
                                original_class: pred.class || pred.class_name || 'detected_region'
                            }));
                    }
                }

                // Filter by selected types if filtering is enabled
                if (useFiltering && (selectedZones.length > 0 || selectedLines.length > 0)) {
                    const allowedTypes = [...selectedZones, ...selectedLines];
                    detections = detections.filter(det => 
                        allowedTypes.includes(det.classification) || 
                        allowedTypes.includes(det.original_class)
                    );
                }

                // Clear existing annotations if requested
                if (clearExisting) {
                    const existingAnnotations = await this.localStorage.getAll('annotations', 'image_id', imageId);
                    for (const annotation of existingAnnotations) {
                        await this.localStorage.delete('annotations', annotation.id);
                    }
                }

                // Save detected annotations to IndexedDB
                let savedCount = 0;
                for (const detection of detections) {
                    try {
                        const annotationData = {
                            image_id: imageId,
                            annotation_type: 'bbox',
                            coordinates: detection.coordinates,
                            classification: detection.classification,
                            label: `${detection.classification} (${Math.round(detection.confidence * 100)}%)`,
                            reading_order: savedCount,
                            metadata: {
                                confidence: detection.confidence,
                                original_class: detection.original_class,
                                detected_by: 'roboflow'
                            }
                        };
                        
                        await this.localStorage.add('annotations', annotationData);
                        savedCount++;
                    } catch (error) {
                        console.error('Failed to save detected annotation:', error);
                    }
                }

                // If we're processing the currently displayed image, reload annotations to sync in-memory state
                if (this.currentImage && this.currentImage.id === imageId) {
                    await this.loadImageAnnotations();
                }
                
                return { success: true, count: savedCount };
            } else {
                // Use server-side detection for normal mode
                const response = await fetch(`${this.apiBaseUrl}/images/${imageId}/detect-zones-lines/`, {
                    method: 'POST',
                    headers: {
                        'Authorization': `Token ${this.authToken}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        roboflow_api_key: credentials.roboflow_api_key,
                        filter_selected_types: useFiltering,
                        clear_existing: clearExisting,
                        selected_zone_types: selectedZones,
                        selected_line_types: selectedLines,
                        apply_mappings: true // Always apply detection mappings
                    })
                });

                const result = await response.json();

                if (response.ok && result.detections && result.detections.detections) {
                    return { success: true, count: result.detections.detections.length };
                } else {
                    console.error(`Detection failed for image ${imageId}:`, result.error || 'Unknown error');
                    return { success: false, count: 0, error: result.error || 'Unknown error' };
                }
            }
        } catch (error) {
            console.error(`Error detecting zones for image ${imageId}:`, error);
            return { success: false, count: 0, error: error.message };
        }
    }

    // Progress Modal Functions
    showProgressModal(title, initialMessage) {
        document.getElementById('progressModalTitle').innerHTML = `<i class="fas fa-cog fa-spin me-2"></i>${title}`;
        document.getElementById('progressMainLabel').textContent = 'Overall Progress';
        document.getElementById('progressMainStats').textContent = '0 / 0';
        document.getElementById('progressMainBar').style.width = '0%';
        document.getElementById('progressCurrentTask').textContent = initialMessage;
        document.getElementById('progressDetails').innerHTML = '';
        
        document.getElementById('progressCancelBtn').style.display = 'inline-block';
        document.getElementById('progressCloseBtn').style.display = 'none';

        const modal = new bootstrap.Modal(document.getElementById('progressModal'));
        modal.show();
    }

    updateProgress(current, total, status, message) {
        const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
        
        document.getElementById('progressMainStats').textContent = `${current} / ${total}`;
        document.getElementById('progressMainBar').style.width = `${percentage}%`;
        document.getElementById('progressCurrentTask').textContent = message;
    }

    addProgressItem(itemName, status, message) {
        const details = document.getElementById('progressDetails');
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-times-circle', 
            processing: 'fas fa-cog fa-spin',
            skipped: 'fas fa-forward'
        };

        const item = document.createElement('div');
        item.className = `progress-item ${status}`;
        item.innerHTML = `
            <span class="progress-item-icon"><i class="${icons[status]}"></i></span>
            <span class="progress-item-text">${itemName}</span>
            <span class="progress-item-count">${message}</span>
        `;

        details.appendChild(item);
        details.scrollTop = details.scrollHeight;
    }

    completeProgressModal(status, message) {
        const title = document.getElementById('progressModalTitle');
        const icons = {
            success: 'fas fa-check-circle text-success',
            error: 'fas fa-times-circle text-danger',
            warning: 'fas fa-exclamation-triangle text-warning'
        };

        title.innerHTML = `<i class="${icons[status]} me-2"></i>Complete`;
        document.getElementById('progressCurrentTask').textContent = message;
        
        document.getElementById('progressCancelBtn').style.display = 'none';
        document.getElementById('progressCloseBtn').style.display = 'inline-block';

        // Show alert as well
        const alertTypes = { success: 'success', error: 'danger', warning: 'warning' };
        this.showAlert(message, alertTypes[status]);
    }

    cancelOperation() {
        this.operationCancelled = true;
        this.completeProgressModal('warning', 'Cancelling operation...');
    }
}

// Global Functions (called from HTML)
let app;

document.addEventListener('DOMContentLoaded', () => {
    app = new OCRApp();
    
    // Make debug functions available globally for troubleshooting
    window.debugPrompts = () => app.debugPromptClassifications();
    window.ensureMainZonePrompt = () => app.ensureMainZonePrompt();
});

// Global functions for HTML onclick handlers
function showLogin() {
    app.showLogin();
}

function showRegister() {
    app.showRegister();
}

function showProjects() {
    app.loadProjects();
}

function showExports() {
    app.showExportsModal();
}

function showImports() {
    app.showImportsModal();
}

function startImport() {
    app.startImport();
}



function logout() {
    app.logout();
}

function login(event) {
    app.login(event);
}

function register(event) {
    app.register(event);
}

function showCredentialsModal() {
    app.showCredentialsModal();
}

function saveCredentials() {
    app.saveCredentials();
}

function showDetectZonesLinesModal() {
    app.showDetectZonesLinesModal();
}

function startZoneLineDetection() {
    app.startZoneLineDetection();
}

function toggleDetectionMapper() {
    app.toggleDetectionMapper();
}

function addDetectionMapping() {
    app.addDetectionMapping();
}

function showCreateProjectModal() {
    app.showCreateProjectModal();
}

function showCreateDocumentModal(projectId) {
    app.showCreateDocumentModal(projectId);
}

function showUploadImageModal(documentId) {
    app.showUploadImageModal(documentId);
}

function uploadImages() {
    app.uploadImages();
}

function setTool(tool) {
    app.setTool(tool);
}

function transcribeFullImage() {
    app.transcribeFullImage();
}

function transcribeSelectedAnnotations() {
    app.transcribeSelectedAnnotations();
}

function zoomIn() {
    app.zoomIn();
}

function zoomOut() {
    app.zoomOut();
}

function resetZoom() {
    app.resetZoom();
}

function fitToScreen() {
    app.fitToScreen();
}

function toggleSection(sectionType, element) {
    app.toggleSection(sectionType, element);
}

function removeTranscription(annotationId) {
    app.removeTranscription(annotationId);
}

function selectAnnotationFromTranscription(annotationId) {
    app.selectAnnotationFromTranscription(annotationId);
}

function selectAnnotationFromItem(event, annotationId) {
    app.selectAnnotationFromItem(event, annotationId);
}

function editTranscription(annotationId) {
    app.editTranscription(annotationId);
}

function saveTranscriptionEdit(annotationId) {
    app.saveTranscriptionEdit(annotationId);
}

function cancelTranscriptionEdit(annotationId) {
    app.cancelTranscriptionEdit(annotationId);
}

function transcribeAnnotationFromList(annotationId) {
    app.transcribeAnnotationFromList(annotationId);
} 

function quickEditClassification(event, annotationId) {
    app.quickEditClassification(event, annotationId);
}

function toggleInlineEdit(annotationId) {
    app.toggleInlineEdit(annotationId);
}

function saveInlineEdit(annotationId) {
    app.saveInlineEdit(annotationId);
}

function cancelInlineEdit(annotationId) {
    app.cancelInlineEdit(annotationId);
}

function selectAnnotationFromItem(event, annotationId) {
    app.selectAnnotationFromItem(event, annotationId);
}

// Panel Management Functions
function toggleLeftPanel() {
    app.toggleLeftPanel();
}

function toggleRightPanel() {
    app.toggleRightPanel();
}

function transcribeAllRegions() {
    app.transcribeAllRegions();
}

function confirmTranscribeAllRegions() {
    app.confirmTranscribeAllRegions();
}





// Annotation Editing Functions
function saveAnnotationEdit() {
    app.saveAnnotationEdit();
}

// Prompts Functions
function showAddPromptModal() {
    app.showAddPromptModal();
}

function savePrompt() {
    app.savePrompt();
}

function addMetadataField() {
    app.addMetadataField();
}

// IIIF Import Functions
function showIIIFImportModal() {
    app.showIIIFImportModal();
}

function setExampleManifest(url) {
    app.setExampleManifest(url);
}

function importIIIFManifest() {
    app.importIIIFManifest();
}

// Bulk Selection Functions
function toggleBulkSelect() {
    app.toggleBulkSelect();
}

function bulkDeleteSelected() {
    app.bulkDeleteSelected();
}

function clearSelection() {
    app.clearSelection();
}

function confirmBulkDelete() {
    app.confirmBulkDelete();
}

// Zone Color Management Functions
function updateZoneColor(zoneValue, newColor) {
    app.updateZoneColor(zoneValue, newColor);
}

function showAddCustomZoneModal() {
    app.showAddCustomZoneModal();
}

function addCustomZone() {
    app.addCustomZone();
}

function removeCustomZone(zoneValue) {
    app.removeCustomZone(zoneValue);
}

// Export-related global functions
function selectAllProjects() {
    app.selectAllProjectsForExport();
}

function clearAllProjects() {
    app.clearAllProjectsForExport();
}

function startExport() {
    app.startExport();
}

function downloadExportFile() {
    app.downloadExportFile();
}

// Transcription zone selection global functions
function toggleAllTranscriptionZoneTypes(selectAll) {
    app.toggleAllTranscriptionZoneTypes(selectAll);
}

function toggleAllTranscriptionLineTypes(selectAll) {
    app.toggleAllTranscriptionLineTypes(selectAll);
}

function startSelectedZoneTranscription() {
    app.startSelectedZoneTranscription();
}

// Structure modal functions
function moveToDocument(imageId) {
    app.moveToDocument(imageId);
}

function moveToProject(documentId) {
    app.moveToProject(documentId);
}

function confirmMoveToProject(documentId) {
    app.confirmMoveToProject(documentId);
}

function confirmMoveToDocument(imageId) {
    app.confirmMoveToDocument(imageId);
}

function loadDocumentsForImageMove(projectId) {
    app.loadDocumentsForImageMove(projectId);
}

function toggleCustomZones(enabled) {
    app.toggleCustomZones(enabled);
}

// Utility function for parsing model JSON responses
function parseModelResponseJson(response) {
    return app.parseModelResponseJson(response);
}

// Admin Panel Functions
function showAdminPanel() {
    // Check if user has admin privileges
    if (!app.currentUser || !app.currentUser.user.is_staff) {
        app.showAlert('Access denied. Admin privileges required.', 'danger');
        return;
    }
    
    hideAllScreens();
    document.getElementById('adminScreen').style.display = 'block';
    loadAccountRequests();
}

function hideAllScreens() {
    const screens = ['welcomeScreen', 'loginScreen', 'registerScreen', 'adminScreen', 'appInterface'];
    screens.forEach(screen => {
        const element = document.getElementById(screen);
        if (element) {
            element.style.display = 'none';
        }
    });
}

async function loadAccountRequests() {
    const container = document.getElementById('accountRequestsContainer');
    const statusFilter = document.querySelector('input[name="statusFilter"]:checked')?.value || 'pending';
    
    // Show loading
    container.innerHTML = `
        <div class="text-center py-4">
            <div class="spinner-border" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
            <p class="mt-2">Loading account requests...</p>
        </div>
    `;
    
    try {
        const response = await fetch(`${app.apiBaseUrl}/admin/account-requests/?status=${statusFilter}`, {
            headers: {
                'Authorization': `Token ${app.authToken}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (response.ok) {
            const data = await response.json();
            displayAccountRequests(data.requests);
        } else {
            const error = await response.json();
            container.innerHTML = `
                <div class="alert alert-danger">
                    <i class="fas fa-exclamation-triangle me-2"></i>
                    Error loading account requests: ${error.error || 'Unknown error'}
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading account requests:', error);
        container.innerHTML = `
            <div class="alert alert-danger">
                <i class="fas fa-exclamation-triangle me-2"></i>
                Failed to load account requests. Please try again.
            </div>
        `;
    }
}

function displayAccountRequests(requests) {
    const container = document.getElementById('accountRequestsContainer');
    
    if (requests.length === 0) {
        container.innerHTML = `
            <div class="text-center py-4 text-muted">
                <i class="fas fa-inbox fa-3x mb-3"></i>
                <p>No account requests found for the selected status.</p>
            </div>
        `;
        return;
    }
    
    const requestsHtml = requests.map(request => {
        const statusBadge = getStatusBadge(request.status);
        const actionButtons = request.status === 'pending' ? `
            <button class="btn btn-success btn-sm me-2" onclick="processAccountRequest('${request.id}', 'approve')">
                <i class="fas fa-check me-1"></i>Approve
            </button>
            <button class="btn btn-danger btn-sm" onclick="processAccountRequest('${request.id}', 'deny')">
                <i class="fas fa-times me-1"></i>Deny
            </button>
        ` : '';
        
        const reviewInfo = request.reviewed_by ? `
            <small class="text-muted">
                Reviewed by ${request.reviewed_by} on ${new Date(request.reviewed_at).toLocaleDateString()}
            </small>
        ` : '';
        
        return `
            <div class="card mb-3">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-8">
                            <h6 class="card-title mb-2">
                                ${request.username} ${statusBadge}
                            </h6>
                            <p class="card-text mb-1">
                                <strong>Name:</strong> ${request.first_name} ${request.last_name}<br>
                                <strong>Email:</strong> ${request.email}<br>
                                <strong>Requested:</strong> ${new Date(request.requested_at).toLocaleDateString()}
                            </p>
                            ${request.request_reason ? `
                                <p class="card-text">
                                    <strong>Reason:</strong> ${request.request_reason}
                                </p>
                            ` : ''}
                            ${request.admin_notes ? `
                                <p class="card-text">
                                    <strong>Admin Notes:</strong> ${request.admin_notes}
                                </p>
                            ` : ''}
                            ${reviewInfo}
                        </div>
                        <div class="col-md-4 text-end">
                            ${actionButtons}
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = requestsHtml;
}

function getStatusBadge(status) {
    const badges = {
        'pending': '<span class="badge bg-warning">Pending</span>',
        'approved': '<span class="badge bg-success">Approved</span>',
        'denied': '<span class="badge bg-danger">Denied</span>'
    };
    return badges[status] || '<span class="badge bg-secondary">Unknown</span>';
}

async function processAccountRequest(requestId, action) {
    const adminNotes = action === 'deny' ? prompt('Enter a reason for denial (optional):') : '';
    
    if (action === 'deny' && adminNotes === null) {
        return; // User cancelled
    }
    
    try {
        const response = await fetch(`${app.apiBaseUrl}/admin/account-requests/`, {
            method: 'POST',
            headers: {
                'Authorization': `Token ${app.authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                request_id: requestId,
                action: action,
                admin_notes: adminNotes || ''
            })
        });
        
        if (response.ok) {
            const data = await response.json();
            app.showAlert(data.message, 'success');
            loadAccountRequests(); // Refresh the list
        } else {
            const error = await response.json();
            app.showAlert(`Error ${action}ing request: ${error.error}`, 'danger');
        }
    } catch (error) {
        console.error(`Error processing account request:`, error);
        app.showAlert(`Failed to ${action} request. Please try again.`, 'danger');
    }
}

// Event listeners for status filter
document.addEventListener('DOMContentLoaded', function() {
    const statusFilters = document.querySelectorAll('input[name="statusFilter"]');
    statusFilters.forEach(filter => {
        filter.addEventListener('change', loadAccountRequests);
    });
});