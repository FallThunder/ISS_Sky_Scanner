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

    cleanResponse(response) {
        console.log('Original response:', response);
        
        // First, parse the outer JSON structure
        const outerJson = JSON.parse(response);
        console.log('Outer JSON:', outerJson);
        
        if (outerJson.status !== 'success') {
            throw new Error('Response status not success');
        }
        
        // Extract the JSON content from between the markdown code blocks
        const match = outerJson.response.match(/```json\s*([\s\S]*?)\s*```/);
        if (!match) {
            console.log('No markdown code block found');
            throw new Error('Invalid response format');
        }

        console.log('Extracted content:', match[1]);
        
        // Parse the inner JSON
        const data = JSON.parse(match[1]);
        console.log('Parsed inner JSON:', data);
        
        return data;
    }

    async queryDatabase(queryData) {
        console.log('Querying database with:', queryData);
        
        // Construct the query URL with parameters
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(queryData)) {
            if (value !== undefined) {
                params.append(key, value);
            }
        }
        
        const queryUrl = `${config.DB_API_URL}?${params.toString()}`;
        console.log('Query URL:', queryUrl);
        
        try {
            const response = await fetch(queryUrl);
            if (!response.ok) {
                throw new Error('Database query failed');
            }
            
            const data = await response.json();
            console.log('Database response:', data);
            
            if (!data || !data.locations || data.locations.length === 0) {
                return { error: 'No matching data found' };
            }
            
            return data;
        } catch (error) {
            console.error('Database query error:', error);
            return { error: 'Failed to query the database' };
        }
    }

    formatDatabaseResponse(data) {
        if (data.error) {
            return data.error;
        }

        const locations = data.locations;
        if (!locations || locations.length === 0) {
            return 'No matching data found';
        }

        // For a single location (most recent)
        if (locations.length === 1) {
            const loc = locations[0];
            const date = new Date(loc.timestamp).toLocaleString();
            return `The ISS was over ${loc.country || loc.region || 'unknown territory'} at ${date} (${loc.latitude.toFixed(2)}°, ${loc.longitude.toFixed(2)}°)`;
        }

        // For multiple locations
        return `Found ${locations.length} locations. The most recent was over ${locations[0].country || locations[0].region || 'unknown territory'} at ${new Date(locations[0].timestamp).toLocaleString()}`;
    }

    async sendFeedback(rating, comment) {
        try {
            const response = await fetch(config.CHAT_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: `${rating} stars: ${comment}`,
                    userAgent: navigator.userAgent
                })
            });

            if (!response.ok) {
                throw new Error('Failed to submit feedback');
            }

            const data = await response.json();
            if (data.status !== 'success') {
                throw new Error('Feedback submission failed');
            }

            return true;
        } catch (error) {
            console.error('Error submitting feedback:', error);
            return false;
        }
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
                console.error('Response not OK:', await response.text());
                throw new Error('Failed to get response');
            }

            const rawResponse = await response.text();
            const data = this.cleanResponse(rawResponse);
            
            // Display the message from the response
            this.addMessage(data.message, false);

            // If there's a database response, display it
            if (data.db_response) {
                this.addMessage(data.db_response, false);
            }

        } catch (error) {
            console.error('Error processing message:', error);
            typingIndicator.remove();
            this.addMessage("I encountered an issue processing your request. Please try again!", false);
        }
    }
}

// Initialize the chat widget when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new ChatWidget();
});
