import config from './config.js';

class ChatWidget {
    constructor() {
        this.panel = document.getElementById('chatPanel');
        this.button = document.getElementById('chatButton');
        this.closeBtn = document.getElementById('closeChat');
        this.sendBtn = document.getElementById('sendMessage');
        this.input = document.getElementById('messageInput');
        this.chatHistory = document.getElementById('chatHistory');
        this.messageDiv = document.getElementById('chatMessage');

        this.initializeEventListeners();
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
            const response = await fetch(`${config.CHAT_API_URL}?api_key=${config.CHAT_API_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ query: message })
            });

            // Remove typing indicator
            typingIndicator.remove();

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to get response');
            }

            const data = await response.json();
            
            // Format and display the response
            let aiResponse = '';
            
            if (data.results && data.results.length > 0) {
                // Format the results into a natural language response
                const locations = data.results.map(result => {
                    const location = result.location_details || {};
                    const time = new Date(result.timestamp).toLocaleString();
                    return `${location.country || 'Unknown'} at ${time}`;
                });
                
                aiResponse = `Based on your query, here's what I found:\n${locations.join('\n')}`;
            } else {
                aiResponse = "I couldn't find any data matching your query. Try asking about specific countries or time periods.";
            }

            this.addMessage(aiResponse, false);

        } catch (error) {
            console.error('Error sending message:', error);
            typingIndicator.remove();
            this.addMessage("I'm sorry, I encountered an error processing your request. Please try again.", false);
        }
    }
}

// Initialize the chat widget when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ChatWidget();
});
