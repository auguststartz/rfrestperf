// Use electronAPI from preload script
const api = window.electronAPI;

// DOM elements
const form = document.getElementById('settingsForm');
const faxApiUrlInput = document.getElementById('faxApiUrl');
const faxUsernameInput = document.getElementById('faxUsername');
const faxPasswordInput = document.getElementById('faxPassword');
const showPasswordCheckbox = document.getElementById('showPassword');
const testConnectionBtn = document.getElementById('testConnectionBtn');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');
const statusMessage = document.getElementById('statusMessage');

// Show/hide password toggle
showPasswordCheckbox.addEventListener('change', () => {
    faxPasswordInput.type = showPasswordCheckbox.checked ? 'text' : 'password';
});

// Load existing settings on window open
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const settings = await api.getConnectionSettings();
        if (settings) {
            faxApiUrlInput.value = settings.faxApiUrl || '';
            faxUsernameInput.value = settings.faxUsername || '';
            faxPasswordInput.value = settings.faxPassword || '';
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showStatus('Error loading settings: ' + error.message, 'error');
    }
});

// Test connection button
testConnectionBtn.addEventListener('click', async () => {
    // Validate form first
    if (!faxApiUrlInput.value || !faxUsernameInput.value || !faxPasswordInput.value) {
        showStatus('Please fill in all fields before testing', 'error');
        return;
    }

    testConnectionBtn.disabled = true;
    testConnectionBtn.textContent = 'Testing...';
    showStatus('Testing connection...', 'info');

    try {
        const settings = {
            faxApiUrl: faxApiUrlInput.value.trim(),
            faxUsername: faxUsernameInput.value.trim(),
            faxPassword: faxPasswordInput.value
        };

        const result = await api.testConnectionWithSettings(settings);

        if (result.success) {
            showStatus(`✓ Connected successfully to ${result.server}`, 'success');
        } else {
            showStatus(`✗ Connection failed: ${result.error}`, 'error');
        }
    } catch (error) {
        showStatus(`✗ Error: ${error.message}`, 'error');
    } finally {
        testConnectionBtn.disabled = false;
        testConnectionBtn.textContent = 'Test Connection';
    }
});

// Save settings button
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const settings = {
            faxApiUrl: faxApiUrlInput.value.trim(),
            faxUsername: faxUsernameInput.value.trim(),
            faxPassword: faxPasswordInput.value
        };

        const result = await api.saveConnectionSettings(settings);

        if (result.success) {
            showStatus('✓ Settings saved successfully!', 'success');
            // Close window after a short delay
            setTimeout(() => {
                window.close();
            }, 1000);
        } else {
            showStatus(`✗ Failed to save settings: ${result.error}`, 'error');
        }
    } catch (error) {
        showStatus(`✗ Error: ${error.message}`, 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Settings';
    }
});

// Cancel button
cancelBtn.addEventListener('click', () => {
    window.close();
});

// Helper function to show status messages
function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message show ${type}`;

    // Auto-hide after 5 seconds for success/info messages
    if (type !== 'error') {
        setTimeout(() => {
            statusMessage.classList.remove('show');
        }, 5000);
    }
}
