const changelog = {
    versions: [
        {
            version: "1.0.0",
            date: "2025-04-21",
            changes: [
                "Changelog introduced to the website"
            ]
        }
    ]
};

function createChangelogButton() {
    const button = document.createElement('button');
    button.className = 'changelog-button';
    button.innerHTML = '<i class="fas fa-clipboard-list"></i> Changelog';
    button.onclick = () => document.body.appendChild(createChangelogHTML());
    return button;
}

function createChangelogHTML() {
    const overlay = document.createElement('div');
    overlay.className = 'changelog-overlay';
    
    const popup = document.createElement('div');
    popup.className = 'changelog-popup';
    
    const title = document.createElement('h2');
    title.className = 'changelog-title';
    title.textContent = 'What\'s New';
    
    const closeButton = document.createElement('button');
    closeButton.className = 'changelog-close';
    closeButton.innerHTML = '&times;';
    closeButton.onclick = () => {
        overlay.remove();
        localStorage.setItem('lastSeenChangelog', changelog.versions[0].version);
    };
    
    popup.appendChild(closeButton);
    popup.appendChild(title);
    
    changelog.versions.forEach(version => {
        const versionDiv = document.createElement('div');
        versionDiv.className = 'changelog-version';
        
        const versionTitle = document.createElement('h3');
        versionTitle.textContent = `Version ${version.version} (${version.date})`;
        
        const changesList = document.createElement('ul');
        version.changes.forEach(change => {
            const li = document.createElement('li');
            li.textContent = change;
            changesList.appendChild(li);
        });
        
        versionDiv.appendChild(versionTitle);
        versionDiv.appendChild(changesList);
        popup.appendChild(versionDiv);
    });
    
    overlay.appendChild(popup);
    return overlay;
}

function showChangelog() {
    const lastSeenVersion = localStorage.getItem('lastSeenChangelog');
    const latestVersion = changelog.versions[0].version;
    
    // Add the persistent button
    document.body.appendChild(createChangelogButton());
    
    // Show changelog popup if there's a new version
    if (lastSeenVersion !== latestVersion) {
        document.body.appendChild(createChangelogHTML());
    }
}

// Export the showChangelog function
export { showChangelog };
