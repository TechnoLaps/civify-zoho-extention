let currentRecordId = null;
let currentModule = null;

// Initialize Zoho Embedded App
ZOHO.embeddedApp.on("PageLoad", function(data) {
    if(data && data.Entity) {
        currentRecordId = data.EntityId;
        currentModule = data.Entity;
        
        // Load Settings
        loadSettings();
    }
});

ZOHO.embeddedApp.init();

// Get API Key with fallback: localStorage -> Org Variable
async function getApiKey() {
    // First check localStorage (user override)
    const localKey = localStorage.getItem('civify_api_key');
    if (localKey && localKey.trim() !== '') {
        return localKey;
    }
    
    // Fallback to Organization Variable
    try {
        const orgData = await ZOHO.CRM.CONFIG.getOrgVariable("civify_api_key");
        if (orgData && orgData.Success && orgData.Success.Content) {
            return orgData.Success.Content;
        }
    } catch (e) {
        console.log("Org variable not found or error:", e);
    }
    
    return null;
}

// Get API URL with fallback
async function getApiUrl() {
    const localUrl = localStorage.getItem('civify_api_url');
    if (localUrl && localUrl.trim() !== '') {
        return localUrl;
    }
    
    try {
        const orgData = await ZOHO.CRM.CONFIG.getOrgVariable("civify_api_url");
        if (orgData && orgData.Success && orgData.Success.Content) {
            return orgData.Success.Content;
        }
    } catch (e) {
        console.log("Org variable not found:", e);
    }
    
    return "https://civify.cv/apis/v1/external/cvs";
}

function switchTab(tabName) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab[onclick="switchTab(\'' + tabName + '\')"]').forEach(t => t.classList.add('active'));
    
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const viewEl = document.getElementById(tabName + '-view');
    if (viewEl) viewEl.classList.add('active');
    
    if (tabName !== 'settings') {
        checkApiKeyWarning();
    }
}

async function checkApiKeyWarning() {
    const apiKey = await getApiKey();
    const warningEl = document.getElementById('settings-warning');
    if (warningEl) {
        warningEl.style.display = apiKey ? 'none' : 'block';
    }
}

async function loadSettings() {
    const localApiKey = localStorage.getItem('civify_api_key');
    const localApiUrl = localStorage.getItem('civify_api_url');
    
    const apiKeyEl = document.getElementById('api-key');
    const apiUrlEl = document.getElementById('api-url');
    
    if (localApiKey && apiKeyEl) apiKeyEl.value = localApiKey;
    if (localApiUrl && apiUrlEl) apiUrlEl.value = localApiUrl;
    
    try {
        const orgKeyData = await ZOHO.CRM.CONFIG.getOrgVariable("civify_api_key");
        if (orgKeyData && orgKeyData.Success && orgKeyData.Success.Content) {
            const orgInfo = document.getElementById('org-key-info');
            if (orgInfo) {
                orgInfo.style.display = 'block';
                orgInfo.innerText = "✓ Organization API Key configured. Leave field empty to use it.";
            }
        }
    } catch (e) {
        console.log("No org variable configured");
    }
    
    checkApiKeyWarning();
}

function saveSettings() {
    const apiKeyEl = document.getElementById('api-key');
    const apiUrlEl = document.getElementById('api-url');
    
    const apiKey = apiKeyEl ? apiKeyEl.value.trim() : '';
    const apiUrl = apiUrlEl ? apiUrlEl.value.trim() : '';
    
    if (apiKey) {
        localStorage.setItem('civify_api_key', apiKey);
    } else {
        localStorage.removeItem('civify_api_key');
    }
    
    if (apiUrl) {
        localStorage.setItem('civify_api_url', apiUrl);
    } else {
        localStorage.removeItem('civify_api_url');
    }
    
    const statusEl = document.getElementById('settings-status');
    if (statusEl) {
        statusEl.innerText = "✓ Saved!";
        setTimeout(() => statusEl.innerText = "", 2000);
    }
    
    checkApiKeyWarning();
}

// Helper to update status display with optional action buttons
function setStatus(elementId, message, type, actions) {
    const el = document.getElementById(elementId);
    if (!el) return;
    
    el.className = 'status ' + (type || '');
    if (type === 'loading') {
        el.innerHTML = '<div class="spinner"></div> ' + message;
    } else {
        el.innerHTML = message;
    }
    
    // Add action buttons if provided
    if (actions && actions.length > 0) {
        const btnContainer = document.createElement('div');
        btnContainer.style.marginTop = '12px';
        btnContainer.style.display = 'flex';
        btnContainer.style.gap = '10px';
        
        actions.forEach(action => {
            const btn = document.createElement('button');
            btn.innerText = action.label;
            btn.onclick = action.onClick;
            btn.style.padding = '8px 16px';
            btn.style.fontSize = '0.85em';
            if (action.secondary) {
                btn.style.background = '#f3f4f6';
                btn.style.color = '#374151';
            }
            btnContainer.appendChild(btn);
        });
        
        el.appendChild(btnContainer);
    }
}

