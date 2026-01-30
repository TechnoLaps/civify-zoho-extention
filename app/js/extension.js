let currentRecordId = null;
let currentModule = null;
let currentAttachments = [];
let parsedDataCache = null;

// Initialize Zoho Embedded App
ZOHO.embeddedApp.on("PageLoad", function(data) {
    if(data && data.Entity) {
        currentRecordId = data.EntityId;
        currentModule = data.Entity;
        
        // Load Settings
        loadSettings();
        
        // Load Attachments
        fetchAttachments();
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
    document.getElementById(tabName + '-view').classList.add('active');
    
    if (tabName !== 'settings') {
        checkApiKeyWarning();
    }
}

async function checkApiKeyWarning() {
    const apiKey = await getApiKey();
    if (!apiKey) {
        document.getElementById('settings-warning').style.display = 'block';
    } else {
        document.getElementById('settings-warning').style.display = 'none';
    }
}

async function loadSettings() {
    const localApiKey = localStorage.getItem('civify_api_key');
    const localApiUrl = localStorage.getItem('civify_api_url');
    
    if (localApiKey) document.getElementById('api-key').value = localApiKey;
    if (localApiUrl) document.getElementById('api-url').value = localApiUrl;
    
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
    const apiKey = document.getElementById('api-key').value.trim();
    const apiUrl = document.getElementById('api-url').value.trim();
    
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
    
    document.getElementById('settings-status').innerText = "Saved!";
    setTimeout(() => document.getElementById('settings-status').innerText = "", 2000);
    
    checkApiKeyWarning();
}

function fetchAttachments() {
    if (!currentRecordId || !currentModule) {
        console.log("fetchAttachments: No record context", { currentRecordId, currentModule });
        return;
    }
    
    console.log("fetchAttachments: Fetching for", currentModule, currentRecordId);
    
    const loadingIds = ['parse-file-loading', 'mask-file-loading'];
    const listIds = ['parse-file-list', 'mask-file-list'];
    const emptyIds = ['parse-no-files', 'mask-no-files'];
    
    loadingIds.forEach(id => { const el = document.getElementById(id); if(el) el.classList.remove('hidden'); });
    listIds.forEach(id => { const el = document.getElementById(id); if(el) el.innerHTML = ''; });
    emptyIds.forEach(id => { const el = document.getElementById(id); if(el) el.classList.add('hidden'); });

    ZOHO.CRM.API.getRelatedRecords({
        Entity: currentModule,
        RecordID: currentRecordId,
        RelatedList: "Attachments",
        page: 1,
        per_page: 50
    }).then(function(data) {
        console.log("fetchAttachments: Response", data);
        loadingIds.forEach(id => { const el = document.getElementById(id); if(el) el.classList.add('hidden'); });
        
        if (data && data.data && data.data.length > 0) {
            currentAttachments = data.data;
            console.log("fetchAttachments: Found", currentAttachments.length, "attachments", currentAttachments);
            renderAttachments(currentAttachments);
        } else {
            console.log("fetchAttachments: No attachments found");
            emptyIds.forEach(id => { const el = document.getElementById(id); if(el) el.classList.remove('hidden'); });
        }
    }).catch(err => {
        console.error("fetchAttachments: Error", err);
        loadingIds.forEach(id => { const el = document.getElementById(id); if(el) el.classList.add('hidden'); });
        emptyIds.forEach(id => { const el = document.getElementById(id); if(el) el.classList.remove('hidden'); });
    });
}

function renderAttachments(attachments) {
    const parseList = document.getElementById('parse-file-list');
    const maskList = document.getElementById('mask-file-list');
    
    if (!parseList || !maskList) return;
    
    attachments.forEach(file => {
        const liParse = document.createElement('li');
        liParse.className = 'file-item';
        liParse.innerHTML = `<span>${file.File_Name}</span><button onclick="parseFile('${file.id}')">Parse</button>`;
        parseList.appendChild(liParse);
        
        const liMask = document.createElement('li');
        liMask.className = 'file-item';
        liMask.innerHTML = `<span>${file.File_Name}</span><button onclick="maskFile('${file.id}')">Mask</button>`;
        maskList.appendChild(liMask);
    });
}

async function getFileBlob(fileId, entity, recordId) {
    try {
        console.log("getFileBlob: Downloading file:", { fileId, entity, recordId });
        
        // Zoho CRM API getFile requires Entity and RecordID for attachments
        const params = { id: fileId };
        
        // Add parent context if available
        if (entity && recordId) {
            params.Entity = entity;
            params.RecordID = recordId;
        }
        
        console.log("getFileBlob: Calling ZOHO.CRM.API.getFile with:", params);
        const response = await ZOHO.CRM.API.getFile(params);
        console.log("getFileBlob: Response type:", typeof response, response);
        
        // Check if response is an error (empty blob with xml type)
        if (response instanceof Blob && response.size === 0) {
            console.error("getFileBlob: Empty blob returned, trying alternative method");
            
            // Try using getRelatedRecordFile alternative
            const altResponse = await ZOHO.CRM.API.getFile({
                Entity: "Attachments",
                RecordID: fileId
            });
            console.log("getFileBlob: Alt response:", altResponse);
            
            if (altResponse instanceof Blob && altResponse.size > 0) {
                return altResponse;
            }
        }
        
        // If response is already a Blob with content, return it
        if (response instanceof Blob && response.size > 0) {
            console.log("getFileBlob: Got Blob, size:", response.size);
            return response;
        }
        
        // If response is an ArrayBuffer, convert to Blob
        if (response instanceof ArrayBuffer) {
            console.log("getFileBlob: Got ArrayBuffer, converting to Blob");
            return new Blob([response]);
        }
        
        // If response has a blob() method (Response object), call it
        if (response && typeof response.blob === 'function') {
            console.log("getFileBlob: Got Response, calling blob()");
            return await response.blob();
        }
        
        // If response is a string (base64), decode it
        if (typeof response === 'string') {
            console.log("getFileBlob: Got string, assuming base64");
            const byteCharacters = atob(response);
            const byteNumbers = new Array(byteCharacters.length);
            for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            return new Blob([byteArray]);
        }
        
        console.error("getFileBlob: Unknown response format or empty file:", response);
        throw new Error("Unable to download file - the file may be empty or inaccessible");
    } catch (error) {
        console.error("getFileBlob: Error:", error);
        throw error;
    }
}

// ... Parsing Logic ...
async function parseFile(fileId) {
    const apiKey = await getApiKey();
    const apiUrl = await getApiUrl();
    
    if (!apiKey) {
        alert("Please configure API Key in Settings.");
        switchTab('settings');
        return;
    }

    const fileMeta = currentAttachments.find(f => f.id == fileId);
    const statusDiv = document.getElementById('parse-status');
    statusDiv.innerText = "Downloading file...";
    
    try {
        const fileBlob = await getFileBlob(fileId, currentModule, currentRecordId);
        const file = new File([fileBlob], fileMeta.File_Name, { type: "application/pdf" });
        
        statusDiv.innerText = "Parsing with Civify...";
        const formData = new FormData();
        formData.append("file", file);
        
        const response = await fetch(`${apiUrl}/parse`, {
            method: 'POST',
            headers: { 'X-API-KEY': apiKey },
            body: formData
        });
        
        if (!response.ok) throw new Error(`API Error: ${response.statusText}`);
        
        const data = await response.json();
        if (data.success && data.resumeData) {
            statusDiv.innerText = "Success!";
            parsedDataCache = data.resumeData;
            showParsePreview(data.resumeData);
        } else {
            throw new Error(data.message || "Unknown error");
        }
    } catch (e) {
        console.error(e);
        statusDiv.innerText = "Error: " + e.message;
    }
}

function showParsePreview(data) {
    const container = document.getElementById('parsed-fields');
    container.innerHTML = '';
    
    const fields = [
        { label: "Name", value: data.personalInfo?.fullName },
        { label: "Email", value: data.personalInfo?.email },
        { label: "Phone", value: data.personalInfo?.phone },
        { label: "Summary", value: data.personalInfo?.summary?.substring(0, 100) + "..." }
    ];
    
    fields.forEach(f => {
        if (f.value) {
            const div = document.createElement('div');
            div.className = 'field-row';
            div.innerHTML = `<span class="field-label">${f.label}:</span><span class="field-value">${f.value}</span>`;
            container.appendChild(div);
        }
    });
    
    document.getElementById('parse-result').style.display = 'block';
}

function saveParsedData() {
    if (!parsedDataCache) return;
    const info = parsedDataCache.personalInfo;
    const updateData = {};
    
    if (info.fullName) {
        const parts = info.fullName.split(' ');
        if (parts.length > 1) {
            updateData.Last_Name = parts.pop();
            updateData.First_Name = parts.join(' ');
        } else {
            updateData.Last_Name = info.fullName;
        }
    }
    if (info.email) updateData.Email = info.email;
    if (info.phone) updateData.Phone = info.phone;
    if (info.city) updateData.Mailing_City = info.city;
    if (info.summary) updateData.Description = info.summary;
    
    updateData.id = currentRecordId;
    document.getElementById('parse-status').innerText = "Updating Record...";
    
    ZOHO.CRM.API.updateRecord({
        Entity: currentModule,
        APIData: updateData,
        Trigger: ["workflow"]
    }).then(function(data) {
         document.getElementById('parse-status').innerText = "Updated!";
         setTimeout(() => ZOHO.CRM.UI.Popup.closeReload(), 1500);
    });
}

async function maskFile(fileId) {
    const apiKey = await getApiKey();
    const apiUrl = await getApiUrl();
     if (!apiKey) {
        alert("Please configure API Key.");
        switchTab('settings');
        return;
    }
    
    const fileMeta = currentAttachments.find(f => f.id == fileId);
    const statusDiv = document.getElementById('mask-status');
    statusDiv.innerText = "Downloading...";

    try {
        const fileBlob = await getFileBlob(fileId, currentModule, currentRecordId);
        console.log("File blob received:", fileBlob, "Size:", fileBlob.size, "Type:", fileBlob.type);
        
        // Determine MIME type from file extension
        const fileName = fileMeta.File_Name;
        let mimeType = fileBlob.type || 'application/octet-stream';
        if (fileName.toLowerCase().endsWith('.pdf')) {
            mimeType = 'application/pdf';
        } else if (fileName.toLowerCase().endsWith('.docx')) {
            mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        } else if (fileName.toLowerCase().endsWith('.doc')) {
            mimeType = 'application/msword';
        }
        
        const file = new File([fileBlob], fileName, { type: mimeType });
        console.log("File created:", file.name, "Size:", file.size, "Type:", file.type);
        
        if (file.size === 0) {
            throw new Error("Downloaded file is empty. Please try again.");
        }
        
        statusDiv.innerText = "Masking...";
        const formData = new FormData();
        formData.append("file", file);
        
        console.log("Sending request to:", `${apiUrl}/mask`);

        const response = await fetch(`${apiUrl}/mask`, {
            method: 'POST',
            headers: { 'X-API-KEY': apiKey },
            body: formData
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error("API Error response:", errorText);
            throw new Error(`API Error: ${response.status} - ${errorText || response.statusText}`);
        }
        const maskedBlob = await response.blob();
        
        statusDiv.innerText = "Uploading...";
        ZOHO.CRM.API.attachFile({
            Entity: currentModule,
            RecordID: currentRecordId,
            File: { Name: "MASKED_" + fileMeta.File_Name, Content: maskedBlob }
        }).then(function(data) {
            statusDiv.innerText = "Uploaded successfully!";
            setTimeout(() => fetchAttachments(), 2000);
        });
    } catch (e) {
        console.error(e);
        statusDiv.innerText = "Error: " + e.message;
    }
}

// Handle file upload for Parse
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
    
    const statusDiv = document.getElementById('parse-status');
    statusDiv.innerText = "Parsing uploaded file...";
    
    try {
        const formData = new FormData();
        formData.append("file", file);
        
        console.log("Uploading file for parsing:", file.name, "Size:", file.size, "Type:", file.type);
        
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
            statusDiv.innerText = "Success! Parsed CV data.";
            parsedDataCache = data.resumeData;
            showParsePreview(data.resumeData);
            
            // Optionally save file as attachment
            if (currentRecordId && currentModule) {
                await ZOHO.CRM.API.attachFile({
                    Entity: currentModule,
                    RecordID: currentRecordId,
                    File: { Name: file.name, Content: file }
                });
                console.log("File saved as attachment");
            }
        } else {
            throw new Error(data.message || "Unknown error");
        }
    } catch (e) {
        console.error(e);
        statusDiv.innerText = "Error: " + e.message;
    }
    
    // Clear the input
    input.value = '';
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
        return;
    }
    
    const statusDiv = document.getElementById('mask-status');
    statusDiv.innerText = "Masking uploaded file...";
    
    try {
        const formData = new FormData();
        formData.append("file", file);
        
        console.log("Uploading file for masking:", file.name, "Size:", file.size, "Type:", file.type);
        
        const response = await fetch(`${apiUrl}/mask`, {
            method: 'POST',
            headers: { 'X-API-KEY': apiKey },
            body: formData
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error: ${response.status} - ${errorText}`);
        }
        
        const maskedBlob = await response.blob();
        statusDiv.innerText = "Masked successfully! Uploading as attachment...";
        
        // Save masked file as attachment
        if (currentRecordId && currentModule) {
            await ZOHO.CRM.API.attachFile({
                Entity: currentModule,
                RecordID: currentRecordId,
                File: { Name: "MASKED_" + file.name, Content: maskedBlob }
            });
            statusDiv.innerText = "Masked file uploaded successfully!";
            setTimeout(() => fetchAttachments(), 2000);
        } else {
            // If no record context, offer download
            const url = URL.createObjectURL(maskedBlob);
            const a = document.createElement('a');
            a.href = url;
            a.download = "MASKED_" + file.name.replace(/\.[^.]+$/, '.pdf');
            a.click();
            URL.revokeObjectURL(url);
            statusDiv.innerText = "Masked file downloaded!";
        }
    } catch (e) {
        console.error(e);
        statusDiv.innerText = "Error: " + e.message;
    }
    
    // Clear the input
    input.value = '';
}
