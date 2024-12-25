import config from './config.js';

class FeedbackWidget {
    constructor() {
        this.panel = document.getElementById('feedbackPanel');
        this.button = document.getElementById('feedbackButton');
        this.closeBtn = document.getElementById('closeFeedback');
        this.submitBtn = document.getElementById('submitFeedback');
        this.textarea = document.getElementById('feedbackText');
        this.wordCount = document.getElementById('wordCount');
        this.stars = document.querySelectorAll('.star-rating i');
        this.messageDiv = document.getElementById('feedbackMessage');
        this.rating = 0;

        this.initializeEventListeners();
        this.updateSubmitButton(); // Initial state
    }

    initializeEventListeners() {
        // Toggle panel with improved click handling
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

        // Star rating
        this.stars.forEach(star => {
            star.addEventListener('click', () => {
                this.handleStarClick(star);
                this.updateSubmitButton();
            });
            star.addEventListener('mouseover', () => this.handleStarHover(star));
            star.addEventListener('mouseout', () => this.handleStarOut());
        });

        // Word count and validation
        this.textarea.addEventListener('input', () => {
            this.updateWordCount();
            this.updateSubmitButton();
        });

        // Submit feedback
        this.submitBtn.addEventListener('click', () => this.submitFeedback());

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
        // Debounce the toggle to prevent rapid clicking
        if (this.toggleTimeout) {
            return;
        }

        this.panel.classList.toggle('active');
        
        // Set a short timeout to prevent rapid toggling
        this.toggleTimeout = setTimeout(() => {
            this.toggleTimeout = null;
        }, 200);
    }

    handleStarClick(clickedStar) {
        const rating = parseInt(clickedStar.dataset.rating);
        this.rating = rating;
        this.updateStars(rating, true);
    }

    handleStarHover(hoveredStar) {
        const rating = parseInt(hoveredStar.dataset.rating);
        this.updateStars(rating, false);
    }

    handleStarOut() {
        this.updateStars(this.rating, true);
    }

    updateStars(rating, permanent = false) {
        this.stars.forEach(star => {
            const starRating = parseInt(star.dataset.rating);
            if (starRating <= rating) {
                star.classList.remove('far');
                star.classList.add('fas');
            } else {
                star.classList.remove('fas');
                star.classList.add('far');
            }
        });
    }

    updateWordCount() {
        const words = this.textarea.value.trim().split(/\s+/);
        const wordCount = words[0] === '' ? 0 : words.length;
        const remaining = 100 - wordCount;
        
        // Update word count display
        if (remaining >= 0) {
            this.wordCount.textContent = `Words remaining: ${remaining}`;
            this.wordCount.parentElement.classList.remove('over-limit');
        } else {
            this.wordCount.textContent = `Over word limit by: ${Math.abs(remaining)}`;
            this.wordCount.parentElement.classList.add('over-limit');
        }

        // Disable submit if over limit
        this.submitBtn.disabled = remaining < 0;
    }

    showMessage(message, isError = false) {
        this.messageDiv.textContent = message;
        this.messageDiv.className = 'feedback-message ' + (isError ? 'error' : 'success');
        setTimeout(() => {
            this.messageDiv.textContent = '';
            if (!isError) {
                this.panel.classList.remove('active');
                this.resetForm();
            }
        }, 3000);
    }

    resetForm() {
        this.textarea.value = '';
        this.rating = 0;
        this.updateStars(0);
        this.updateWordCount();
        this.updateSubmitButton();
    }

    updateSubmitButton() {
        const hasRating = this.rating > 0;
        const hasFeedback = this.textarea.value.trim().length > 0;
        const wordCount = this.textarea.value.trim().split(/\s+/);
        const isUnderLimit = wordCount[0] === '' ? true : wordCount.length <= 100;
        
        this.submitBtn.disabled = !hasRating || !hasFeedback || !isUnderLimit;
    }

    async submitFeedback() {
        if (!this.rating) {
            this.showMessage('Please select a rating', true);
            return;
        }

        const words = this.textarea.value.trim().split(/\s+/);
        if (words.length > 100 || (words.length === 1 && words[0] === '')) {
            this.showMessage('Please provide feedback within the word limit', true);
            return;
        }

        const feedback = {
            rating: this.rating,
            feedback: this.textarea.value.trim(),
            timestamp: new Date().toISOString(),
            userAgent: navigator.userAgent
        };

        try {
            const response = await fetch(`${config.FEEDBACK_API_URL}?api_key=${config.FEEDBACK_API_KEY}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(feedback)
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to submit feedback');
            }

            this.showMessage('Thank you for your feedback!');
        } catch (error) {
            console.error('Error submitting feedback:', error);
            this.showMessage(error.message || 'Failed to submit feedback. Please try again later.', true);
        }
    }
}

// Initialize the feedback widget when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new FeedbackWidget();
});
