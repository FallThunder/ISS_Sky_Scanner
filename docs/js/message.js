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
        try {
            console.log('%c Fetching message from: ' + this.messageUrl, 'background: #222; color: #bada55; padding: 2px;');
            const response = await fetch(this.messageUrl, {
                cache: 'no-store' // Disable caching
            });
            
            if (!response.ok) {
                console.warn('%c Failed to fetch website message:', 'background: #222; color: #ff9900; padding: 2px;', response.status, response.statusText);
                return;
            }

            const message = await response.text();
            console.log('%c Received message: ' + message, 'background: #222; color: #bada55; padding: 2px;');
            
            // Only show if message is not empty
            if (message.trim()) {
                this.showMessage(message.trim());
            } else {
                console.log('%c Message is empty, hiding message box', 'background: #222; color: #bada55; padding: 2px;');
                this.hideMessage();
            }
        } catch (error) {
            console.warn('%c Error fetching website message:', 'background: #222; color: #ff0000; padding: 2px;', error);
        }
    }

    showMessage(message) {
        console.log('%c Showing message box with text: ' + message, 'background: #222; color: #bada55; padding: 2px;');
        if (!this.content || !this.container) {
            console.error('%c Error: Required elements not found!', 'background: #222; color: #ff0000; padding: 2px;');
            return;
        }
        this.content.textContent = message;
        this.container.style.display = 'block';
    }

    hideMessage() {
        console.log('%c Hiding message box', 'background: #222; color: #bada55; padding: 2px;');
        if (this.container) {
            this.container.style.display = 'none';
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('%c Initializing message box...', 'background: #222; color: #bada55; padding: 2px;');
    new MessageBox();
});
