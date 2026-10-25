class MessageBox {
    constructor() {
        this.container = document.getElementById('messageBox');
        if (!this.container) {
            console.error('%c Error: Message box container not found!', 'background: #222; color: #ff0000; padding: 2px;');
            return;
        }
        
        this.content = this.container.querySelector('.message-box-content');
        this.closeButton = this.container.querySelector('.message-box-close');
        this.messageUrl = `https://storage.googleapis.com/iss_sky_scanner_site_message/website_message.txt`;
        
        // Initialize
        this.setupEventListeners();
        
        // Fetch message once on load
        this.fetchMessage();
    }

    setupEventListeners() {
        if (!this.closeButton) {
            console.error('%c Error: Close button not found!', 'background: #222; color: #ff0000; padding: 2px;');
            return;
        }
        this.closeButton.addEventListener('click', () => this.hideMessage());
    }

    async fetchMessage() {
        // The banner is optional: any failure (missing bucket/object, network, CORS)
        // just leaves it hidden, with a single debug line.
        try {
            const response = await fetch(this.messageUrl, {
                cache: 'no-store' // Disable caching
            });
            
            if (!response.ok) {
                console.debug('Website message unavailable:', response.status);
                return;
            }

            const message = (await response.text()).trim();
            
            // Only show if message is not empty
            if (message) {
                this.showMessage(message);
            } else {
                this.hideMessage();
            }
        } catch (error) {
            console.debug('Website message unavailable:', error.message);
        }
    }

    showMessage(message) {
        if (!this.content || !this.container) {
            console.error('%c Error: Required elements not found!', 'background: #222; color: #ff0000; padding: 2px;');
            return;
        }
        this.content.textContent = message;
        this.container.style.display = 'block';
    }

    hideMessage() {
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new MessageBox();
});
