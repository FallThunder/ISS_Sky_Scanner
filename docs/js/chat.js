import config from './config.js';

class ChatWidget {
    constructor() {
        this.panel = document.getElementById('chatPanel');
        this.button = document.getElementById('chatButton');
        this.closeBtn = document.getElementById('closeChat');
        this.sendBtn = document.getElementById('sendMessage');
        this.input = document.getElementById('messageInput');
        this.chatHistory = document.getElementById('chatHistory');

        this.initializeEventListeners();

        // Show welcome message
        this.addMessage("Hello! I track the International Space Station's location. I can tell you:\n• Where the ISS is right now\n• When it was last over a specific country\n• How many times it passed over a location", false);
    }

    initializeEventListeners() {
        // Toggle panel
        this.button.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.togglePanel();
        }, { passive: false });
        
        this.closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            this.togglePanel();
        }, { passive: false });

        // Send message on button click or enter key
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (this.panel.classList.contains('active') && 
                !this.panel.contains(e.target) && 
                e.target !== this.button) {
                this.panel.classList.remove('active');
            }
        });

        // Prevent panel close when clicking inside
        this.panel.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }

    togglePanel() {
        if (this.toggleTimeout) return;

        this.panel.classList.toggle('active');
        if (this.panel.classList.contains('active')) {
            this.input.focus();
        }
        
        this.toggleTimeout = setTimeout(() => {
            this.toggleTimeout = null;
        }, 200);
    }

    addMessage(message, isUser = true) {
        const messageElement = document.createElement('div');
        messageElement.className = `chat-message ${isUser ? 'user' : 'ai'}`;
        
        const contentElement = document.createElement('div');
        contentElement.className = 'message-content';
        contentElement.textContent = message;
        
        messageElement.appendChild(contentElement);
        this.chatHistory.appendChild(messageElement);
        
        // Scroll to bottom
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
    }

    showTypingIndicator() {
        const typingElement = document.createElement('div');
        typingElement.className = 'chat-message ai typing';
        typingElement.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
        this.chatHistory.appendChild(typingElement);
        this.chatHistory.scrollTop = this.chatHistory.scrollHeight;
        return typingElement;
    }

    // Parse the assistant reply. The endpoint returns {response, status} where `response`
    // is a JSON string of {message, action, data}, possibly wrapped in ```json fences.
    // Database lookups and feedback storage happen server-side (the assistant calls the
    // internal iss_api_query_loc_history / iss_api_store_feedback functions), so the
    // browser only ever talks to the chat endpoint.
    cleanResponse(response) {
        const outerJson = JSON.parse(response);
        
        if (outerJson.status !== 'success' || typeof outerJson.response !== 'string') {
            throw new Error('Response status not success');
        }
        
        const raw = outerJson.response.trim();
        const match = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
        const content = match ? match[1] : raw;
        
        try {
            const data = JSON.parse(content);
            if (data && typeof data === 'object') {
                return data;
            }
        } catch (e) {
            // Not JSON - fall through and treat it as a plain-text reply
        }
        return { message: content };
    }

    async sendMessage() {
        const message = this.input.value.trim();
        if (!message) return;

        // Clear input
        this.input.value = '';

        // Add user message to chat
        this.addMessage(message, true);

        // Show typing indicator
        const typingIndicator = this.showTypingIndicator();

        try {
            const response = await fetch(config.CHAT_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: message })
            });

            // Remove typing indicator
            typingIndicator.remove();

            if (!response.ok) {
                throw new Error(`Chat API returned ${response.status}`);
            }

            const rawResponse = await response.text();
            const data = this.cleanResponse(rawResponse);
            
            // Display the message from the response
            const reply = typeof data.message === 'string' && data.message.trim()
                ? data.message
                : "Sorry, I don't have an answer for that right now.";
            this.addMessage(reply, false);

            // If there's a database response, display it
            if (data.db_response) {
                this.addMessage(data.db_response, false);
            }

        } catch (error) {
            console.warn('Chat request failed:', error.message);
            typingIndicator.remove();
            this.addMessage("I encountered an issue processing your request. Please try again!", false);
        }
    }
}

// Initialize the chat widget when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ChatWidget();
});