// Start over - reset the form
function startOver() {
    const statusEl = document.getElementById('mask-status');
    if (statusEl) {
        statusEl.innerHTML = '';
        statusEl.className = '';
    }
    const uploadEl = document.getElementById('mask-upload');
    if (uploadEl) uploadEl.value = '';
}

// Close widget and refresh the parent page
function closeAndRefresh() {
    try {
        ZOHO.CRM.UI.Popup.closeReload();
    } catch (e) {
        // Fallback: just reload the widget
        window.location.reload();
    }
}

// Handle file upload for Mask
async function handleMaskUpload(input) {
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const apiKey = await getApiKey();
    const apiUrl = await getApiUrl();
    
    if (!apiKey) {
        alert("Please configure API Key in Settings or set Organization Variable.");
        switchTab('settings');
        input.value = '';
        return;
    }
    
    setStatus('mask-status', 'Uploading and masking CV...', 'loading');
    
    try {
        const formData = new FormData();
        formData.append("file", file);
        
        console.log("Masking file:", file.name, "Size:", file.size);
        
        const response = await fetch(`${apiUrl}/mask`, {
            method: 'POST',
            headers: { 'X-API-KEY': apiKey },
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorText || 'Unknown error'}`);
        }
        
        const maskedBlob = await response.blob();
        console.log("Masked blob received:", maskedBlob.size, "bytes");
        
        const successActions = [
            { label: '🔄 Mask Another', onClick: startOver, secondary: true },
            { label: '✓ Close & Refresh', onClick: closeAndRefresh }
        ];
        
        // Save masked file as attachment if we have record context
        if (currentRecordId && currentModule) {
            setStatus('mask-status', 'Saving masked file to record...', 'loading');
            
            try {
                await ZOHO.CRM.API.attachFile({
                    Entity: currentModule,
                    RecordID: currentRecordId,
                    File: { Name: "MASKED_" + file.name.replace(/\.[^.]+$/, '.pdf'), Content: maskedBlob }
                });
                setStatus('mask-status', '✓ Masked file saved to attachments!', 'success', successActions);
            } catch (attachErr) {
                console.warn("Could not attach file, offering download instead:", attachErr);
                downloadBlob(maskedBlob, "MASKED_" + file.name.replace(/\.[^.]+$/, '.pdf'));
                setStatus('mask-status', '✓ Masked file downloaded (could not save to record)', 'success', successActions);
            }
        } else {
            // No record context, just download
            downloadBlob(maskedBlob, "MASKED_" + file.name.replace(/\.[^.]+$/, '.pdf'));
            setStatus('mask-status', '✓ Masked file downloaded!', 'success', [
                { label: '🔄 Mask Another', onClick: startOver }
            ]);
        }
    } catch (e) {
        console.error("Mask error:", e);
        setStatus('mask-status', '✗ Error: ' + e.message, 'error', [
            { label: '🔄 Try Again', onClick: startOver }
        ]);
    }
    
    // Clear the input
    input.value = '';
}

// Helper to download a blob
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/* 
 * Parse functionality - commented out for now
 * 
async function handleParseUpload(input) {
    if (!input.files || input.files.length === 0) return;
    
    const file = input.files[0];
    const apiKey = await getApiKey();
    const apiUrl = await getApiUrl();
    
    if (!apiKey) {
        alert("Please configure API Key in Settings or set Organization Variable.");
        switchTab('settings');
        return;
    }
    
    setStatus('parse-status', 'Parsing CV...', 'loading');
    
    try {
        const formData = new FormData();
        formData.append("file", file);
        
        const response = await fetch(`${apiUrl}/parse`, {
            method: 'POST',
            headers: { 'X-API-KEY': apiKey },
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }
        
        const data = await response.json();
        if (data.success && data.resumeData) {
            setStatus('parse-status', '✓ CV parsed successfully!', 'success');
            showParsePreview(data.resumeData);
        } else {
            throw new Error(data.message || "Unknown error");
        }
    } catch (e) {
        console.error(e);
        setStatus('parse-status', '✗ Error: ' + e.message, 'error');
    }
    
    input.value = '';
}
*/
