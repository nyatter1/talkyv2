// Global Application & Server State
        let currentUser = null;
        let serversList = [];
        let activeServerId = null;
        let activeChannelId = null;
        let activeServerReply = null;
        let pendingServerImages = [];
        let currentServerMessages = [];

        // In-memory Canvas Image Compression Utility
        function compressImage(source, maxWidth, maxHeight, quality = 0.82) {
            return new Promise((resolve) => {
                if (!source) return resolve('');

                const processImg = (img) => {
                    let width = img.naturalWidth || img.width;
                    let height = img.naturalHeight || img.height;
                    if (!width || !height) return resolve(typeof source === 'string' ? source : '');

                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width = Math.max(1, Math.round(width * ratio));
                        height = Math.max(1, Math.round(height * ratio));
                    }
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);
                        const compressed = canvas.toDataURL('image/jpeg', quality);
                        resolve(compressed);
                    } catch (err) {
                        console.warn('Canvas compression fallback:', err);
                        resolve(typeof source === 'string' ? source : '');
                    }
                };

                if (typeof source === 'string') {
                    if (!source.startsWith('data:image')) {
                        return resolve(source);
                    }
                    const img = new Image();
                    img.onload = () => processImg(img);
                    img.onerror = () => resolve(source);
                    img.src = source;
                } else if (source instanceof File || source instanceof Blob) {
                    const url = URL.createObjectURL(source);
                    const img = new Image();
                    img.onload = () => {
                        URL.revokeObjectURL(url);
                        processImg(img);
                    };
                    img.onerror = () => {
                        URL.revokeObjectURL(url);
                        resolve('');
                    };
                    img.src = url;
                } else {
                    resolve('');
                }
            });
        }

        // Safe Storage Helper with automatic quota pruning
        function safeStorageSet(key, value) {
            try {
                localStorage.setItem(key, value);
                return true;
            } catch (err) {
                console.warn('localStorage quota warning on key "' + key + '", initiating auto-prune:', err);
                try {
                    // 1. Prune temporary attachment and message caches
                    const keysToRemove = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && (k.startsWith('talky_server_messages_') || k.startsWith('talky_dm_attachments_') || k.startsWith('talky_temp_'))) {
                            keysToRemove.push(k);
                        }
                    }
                    keysToRemove.forEach(k => localStorage.removeItem(k));

                    // 2. In talky_users list, keep essential profile fields and trim large duplicate banners
                    const usersRaw = localStorage.getItem('talky_users');
                    if (usersRaw) {
                        try {
                            const uList = JSON.parse(usersRaw);
                            if (Array.isArray(uList)) {
                                const trimmedUsers = uList.slice(-20).map(u => ({
                                    id: u.id,
                                    username: u.username,
                                    email: u.email,
                                    displayName: u.displayName,
                                    handle: u.handle,
                                    pronouns: u.pronouns,
                                    bio: u.bio,
                                    links: u.links,
                                    avatar: (u.avatar && u.avatar.length < 50000) ? u.avatar : '',
                                    banner: (u.banner && u.banner.length < 80000) ? u.banner : '',
                                    accentColor: u.accentColor,
                                    secondaryColor: u.secondaryColor,
                                    borderStartColor: u.borderStartColor,
                                    borderEndColor: u.borderEndColor
                                }));
                                localStorage.setItem('talky_users', JSON.stringify(trimmedUsers));
                            }
                        } catch (pe) {}
                    }

                    // 3. Retry saving
                    localStorage.setItem(key, value);
                    return true;
                } catch (retryErr) {
                    console.error('Safe storage recovery failed for key:', key, retryErr);
                    // If key is talky_current_user and still failing, strip heavy banner as last resort
                    if (key === 'talky_current_user') {
                        try {
                            const obj = JSON.parse(value);
                            if (obj.banner && obj.banner.length > 50000) {
                                obj.banner = '';
                                localStorage.setItem(key, JSON.stringify(obj));
                                return true;
                            }
                        } catch (e) {}
                    }
                    return false;
                }
            }
        }

        function loadUserData() {
            const stored = localStorage.getItem('talky_current_user');
            if (stored) {
                try {
                    currentUser = JSON.parse(stored);
                } catch(e) {
                    currentUser = null;
                }
            }

            if (!currentUser) {
                const usersList = JSON.parse(localStorage.getItem('talky_users') || '[]');
                if (usersList.length > 0) {
                    currentUser = usersList[usersList.length - 1];
                    safeStorageSet('talky_current_user', JSON.stringify(currentUser));
                } else {
                    currentUser = {
                        id: 'user_default',
                        email: 'user@talky.app',
                        username: 'User',
                        displayName: 'User',
                        handle: 'user',
                        handleLastChanged: null,
                        pronouns: '',
                        bio: '',
                        links: [],
                        avatar: '',
                        banner: '',
                        accentColor: '#ffffff',
                        secondaryColor: '#2b2d31',
                        borderStartColor: '#ffffff',
                        borderEndColor: '#80848e'
                    };
                    saveUserData();
                }
            }

            if (currentUser && !Array.isArray(currentUser.links)) {
                currentUser.links = [];
            }

            // Downscale any legacy oversized avatar or banner in the background
            if (currentUser) {
                if (currentUser.avatar && currentUser.avatar.startsWith('data:image') && currentUser.avatar.length > 60000) {
                    compressImage(currentUser.avatar, 180, 180, 0.82).then(compressed => {
                        if (compressed && compressed.length < currentUser.avatar.length) {
                            currentUser.avatar = compressed;
                            safeStorageSet('talky_current_user', JSON.stringify(currentUser));
                        }
                    });
                }
                if (currentUser.banner && currentUser.banner.startsWith('data:image') && currentUser.banner.length > 120000) {
                    compressImage(currentUser.banner, 640, 220, 0.80).then(compressed => {
                        if (compressed && compressed.length < currentUser.banner.length) {
                            currentUser.banner = compressed;
                            safeStorageSet('talky_current_user', JSON.stringify(currentUser));
                        }
                    });
                }
            }

            applyUserDataToUI();
        }

        function saveUserData() {
            if (!currentUser) return;
            safeStorageSet('talky_current_user', JSON.stringify(currentUser));

            try {
                let users = JSON.parse(localStorage.getItem('talky_users') || '[]');
                const idx = users.findIndex(u => u.id === currentUser.id || (u.email && u.email === currentUser.email));
                if (idx >= 0) {
                    users[idx] = currentUser;
                } else {
                    users.push(currentUser);
                }
                safeStorageSet('talky_users', JSON.stringify(users));
            } catch (e) {
                console.warn('Error saving talky_users list:', e);
            }
        }

        // Settings Modal Controls
        const openSettingsBtn = document.getElementById('openSettingsBtn');
        const closeSettingsBtn = document.getElementById('closeSettingsBtn');
        const settingsOverlay = document.getElementById('settingsOverlay');
        const logoutBtn = document.getElementById('logoutBtn');
        const userAvatarTrigger = document.getElementById('userAvatarTrigger');
        const serverUserAvatarTrigger = document.getElementById('serverUserAvatarTrigger');

        // User Settings Tabs Handling
        const userSettingsTabProfiles = document.getElementById('userSettingsTabProfiles');
        const userSettingsTabPreferences = document.getElementById('userSettingsTabPreferences');
        const settingsPanelProfiles = document.getElementById('settingsPanelProfiles');
        const settingsPanelPreferences = document.getElementById('settingsPanelPreferences');

        function switchUserSettingsTab(tab) {
            if (tab === 'profiles') {
                if (userSettingsTabProfiles) userSettingsTabProfiles.classList.add('active');
                if (userSettingsTabPreferences) userSettingsTabPreferences.classList.remove('active');
                if (settingsPanelProfiles) settingsPanelProfiles.style.display = 'flex';
                if (settingsPanelPreferences) settingsPanelPreferences.style.display = 'none';
            } else if (tab === 'preferences') {
                if (userSettingsTabPreferences) userSettingsTabPreferences.classList.add('active');
                if (userSettingsTabProfiles) userSettingsTabProfiles.classList.remove('active');
                if (settingsPanelProfiles) settingsPanelProfiles.style.display = 'none';
                if (settingsPanelPreferences) settingsPanelPreferences.style.display = 'flex';
            }
        }

        if (userSettingsTabProfiles) {
            userSettingsTabProfiles.addEventListener('click', () => switchUserSettingsTab('profiles'));
        }
        if (userSettingsTabPreferences) {
            userSettingsTabPreferences.addEventListener('click', () => switchUserSettingsTab('preferences'));
        }

        /* ------------------------------------------------------------
           25 COLOUR THEMES & SITE TINT CONTROLLER
           ------------------------------------------------------------ */
        const APP_THEMES = [
            { id: 'none', name: 'None', gradient: 'none', swatch: 'none' },
            { id: 'mint-teal', name: 'Mint Teal', gradient: 'linear-gradient(135deg, rgba(67,233,123,0.3) 0%, rgba(56,249,215,0.2) 100%)', swatch: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
            { id: 'golden-sunset', name: 'Golden Sunset', gradient: 'linear-gradient(135deg, rgba(255,236,210,0.25) 0%, rgba(252,182,159,0.25) 100%)', swatch: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)' },
            { id: 'lavender-breeze', name: 'Lavender Breeze', gradient: 'linear-gradient(135deg, rgba(161,196,253,0.3) 0%, rgba(194,233,251,0.25) 100%)', swatch: 'linear-gradient(135deg, #a1c4fd 0%, #c2e9fb 100%)' },
            { id: 'soft-peach', name: 'Soft Peach', gradient: 'linear-gradient(135deg, rgba(255,154,158,0.3) 0%, rgba(254,207,239,0.25) 100%)', swatch: 'linear-gradient(135deg, #ff9a9e 0%, #fecfef 100%)' },
            { id: 'warm-tangerine', name: 'Warm Tangerine', gradient: 'linear-gradient(135deg, rgba(255,179,71,0.3) 0%, rgba(255,204,51,0.25) 100%)', swatch: 'linear-gradient(135deg, #ffb347 0%, #ffcc33 100%)' },
            { id: 'orchid-glow', name: 'Orchid Glow', gradient: 'linear-gradient(135deg, rgba(224,195,252,0.3) 0%, rgba(142,197,252,0.25) 100%)', swatch: 'linear-gradient(135deg, #e0c3fc 0%, #8ec5fc 100%)' },
            { id: 'emerald-mint', name: 'Emerald Mint', gradient: 'linear-gradient(135deg, rgba(132,250,176,0.3) 0%, rgba(143,211,244,0.25) 100%)', swatch: 'linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%)' },
            { id: 'olive-garden', name: 'Olive Garden', gradient: 'linear-gradient(135deg, rgba(212,252,121,0.3) 0%, rgba(150,230,161,0.25) 100%)', swatch: 'linear-gradient(135deg, #d4fc79 0%, #96e6a1 100%)' },
            { id: 'rose-neon', name: 'Rose Neon', gradient: 'linear-gradient(135deg, rgba(255,117,140,0.3) 0%, rgba(255,126,179,0.25) 100%)', swatch: 'linear-gradient(135deg, #ff758c 0%, #ff7eb3 100%)' },
            { id: 'electric-sky', name: 'Electric Sky', gradient: 'linear-gradient(135deg, rgba(137,247,254,0.3) 0%, rgba(102,166,255,0.25) 100%)', swatch: 'linear-gradient(135deg, #89f7fe 0%, #66a6ff 100%)' },
            { id: 'forest-lagoon', name: 'Forest Lagoon', gradient: 'linear-gradient(135deg, rgba(19,84,122,0.4) 0%, rgba(128,208,199,0.3) 100%)', swatch: 'linear-gradient(135deg, #13547a 0%, #80d0c7 100%)' },
            { id: 'crimson-ruby', name: 'Crimson Ruby', gradient: 'linear-gradient(135deg, rgba(147,44,139,0.35) 0%, rgba(178,31,31,0.3) 100%)', swatch: 'linear-gradient(135deg, #932c8b 0%, #b21f1f 50%, #fdbb2d 100%)' },
            { id: 'royal-violet', name: 'Royal Violet', gradient: 'linear-gradient(135deg, rgba(101,78,163,0.35) 0%, rgba(234,175,200,0.25) 100%)', swatch: 'linear-gradient(135deg, #654ea3 0%, #eaafc8 100%)' },
            { id: 'terracotta-rust', name: 'Terracotta Rust', gradient: 'linear-gradient(135deg, rgba(186,83,112,0.35) 0%, rgba(244,226,216,0.25) 100%)', swatch: 'linear-gradient(135deg, #ba5370 0%, #f4e2d8 100%)' },
            { id: 'deep-amethyst', name: 'Deep Amethyst', gradient: 'linear-gradient(135deg, rgba(155,81,224,0.35) 0%, rgba(112,161,255,0.25) 100%)', swatch: 'linear-gradient(135deg, #9b51e0 0%, #70a1ff 100%)' },
            { id: 'oceanic-sapphire', name: 'Oceanic Sapphire', gradient: 'linear-gradient(135deg, rgba(0,198,255,0.3) 0%, rgba(0,114,255,0.25) 100%)', swatch: 'linear-gradient(135deg, #00c6ff 0%, #0072ff 100%)' },
            { id: 'sunset-tango', name: 'Sunset Tango', gradient: 'linear-gradient(135deg, rgba(255,81,47,0.35) 0%, rgba(240,152,25,0.25) 100%)', swatch: 'linear-gradient(135deg, #ff512f 0%, #f09819 100%)' },
            { id: 'vaporwave-dream', name: 'Vaporwave Dream', gradient: 'linear-gradient(135deg, rgba(229,93,135,0.35) 0%, rgba(95,195,228,0.25) 100%)', swatch: 'linear-gradient(135deg, #e55d87 0%, #5fc3e4 100%)' },
            { id: 'cyber-neon', name: 'Cyber Neon', gradient: 'linear-gradient(135deg, rgba(0,242,254,0.3) 0%, rgba(79,172,254,0.25) 100%)', swatch: 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)' },
            { id: 'midnight-wine', name: 'Midnight Wine', gradient: 'linear-gradient(135deg, rgba(32,1,34,0.5) 0%, rgba(111,0,0,0.35) 100%)', swatch: 'linear-gradient(135deg, #200122 0%, #6f0000 100%)' },
            { id: 'solar-flare', name: 'Solar Flare', gradient: 'linear-gradient(135deg, rgba(241,39,17,0.35) 0%, rgba(245,175,25,0.25) 100%)', swatch: 'linear-gradient(135deg, #f12711 0%, #f5af19 100%)' },
            { id: 'northern-aurora', name: 'Northern Aurora', gradient: 'linear-gradient(135deg, rgba(0,201,255,0.3) 0%, rgba(146,254,157,0.25) 100%)', swatch: 'linear-gradient(135deg, #00c9ff 0%, #92fe9d 100%)' },
            { id: 'cherry-blossom', name: 'Cherry Blossom', gradient: 'linear-gradient(135deg, rgba(255,179,217,0.35) 0%, rgba(255,102,178,0.25) 100%)', swatch: 'linear-gradient(135deg, #ffb3d9 0%, #ff66b2 100%)' },
            { id: 'cosmic-galaxy', name: 'Cosmic Galaxy', gradient: 'linear-gradient(135deg, rgba(58,28,113,0.4) 0%, rgba(215,109,119,0.3) 50%, rgba(255,175,123,0.25) 100%)', swatch: 'linear-gradient(135deg, #3a1c71 0%, #d76d77 50%, #ffaf7b 100%)' }
        ];

        let activeAppThemeId = localStorage.getItem('talky_app_theme') || 'none';

        function renderThemeCardsGrid() {
            const grid = document.getElementById('themeCardsGrid');
            if (!grid) return;
            grid.innerHTML = '';

            APP_THEMES.forEach(theme => {
                const card = document.createElement('div');
                card.className = `theme-card ${theme.id === activeAppThemeId ? 'active' : ''}`;
                card.dataset.themeId = theme.id;
                card.title = theme.name;

                if (theme.id === 'none') {
                    card.style.background = '#1e1f22';
                    card.innerHTML = `
                        <span class="theme-card-none-text">None</span>
                        <div class="theme-card-check">
                            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                        </div>
                    `;
                } else {
                    card.style.background = theme.swatch;
                    card.innerHTML = `
                        <div class="theme-card-check">
                            <svg viewBox="0 0 24 24"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                        </div>
                    `;
                }

                card.addEventListener('click', () => {
                    selectAppTheme(theme.id);
                });

                grid.appendChild(card);
            });
        }

        function selectAppTheme(themeId) {
            activeAppThemeId = themeId;
            safeStorageSet('talky_app_theme', themeId);
            renderThemeCardsGrid();
            applyAppTheme(themeId);
        }

        function applyAppTheme(themeId) {
            const bgOverlay = document.getElementById('appThemeBackgroundOverlay');
            if (!bgOverlay) return;

            // Check if currently inside a server that has a custom background
            const activeServer = (typeof serversList !== 'undefined' && Array.isArray(serversList)) ? serversList.find(s => s.id === activeServerId) : null;
            if (activeServer && activeServer.backgroundImage) {
                // Server custom background takes precedence for the app background
                bgOverlay.style.background = `linear-gradient(rgba(11, 12, 16, 0.65), rgba(11, 12, 16, 0.85)), url('${activeServer.backgroundImage}') center/cover no-repeat`;
                bgOverlay.style.display = 'block';
                bgOverlay.style.opacity = '1';
                document.body.setAttribute('data-app-tint', 'true');
                return;
            }

            if (themeId === 'none' || !themeId) {
                bgOverlay.style.display = 'none';
                bgOverlay.style.opacity = '0';
                bgOverlay.style.background = 'none';
                document.body.removeAttribute('data-app-tint');
            } else {
                const theme = APP_THEMES.find(t => t.id === themeId);
                if (theme) {
                    bgOverlay.style.background = `${theme.gradient || theme.swatch}`;
                    bgOverlay.style.display = 'block';
                    bgOverlay.style.opacity = '1';
                    document.body.setAttribute('data-app-tint', 'true');
                }
            }
        }

        function openSettings() {
            if (settingsOverlay) settingsOverlay.classList.add('open');
        }

        function closeSettings() {
            if (settingsOverlay) settingsOverlay.classList.remove('open');
        }

        if (openSettingsBtn) openSettingsBtn.addEventListener('click', openSettings);
        if (closeSettingsBtn) closeSettingsBtn.addEventListener('click', closeSettings);
        if (userAvatarTrigger) userAvatarTrigger.addEventListener('click', openSettings);
        if (serverUserAvatarTrigger) serverUserAvatarTrigger.addEventListener('click', openSettings);

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('talky_current_user');
            });
        }

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && settingsOverlay.classList.contains('open')) {
                settingsOverlay.classList.remove('open');
            }
        });

        // DOM elements
        const displayNameInput = document.getElementById('displayNameInput');
        const handleInput = document.getElementById('handleInput');
        const saveHandleBtn = document.getElementById('saveHandleBtn');
        const handleNotice = document.getElementById('handleNotice');
        const pronounsInput = document.getElementById('pronounsInput');
        const bioInput = document.getElementById('bioInput');

        const accentBox = document.getElementById('accentBox');
        const secondaryBox = document.getElementById('secondaryBox');
        const accentColorInput = document.getElementById('accentColorInput');
        const secondaryColorInput = document.getElementById('secondaryColorInput');
        const accentSwatchWrapper = document.getElementById('accentSwatchWrapper');
        const secondarySwatchWrapper = document.getElementById('secondarySwatchWrapper');
        const accentHex = document.getElementById('accentHex');
        const secondaryHex = document.getElementById('secondaryHex');

        const borderStartBox = document.getElementById('borderStartBox');
        const borderEndBox = document.getElementById('borderEndBox');
        const borderStartColorInput = document.getElementById('borderStartColorInput');
        const borderEndColorInput = document.getElementById('borderEndColorInput');
        const borderStartSwatchWrapper = document.getElementById('borderStartSwatchWrapper');
        const borderEndSwatchWrapper = document.getElementById('borderEndSwatchWrapper');
        const borderStartHex = document.getElementById('borderStartHex');
        const borderEndHex = document.getElementById('borderEndHex');

        const previewCard = document.getElementById('previewCard');
        const previewName = document.getElementById('previewName');
        const previewHandle = document.getElementById('previewHandle');
        const previewPronouns = document.getElementById('previewPronouns');
        const previewDivider = document.getElementById('previewDivider');
        const previewAboutSection = document.getElementById('previewAboutSection');
        const previewBio = document.getElementById('previewBio');

        const barName = document.getElementById('barName');
        const barHandle = document.getElementById('barHandle');
        const previewAvatar = document.getElementById('previewAvatar');
        const barAvatar = document.getElementById('barAvatar');
        const previewBanner = document.getElementById('previewBanner');

        const avatarInput = document.getElementById('avatarInput');
        const removeAvatarBtn = document.getElementById('removeAvatarBtn');
        const bannerInput = document.getElementById('bannerInput');
        const removeBannerBtn = document.getElementById('removeBannerBtn');

        function updateProfileThemeGradient(accent, secondary) {
            if (previewCard) previewCard.style.background = `linear-gradient(135deg, ${accent} 0%, ${secondary} 100%)`;
            if (accentSwatchWrapper) accentSwatchWrapper.style.backgroundColor = accent;
            if (secondarySwatchWrapper) secondarySwatchWrapper.style.backgroundColor = secondary;
            if (accentHex) accentHex.textContent = accent;
            if (secondaryHex) secondaryHex.textContent = secondary;
        }

        function updateProfileBorderGradient(borderStart, borderEnd) {
            const previewCardBorderWrap = document.getElementById('previewCardBorderWrap');
            if (previewCardBorderWrap) {
                previewCardBorderWrap.style.background = `linear-gradient(135deg, ${borderStart} 0%, ${borderEnd} 100%)`;
                previewCardBorderWrap.style.boxShadow = `0 10px 32px rgba(0, 0, 0, 0.65), 0 0 18px ${borderStart}45`;
            }
            if (borderStartSwatchWrapper) borderStartSwatchWrapper.style.backgroundColor = borderStart;
            if (borderEndSwatchWrapper) borderEndSwatchWrapper.style.backgroundColor = borderEnd;
            if (borderStartHex) borderStartHex.textContent = borderStart;
            if (borderEndHex) borderEndHex.textContent = borderEnd;
        }

        // Profile Unsaved Changes State & Logic
        let profileSavedState = {
            displayName: 'User',
            pronouns: '',
            bio: '',
            links: [],
            accentColor: '#ffffff',
            secondaryColor: '#2b2d31',
            borderStartColor: '#ffffff',
            borderEndColor: '#80848e',
            avatar: '',
            banner: ''
        };

        let profileDraftState = { ...profileSavedState };

        function getDomainFromUrl(url) {
            if (!url) return '';
            try {
                let u = url.trim();
                if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
                const parsed = new URL(u);
                return parsed.hostname.replace(/^www\./, '');
            } catch(e) {
                return url.replace(/^https?:\/\//i, '').split('/')[0];
            }
        }

        function areLinksEqual(linksA, linksB) {
            const cleanA = (linksA || []).filter(l => l && ((l.url && l.url.trim()) || (l.title && l.title.trim())));
            const cleanB = (linksB || []).filter(l => l && ((l.url && l.url.trim()) || (l.title && l.title.trim())));
            if (cleanA.length !== cleanB.length) return false;
            for (let i = 0; i < cleanA.length; i++) {
                if ((cleanA[i].title || '').trim() !== (cleanB[i].title || '').trim() ||
                    (cleanA[i].url || '').trim() !== (cleanB[i].url || '').trim()) {
                    return false;
                }
            }
            return true;
        }

        function renderProfileLinksInputs() {
            const container = document.getElementById('profileLinksContainer');
            const addBtn = document.getElementById('addNewLinkBtn');
            const countBadge = document.getElementById('linksCountBadge');
            if (!container) return;

            if (!Array.isArray(profileDraftState.links)) {
                profileDraftState.links = [];
            }

            container.innerHTML = '';
            profileDraftState.links.forEach((link, idx) => {
                const row = document.createElement('div');
                row.className = 'profile-link-row';
                row.dataset.index = idx;

                const inputsDiv = document.createElement('div');
                inputsDiv.className = 'profile-link-inputs';

                const titleInput = document.createElement('input');
                titleInput.type = 'text';
                titleInput.className = 'profile-input profile-link-title';
                titleInput.placeholder = 'Title (e.g. YouTube)';
                titleInput.value = link.title || '';
                titleInput.title = 'Link Title (optional)';

                const urlInput = document.createElement('input');
                urlInput.type = 'text';
                urlInput.className = 'profile-input profile-link-url';
                urlInput.placeholder = 'https://example.com';
                urlInput.value = link.url || '';
                urlInput.title = 'Link URL';

                titleInput.addEventListener('input', (e) => {
                    profileDraftState.links[idx].title = e.target.value;
                    renderProfileLinksPreview();
                    checkProfileUnsavedChanges();
                });

                urlInput.addEventListener('input', (e) => {
                    profileDraftState.links[idx].url = e.target.value;
                    renderProfileLinksPreview();
                    checkProfileUnsavedChanges();
                });

                inputsDiv.appendChild(titleInput);
                inputsDiv.appendChild(urlInput);

                const removeBtn = document.createElement('button');
                removeBtn.type = 'button';
                removeBtn.className = 'btn-remove-link';
                removeBtn.title = 'Remove link slot';
                removeBtn.setAttribute('aria-label', 'Remove link slot');
                removeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;

                removeBtn.addEventListener('click', () => {
                    profileDraftState.links.splice(idx, 1);
                    renderProfileLinksInputs();
                    renderProfileLinksPreview();
                    checkProfileUnsavedChanges();
                });

                row.appendChild(inputsDiv);
                row.appendChild(removeBtn);
                container.appendChild(row);
            });

            const count = profileDraftState.links.length;
            if (countBadge) {
                countBadge.textContent = `${count} / 4 links`;
            }

            if (addBtn) {
                if (count >= 4) {
                    addBtn.disabled = true;
                    addBtn.classList.add('disabled');
                    addBtn.innerHTML = `Max 4 Links Reached`;
                } else {
                    addBtn.disabled = false;
                    addBtn.classList.remove('disabled');
                    addBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" style="margin-right: 6px;"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>Add New Link`;
                }
            }
        }

        function renderProfileLinksPreview() {
            const section = document.getElementById('previewLinksSection');
            const grid = document.getElementById('previewLinksGrid');
            if (!section || !grid) return;

            const validLinks = (profileDraftState.links || []).filter(l => l && l.url && l.url.trim());
            if (validLinks.length > 0) {
                section.style.display = 'block';
                grid.innerHTML = validLinks.slice(0, 4).map(l => {
                    const dom = getDomainFromUrl(l.url);
                    const title = (l.title && l.title.trim()) || dom || 'Link';
                    return `
                        <div class="preview-link-pill" title="${escapeHtml(l.url)}">
                            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                            <span>${escapeHtml(title)}</span>
                        </div>
                    `;
                }).join('');
            } else {
                section.style.display = 'none';
                grid.innerHTML = '';
            }
        }

        function initProfileDraftState() {
            if (!currentUser) return;
            const userLinks = (currentUser.links && Array.isArray(currentUser.links))
                ? JSON.parse(JSON.stringify(currentUser.links))
                : [];
            profileSavedState = {
                displayName: currentUser.displayName || currentUser.username || 'User',
                pronouns: currentUser.pronouns || '',
                bio: currentUser.bio || '',
                links: userLinks,
                accentColor: currentUser.accentColor || '#ffffff',
                secondaryColor: currentUser.secondaryColor || '#2b2d31',
                borderStartColor: currentUser.borderStartColor || '#ffffff',
                borderEndColor: currentUser.borderEndColor || '#80848e',
                avatar: currentUser.avatar || '',
                banner: currentUser.banner || ''
            };
            profileDraftState = JSON.parse(JSON.stringify(profileSavedState));

            // Up to 4 links can be added; 2 are already there to fill out by default
            if (!Array.isArray(profileDraftState.links)) {
                profileDraftState.links = [];
            }
            while (profileDraftState.links.length < 2) {
                profileDraftState.links.push({ title: '', url: '' });
            }

            renderProfileLinksInputs();
            renderProfileLinksPreview();
            checkProfileUnsavedChanges();
        }

        function checkProfileUnsavedChanges() {
            const hasChanges =
                profileDraftState.displayName !== profileSavedState.displayName ||
                profileDraftState.pronouns !== profileSavedState.pronouns ||
                profileDraftState.bio !== profileSavedState.bio ||
                profileDraftState.accentColor !== profileSavedState.accentColor ||
                profileDraftState.secondaryColor !== profileSavedState.secondaryColor ||
                profileDraftState.borderStartColor !== profileSavedState.borderStartColor ||
                profileDraftState.borderEndColor !== profileSavedState.borderEndColor ||
                profileDraftState.avatar !== profileSavedState.avatar ||
                profileDraftState.banner !== profileSavedState.banner ||
                !areLinksEqual(profileDraftState.links, profileSavedState.links);

            const noticeBar = document.getElementById('profileSaveNoticeBar');
            if (noticeBar) {
                if (hasChanges) {
                    noticeBar.classList.add('show');
                } else {
                    noticeBar.classList.remove('show');
                }
            }
        }

        function renderProfilePreviewFromDraft() {
            const name = profileDraftState.displayName || 'User';
            const handle = currentUser ? (currentUser.handle || 'user') : 'user';
            const accent = profileDraftState.accentColor || '#ffffff';
            const secondary = profileDraftState.secondaryColor || '#2b2d31';
            const borderStart = profileDraftState.borderStartColor || '#ffffff';
            const borderEnd = profileDraftState.borderEndColor || '#80848e';

            displayNameInput.value = profileDraftState.displayName;
            pronounsInput.value = profileDraftState.pronouns;
            bioInput.value = profileDraftState.bio;
            accentColorInput.value = accent;
            secondaryColorInput.value = secondary;
            if (borderStartColorInput) borderStartColorInput.value = borderStart;
            if (borderEndColorInput) borderEndColorInput.value = borderEnd;

            previewName.textContent = name;
            previewHandle.textContent = '@' + handle;
            updateProfileThemeGradient(accent, secondary);
            updateProfileBorderGradient(borderStart, borderEnd);

            if (profileDraftState.pronouns) {
                previewPronouns.textContent = profileDraftState.pronouns;
                previewPronouns.style.display = 'block';
                previewDivider.style.display = 'block';
            } else {
                previewPronouns.style.display = 'none';
            }

            if (profileDraftState.bio) {
                previewBio.textContent = profileDraftState.bio;
                previewAboutSection.style.display = 'block';
                previewDivider.style.display = 'block';
            } else {
                previewAboutSection.style.display = 'none';
                if (!profileDraftState.pronouns) previewDivider.style.display = 'none';
            }

            renderProfileLinksPreview();

            if (profileDraftState.avatar) {
                const imgUrl = `url('${profileDraftState.avatar}')`;
                previewAvatar.style.backgroundImage = imgUrl;
            } else {
                previewAvatar.style.backgroundImage = 'none';
                previewAvatar.textContent = name ? name.charAt(0).toUpperCase() : 'U';
            }

            if (profileDraftState.banner) {
                previewBanner.style.backgroundImage = `url('${profileDraftState.banner}')`;
            } else {
                previewBanner.style.backgroundImage = 'none';
            }
        }

        function applyUserDataToUI() {
            const name = currentUser.displayName || currentUser.username || 'User';
            const handle = currentUser.handle || 'user';
            const accent = currentUser.accentColor || '#ffffff';
            const secondary = currentUser.secondaryColor || '#2b2d31';
            const borderStart = currentUser.borderStartColor || '#ffffff';
            const borderEnd = currentUser.borderEndColor || '#80848e';

            displayNameInput.value = name;
            handleInput.value = handle;
            pronounsInput.value = currentUser.pronouns || '';
            bioInput.value = currentUser.bio || '';

            barName.textContent = name;
            barHandle.textContent = '@' + handle;
            previewName.textContent = name;
            previewHandle.textContent = '@' + handle;

            // Sync to server sidebar user bar and server members list
            const serverBarName = document.getElementById('serverBarName');
            const serverBarHandle = document.getElementById('serverBarHandle');
            const serverBarAvatar = document.getElementById('serverBarAvatar');
            const memberUserName = document.getElementById('memberUserName');
            const memberUserHandle = document.getElementById('memberUserHandle');
            const memberUserAvatar = document.getElementById('memberUserAvatar');

            if (serverBarName) serverBarName.textContent = name;
            if (serverBarHandle) serverBarHandle.textContent = '@' + handle;
            if (memberUserName) memberUserName.textContent = name;
            if (memberUserHandle) memberUserHandle.textContent = '@' + handle;

            accentColorInput.value = accent;
            secondaryColorInput.value = secondary;
            if (borderStartColorInput) borderStartColorInput.value = borderStart;
            if (borderEndColorInput) borderEndColorInput.value = borderEnd;
            updateProfileThemeGradient(accent, secondary);
            updateProfileBorderGradient(borderStart, borderEnd);

            if (currentUser.pronouns) {
                previewPronouns.textContent = currentUser.pronouns;
                previewPronouns.style.display = 'block';
                previewDivider.style.display = 'block';
            } else {
                previewPronouns.style.display = 'none';
            }

            if (currentUser.bio) {
                previewBio.textContent = currentUser.bio;
                previewAboutSection.style.display = 'block';
                previewDivider.style.display = 'block';
            } else {
                previewAboutSection.style.display = 'none';
            }

            if (currentUser.avatar) {
                const imgUrl = `url('${currentUser.avatar}')`;
                previewAvatar.style.backgroundImage = imgUrl;
                barAvatar.style.backgroundImage = imgUrl;
                if (serverBarAvatar) serverBarAvatar.style.backgroundImage = imgUrl;
                if (memberUserAvatar) {
                    memberUserAvatar.style.backgroundImage = imgUrl;
                    memberUserAvatar.textContent = '';
                }
            } else {
                previewAvatar.style.backgroundImage = 'none';
                barAvatar.style.backgroundImage = 'none';
                if (serverBarAvatar) serverBarAvatar.style.backgroundImage = 'none';
                if (memberUserAvatar) {
                    memberUserAvatar.style.backgroundImage = 'none';
                    memberUserAvatar.textContent = name ? name.charAt(0).toUpperCase() : 'U';
                }
            }

            if (currentUser.banner) {
                previewBanner.style.backgroundImage = `url('${currentUser.banner}')`;
            } else {
                previewBanner.style.backgroundImage = 'none';
            }

            initProfileDraftState();

            if (typeof renderServerMembersList === 'function') {
                renderServerMembersList();
            }
        }

        loadUserData();

        // Profile Theme Pickers
        accentColorInput.addEventListener('input', (e) => {
            profileDraftState.accentColor = e.target.value;
            updateProfileThemeGradient(profileDraftState.accentColor, profileDraftState.secondaryColor);
            checkProfileUnsavedChanges();
        });

        secondaryColorInput.addEventListener('input', (e) => {
            profileDraftState.secondaryColor = e.target.value;
            updateProfileThemeGradient(profileDraftState.accentColor, profileDraftState.secondaryColor);
            checkProfileUnsavedChanges();
        });

        accentBox.addEventListener('click', (e) => {
            if (e.target !== accentColorInput) accentColorInput.click();
        });

        secondaryBox.addEventListener('click', (e) => {
            if (e.target !== secondaryColorInput) secondaryColorInput.click();
        });

        // Profile Border Pickers
        if (borderStartColorInput) {
            borderStartColorInput.addEventListener('input', (e) => {
                profileDraftState.borderStartColor = e.target.value;
                updateProfileBorderGradient(profileDraftState.borderStartColor, profileDraftState.borderEndColor);
                checkProfileUnsavedChanges();
            });
        }

        if (borderEndColorInput) {
            borderEndColorInput.addEventListener('input', (e) => {
                profileDraftState.borderEndColor = e.target.value;
                updateProfileBorderGradient(profileDraftState.borderStartColor, profileDraftState.borderEndColor);
                checkProfileUnsavedChanges();
            });
        }

        if (borderStartBox && borderStartColorInput) {
            borderStartBox.addEventListener('click', (e) => {
                if (e.target !== borderStartColorInput) borderStartColorInput.click();
            });
        }

        if (borderEndBox && borderEndColorInput) {
            borderEndBox.addEventListener('click', (e) => {
                if (e.target !== borderEndColorInput) borderEndColorInput.click();
            });
        }

        // Display Name Handler
        displayNameInput.addEventListener('input', (e) => {
            profileDraftState.displayName = e.target.value;
            previewName.textContent = e.target.value.trim() || 'User';
            checkProfileUnsavedChanges();
        });

        // 5-Day Handle Cooldown & Format Handler
        const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

        saveHandleBtn.addEventListener('click', () => {
            const rawInput = handleInput.value.trim().replace(/^@/, '');
            
            if (!rawInput) {
                handleNotice.textContent = 'Handle must contain at least 3 valid characters.';
                handleNotice.className = 'handle-notice error';
                return;
            }

            if (rawInput.includes(' ')) {
                handleNotice.textContent = 'Handle cannot contain spaces.';
                handleNotice.className = 'handle-notice error';
                return;
            }

            if (rawInput.length < 3 || rawInput.length > 12) {
                handleNotice.textContent = 'Handle must be between 3 and 12 characters long.';
                handleNotice.className = 'handle-notice error';
                return;
            }

            if (!/^[a-zA-Z0-9_.]+$/.test(rawInput)) {
                handleNotice.textContent = 'Handle can only contain letters, numbers, underscores (_), and dots (.). No special characters.';
                handleNotice.className = 'handle-notice error';
                return;
            }

            const cleanHandle = rawInput.toLowerCase();

            if (cleanHandle === currentUser.handle) {
                handleNotice.textContent = 'This is already your current handle.';
                handleNotice.className = 'handle-notice error';
                return;
            }

            let usersList = [];
            try { usersList = JSON.parse(localStorage.getItem('talky_users') || '[]'); } catch(e) {}
            const handleIsTaken = usersList.some(u => u.id !== currentUser.id && u.handle && u.handle.toLowerCase() === cleanHandle);
            if (handleIsTaken) {
                handleNotice.textContent = `The handle "@${cleanHandle}" is already taken by another account.`;
                handleNotice.className = 'handle-notice error';
                return;
            }

            const now = Date.now();
            const lastChanged = currentUser.handleLastChanged;

            if (lastChanged && (now - lastChanged) < FIVE_DAYS_MS) {
                const remainingMs = FIVE_DAYS_MS - (now - lastChanged);
                const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
                const hours = Math.floor((remainingMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
                const mins = Math.ceil((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

                let timeStr = '';
                if (days > 0) timeStr += `${days}d `;
                if (hours > 0 || days > 0) timeStr += `${hours}h `;
                timeStr += `${mins}m`;

                handleNotice.textContent = `You can only change your handle once every 5 days. Try again in ${timeStr}.`;
                handleNotice.className = 'handle-notice error';
                handleInput.value = currentUser.handle;
                return;
            }

            currentUser.handle = cleanHandle;
            currentUser.handleLastChanged = now;
            saveUserData();

            previewHandle.textContent = '@' + cleanHandle;
            barHandle.textContent = '@' + cleanHandle;
            handleInput.value = cleanHandle;

            handleNotice.textContent = 'Handle changed successfully! Cooldown active for 5 days.';
            handleNotice.className = 'handle-notice success';

            setTimeout(() => {
                if (handleNotice.textContent.includes('successfully')) {
                    handleNotice.textContent = '';
                    handleNotice.className = 'handle-notice';
                }
            }, 5000);
        });

        // Pronouns Handler
        pronounsInput.addEventListener('input', (e) => {
            const val = e.target.value;
            profileDraftState.pronouns = val;
            if (val.trim()) {
                previewPronouns.textContent = val.trim();
                previewPronouns.style.display = 'block';
                previewDivider.style.display = 'block';
            } else {
                previewPronouns.style.display = 'none';
                if (!profileDraftState.bio.trim()) {
                    previewDivider.style.display = 'none';
                }
            }
            checkProfileUnsavedChanges();
        });

        // Bio Handler
        bioInput.addEventListener('input', (e) => {
            const val = e.target.value;
            profileDraftState.bio = val;
            if (val.trim()) {
                previewBio.textContent = val.trim();
                previewAboutSection.style.display = 'block';
                previewDivider.style.display = 'block';
            } else {
                previewAboutSection.style.display = 'none';
                if (!profileDraftState.pronouns.trim()) {
                    previewDivider.style.display = 'none';
                }
            }
            checkProfileUnsavedChanges();
        });

        // Avatar Upload Handler with Automatic In-Memory Compression
        avatarInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const compressed = await compressImage(file, 180, 180, 0.82);
                profileDraftState.avatar = compressed;
                previewAvatar.style.backgroundImage = `url('${compressed}')`;
                checkProfileUnsavedChanges();
            }
        });

        removeAvatarBtn.addEventListener('click', () => {
            previewAvatar.style.backgroundImage = 'none';
            avatarInput.value = '';
            profileDraftState.avatar = '';
            checkProfileUnsavedChanges();
        });

        // Banner Upload Handler with Automatic In-Memory Compression
        bannerInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                const compressed = await compressImage(file, 640, 220, 0.80);
                profileDraftState.banner = compressed;
                previewBanner.style.backgroundImage = `url('${compressed}')`;
                checkProfileUnsavedChanges();
            }
        });

        removeBannerBtn.addEventListener('click', () => {
            previewBanner.style.backgroundImage = 'none';
            bannerInput.value = '';
            profileDraftState.banner = '';
            checkProfileUnsavedChanges();
        });

        // Profile Floating Save Changes Notice Bar Event Handlers
        const profileResetNoticeBtn = document.getElementById('profileResetNoticeBtn');
        const profileSaveNoticeBtn = document.getElementById('profileSaveNoticeBtn');
        const addNewLinkBtn = document.getElementById('addNewLinkBtn');

        if (addNewLinkBtn) {
            addNewLinkBtn.addEventListener('click', () => {
                if (!Array.isArray(profileDraftState.links)) {
                    profileDraftState.links = [];
                }
                if (profileDraftState.links.length < 4) {
                    profileDraftState.links.push({ title: '', url: '' });
                    renderProfileLinksInputs();
                    renderProfileLinksPreview();
                    checkProfileUnsavedChanges();
                    const container = document.getElementById('profileLinksContainer');
                    const lastRow = container ? container.lastElementChild : null;
                    if (lastRow) {
                        const input = lastRow.querySelector('.profile-link-url');
                        if (input) input.focus();
                    }
                }
            });
        }

        if (profileResetNoticeBtn) {
            profileResetNoticeBtn.addEventListener('click', () => {
                profileDraftState = JSON.parse(JSON.stringify(profileSavedState));
                if (!Array.isArray(profileDraftState.links)) {
                    profileDraftState.links = [];
                }
                while (profileDraftState.links.length < 2) {
                    profileDraftState.links.push({ title: '', url: '' });
                }
                renderProfilePreviewFromDraft();
                renderProfileLinksInputs();
                renderProfileLinksPreview();
                checkProfileUnsavedChanges();
            });
        }

        if (profileSaveNoticeBtn) {
            profileSaveNoticeBtn.addEventListener('click', async () => {
                profileSaveNoticeBtn.disabled = true;
                const origText = profileSaveNoticeBtn.textContent;
                profileSaveNoticeBtn.textContent = 'Saving...';

                try {
                    // Pre-compression check on draft avatar & banner if they are large
                    if (profileDraftState.avatar && profileDraftState.avatar.length > 70000) {
                        profileDraftState.avatar = await compressImage(profileDraftState.avatar, 180, 180, 0.82);
                    }
                    if (profileDraftState.banner && profileDraftState.banner.length > 120000) {
                        profileDraftState.banner = await compressImage(profileDraftState.banner, 640, 220, 0.80);
                    }

                    currentUser.displayName = profileDraftState.displayName.trim() || 'User';
                    currentUser.pronouns = profileDraftState.pronouns;
                    currentUser.bio = profileDraftState.bio;
                    currentUser.accentColor = profileDraftState.accentColor;
                    currentUser.secondaryColor = profileDraftState.secondaryColor;
                    currentUser.borderStartColor = profileDraftState.borderStartColor || '#00f2fe';
                    currentUser.borderEndColor = profileDraftState.borderEndColor || '#4facfe';
                    currentUser.avatar = profileDraftState.avatar;
                    currentUser.banner = profileDraftState.banner;

                    // Process up to 4 links with non-empty URLs
                    const processedLinks = (profileDraftState.links || [])
                        .filter(l => l && l.url && l.url.trim())
                        .slice(0, 4)
                        .map(l => {
                            let u = l.url.trim();
                            if (!/^https?:\/\//i.test(u)) {
                                u = 'https://' + u;
                            }
                            let t = (l.title || '').trim();
                            if (!t) {
                                t = getDomainFromUrl(u);
                            }
                            return { title: t, url: u };
                        });

                    currentUser.links = processedLinks;
                    profileSavedState = JSON.parse(JSON.stringify(profileDraftState));
                    profileSavedState.links = JSON.parse(JSON.stringify(processedLinks));

                    saveUserData();
                    applyUserDataToUI();
                    checkProfileUnsavedChanges();
                } catch (err) {
                    console.error('Error during profile save:', err);
                } finally {
                    profileSaveNoticeBtn.disabled = false;
                    profileSaveNoticeBtn.textContent = origText;
                }
            });
        }

        // Talky BOT DM & Chat Logic
        const talkyBotDmBtn = document.getElementById('talkyBotDmBtn');
        const friendsView = document.getElementById('friendsView');
        const dmChatView = document.getElementById('dmChatView');
        const serverDmsBtn = document.querySelector('.dms-btn');
        const toggleProfileBtn = document.getElementById('toggleProfileBtn');
        const userProfileSidebar = document.getElementById('userProfileSidebar');

        const dmMessageForm = document.getElementById('dmMessageForm');
        const dmMessageInput = document.getElementById('dmMessageInput');
        const chatMessagesList = document.getElementById('chatMessagesList');
        const chatMessagesScroll = document.getElementById('chatMessagesScroll');

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        function formatCurrentTime() {
            const now = new Date();
            const hours = now.getHours() % 12 || 12;
            const minutes = now.getMinutes().toString().padStart(2, '0');
            const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
            return `Today at ${hours}:${minutes} ${ampm}`;
        }

        function scrollToBottom() {
            if (chatMessagesScroll) {
                chatMessagesScroll.scrollTop = chatMessagesScroll.scrollHeight;
            }
        }

        function openDmChat() {
            if (friendsView && dmChatView) {
                friendsView.style.display = 'none';
                dmChatView.style.display = 'flex';
                if (talkyBotDmBtn) talkyBotDmBtn.classList.add('active');
                setTimeout(scrollToBottom, 50);
            }
        }
        // Note: full openFriendsView defined below to also handle server sidebar state

        if (talkyBotDmBtn) {
            talkyBotDmBtn.addEventListener('click', openDmChat);
        }

        if (serverDmsBtn) {
            serverDmsBtn.addEventListener('click', openFriendsView);
        }

        if (toggleProfileBtn && userProfileSidebar) {
            toggleProfileBtn.addEventListener('click', () => {
                const isHidden = userProfileSidebar.classList.toggle('hidden');
                toggleProfileBtn.classList.toggle('active', !isHidden);
            });
        }

        let dmMessagesList = [];
        let activeReply = null;

        const replyContextBar = document.getElementById('replyContextBar');
        const replyContextTarget = document.getElementById('replyContextTarget');
        const replyContextSnippet = document.getElementById('replyContextSnippet');
        const replyCancelBtn = document.getElementById('replyCancelBtn');

        function setReply(msgId) {
            const msg = dmMessagesList.find(m => m.id === msgId);
            if (!msg) return;
            const fallbackSnippet = (msg.images && msg.images.length > 0) ? (msg.images.length === 1 ? '[Attachment: 1 Image]' : `[Attachments: ${msg.images.length} Images]`) : '';
            activeReply = {
                id: msg.id,
                author: msg.author,
                text: msg.text || fallbackSnippet,
                avatar: msg.avatar || ''
            };
            updateReplyUI();
            if (dmMessageInput) {
                dmMessageInput.focus();
            }
        }

        function cancelReply() {
            activeReply = null;
            updateReplyUI();
        }

        function updateReplyUI() {
            if (!replyContextBar) return;
            if (activeReply) {
                replyContextBar.style.display = 'flex';
                if (replyContextTarget) replyContextTarget.textContent = '@' + activeReply.author;
                if (replyContextSnippet) {
                    const snippetText = activeReply.text ? `— ${activeReply.text}` : '';
                    replyContextSnippet.textContent = snippetText;
                }
                if (dmMessageForm) dmMessageForm.classList.add('has-reply');
            } else {
                replyContextBar.style.display = 'none';
                if (dmMessageForm) dmMessageForm.classList.remove('has-reply');
            }
        }

        if (replyCancelBtn) {
            replyCancelBtn.addEventListener('click', cancelReply);
        }

        function scrollToMessage(msgId) {
            const target = document.getElementById(`msg-${msgId}`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.remove('flash-highlight');
                void target.offsetWidth;
                target.classList.add('flash-highlight');
            }
        }

        function saveDmMessages() {
            safeStorageSet('talky_bot_messages', JSON.stringify(dmMessagesList));
        }

        function renderChatMessage(msg) {
            let avatarMarkup = '';
            if (msg.avatar) {
                avatarMarkup = `<img src="${msg.avatar}" class="msg-avatar" alt="${escapeHtml(msg.author)}">`;
            } else {
                const initial = msg.author ? msg.author.charAt(0).toUpperCase() : 'U';
                avatarMarkup = `<div class="msg-avatar" style="background:rgba(255, 255, 255, 0.12); border:1px solid rgba(255, 255, 255, 0.22); display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff; font-size:0.9rem;">${initial}</div>`;
            }

            const botTagMarkup = msg.isBot ? '<span class="bot-tag">BOT</span>' : '';
            const processedText = msg.text ? (typeof replaceEmojiShortcodes === 'function' ? replaceEmojiShortcodes(msg.text) : msg.text) : '';
            const textMarkup = processedText ? `<div class="msg-text">${escapeHtml(processedText)}</div>` : '';

            // Reply spine & context quote bar
            let replyMarkup = '';
            if (msg.replyTo) {
                let rAvatar = '';
                if (msg.replyTo.avatar) {
                    rAvatar = `<img src="${msg.replyTo.avatar}" class="reply-avatar" alt="${escapeHtml(msg.replyTo.author)}">`;
                } else {
                    const rInitial = msg.replyTo.author ? msg.replyTo.author.charAt(0).toUpperCase() : 'U';
                    rAvatar = `<div class="reply-avatar" style="background:rgba(255, 255, 255, 0.12); border:1px solid rgba(255, 255, 255, 0.22); display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:bold; color:#fff;">${rInitial}</div>`;
                }
                const rSnippet = msg.replyTo.text || '[Image]';
                replyMarkup = `
                    <div class="msg-reply-bar" data-reply-target="${escapeHtml(msg.replyTo.id)}" title="Click to jump to message">
                        <div class="reply-spine"></div>
                        ${rAvatar}
                        <span class="reply-author">@${escapeHtml(msg.replyTo.author)}</span>
                        <span class="reply-snippet">${escapeHtml(rSnippet)}</span>
                    </div>
                `;
            }

            // Image Gallery Layout:
            // 1 image: large single preview
            // 2 images: 2 columns
            // >2 images: multi-column grid mosaic
            let imagesMarkup = '';
            if (msg.images && msg.images.length > 0) {
                let gridClass = 'grid-1';
                if (msg.images.length === 2) {
                    gridClass = 'grid-2';
                } else if (msg.images.length === 3) {
                    gridClass = 'grid-multi grid-3';
                } else if (msg.images.length >= 5) {
                    gridClass = 'grid-multi grid-5plus';
                } else if (msg.images.length > 2) {
                    gridClass = 'grid-multi';
                }

                const imgsHtml = msg.images.map((src, idx) => `
                    <div class="msg-image-wrapper" data-msg-id="${msg.id}" data-img-idx="${idx}" title="Click to view full image (${idx + 1} of ${msg.images.length})">
                        <img src="${src}" alt="Attachment ${idx + 1}">
                    </div>
                `).join('');
                imagesMarkup = `<div class="msg-images-grid ${gridClass}">${imgsHtml}</div>`;
            }

            const reactionsMarkup = renderReactionsMarkup(msg);

            const msgHtml = `
                <div class="chat-message-row" id="msg-${msg.id}" data-msg-id="${msg.id}">
                    ${replyMarkup}
                    <div class="chat-message">
                        <div class="chat-message-actions">
                            <button type="button" class="msg-action-btn react-btn" data-react-id="${msg.id}" title="Add Reaction">
                                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>
                            </button>
                            <button type="button" class="msg-action-btn reply-btn" data-reply-id="${msg.id}" title="Reply">
                                <svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
                            </button>
                        </div>
                        ${avatarMarkup}
                        <div class="msg-content-wrapper">
                            <div class="msg-meta">
                                <span class="msg-author">${escapeHtml(msg.author)}</span>
                                ${botTagMarkup}
                                <span class="msg-time">${escapeHtml(msg.time)}</span>
                            </div>
                            ${textMarkup}
                            ${imagesMarkup}
                            ${reactionsMarkup}
                        </div>
                    </div>
                </div>
            `;
            chatMessagesList.insertAdjacentHTML('beforeend', msgHtml);
        }

        // Render Reaction Badges for Message
        function renderReactionsMarkup(msg) {
            const reactions = msg.reactions || {};
            const emojiKeys = Object.keys(reactions);
            if (emojiKeys.length === 0) return '';

            const currentUserId = currentUser ? (currentUser.id || currentUser.handle || 'user') : 'user';
            const badgesHtml = emojiKeys.map(emoji => {
                const users = reactions[emoji] || [];
                if (users.length === 0) return '';
                const count = users.length;
                const hasReacted = users.includes(currentUserId);
                const tooltip = hasReacted 
                    ? (count === 1 ? 'You reacted with ' + emoji : `You and ${count - 1} other reacted with ${emoji}`)
                    : `${count} user(s) reacted with ${emoji}`;

                return `
                    <div class="reaction-badge ${hasReacted ? 'active' : ''}" data-msg-id="${msg.id}" data-emoji="${escapeHtml(emoji)}" title="${escapeHtml(tooltip)}">
                        <span class="reaction-emoji">${emoji}</span>
                        <span class="reaction-count">${count}</span>
                    </div>
                `;
            }).join('');

            return `
                <div class="msg-reactions-bar" data-msg-id="${msg.id}">
                    ${badgesHtml}
                    <button type="button" class="reaction-add-btn" data-react-id="${msg.id}" title="Add Reaction">
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>
                    </button>
                </div>
            `;
        }

        // Toggle Reaction on a Message
        function toggleMessageReaction(msgId, emoji) {
            const msg = dmMessagesList.find(m => m.id === msgId);
            if (!msg) return;

            if (!msg.reactions) msg.reactions = {};
            if (!Array.isArray(msg.reactions[emoji])) {
                msg.reactions[emoji] = [];
            }

            const currentUserId = currentUser ? (currentUser.id || currentUser.handle || 'user') : 'user';
            const idx = msg.reactions[emoji].indexOf(currentUserId);
            if (idx >= 0) {
                // User already reacted -> remove reaction
                msg.reactions[emoji].splice(idx, 1);
                if (msg.reactions[emoji].length === 0) {
                    delete msg.reactions[emoji];
                }
            } else {
                // User hasn't reacted yet -> add reaction
                msg.reactions[emoji].push(currentUserId);
            }

            saveDmMessages();
            updateMessageReactionsUI(msgId);
        }

        // Update Reactions DOM without full message re-render
        function updateMessageReactionsUI(msgId) {
            const msg = dmMessagesList.find(m => m.id === msgId);
            if (!msg) return;
            const msgRow = document.getElementById(`msg-${msgId}`);
            if (!msgRow) return;

            const existingBar = msgRow.querySelector('.msg-reactions-bar');
            const newHtml = renderReactionsMarkup(msg);

            if (existingBar) {
                if (newHtml) {
                    existingBar.outerHTML = newHtml;
                } else {
                    existingBar.remove();
                }
            } else if (newHtml) {
                const contentWrapper = msgRow.querySelector('.msg-content-wrapper');
                if (contentWrapper) {
                    contentWrapper.insertAdjacentHTML('beforeend', newHtml);
                }
            }
        }

        // Load Persisted Chat Messages
        function loadDmMessages() {
            const storedMsgs = localStorage.getItem('talky_bot_messages');
            if (storedMsgs) {
                try {
                    const msgs = JSON.parse(storedMsgs);
                    if (Array.isArray(msgs) && msgs.length > 0) {
                        dmMessagesList = msgs.map(m => ({
                            id: m.id || ('msg_' + Math.random().toString(36).substr(2, 9)),
                            author: m.author || 'User',
                            avatar: m.avatar || '',
                            isBot: !!m.isBot,
                            time: m.time || '',
                            text: m.text || '',
                            images: Array.isArray(m.images) ? m.images : [],
                            replyTo: m.replyTo || null,
                            reactions: (m.reactions && typeof m.reactions === 'object') ? m.reactions : {}
                        }));
                        chatMessagesList.innerHTML = '';
                        dmMessagesList.forEach(m => renderChatMessage(m));
                        scrollToBottom();
                        saveDmMessages();
                    }
                } catch(e) {
                    console.error(e);
                    dmMessagesList = [];
                }
            }
        }


        // Multiple Image Attachments
        let pendingImages = [];
        const chatImageInput = document.getElementById('chatImageInput');
        const attachBtn = document.getElementById('attachBtn');
        const attachmentPreviewTray = document.getElementById('attachmentPreviewTray');

        if (attachBtn && chatImageInput) {
            attachBtn.addEventListener('click', () => {
                chatImageInput.click();
            });

            chatImageInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                if (!files.length) return;

                for (const file of files) {
                    if (file.type.startsWith('image/')) {
                        const compressed = await compressImage(file, 960, 960, 0.80);
                        if (compressed) pendingImages.push(compressed);
                    }
                }
                renderAttachmentTray();
                chatImageInput.value = '';
            });
        }

        function renderAttachmentTray() {
            if (pendingImages.length === 0) {
                attachmentPreviewTray.style.display = 'none';
                attachmentPreviewTray.innerHTML = '';
                dmMessageForm.classList.remove('has-attachments');
                return;
            }

            attachmentPreviewTray.style.display = 'flex';
            dmMessageForm.classList.add('has-attachments');
            attachmentPreviewTray.innerHTML = '';

            pendingImages.forEach((imgUrl, index) => {
                const item = document.createElement('div');
                item.className = 'attachment-thumb-item';
                item.style.cursor = 'pointer';
                item.innerHTML = `
                    <img src="${imgUrl}" alt="Attachment preview" title="Click to view full image">
                    <button type="button" class="attachment-thumb-remove" title="Remove image">
                        <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                `;
                item.querySelector('img').addEventListener('click', () => {
                    openLightboxWithImages(pendingImages, index);
                });
                item.querySelector('.attachment-thumb-remove').addEventListener('click', (e) => {
                    e.stopPropagation();
                    pendingImages.splice(index, 1);
                    renderAttachmentTray();
                });
                attachmentPreviewTray.appendChild(item);
            });
        }

        // Send Message (Bot does NOT talk or do anything)
        if (dmMessageForm && dmMessageInput) {
            dmMessageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                if (typeof closeEmojiSuggestions === 'function') {
                    closeEmojiSuggestions();
                }
                const rawText = dmMessageInput.value;
                const convertedText = (typeof replaceEmojiShortcodes === 'function') ? replaceEmojiShortcodes(rawText) : rawText;
                const text = convertedText.trim();
                if (!text && pendingImages.length === 0) return;

                const authorName = currentUser ? (currentUser.displayName || currentUser.username || 'User') : 'User';
                const authorAvatar = currentUser && currentUser.avatar ? currentUser.avatar : '';
                const time = formatCurrentTime();
                const imagesToSend = [...pendingImages];

                const newMsg = {
                    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    author: authorName,
                    avatar: authorAvatar,
                    isBot: false,
                    time: time,
                    text: text,
                    images: imagesToSend,
                    replyTo: activeReply ? { ...activeReply } : null,
                    reactions: {}
                };

                dmMessagesList.push(newMsg);
                renderChatMessage(newMsg);

                dmMessageInput.value = '';
                pendingImages = [];
                renderAttachmentTray();
                cancelReply();
                closeEmojiBoard();
                scrollToBottom();
                saveDmMessages();

                // Bot does not talk or do anything
            });
        }

        // Fullscreen Image Lightbox Viewer with Image Cycling (Discord style)
        let currentGalleryImages = [];
        let currentGalleryIndex = 0;

        function getLightboxElements() {
            return {
                modal: document.getElementById('imageLightboxModal'),
                img: document.getElementById('lightboxImg'),
                closeBtn: document.getElementById('lightboxCloseBtn'),
                backdrop: document.getElementById('lightboxBackdrop'),
                prevBtn: document.getElementById('lightboxPrevBtn'),
                nextBtn: document.getElementById('lightboxNextBtn'),
                counter: document.getElementById('lightboxCounter')
            };
        }

        function openLightboxWithImages(images, startIndex = 0) {
            if (!images || images.length === 0) return;
            currentGalleryImages = [...images];
            currentGalleryIndex = Math.max(0, Math.min(startIndex, currentGalleryImages.length - 1));
            updateLightboxView();
            const { modal } = getLightboxElements();
            if (modal) {
                modal.classList.add('open');
            }
        }

        function updateLightboxView() {
            const { img, counter, prevBtn, nextBtn } = getLightboxElements();
            if (img && currentGalleryImages.length > 0) {
                img.src = currentGalleryImages[currentGalleryIndex];
            }

            if (counter) {
                counter.textContent = `${currentGalleryIndex + 1} / ${currentGalleryImages.length}`;
                counter.style.display = currentGalleryImages.length > 1 ? 'block' : 'none';
            }

            if (prevBtn && nextBtn) {
                if (currentGalleryImages.length > 1) {
                    prevBtn.style.display = 'flex';
                    nextBtn.style.display = 'flex';
                } else {
                    prevBtn.style.display = 'none';
                    nextBtn.style.display = 'none';
                }
            }
        }

        function nextLightboxImage() {
            if (currentGalleryImages.length <= 1) return;
            currentGalleryIndex = (currentGalleryIndex + 1) % currentGalleryImages.length;
            updateLightboxView();
        }

        function prevLightboxImage() {
            if (currentGalleryImages.length <= 1) return;
            currentGalleryIndex = (currentGalleryIndex - 1 + currentGalleryImages.length) % currentGalleryImages.length;
            updateLightboxView();
        }

        function closeLightbox() {
            const { modal, img } = getLightboxElements();
            if (modal) {
                modal.classList.remove('open');
            }
            if (img) {
                img.src = '';
            }
            currentGalleryImages = [];
            currentGalleryIndex = 0;
        }

        const lb = getLightboxElements();
        if (lb.closeBtn) lb.closeBtn.addEventListener('click', closeLightbox);
        if (lb.backdrop) lb.backdrop.addEventListener('click', closeLightbox);
        if (lb.prevBtn) lb.prevBtn.addEventListener('click', (e) => { e.stopPropagation(); prevLightboxImage(); });
        if (lb.nextBtn) lb.nextBtn.addEventListener('click', (e) => { e.stopPropagation(); nextLightboxImage(); });

        window.addEventListener('keydown', (e) => {
            const { modal } = getLightboxElements();
            if (modal && modal.classList.contains('open')) {
                if (e.key === 'Escape') {
                    closeLightbox();
                } else if (e.key === 'ArrowRight') {
                    nextLightboxImage();
                } else if (e.key === 'ArrowLeft') {
                    prevLightboxImage();
                }
            }
        });

        // Discord Emoji Board & Reactions Controller
        const EMOJI_CATEGORIES = [
            {
                id: 'popular',
                name: 'Frequently Used',
                emojis: [
                    { char: '🔥', name: 'Fire', keywords: 'fire hot lit burn' },
                    { char: '❤️', name: 'Red Heart', keywords: 'heart love red' },
                    { char: '😂', name: 'Face with Tears of Joy', keywords: 'lol laugh haha tears' },
                    { char: '👍', name: 'Thumbs Up', keywords: 'thumbs up like yes approve' },
                    { char: '✨', name: 'Sparkles', keywords: 'sparkles shiny star magic' },
                    { char: '🎉', name: 'Party Popper', keywords: 'party celebrate popper yay' },
                    { char: '💀', name: 'Skull', keywords: 'skull dead die laugh' },
                    { char: '😭', name: 'Loudly Crying Face', keywords: 'cry sad sob tears' },
                    { char: '😍', name: 'Heart Eyes', keywords: 'love heart eyes smile' },
                    { char: '🥺', name: 'Pleading Face', keywords: 'pleading puppy eyes please' },
                    { char: '😎', name: 'Smiling Face with Sunglasses', keywords: 'cool sunglasses chill' },
                    { char: '👏', name: 'Clapping Hands', keywords: 'clap applause praise' },
                    { char: '🙌', name: 'Raising Hands', keywords: 'celebrate praise hands hooray' },
                    { char: '💯', name: 'Hundred Points', keywords: '100 hundred perfect' }
                ]
            },
            {
                id: 'smileys',
                name: 'Smileys & Emotion',
                emojis: [
                    { char: '😀', name: 'Grinning Face', keywords: 'grinning smile happy' },
                    { char: '😃', name: 'Grinning Face with Big Eyes', keywords: 'happy smile joy' },
                    { char: '😄', name: 'Grinning Face with Smiling Eyes', keywords: 'happy smile' },
                    { char: '😁', name: 'Beaming Face with Smiling Eyes', keywords: 'grin teeth smile' },
                    { char: '😆', name: 'Grinning Squinting Face', keywords: 'laugh haha' },
                    { char: '😅', name: 'Grinning Face with Sweat', keywords: 'sweat relief whew' },
                    { char: '🤣', name: 'Rolling on the Floor Laughing', keywords: 'rofl laugh haha' },
                    { char: '😂', name: 'Face with Tears of Joy', keywords: 'laugh lol tears' },
                    { char: '🙂', name: 'Slightly Smiling Face', keywords: 'smile nice ok' },
                    { char: '🙃', name: 'Upside-Down Face', keywords: 'silly upside down' },
                    { char: '😉', name: 'Winking Face', keywords: 'wink flirt' },
                    { char: '😊', name: 'Smiling Face with Smiling Eyes', keywords: 'blush smile proud' },
                    { char: '😇', name: 'Smiling Face with Halo', keywords: 'angel innocent halo' },
                    { char: '🥰', name: 'Smiling Face with Hearts', keywords: 'love in love adore' },
                    { char: '😍', name: 'Heart Eyes', keywords: 'love heart eyes' },
                    { char: '🤩', name: 'Star-Struck', keywords: 'star eyes wow' },
                    { char: '😘', name: 'Face Blowing a Kiss', keywords: 'kiss love' },
                    { char: '😋', name: 'Face Savoring Food', keywords: 'yum delicious tongue' },
                    { char: '😛', name: 'Face with Tongue', keywords: 'tongue silly' },
                    { char: '😜', name: 'Winking Face with Tongue', keywords: 'wink tongue crazy' },
                    { char: '🤪', name: 'Zany Face', keywords: 'crazy goofy wild' },
                    { char: '😝', name: 'Squinting Face with Tongue', keywords: 'tongue funny' },
                    { char: '🤑', name: 'Money-Mouth Face', keywords: 'money rich cash dollar' },
                    { char: '🤗', name: 'Smiling Face with Open Hands', keywords: 'hug warmth' },
                    { char: '🤭', name: 'Face with Hand Over Mouth', keywords: 'oops teehee giggle' },
                    { char: '🤫', name: 'Shushing Face', keywords: 'shh quiet secret' },
                    { char: '🤔', name: 'Thinking Face', keywords: 'think hmm wonder' },
                    { char: '🤐', name: 'Zipper-Mouth Face', keywords: 'zipper secret quiet' },
                    { char: '🤨', name: 'Face with Raised Eyebrow', keywords: 'skeptical doubt eyebrow' },
                    { char: '😐', name: 'Neutral Face', keywords: 'neutral poker face' },
                    { char: '😑', name: 'Expressionless Face', keywords: 'expressionless blank' },
                    { char: '😶', name: 'Face Without Mouth', keywords: 'speechless quiet' },
                    { char: '😏', name: 'Smirking Face', keywords: 'smirk cool flirt' },
                    { char: '😒', name: 'Unamused Face', keywords: 'unamused annoyed' },
                    { char: '🙄', name: 'Face with Rolling Eyes', keywords: 'eye roll whatever' },
                    { char: '😬', name: 'Grimacing Face', keywords: 'grimace awkward eek' },
                    { char: '🤥', name: 'Lying Face', keywords: 'lie pinocchio nose' },
                    { char: '😌', name: 'Relieved Face', keywords: 'relieved peace' },
                    { char: '😔', name: 'Pensive Face', keywords: 'sad pensive down' },
                    { char: '😪', name: 'Sleepy Face', keywords: 'sleepy tired snot' },
                    { char: '🤤', name: 'Drooling Face', keywords: 'drool crave' },
                    { char: '😴', name: 'Sleeping Face', keywords: 'sleep zzz night' },
                    { char: '😷', name: 'Face with Medical Mask', keywords: 'mask sick virus' },
                    { char: '🤒', name: 'Face with Thermometer', keywords: 'sick fever ill' },
                    { char: '🤕', name: 'Face with Head-Bandage', keywords: 'hurt bandage injured' },
                    { char: '🤢', name: 'Nauseated Face', keywords: 'sick gross puking' },
                    { char: '🤮', name: 'Face Vomiting', keywords: 'vomit puke barf' },
                    { char: '🤧', name: 'Sneezing Face', keywords: 'sneeze cold tissues' },
                    { char: '🥵', name: 'Hot Face', keywords: 'hot heat sweating' },
                    { char: '🥶', name: 'Cold Face', keywords: 'cold freezing ice' },
                    { char: '🥴', name: 'Woozy Face', keywords: 'drunk dizzy woozy' },
                    { char: '😵', name: 'Face with Crossed-Out Eyes', keywords: 'dizzy knocked out dead' },
                    { char: '🤯', name: 'Exploding Head', keywords: 'mind blown explosion shocked' },
                    { char: '🤠', name: 'Cowboy Hat Face', keywords: 'cowboy yeehaw western' },
                    { char: '🥳', name: 'Partying Face', keywords: 'party celebrate birthday' },
                    { char: '😎', name: 'Smiling Face with Sunglasses', keywords: 'cool sunglasses awesome' },
                    { char: '🤓', name: 'Nerd Face', keywords: 'nerd geek glasses smart' },
                    { char: '🧐', name: 'Face with Monocle', keywords: 'monocle classy inspect' },
                    { char: '😕', name: 'Confused Face', keywords: 'confused puzzled' },
                    { char: '😟', name: 'Worried Face', keywords: 'worried concern' },
                    { char: '🙁', name: 'Slightly Frowning Face', keywords: 'frown sad' },
                    { char: '😮', name: 'Face with Open Mouth', keywords: 'surprised wow ooh' },
                    { char: '😯', name: 'Hushed Face', keywords: 'hushed quiet stunned' },
                    { char: '😲', name: 'Astonished Face', keywords: 'astonished shocked omg' },
                    { char: '😳', name: 'Flushed Face', keywords: 'blush embarrassed shocked' },
                    { char: '🥺', name: 'Pleading Face', keywords: 'please puppy eyes puppy' },
                    { char: '😦', name: 'Frowning Face with Open Mouth', keywords: 'frown shocked' },
                    { char: '😧', name: 'Anguished Face', keywords: 'anguish stunned pain' },
                    { char: '😨', name: 'Fearful Face', keywords: 'scared fear shocked' },
                    { char: '😰', name: 'Anxious Face with Sweat', keywords: 'anxious sweat nervous' },
                    { char: '😥', name: 'Sad but Relieved Face', keywords: 'relieved sad close call' },
                    { char: '😢', name: 'Crying Face', keywords: 'tear sad weep' },
                    { char: '😭', name: 'Loudly Crying Face', keywords: 'sob cry bawling sad' },
                    { char: '😱', name: 'Face Screaming in Fear', keywords: 'scream panic terrified' },
                    { char: '😖', name: 'Confounded Face', keywords: 'quiver frustration' },
                    { char: '😣', name: 'Persevering Face', keywords: 'struggle suffering' },
                    { char: '😞', name: 'Disappointed Face', keywords: 'sad down letdown' },
                    { char: '😓', name: 'Downcast Face with Sweat', keywords: 'stress sweat' },
                    { char: '😩', name: 'Weary Face', keywords: 'weary tired exhausted' },
                    { char: '😫', name: 'Tired Face', keywords: 'tired fed up' },
                    { char: '🥱', name: 'Yawning Face', keywords: 'yawn bored sleepy' },
                    { char: '😤', name: 'Face with Steam From Nose', keywords: 'triumph huff angry' },
                    { char: '😡', name: 'Pouting Face', keywords: 'angry mad red furious' },
                    { char: '😠', name: 'Angry Face', keywords: 'angry mad annoyance' },
                    { char: '🤬', name: 'Face with Symbols on Mouth', keywords: 'cursing swearing rage' },
                    { char: '😈', name: 'Smiling Face with Horns', keywords: 'devil naughty evil' },
                    { char: '👿', name: 'Angry Face with Horns', keywords: 'demon devil evil mad' },
                    { char: '💀', name: 'Skull', keywords: 'skull dead skeleton' },
                    { char: '💩', name: 'Pile of Poo', keywords: 'poop crap poo' },
                    { char: '🤡', name: 'Clown Face', keywords: 'clown circus funny silly' },
                    { char: '👻', name: 'Ghost', keywords: 'ghost spooky halloween boo' },
                    { char: '👽', name: 'Alien', keywords: 'alien ufo extraterrestrial' },
                    { char: '🤖', name: 'Robot', keywords: 'robot bot technology' }
                ]
            },
            {
                id: 'gestures',
                name: 'Hand Gestures & People',
                emojis: [
                    { char: '👍', name: 'Thumbs Up', keywords: 'thumbs up yes agree like approve' },
                    { char: '👎', name: 'Thumbs Down', keywords: 'thumbs down no dislike reject' },
                    { char: '👊', name: 'Oncoming Fist', keywords: 'punch fist bump brofist' },
                    { char: '✊', name: 'Raised Fist', keywords: 'power strength solidarity' },
                    { char: '🤛', name: 'Left-Facing Fist', keywords: 'fist bump bro' },
                    { char: '🤜', name: 'Right-Facing Fist', keywords: 'fist bump bro' },
                    { char: '👏', name: 'Clapping Hands', keywords: 'applause bravo praise' },
                    { char: '🙌', name: 'Raising Hands', keywords: 'celebrate praise yay' },
                    { char: '👐', name: 'Open Hands', keywords: 'open hands hug' },
                    { char: '🤲', name: 'Palms Up Together', keywords: 'prayer offering' },
                    { char: '🤝', name: 'Handshake', keywords: 'deal agreement greeting' },
                    { char: '🙏', name: 'Folded Hands', keywords: 'pray please thank you namaste' },
                    { char: '✍️', name: 'Writing Hand', keywords: 'write taking notes' },
                    { char: '💅', name: 'Nail Polish', keywords: 'slay sassy fabulous' },
                    { char: '💪', name: 'Flexed Biceps', keywords: 'strong muscle flex gym workout' },
                    { char: '👈', name: 'Backhand Index Pointing Left', keywords: 'point left' },
                    { char: '👉', name: 'Backhand Index Pointing Right', keywords: 'point right' },
                    { char: '👆', name: 'Backhand Index Pointing Up', keywords: 'point up' },
                    { char: '👇', name: 'Backhand Index Pointing Down', keywords: 'point down' },
                    { char: '✌️', name: 'Victory Hand', keywords: 'peace victory two' },
                    { char: '🤞', name: 'Crossed Fingers', keywords: 'luck hope wish' },
                    { char: '🤟', name: 'Love-You Gesture', keywords: 'ily love you' },
                    { char: '🤘', name: 'Sign of the Horns', keywords: 'rock on metal concert' },
                    { char: '🤙', name: 'Call Me Hand', keywords: 'shaka hang loose call me' },
                    { char: '🖐️', name: 'Hand with Fingers Splayed', keywords: 'five high five stop' },
                    { char: '✋', name: 'Raised Hand', keywords: 'high five stop palm' },
                    { char: '👌', name: 'OK Hand', keywords: 'ok fine perfect' },
                    { char: '🤏', name: 'Pinching Hand', keywords: 'pinch small little bit' },
                    { char: '👋', name: 'Waving Hand', keywords: 'wave hello bye hi' },
                    { char: '🫡', name: 'Saluting Face', keywords: 'salute respect yes sir' }
                ]
            },
            {
                id: 'hearts',
                name: 'Hearts & Symbols',
                emojis: [
                    { char: '❤️', name: 'Red Heart', keywords: 'love heart red' },
                    { char: '🧡', name: 'Orange Heart', keywords: 'orange heart' },
                    { char: '💛', name: 'Yellow Heart', keywords: 'yellow heart friendship' },
                    { char: '💚', name: 'Green Heart', keywords: 'green heart nature' },
                    { char: '💙', name: 'Blue Heart', keywords: 'blue heart peace' },
                    { char: '💜', name: 'Purple Heart', keywords: 'purple heart' },
                    { char: '🖤', name: 'Black Heart', keywords: 'black heart dark emo' },
                    { char: '🤍', name: 'White Heart', keywords: 'white heart pure' },
                    { char: '🤎', name: 'Brown Heart', keywords: 'brown heart' },
                    { char: '💔', name: 'Broken Heart', keywords: 'heartbreak heartbroken' },
                    { char: '❣️', name: 'Heart Exclamation', keywords: 'heart mark' },
                    { char: '💕', name: 'Two Hearts', keywords: 'hearts love' },
                    { char: '💞', name: 'Revolving Hearts', keywords: 'hearts romance' },
                    { char: '💓', name: 'Beating Heart', keywords: 'heartbeat throb' },
                    { char: '💗', name: 'Growing Heart', keywords: 'love expanding' },
                    { char: '💖', name: 'Sparkling Heart', keywords: 'sparkle heart love' },
                    { char: '💘', name: 'Heart with Arrow', keywords: 'cupid love target' },
                    { char: '💝', name: 'Heart with Ribbon', keywords: 'gift present love' },
                    { char: '🔥', name: 'Fire', keywords: 'flame lit hot burn' },
                    { char: '✨', name: 'Sparkles', keywords: 'glitter star shine' },
                    { char: '⭐', name: 'Star', keywords: 'star yellow' },
                    { char: '🌟', name: 'Glowing Star', keywords: 'glowing star shine' },
                    { char: '💫', name: 'Dizzy Star', keywords: 'dizzy star magic' },
                    { char: '⚡', name: 'High Voltage', keywords: 'lightning thunder energy' },
                    { char: '💥', name: 'Collision', keywords: 'boom explosion pow' },
                    { char: '💯', name: 'Hundred Points', keywords: '100 perfect full' },
                    { char: '💬', name: 'Speech Balloon', keywords: 'comment talk chat text' },
                    { char: '👀', name: 'Eyes', keywords: 'look looking observe snooping' }
                ]
            },
            {
                id: 'food',
                name: 'Food & Activities',
                emojis: [
                    { char: '🎉', name: 'Party Popper', keywords: 'tada celebration party' },
                    { char: '🎊', name: 'Confetti Ball', keywords: 'confetti celebrate' },
                    { char: '🎈', name: 'Balloon', keywords: 'balloon celebration' },
                    { char: '🎁', name: 'Wrapped Gift', keywords: 'gift present birthday' },
                    { char: '🏆', name: 'Trophy', keywords: 'winner championship prize' },
                    { char: '🥇', name: '1st Place Medal', keywords: 'gold medal first' },
                    { char: '🍕', name: 'Pizza', keywords: 'pizza food cheese' },
                    { char: '🍔', name: 'Hamburger', keywords: 'burger fast food beef' },
                    { char: '🍟', name: 'French Fries', keywords: 'fries fast food' },
                    { char: '🌭', name: 'Hot Dog', keywords: 'hotdog sausage' },
                    { char: '🍿', name: 'Popcorn', keywords: 'movie popcorn snack' },
                    { char: '🥓', name: 'Bacon', keywords: 'bacon meat breakfast' },
                    { char: '🥞', name: 'Pancakes', keywords: 'breakfast syrup' },
                    { char: '🍩', name: 'Doughnut', keywords: 'donut sweet pastry' },
                    { char: '🍪', name: 'Cookie', keywords: 'biscuit chocolate chip' },
                    { char: '🎂', name: 'Birthday Cake', keywords: 'cake birthday party' },
                    { char: '🍰', name: 'Shortcake', keywords: 'cake dessert sweet' },
                    { char: '☕', name: 'Hot Beverage', keywords: 'coffee tea cafe morning' },
                    { char: '🧋', name: 'Bubble Tea', keywords: 'boba milk tea' },
                    { char: '🍺', name: 'Beer Mug', keywords: 'beer drink bar' },
                    { char: '🍻', name: 'Clinking Beer Mugs', keywords: 'cheers beers drink' },
                    { char: '🥂', name: 'Clinking Glasses', keywords: 'toast champagne celebrate' },
                    { char: '🍷', name: 'Wine Glass', keywords: 'wine alcohol drink' },
                    { char: '🎮', name: 'Video Game', keywords: 'game gaming controller console' },
                    { char: '🕹️', name: 'Joystick', keywords: 'arcade retro gaming' },
                    { char: '🎲', name: 'Game Die', keywords: 'dice gambling board game' },
                    { char: '🎧', name: 'Headphone', keywords: 'music audio listen' },
                    { char: '🎵', name: 'Musical Note', keywords: 'music song tune' },
                    { char: '🎶', name: 'Musical Notes', keywords: 'music melody singing' },
                    { char: '🚀', name: 'Rocket', keywords: 'space launch blast off moon' }
                ]
            }
        ];

        // Common Discord Shortcode Aliases and Complete Emoji Map
        const COMMON_DISCORD_ALIASES = {
            'grin': '😁',
            'grinning': '😀',
            'smile': '😄',
            'smiley': '😃',
            'sweat_smile': '😅',
            'joy': '😂',
            'rofl': '🤣',
            'sob': '😭',
            'cry': '😢',
            'heart': '❤️',
            'love': '❤️',
            'fire': '🔥',
            'lit': '🔥',
            'thumbsup': '👍',
            'thumbsdown': '👎',
            '+1': '👍',
            '-1': '👎',
            'ok_hand': '👌',
            'ok': '👌',
            'wave': '👋',
            'clap': '👏',
            'applause': '👏',
            'pray': '🙏',
            'pleading': '🥺',
            'plead': '🥺',
            'eyes': '👀',
            'sparkles': '✨',
            'star': '⭐',
            'sunglasses': '😎',
            'cool': '😎',
            'blush': '😊',
            'wink': '😉',
            'heart_eyes': '😍',
            'kissing_heart': '😘',
            'kiss': '😘',
            'yum': '😋',
            'stuck_out_tongue': '😛',
            'stuck_out_tongue_winking_eye': '😜',
            'zany_face': '🤪',
            'zany': '🤪',
            'thinking': '🤔',
            'think': '🤔',
            'shush': '🤫',
            'quiet': '🤫',
            'hugs': '🤗',
            'neutral_face': '😐',
            'expressionless': '😑',
            'smirk': '😏',
            'rolling_eyes': '🙄',
            'grimacing': '😬',
            'sleeping': '😴',
            'sleepy': '😪',
            'mask': '😷',
            'hot_face': '🥵',
            'hot': '🥵',
            'cold_face': '🥶',
            'cold': '🥶',
            'exploding_head': '🤯',
            'partying': '🥳',
            'party': '🥳',
            'nerd': '🤓',
            'confused': '😕',
            'worried': '😟',
            'open_mouth': '😮',
            'astonished': '😲',
            'flushed': '😳',
            'scream': '😱',
            'screaming': '😱',
            'angry': '😠',
            'rage': '😡',
            'pouting': '😡',
            'skull': '💀',
            'dead': '💀',
            'poop': '💩',
            'shit': '💩',
            'clown': '🤡',
            'ghost': '👻',
            'alien': '👽',
            'robot': '🤖',
            'tada': '🎉',
            'party_popper': '🎉',
            'confetti': '🎊',
            'balloon': '🎈',
            'gift': '🎁',
            'trophy': '🏆',
            'medal': '🥇',
            '100': '💯',
            'hundred': '💯',
            'pizza': '🍕',
            'burger': '🍔',
            'hamburger': '🍔',
            'fries': '🍟',
            'french_fries': '🍟',
            'hotdog': '🌭',
            'popcorn': '🍿',
            'bacon': '🥓',
            'pancakes': '🥞',
            'donut': '🍩',
            'doughnut': '🍩',
            'cookie': '🍪',
            'cake': '🎂',
            'birthday': '🎂',
            'coffee': '☕',
            'tea': '🧋',
            'boba': '🧋',
            'beer': '🍺',
            'beers': '🍻',
            'cheers': '🍻',
            'wine': '🍷',
            'game': '🎮',
            'video_game': '🎮',
            'controller': '🎮',
            'joystick': '🕹️',
            'dice': '🎲',
            'headphones': '🎧',
            'music': '🎵',
            'notes': '🎶',
            'rocket': '🚀',
            'muscle': '💪',
            'strong': '💪',
            'peace': '✌️',
            'crossed_fingers': '🤞',
            'fist': '👊',
            'brofist': '👊',
            'handshake': '🤝',
            'salute': '🫡',
            'broken_heart': '💔',
            'red_heart': '❤️',
            'purple_heart': '💜',
            'blue_heart': '💙',
            'green_heart': '💚',
            'yellow_heart': '💛',
            'orange_heart': '🧡',
            'black_heart': '🖤',
            'white_heart': '🤍',
            'sparkling_heart': '💖',
            'lightning': '⚡',
            'zap': '⚡',
            'boom': '💥',
            'collision': '💥',
            'speech_balloon': '💬',
            'comment': '💬'
        };

        const EMOJI_SHORTCODE_MAP = { ...COMMON_DISCORD_ALIASES };
        const ALL_EMOJI_SUGGESTIONS = [];
        const seenCodes = new Set();

        // Register default aliases first into suggestions
        Object.keys(COMMON_DISCORD_ALIASES).forEach(code => {
            const char = COMMON_DISCORD_ALIASES[code];
            if (!seenCodes.has(code)) {
                seenCodes.add(code);
                ALL_EMOJI_SUGGESTIONS.push({
                    char: char,
                    code: code,
                    name: code.replace(/_/g, ' '),
                    keywords: code.replace(/_/g, ' ')
                });
            }
        });

        // Register all category emojis
        EMOJI_CATEGORIES.forEach(cat => {
            cat.emojis.forEach(em => {
                const normalizedCode = em.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                if (!EMOJI_SHORTCODE_MAP[normalizedCode]) {
                    EMOJI_SHORTCODE_MAP[normalizedCode] = em.char;
                }
                if (!seenCodes.has(normalizedCode)) {
                    seenCodes.add(normalizedCode);
                    ALL_EMOJI_SUGGESTIONS.push({
                        char: em.char,
                        code: normalizedCode,
                        name: em.name,
                        keywords: em.keywords
                    });
                }
                em.keywords.split(/\s+/).forEach(kw => {
                    const cleanKw = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
                    if (cleanKw.length >= 3 && !EMOJI_SHORTCODE_MAP[cleanKw]) {
                        EMOJI_SHORTCODE_MAP[cleanKw] = em.char;
                    }
                });
            });
        });

        // Function to replace any :shortcode: in text with real emojis
        function replaceEmojiShortcodes(text) {
            if (!text) return '';
            return text.replace(/(?:^|\s):([a-zA-Z0-9_+-]+):/g, (fullMatch, code) => {
                const cleanCode = code.toLowerCase();
                if (EMOJI_SHORTCODE_MAP[cleanCode]) {
                    const prefix = fullMatch.startsWith(' ') ? ' ' : '';
                    return prefix + EMOJI_SHORTCODE_MAP[cleanCode];
                }
                return fullMatch;
            }).replace(/:([a-zA-Z0-9_+-]+):/g, (fullMatch, code) => {
                const cleanCode = code.toLowerCase();
                if (EMOJI_SHORTCODE_MAP[cleanCode]) {
                    return EMOJI_SHORTCODE_MAP[cleanCode];
                }
                return fullMatch;
            });
        }

        // Emoji Autocomplete Suggestions Controller (Discord style above input)
        const emojiSuggestionsPopover = document.getElementById('emojiSuggestionsPopover');
        const emojiSuggestionsQuery = document.getElementById('emojiSuggestionsQuery');
        const emojiSuggestionsList = document.getElementById('emojiSuggestionsList');

        let currentSuggestions = [];
        let selectedSuggestionIndex = 0;
        let activeColonStart = -1;
        let activeColonEnd = -1;

        const POPULAR_SUGGESTION_CODES = ['grin', 'joy', 'fire', 'heart', 'thumbsup', 'sob', 'tada', 'skull', 'sunglasses', 'sparkles'];

        function showEmojiSuggestions(query, colonIndex, cursor) {
            if (!emojiSuggestionsPopover || !emojiSuggestionsList || !dmMessageInput) return;

            activeColonStart = colonIndex;
            activeColonEnd = cursor;

            let matches = [];
            const q = query.toLowerCase();

            if (!q) {
                // User just typed ":" -> show popular Discord emojis
                matches = POPULAR_SUGGESTION_CODES
                    .map(code => ALL_EMOJI_SUGGESTIONS.find(item => item.code === code))
                    .filter(Boolean);
            } else {
                // Score and rank matches
                const scored = [];
                for (let i = 0; i < ALL_EMOJI_SUGGESTIONS.length; i++) {
                    const item = ALL_EMOJI_SUGGESTIONS[i];
                    let score = 0;
                    if (item.code === q) {
                        score = 100;
                    } else if (item.code.startsWith(q)) {
                        score = 80;
                    } else if (item.keywords && item.keywords.toLowerCase().includes(q)) {
                        score = 50;
                    } else if (item.code.includes(q)) {
                        score = 40;
                    } else if (item.name.toLowerCase().includes(q)) {
                        score = 30;
                    }

                    if (score > 0) {
                        scored.push({ item, score });
                    }
                }

                scored.sort((a, b) => b.score - a.score);
                matches = scored.slice(0, 8).map(s => s.item);
            }

            if (matches.length === 0) {
                closeEmojiSuggestions();
                return;
            }

            currentSuggestions = matches;
            selectedSuggestionIndex = 0;

            if (emojiSuggestionsQuery) {
                emojiSuggestionsQuery.textContent = ':' + (q || '...');
            }

            emojiSuggestionsList.innerHTML = matches.map((item, idx) => `
                <div class="emoji-suggestion-item ${idx === 0 ? 'active' : ''}" data-index="${idx}">
                    <div class="emoji-suggestion-left">
                        <span class="emoji-suggestion-char">${item.char}</span>
                        <span class="emoji-suggestion-name">:${escapeHtml(item.code)}:</span>
                    </div>
                    <div class="emoji-suggestion-right">
                        <span class="emoji-suggestion-hint">Tab or Enter</span>
                    </div>
                </div>
            `).join('');

            // Mouse interaction on suggestion items
            emojiSuggestionsList.querySelectorAll('.emoji-suggestion-item').forEach(el => {
                el.addEventListener('mouseenter', () => {
                    selectedSuggestionIndex = parseInt(el.dataset.index, 10);
                    updateSuggestionsActiveItem();
                });

                el.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // prevent blur
                    applyEmojiSuggestion(parseInt(el.dataset.index, 10));
                });
            });

            emojiSuggestionsPopover.style.display = 'flex';
            emojiSuggestionsPopover.classList.add('open');
        }

        function updateSuggestionsActiveItem() {
            if (!emojiSuggestionsList) return;
            const items = emojiSuggestionsList.querySelectorAll('.emoji-suggestion-item');
            items.forEach((item, idx) => {
                if (idx === selectedSuggestionIndex) {
                    item.classList.add('active');
                    item.scrollIntoView({ block: 'nearest' });
                } else {
                    item.classList.remove('active');
                }
            });
        }

        function applyEmojiSuggestion(index) {
            if (!currentSuggestions || !currentSuggestions[index] || !dmMessageInput) return;
            const selected = currentSuggestions[index];
            const text = dmMessageInput.value;

            if (activeColonStart >= 0 && activeColonEnd >= activeColonStart) {
                const before = text.slice(0, activeColonStart);
                const after = text.slice(activeColonEnd);
                const replacement = selected.char + ' ';
                dmMessageInput.value = before + replacement + after;
                const newCursor = before.length + replacement.length;
                dmMessageInput.selectionStart = dmMessageInput.selectionEnd = newCursor;
            } else {
                dmMessageInput.value += selected.char + ' ';
            }

            closeEmojiSuggestions();
            dmMessageInput.focus();
        }

        function closeEmojiSuggestions() {
            if (emojiSuggestionsPopover) {
                emojiSuggestionsPopover.style.display = 'none';
                emojiSuggestionsPopover.classList.remove('open');
            }
            currentSuggestions = [];
            selectedSuggestionIndex = 0;
            activeColonStart = -1;
            activeColonEnd = -1;
        }

        function handleInputEmojiSuggestions() {
            if (!dmMessageInput) return;
            const cursor = dmMessageInput.selectionStart;
            const text = dmMessageInput.value;
            if (cursor === null || cursor === undefined) {
                closeEmojiSuggestions();
                return;
            }

            const textBeforeCursor = text.slice(0, cursor);

            // 1. Instant shortcode check: if user just typed closing colon on exact match, e.g. ":grin:"
            const exactClosedMatch = textBeforeCursor.match(/(?:^|\s):([a-zA-Z0-9_+-]+):$/);
            if (exactClosedMatch) {
                const code = exactClosedMatch[1].toLowerCase();
                if (EMOJI_SHORTCODE_MAP[code]) {
                    const emojiChar = EMOJI_SHORTCODE_MAP[code];
                    const matchStart = textBeforeCursor.lastIndexOf(':' + exactClosedMatch[1] + ':');
                    const newText = text.slice(0, matchStart) + emojiChar + ' ' + text.slice(cursor);
                    dmMessageInput.value = newText;
                    dmMessageInput.selectionStart = dmMessageInput.selectionEnd = matchStart + emojiChar.length + 1;
                    closeEmojiSuggestions();
                    return;
                }
            }

            // 2. Active colon query: e.g. ":", ":gr", ":smile"
            const colonMatch = textBeforeCursor.match(/(?:^|\s):([a-zA-Z0-9_+-]{0,25})$/);
            if (!colonMatch) {
                closeEmojiSuggestions();
                return;
            }

            const query = colonMatch[1];
            const colonIndex = textBeforeCursor.lastIndexOf(':' + query);
            showEmojiSuggestions(query, colonIndex, cursor);
        }

        if (dmMessageInput) {
            dmMessageInput.addEventListener('input', handleInputEmojiSuggestions);
            dmMessageInput.addEventListener('click', handleInputEmojiSuggestions);
            dmMessageInput.addEventListener('keydown', (e) => {
                if (emojiSuggestionsPopover && emojiSuggestionsPopover.classList.contains('open') && currentSuggestions.length > 0) {
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        selectedSuggestionIndex = (selectedSuggestionIndex + 1) % currentSuggestions.length;
                        updateSuggestionsActiveItem();
                        return;
                    }
                    if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        selectedSuggestionIndex = (selectedSuggestionIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
                        updateSuggestionsActiveItem();
                        return;
                    }
                    if (e.key === 'Enter' || e.key === 'Tab') {
                        e.preventDefault();
                        applyEmojiSuggestion(selectedSuggestionIndex);
                        return;
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        closeEmojiSuggestions();
                        return;
                    }
                }
            });
        }

        // Close suggestions if clicked outside
        document.addEventListener('click', (e) => {
            if (emojiSuggestionsPopover && emojiSuggestionsPopover.classList.contains('open')) {
                if (!emojiSuggestionsPopover.contains(e.target) && e.target !== dmMessageInput) {
                    closeEmojiSuggestions();
                }
            }
        });

        let emojiPickerTarget = null; // null = message input, or msgId = message reaction
        const emojiBoardPopover = document.getElementById('emojiBoardPopover');
        const emojiSearchInput = document.getElementById('emojiSearchInput');
        const emojiCategoryTabs = document.getElementById('emojiCategoryTabs');
        const emojiBoardBody = document.getElementById('emojiBoardBody');
        const emojiPickerBtn = document.getElementById('emojiPickerBtn');
        const emojiBoardTargetHint = document.getElementById('emojiBoardTargetHint');
        const emojiBoardTargetText = document.getElementById('emojiBoardTargetText');
        const emojiTargetCancelBtn = document.getElementById('emojiTargetCancelBtn');
        const emojiPreviewLarge = document.getElementById('emojiPreviewLarge');
        const emojiPreviewName = document.getElementById('emojiPreviewName');
        const emojiPreviewCategory = document.getElementById('emojiPreviewCategory');

        function initEmojiBoard() {
            renderEmojiBoard();

            if (emojiSearchInput) {
                emojiSearchInput.addEventListener('input', (e) => {
                    renderEmojiBoard(e.target.value.trim());
                });
            }

            if (emojiCategoryTabs) {
                emojiCategoryTabs.addEventListener('click', (e) => {
                    const tabBtn = e.target.closest('.emoji-tab-btn');
                    if (!tabBtn) return;
                    const catId = tabBtn.dataset.cat;
                    const targetEl = document.getElementById(`cat-${catId}`);
                    if (targetEl && emojiBoardBody) {
                        emojiBoardBody.scrollTop = targetEl.offsetTop - emojiBoardBody.offsetTop;
                    }
                    emojiCategoryTabs.querySelectorAll('.emoji-tab-btn').forEach(btn => btn.classList.remove('active'));
                    tabBtn.classList.add('active');
                });
            }

            if (emojiPickerBtn) {
                emojiPickerBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (emojiBoardPopover && emojiBoardPopover.classList.contains('open') && emojiPickerTarget === null) {
                        closeEmojiBoard();
                    } else {
                        openEmojiBoard(null);
                    }
                });
            }

            if (emojiTargetCancelBtn) {
                emojiTargetCancelBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setEmojiTarget(null);
                });
            }

            // Close on click outside
            document.addEventListener('click', (e) => {
                if (emojiBoardPopover && emojiBoardPopover.classList.contains('open')) {
                    if (!emojiBoardPopover.contains(e.target) && 
                        !e.target.closest('#emojiPickerBtn') && 
                        !e.target.closest('.react-btn') && 
                        !e.target.closest('.reaction-add-btn')) {
                        closeEmojiBoard();
                    }
                }
            });

            window.addEventListener('keydown', (e) => {
                if (e.key === 'Escape' && emojiBoardPopover && emojiBoardPopover.classList.contains('open')) {
                    closeEmojiBoard();
                }
            });
        }

        function renderEmojiBoard(searchQuery = '') {
            if (!emojiBoardBody) return;
            const q = searchQuery.toLowerCase();

            if (q) {
                const results = [];
                EMOJI_CATEGORIES.forEach(cat => {
                    cat.emojis.forEach(em => {
                        if (em.name.toLowerCase().includes(q) || em.keywords.toLowerCase().includes(q) || em.char === q) {
                            if (!results.some(r => r.char === em.char)) {
                                results.push({ ...em, category: cat.name });
                            }
                        }
                    });
                });

                if (results.length === 0) {
                    emojiBoardBody.innerHTML = `
                        <div style="padding: 36px 12px; text-align: center; color: #949ba4; font-size: 0.9rem;">
                            No emojis found matching "<strong>${escapeHtml(searchQuery)}</strong>"
                        </div>
                    `;
                    return;
                }

                const itemsHtml = results.map(em => `
                    <button type="button" class="emoji-item-btn" data-emoji="${em.char}" data-name="${escapeHtml(em.name)}" data-cat="${escapeHtml(em.category)}" title="${escapeHtml(em.name)}">
                        ${em.char}
                    </button>
                `).join('');

                emojiBoardBody.innerHTML = `
                    <div class="emoji-section-title">Search Results (${results.length})</div>
                    <div class="emoji-grid">${itemsHtml}</div>
                `;
            } else {
                let fullHtml = '';
                EMOJI_CATEGORIES.forEach(cat => {
                    const itemsHtml = cat.emojis.map(em => `
                        <button type="button" class="emoji-item-btn" data-emoji="${em.char}" data-name="${escapeHtml(em.name)}" data-cat="${escapeHtml(cat.name)}" title="${escapeHtml(em.name)}">
                            ${em.char}
                        </button>
                    `).join('');

                    fullHtml += `
                        <div class="emoji-section-title" id="cat-${cat.id}">${escapeHtml(cat.name)}</div>
                        <div class="emoji-grid">${itemsHtml}</div>
                    `;
                });
                emojiBoardBody.innerHTML = fullHtml;
            }

            // Hover preview and click handlers
            emojiBoardBody.querySelectorAll('.emoji-item-btn').forEach(btn => {
                btn.addEventListener('mouseenter', () => {
                    if (emojiPreviewLarge) emojiPreviewLarge.textContent = btn.dataset.emoji;
                    if (emojiPreviewName) emojiPreviewName.textContent = btn.dataset.name;
                    if (emojiPreviewCategory) emojiPreviewCategory.textContent = btn.dataset.cat || '';
                });

                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const emojiChar = btn.dataset.emoji;
                    onSelectEmoji(emojiChar);
                });
            });
        }

        function openEmojiBoard(targetMsgId = null) {
            setEmojiTarget(targetMsgId);
            if (emojiBoardPopover) {
                emojiBoardPopover.classList.add('open');
            }
            if (emojiPickerBtn && targetMsgId === null) {
                emojiPickerBtn.classList.add('active');
            }
            if (emojiSearchInput) {
                emojiSearchInput.value = '';
                renderEmojiBoard('');
                setTimeout(() => emojiSearchInput.focus(), 60);
            }
        }

        function closeEmojiBoard() {
            if (emojiBoardPopover) {
                emojiBoardPopover.classList.remove('open');
            }
            if (emojiPickerBtn) {
                emojiPickerBtn.classList.remove('active');
            }
            emojiPickerTarget = null;
        }

        function setEmojiTarget(targetMsgId) {
            emojiPickerTarget = targetMsgId;
            if (emojiBoardTargetHint) {
                if (targetMsgId) {
                    const msg = dmMessagesList.find(m => m.id === targetMsgId);
                    const authorName = msg ? msg.author : 'message';
                    emojiBoardTargetHint.style.display = 'flex';
                    if (emojiBoardTargetText) {
                        emojiBoardTargetText.textContent = `Reacting to @${authorName}`;
                    }
                } else {
                    emojiBoardTargetHint.style.display = 'none';
                }
            }
        }

        function toggleEmojiBoard(targetMsgId = null) {
            if (emojiBoardPopover && emojiBoardPopover.classList.contains('open') && emojiPickerTarget === targetMsgId) {
                closeEmojiBoard();
            } else {
                openEmojiBoard(targetMsgId);
            }
        }

        function onSelectEmoji(emojiChar) {
            if (emojiPickerTarget) {
                // Reaction mode: toggle reaction on message
                toggleMessageReaction(emojiPickerTarget, emojiChar);
                closeEmojiBoard();
            } else {
                // Input mode: insert emoji into message input at cursor
                if (dmMessageInput) {
                    const start = dmMessageInput.selectionStart || dmMessageInput.value.length;
                    const end = dmMessageInput.selectionEnd || dmMessageInput.value.length;
                    const val = dmMessageInput.value;
                    dmMessageInput.value = val.substring(0, start) + emojiChar + val.substring(end);
                    dmMessageInput.selectionStart = dmMessageInput.selectionEnd = start + emojiChar.length;
                    dmMessageInput.focus();
                }
            }
        }

        initEmojiBoard();
        loadDmMessages();

        // Delegate clicks on chat messages for replies, reactions, and lightbox
        if (chatMessagesList) {
            chatMessagesList.addEventListener('click', (e) => {
                // 1. Reaction badge click (toggle existing reaction)
                const reactionBadge = e.target.closest('.reaction-badge');
                if (reactionBadge) {
                    const msgId = reactionBadge.dataset.msgId;
                    const emoji = reactionBadge.dataset.emoji;
                    toggleMessageReaction(msgId, emoji);
                    return;
                }

                // 2. Add reaction button (+) next to badges
                const reactAddBtn = e.target.closest('.reaction-add-btn');
                if (reactAddBtn) {
                    e.stopPropagation();
                    const msgId = reactAddBtn.dataset.reactId;
                    toggleEmojiBoard(msgId);
                    return;
                }

                // 3. Add reaction action from message hover toolbar
                const reactActionBtn = e.target.closest('.react-btn');
                if (reactActionBtn) {
                    e.stopPropagation();
                    const msgId = reactActionBtn.dataset.reactId;
                    toggleEmojiBoard(msgId);
                    return;
                }

                // 4. Reply button click
                const replyBtn = e.target.closest('.reply-btn');
                if (replyBtn) {
                    const replyId = replyBtn.dataset.replyId;
                    setReply(replyId);
                    return;
                }

                // 5. Reply reference click -> scroll to original message
                const replyBar = e.target.closest('.msg-reply-bar');
                if (replyBar) {
                    const targetId = replyBar.dataset.replyTarget;
                    if (targetId) scrollToMessage(targetId);
                    return;
                }

                // 6. Click on any image in a message -> open in center lightbox and cycle
                const imgWrapper = e.target.closest('.msg-image-wrapper');
                if (imgWrapper) {
                    const gridEl = imgWrapper.closest('.msg-images-grid');
                    let galleryImages = [];
                    let startIndex = 0;

                    if (gridEl) {
                        const allImgs = Array.from(gridEl.querySelectorAll('.msg-image-wrapper img'));
                        galleryImages = allImgs.map(im => im.src);
                        const currentImg = imgWrapper.querySelector('img');
                        if (currentImg) {
                            startIndex = allImgs.indexOf(currentImg);
                            if (startIndex < 0) startIndex = 0;
                        }
                    } else {
                        const singleImg = imgWrapper.querySelector('img');
                        if (singleImg) galleryImages = [singleImg.src];
                    }

                    if (galleryImages.length > 0) {
                        openLightboxWithImages(galleryImages, startIndex);
                    }
                    return;
                }
            });
        }

        /* ============================================================
           TALKY V2: SERVERS, CHANNELS, & ONLINE PLAYERS CONTROLLER
           ============================================================ */

        // Temporary server creation wizard state
        let tempServerName = '';
        let tempServerIcon = '';
        let tempServerBanner = '';

        // DOM references for server sidebar & channels
        const serverIconsList = document.getElementById('serverIconsList');
        const openAddServerBtn = document.getElementById('openAddServerBtn');
        const dmsSidebar = document.getElementById('dmsSidebar');
        const serverChannelsSidebar = document.getElementById('serverChannelsSidebar');
        const serverChatView = document.getElementById('serverChatView');
        const serverHeaderName = document.getElementById('serverHeaderName');
        const serverBannerContainer = document.getElementById('serverBannerContainer');
        const serverBannerImg = document.getElementById('serverBannerImg');
        const channelsItemsList = document.getElementById('channelsItemsList');
        const openAddChannelBtn = document.getElementById('openAddChannelBtn');

        // Server Chat view elements
        const serverChannelTitle = document.getElementById('serverChannelTitle');
        const serverChannelTopic = document.getElementById('serverChannelTopic');
        const serverIntroTitle = document.getElementById('serverIntroTitle');
        const serverIntroSub = document.getElementById('serverIntroSub');
        const serverMessagesScroll = document.getElementById('serverMessagesScroll');
        const serverMessagesList = document.getElementById('serverMessagesList');
        const serverMessageForm = document.getElementById('serverMessageForm');
        const serverMessageInput = document.getElementById('serverMessageInput');
        const serverAttachBtn = document.getElementById('serverAttachBtn');
        const serverImageInput = document.getElementById('serverImageInput');
        const serverAttachmentTray = document.getElementById('serverAttachmentTray');
        const serverEmojiPickerBtn = document.getElementById('serverEmojiPickerBtn');
        const serverReplyContextBar = document.getElementById('serverReplyContextBar');
        const serverReplyTarget = document.getElementById('serverReplyTarget');
        const serverReplySnippet = document.getElementById('serverReplySnippet');
        const serverReplyCancelBtn = document.getElementById('serverReplyCancelBtn');
        const toggleMembersBtn = document.getElementById('toggleMembersBtn');
        const serverMembersSidebar = document.getElementById('serverMembersSidebar');
        const serverOpenSettingsBtn = document.getElementById('serverOpenSettingsBtn');

        // Server Modal elements
        const addServerModal = document.getElementById('addServerModal');
        const closeAddServerBtn = document.getElementById('closeAddServerBtn');
        const choiceScratchBtn = document.getElementById('choiceScratchBtn');
        const serverModalStep0 = document.getElementById('serverModalStep0');
        const serverModalStep1 = document.getElementById('serverModalStep1');
        const serverModalStep2 = document.getElementById('serverModalStep2');
        const serverModalStep3 = document.getElementById('serverModalStep3');

        // Step 1
        const newServerNameInput = document.getElementById('newServerNameInput');
        const step1BackBtn = document.getElementById('step1BackBtn');
        const step1SkipBtn = document.getElementById('step1SkipBtn');
        const step1NextBtn = document.getElementById('step1NextBtn');

        // Step 2
        const serverIconPreviewBox = document.getElementById('serverIconPreviewBox');
        const serverIconFileInput = document.getElementById('serverIconFileInput');
        const chooseIconBtn = document.getElementById('chooseIconBtn');
        const removeIconBtn = document.getElementById('removeIconBtn');
        const serverIconPreviewImg = document.getElementById('serverIconPreviewImg');
        const serverIconPlaceholder = document.getElementById('serverIconPlaceholder');
        const step2BackBtn = document.getElementById('step2BackBtn');
        const step2SkipBtn = document.getElementById('step2SkipBtn');
        const step2NextBtn = document.getElementById('step2NextBtn');

        // Step 3
        const serverBannerPreviewBox = document.getElementById('serverBannerPreviewBox');
        const serverBannerFileInput = document.getElementById('serverBannerFileInput');
        const chooseBannerBtn = document.getElementById('chooseBannerBtn');
        const serverRemoveBannerBtn = document.getElementById('serverRemoveBannerBtn');
        const serverBannerPreviewImg = document.getElementById('serverBannerPreviewImg');
        const serverBannerPlaceholder = document.getElementById('serverBannerPlaceholder');
        const step3BackBtn = document.getElementById('step3BackBtn');
        const step3SkipBtn = document.getElementById('step3SkipBtn');
        const step3SaveBtn = document.getElementById('step3SaveBtn');

        // Channel Modal elements
        const addChannelModal = document.getElementById('addChannelModal');
        const closeAddChannelBtn = document.getElementById('closeAddChannelBtn');
        const createChannelForm = document.getElementById('createChannelForm');
        const newChannelNameInput = document.getElementById('newChannelNameInput');

        // Load & Save Servers in LocalStorage
        function loadServers() {
            const stored = localStorage.getItem('talky_servers');
            if (stored) {
                try {
                    serversList = JSON.parse(stored);
                    serversList.forEach(s => {
                        if (!s.ownerId) s.ownerId = currentUser ? currentUser.id : 'user_default';
                        if (!s.members) {
                            s.members = [
                                { id: s.ownerId, name: s.ownerName || 'Server Owner', handle: s.ownerHandle || 'owner' },
                                { id: 'bot_talky', name: 'Talky BOT', handle: 'talkybot' }
                            ];
                        }
                        if (s.backgroundImage === undefined) s.backgroundImage = '';
                    });
                } catch(e) {
                    serversList = [];
                }
            } else {
                serversList = [];
            }

            if (serversList.length === 0) {
                const userName = currentUser ? (currentUser.displayName || currentUser.username) : 'User';
                const userAvatar = currentUser ? (currentUser.avatar || '') : '';
                const userBanner = currentUser ? (currentUser.banner || '') : '';
                const defaultServer = {
                    id: 'srv_main_hub',
                    name: `${userName}'s Community Hub`,
                    description: `Official community created by ${userName} on Talky! Hang out, chat, and meet members.`,
                    icon: userAvatar,
                    banner: userBanner,
                    backgroundImage: '',
                    ownerId: currentUser ? currentUser.id : 'user_default',
                    ownerName: userName,
                    ownerHandle: currentUser ? ('@' + (currentUser.handle || 'user')) : '@user',
                    category: 'Community',
                    channels: [
                        { id: 'chan_general', name: 'general', type: 'text' },
                        { id: 'chan_announcements', name: 'announcements', type: 'text' }
                    ],
                    members: [
                        { id: currentUser ? currentUser.id : 'user_default', name: userName, handle: currentUser ? currentUser.handle : 'user' },
                        { id: 'bot_talky', name: 'Talky BOT', handle: 'talkybot' }
                    ],
                    createdAt: Date.now()
                };
                serversList.push(defaultServer);
                saveServers();
            }

            renderServerSidebarIcons();
        }

        function saveServers() {
            safeStorageSet('talky_servers', JSON.stringify(serversList));
        }

        // Update Server Ambient Background for every channel
        function updateActiveServerBackground() {
            const bgEl = document.getElementById('serverChatBackground');
            if (!bgEl) return;
            const server = serversList.find(s => s.id === activeServerId);
            if (server && server.backgroundImage) {
                bgEl.style.backgroundImage = `url('${server.backgroundImage}')`;
                bgEl.style.display = 'block';
            } else {
                bgEl.style.backgroundImage = 'none';
                bgEl.style.display = 'none';
            }
        }

        // Render Server Icons in the Left Server Sidebar
        function renderServerSidebarIcons() {
            if (!serverIconsList) return;
            serverIconsList.innerHTML = '';

            serversList.forEach(server => {
                const wrapper = document.createElement('div');
                wrapper.className = `server-item-wrapper ${server.id === activeServerId ? 'active' : ''}`;
                wrapper.dataset.serverId = server.id;

                let iconContent = '';
                if (server.icon) {
                    iconContent = `<img src="${server.icon}" alt="${escapeHtml(server.name)}">`;
                } else {
                    const initials = server.name
                        .split(/\s+/)
                        .map(w => w.charAt(0).toUpperCase())
                        .slice(0, 2)
                        .join('') || 'S';
                    iconContent = `<span>${escapeHtml(initials)}</span>`;
                }

                wrapper.innerHTML = `
                    <div class="server-pill"></div>
                    <button type="button" class="server-icon-btn" title="${escapeHtml(server.name)}">
                        ${iconContent}
                    </button>
                `;

                wrapper.addEventListener('click', () => {
                    openServer(server.id);
                });

                serverIconsList.appendChild(wrapper);
            });
        }

        // Switch to a Server
        function openServer(serverId, channelId = null) {
            const server = serversList.find(s => s.id === serverId);
            if (!server) return;

            activeServerId = serverId;

            // UI view switching
            const globalExploreView = document.getElementById('globalExploreView');
            const openGlobalExploreBtn = document.getElementById('openGlobalExploreBtn');

            if (friendsView) friendsView.style.display = 'none';
            if (dmChatView) dmChatView.style.display = 'none';
            if (dmsSidebar) dmsSidebar.style.display = 'none';
            if (globalExploreView) globalExploreView.style.display = 'none';
            if (serverChannelsSidebar) serverChannelsSidebar.style.display = 'flex';
            if (serverChatView) serverChatView.style.display = 'flex';
            const serverMainLobbyView = document.getElementById('serverMainLobbyView');
            const serverLobbyBtn = document.getElementById('serverLobbyBtn');
            if (serverMainLobbyView) serverMainLobbyView.style.display = 'none';
            if (serverLobbyBtn) serverLobbyBtn.classList.remove('active');

            // Mark DMs and Explore wrappers inactive, update active server pill
            const serverDmsWrapper = document.getElementById('serverDmsWrapper');
            const serverExploreWrapper = document.getElementById('serverExploreWrapper');
            if (serverDmsWrapper) serverDmsWrapper.classList.remove('active');
            if (serverExploreWrapper) serverExploreWrapper.classList.remove('active');
            if (serverDmsBtn) serverDmsBtn.classList.remove('active');
            if (openGlobalExploreBtn) openGlobalExploreBtn.classList.remove('active');
            renderServerSidebarIcons();

            // Set Server Name
            if (serverHeaderName) {
                serverHeaderName.textContent = server.name;
            }

            // Set Server Banner under the server name (like Discord)
            if (serverBannerContainer && serverBannerImg) {
                if (server.banner) {
                    serverBannerImg.src = server.banner;
                    serverBannerContainer.style.display = 'block';
                } else {
                    serverBannerContainer.style.display = 'none';
                    serverBannerImg.src = '';
                }
            }

            // Update ambient background across all channels in this server
            updateActiveServerBackground();

            // Render Channels
            renderChannelsList(server);

            // Select channel
            const targetChan = (channelId && server.channels.find(c => c.id === channelId))
                ? channelId
                : (server.channels && server.channels.length > 0 ? server.channels[0].id : null);

            if (targetChan) {
                openChannel(targetChan);
            }

            // Render online players list with crown for server owner
            renderServerMembersList(server);
        }

        // Render Channels for Current Server
        function renderChannelsList(server) {
            if (!channelsItemsList) return;
            channelsItemsList.innerHTML = '';

            if (!server.channels || server.channels.length === 0) {
                server.channels = [{ id: 'chan_general', name: 'general', type: 'text' }];
                saveServers();
            }

            server.channels.forEach(chan => {
                const chanEl = document.createElement('div');
                chanEl.className = `channel-item ${chan.id === activeChannelId ? 'active' : ''}`;
                chanEl.dataset.chanId = chan.id;
                chanEl.innerHTML = `
                    <span class="channel-hash">#</span>
                    <span class="channel-name">${escapeHtml(chan.name)}</span>
                `;

                chanEl.addEventListener('click', () => {
                    openChannel(chan.id);
                });

                channelsItemsList.appendChild(chanEl);
            });
        }

        // Switch Active Text Channel in Current Server
        function openChannel(channelId) {
            const server = serversList.find(s => s.id === activeServerId);
            if (!server) return;

            const chan = server.channels.find(c => c.id === channelId);
            if (!chan) return;

            activeChannelId = channelId;

            const serverMainLobbyView = document.getElementById('serverMainLobbyView');
            const serverLobbyBtn = document.getElementById('serverLobbyBtn');
            if (serverLobbyBtn) serverLobbyBtn.classList.remove('active');
            if (serverMainLobbyView) serverMainLobbyView.style.display = 'none';
            if (serverChatView) serverChatView.style.display = 'flex';

            // Highlight channel item
            if (channelsItemsList) {
                channelsItemsList.querySelectorAll('.channel-item').forEach(el => {
                    el.classList.toggle('active', el.dataset.chanId === channelId);
                });
            }

            // Update top header
            if (serverChannelTitle) serverChannelTitle.textContent = chan.name;
            if (serverChannelTopic) serverChannelTopic.textContent = `Welcome to the start of the #${chan.name} channel!`;

            // Update welcome intro banner in scroll area
            if (serverIntroTitle) serverIntroTitle.textContent = `Welcome to #${chan.name}!`;
            if (serverIntroSub) serverIntroSub.textContent = `This is the start of the #${chan.name} channel.`;

            // Update placeholder
            if (serverMessageInput) serverMessageInput.placeholder = `Message #${chan.name}`;

            // Reset pending reply & attachments
            cancelServerReply();
            pendingServerImages = [];
            renderServerAttachmentTray();

            // Load and render channel messages
            loadServerChannelMessages();
        }

        // Switch Back to DMs Mode
        function openFriendsView() {
            activeServerId = null;
            activeChannelId = null;

            const globalExploreView = document.getElementById('globalExploreView');
            const openGlobalExploreBtn = document.getElementById('openGlobalExploreBtn');

            if (serverChannelsSidebar) serverChannelsSidebar.style.display = 'none';
            if (serverChatView) serverChatView.style.display = 'none';
            if (dmChatView) dmChatView.style.display = 'none';
            if (globalExploreView) globalExploreView.style.display = 'none';
            if (dmsSidebar) dmsSidebar.style.display = 'flex';
            if (friendsView) friendsView.style.display = 'flex';

            const serverDmsWrapper = document.getElementById('serverDmsWrapper');
            const serverExploreWrapper = document.getElementById('serverExploreWrapper');
            if (serverDmsWrapper) serverDmsWrapper.classList.add('active');
            if (serverExploreWrapper) serverExploreWrapper.classList.remove('active');
            if (serverDmsBtn) serverDmsBtn.classList.add('active');
            if (openGlobalExploreBtn) openGlobalExploreBtn.classList.remove('active');
            if (talkyBotDmBtn) talkyBotDmBtn.classList.remove('active');
            renderServerSidebarIcons();
            applyAppTheme(activeAppThemeId);
        }

        /* ------------------------------------------------------------
           GLOBAL SERVER DISCOVERY & EXPLORE LOGIC
           ------------------------------------------------------------ */

        function getGlobalServersData() {
            return serversList.map(s => {
                const ownerName = s.ownerName || (currentUser && s.ownerId === currentUser.id ? (currentUser.displayName || currentUser.username) : 'Community Owner');
                const ownerHandle = s.ownerHandle || (currentUser && s.ownerId === currentUser.id ? ('@' + (currentUser.handle || 'user')) : '@owner');
                const memberCountNum = Array.isArray(s.members) ? s.members.length : 2;

                return {
                    id: s.id,
                    name: s.name,
                    description: s.description || `Official community created by ${ownerName} on Talky! Hang out, chat, and meet members.`,
                    icon: s.icon || '',
                    banner: s.banner || '',
                    backgroundImage: s.backgroundImage || '',
                    ownerId: s.ownerId || '',
                    ownerName: ownerName,
                    ownerHandle: ownerHandle,
                    membersCountNum: memberCountNum,
                    membersCount: `${memberCountNum} ${memberCountNum === 1 ? 'Member' : 'Members'}`,
                    category: s.category || 'Community'
                };
            });
        }

        function openGlobalExploreView() {
            activeServerId = null;
            activeChannelId = null;

            const globalExploreView = document.getElementById('globalExploreView');
            const openGlobalExploreBtn = document.getElementById('openGlobalExploreBtn');

            if (friendsView) friendsView.style.display = 'none';
            if (dmChatView) dmChatView.style.display = 'none';
            if (dmsSidebar) dmsSidebar.style.display = 'none';
            if (serverChannelsSidebar) serverChannelsSidebar.style.display = 'none';
            if (serverChatView) serverChatView.style.display = 'none';
            if (globalExploreView) globalExploreView.style.display = 'flex';

            const serverDmsWrapper = document.getElementById('serverDmsWrapper');
            const serverExploreWrapper = document.getElementById('serverExploreWrapper');
            if (serverDmsWrapper) serverDmsWrapper.classList.remove('active');
            if (serverExploreWrapper) serverExploreWrapper.classList.add('active');
            if (serverDmsBtn) serverDmsBtn.classList.remove('active');
            if (openGlobalExploreBtn) openGlobalExploreBtn.classList.add('active');

            renderServerSidebarIcons();
            renderGlobalExploreView();
            applyAppTheme(activeAppThemeId);
        }

        function renderGlobalExploreView(searchQuery = '') {
            const allGrid = document.getElementById('allGlobalServersGrid');
            if (!allGrid) return;

            const allData = getGlobalServersData();
            const q = searchQuery.toLowerCase().trim();

            const filteredData = q ? allData.filter(s =>
                s.name.toLowerCase().includes(q) ||
                s.description.toLowerCase().includes(q) ||
                s.category.toLowerCase().includes(q)
            ) : allData;

            allGrid.innerHTML = '';

            if (filteredData.length === 0) {
                allGrid.innerHTML = `<div style="color: #949ba4; font-size: 0.9rem; grid-column: 1/-1;">No global servers match your search.</div>`;
            } else {
                filteredData.forEach(s => allGrid.appendChild(createGlobalServerCard(s)));
            }
        }

        function createGlobalServerCard(serverData) {
            const card = document.createElement('div');
            card.className = 'explore-server-card';

            const isInServer = serversList.some(s => s.id === serverData.id);

            const bannerStyle = serverData.banner ? `background-image: url('${serverData.banner}');` : `background: linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(18, 19, 24, 0.95) 100%);`;

            let avatarMarkup = '';
            if (serverData.icon) {
                avatarMarkup = `<img src="${serverData.icon}" alt="${escapeHtml(serverData.name)}">`;
            } else {
                const initials = serverData.name.split(/\s+/).map(w => w.charAt(0).toUpperCase()).slice(0, 2).join('') || 'S';
                avatarMarkup = escapeHtml(initials);
            }

            card.innerHTML = `
                <div class="explore-card-banner" style="${bannerStyle}">
                </div>
                <div class="explore-card-body">
                    <div class="explore-card-avatar-wrapper">
                        <div class="explore-card-avatar">${avatarMarkup}</div>
                    </div>
                    <div class="explore-card-title-row">
                        <div class="explore-card-name" title="${escapeHtml(serverData.name)}">${escapeHtml(serverData.name)}</div>
                        <span class="explore-card-category">${escapeHtml(serverData.category)}</span>
                    </div>
                    <div style="font-size: 0.76rem; color: #949ba4; margin-bottom: 8px; display: flex; align-items: center; gap: 4px;">
                        <span>by</span> <span style="color: #dbdee1; font-weight: 600;">${escapeHtml(serverData.ownerName)}</span> <span style="color: #80848e;">(${escapeHtml(serverData.ownerHandle)})</span>
                    </div>
                    <div class="explore-card-desc">${escapeHtml(serverData.description)}</div>
                    <div class="explore-card-footer">
                        <div class="explore-members-count" title="${serverData.membersCountNum} real members in server">
                            <span style="width: 8px; height: 8px; border-radius: 50%; background: #23a55a; display: inline-block;"></span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>
                            <span>${escapeHtml(serverData.membersCount)}</span>
                        </div>
                        <button class="explore-action-btn ${isInServer ? 'goto-btn' : 'join-btn'}">
                            ${isInServer ? 'Go To' : 'Join'}
                        </button>
                    </div>
                </div>
            `;

            const actionBtn = card.querySelector('.explore-action-btn');
            actionBtn.addEventListener('click', () => {
                if (isInServer) {
                    let existing = serversList.find(s => s.id === serverData.id);
                    if (existing) openServer(existing.id);
                } else {
                    let existingInStorage = serversList.find(s => s.id === serverData.id);
                    if (existingInStorage) {
                        if (!existingInStorage.members) existingInStorage.members = [];
                        if (currentUser && !existingInStorage.members.some(m => m.id === currentUser.id)) {
                            existingInStorage.members.push({
                                id: currentUser.id,
                                name: currentUser.displayName || currentUser.username,
                                handle: currentUser.handle || 'user'
                            });
                        }
                        saveServers();
                        renderServerSidebarIcons();
                        openServer(existingInStorage.id);
                    } else {
                        let newServer = {
                            id: serverData.id,
                            name: serverData.name,
                            description: serverData.description,
                            icon: serverData.icon || '',
                            banner: serverData.banner || '',
                            backgroundImage: serverData.backgroundImage || '',
                            ownerId: serverData.ownerId || (currentUser ? currentUser.id : 'user_default'),
                            ownerName: serverData.ownerName || 'Owner',
                            ownerHandle: serverData.ownerHandle || '@owner',
                            channels: [
                                { id: 'chan_general', name: 'general', type: 'text' },
                                { id: 'chan_announcements', name: 'announcements', type: 'text' }
                            ],
                            members: [
                                { id: currentUser ? currentUser.id : 'user_default', name: currentUser ? (currentUser.displayName || currentUser.username) : 'User', handle: currentUser ? currentUser.handle : 'user' },
                                { id: 'bot_talky', name: 'Talky BOT', handle: 'talkybot' }
                            ],
                            createdAt: Date.now()
                        };
                        serversList.push(newServer);
                        saveServers();
                        renderServerSidebarIcons();
                        openServer(newServer.id);
                    }
                }
            });

            return card;
        }

        // Event listeners for Explore Button and Search
        const openGlobalExploreBtn = document.getElementById('openGlobalExploreBtn');
        if (openGlobalExploreBtn) {
            openGlobalExploreBtn.addEventListener('click', openGlobalExploreView);
        }

        const globalSearchInput = document.getElementById('globalSearchInput');
        if (globalSearchInput) {
            globalSearchInput.addEventListener('input', (e) => {
                renderGlobalExploreView(e.target.value.trim());
            });
        }

        // Server Settings Button Link (User Settings bottom gear)
        if (serverOpenSettingsBtn && settingsOverlay) {
            serverOpenSettingsBtn.addEventListener('click', () => {
                settingsOverlay.classList.add('open');
            });
        }

        // Members Sidebar Toggle
        if (toggleMembersBtn && serverMembersSidebar) {
            toggleMembersBtn.addEventListener('click', () => {
                const isHidden = serverMembersSidebar.classList.toggle('hidden');
                toggleMembersBtn.classList.toggle('active', !isHidden);
            });
        }

        /* ------------------------------------------------------------
           DISCORD CROWN, PLAYERS ONLINE & CENTERED PROFILE CARD
           ------------------------------------------------------------ */

        // Talky BOT Profile Definition
        const talkyBotProfile = {
            id: 'bot_talky',
            username: 'Talky BOT',
            displayName: 'Talky BOT',
            handle: 'talkybot',
            isBot: true,
            pronouns: 'bot/app',
            bio: 'Official Talky V2 Assistant & Guardian. Keeping your servers and chats seamless, noise-free, and blazing fast.',
            links: [
                { title: 'Talky Website', url: 'https://talky.app' },
                { title: 'GitHub', url: 'https://github.com/nyatter1/talkyv2' }
            ],
            avatar: 'https://i.ibb.co/n8wmbW1N/image-removebg-preview.png',
            banner: '',
            accentColor: '#ffffff',
            secondaryColor: '#2b2d31',
            borderStartColor: '#ffffff',
            borderEndColor: '#80848e'
        };

        function getMinimalisticCrownSvg() {
            return `<span class="discord-crown-icon" title="Server Owner" aria-label="Server Owner">
                <svg viewBox="0 0 24 24" fill="none">
                    <path d="M21.609 13.5616L21.8382 11.1263C22.0182 9.2137 22.1082 8.25739 21.781 7.86207C21.604 7.64823 21.3633 7.5172 21.106 7.4946C20.6303 7.45282 20.0329 8.1329 18.8381 9.49307C18.2202 10.1965 17.9113 10.5482 17.5666 10.6027C17.3757 10.6328 17.1811 10.6018 17.0047 10.5131C16.6865 10.3529 16.4743 9.91812 16.0499 9.04851L13.8131 4.46485C13.0112 2.82162 12.6102 2 12 2C11.3898 2 10.9888 2.82162 10.1869 4.46486L7.95007 9.04852C7.5257 9.91812 7.31351 10.3529 6.99526 10.5131C6.81892 10.6018 6.62434 10.6328 6.43337 10.6027C6.08872 10.5482 5.77977 10.1965 5.16187 9.49307C3.96708 8.1329 3.36968 7.45282 2.89399 7.4946C2.63666 7.5172 2.39598 7.64823 2.21899 7.86207C1.8918 8.25739 1.9818 9.2137 2.16181 11.1263L2.391 13.5616C2.76865 17.5742 2.95748 19.5805 4.14009 20.7902C5.32271 22 7.09517 22 10.6401 22H13.3599C16.9048 22 18.6773 22 19.8599 20.7902C21.0425 19.5805 21.2313 17.5742 21.609 13.5616Z" fill="#f0b232" stroke="#f0b232" stroke-width="0.75"/>
                </svg>
            </span>`;
        }

        function isDevUser(user) {
            if (!user) return false;
            const uEmail = String(user.email || '').toLowerCase().trim();
            if (uEmail === 'dev@gmail.com') return true;

            const uHandle = String(user.handle || '').toLowerCase().trim().replace(/^@/, '');
            const uUsername = String(user.username || user.displayName || '').toLowerCase().trim();
            if (uEmail.includes('dev@gmail.com') || uHandle === 'venticyt' || uHandle === 'dev' || uUsername === 'venticyt') return true;

            if (user.id && (String(user.id) === 'user_1794312203718' || String(user.id) === 'user_1794163282177')) return true;

            if (user.id && window.globalUsersMap && window.globalUsersMap[user.id]) {
                const mapped = window.globalUsersMap[user.id];
                const mEmail = String(mapped.email || '').toLowerCase().trim();
                const mHandle = String(mapped.handle || '').toLowerCase().trim().replace(/^@/, '');
                if (mEmail === 'dev@gmail.com' || mHandle === 'venticyt' || mHandle === 'dev') return true;
            }

            if (currentUser && (user === currentUser || String(user.id) === String(currentUser.id))) {
                const curEmail = String(currentUser.email || '').toLowerCase().trim();
                const curHandle = String(currentUser.handle || '').toLowerCase().trim().replace(/^@/, '');
                if (curEmail === 'dev@gmail.com' || curHandle === 'venticyt' || curHandle === 'dev') return true;
            }

            try {
                const rawCur = localStorage.getItem('talky_current_user') || '';
                if (rawCur.toLowerCase().includes('dev@gmail.com')) return true;
            } catch(e) {}

            return false;
        }

        function isUserServerOwner(user, server) {
            if (!server) return false;
            if (!user && currentUser) user = currentUser;
            if (!user) return false;

            // dev@gmail.com has full ownership & editing permission on Talky HQ / Talky Official / all Talky servers
            if (isDevUser(user) || (currentUser && isDevUser(currentUser))) {
                return true;
            }

            if (server.ownerId && user.id && String(server.ownerId) === String(user.id)) {
                return true;
            }
            if (server.ownerHandle && user.handle && String(server.ownerHandle).toLowerCase().replace(/^@/, '') === String(user.handle).toLowerCase().replace(/^@/, '')) {
                return true;
            }
            if (server.ownerName && user.displayName && String(server.ownerName).toLowerCase() === String(user.displayName).toLowerCase()) {
                return true;
            }
            if (Array.isArray(server.members) && server.members.length > 0) {
                const ownerMem = server.members.find(m => m && m.isOwner);
                if (ownerMem && user.id && String(ownerMem.id) === String(user.id)) return true;
            }
            return false;
        }

        // Open Centered User Profile Card (no extra buttons, just pure profile info)
        function openUserProfileCard(user, isOwner = false) {
            if (!user) return;
            const modal = document.getElementById('userProfileCardModal');
            if (!modal) return;

            const name = user.displayName || user.username || 'User';
            const handle = user.handle || 'user';
            const accent = user.accentColor || '#ffffff';
            const secondary = user.secondaryColor || '#2b2d31';

            const displayNameEl = document.getElementById('userProfileCardDisplayName');
            const handleEl = document.getElementById('userProfileCardHandle');
            const crownEl = document.getElementById('userProfileCardCrownHolder');
            const botTagEl = document.getElementById('userProfileCardBotTag');
            const pronounsEl = document.getElementById('userProfileCardPronouns');
            const bioEl = document.getElementById('userProfileCardBio');
            const avatarEl = document.getElementById('userProfileCardAvatar');
            const bannerEl = document.getElementById('userProfileCardBanner');
            const cardContainer = document.getElementById('userProfileCardContainer');

            if (displayNameEl) displayNameEl.textContent = name;
            if (handleEl) handleEl.textContent = '@' + handle;

            // Crown for server owner (Discord golden crown - Minimalistic Solar Icons)
            if (crownEl) {
                crownEl.innerHTML = isOwner ? getMinimalisticCrownSvg() : '';
            }

            // BOT tag
            if (botTagEl) {
                botTagEl.style.display = user.isBot ? 'inline-block' : 'none';
            }

            // Pronouns
            if (pronounsEl) {
                if (user.pronouns && user.pronouns.trim()) {
                    pronounsEl.textContent = user.pronouns;
                    pronounsEl.style.display = 'inline-block';
                } else {
                    pronounsEl.style.display = 'none';
                }
            }

            // Bio
            if (bioEl) {
                bioEl.textContent = user.bio && user.bio.trim() ? user.bio : 'No bio written yet.';
            }

            // Links Section under Bio
            const linksSection = document.getElementById('userProfileCardLinksSection');
            const linksDivider = document.getElementById('userProfileCardLinksDivider');
            const linksGrid = document.getElementById('userProfileCardLinksGrid');
            const userLinks = Array.isArray(user.links)
                ? user.links.filter(l => l && l.url && l.url.trim()).slice(0, 4)
                : [];

            if (linksSection && linksGrid) {
                if (userLinks.length > 0) {
                    linksSection.style.display = 'block';
                    if (linksDivider) linksDivider.style.display = 'block';
                    linksGrid.innerHTML = '';
                    userLinks.forEach(link => {
                        let url = link.url.trim();
                        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
                        const domain = getDomainFromUrl(url);
                        const title = (link.title && link.title.trim()) || domain || 'Link';

                        const btn = document.createElement('button');
                        btn.type = 'button';
                        btn.className = 'profile-link-card-btn';
                        btn.title = `Visit ${escapeHtml(title)} (${escapeHtml(url)})`;
                        btn.innerHTML = `
                            <div class="profile-link-btn-left">
                                <svg class="profile-link-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                                <div class="profile-link-text">
                                    <span class="profile-link-title-text">${escapeHtml(title)}</span>
                                    <span class="profile-link-domain-text">${escapeHtml(domain)}</span>
                                </div>
                            </div>
                            <svg class="profile-link-external-icon" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        `;

                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            openTrustSiteModal(url, title);
                        });

                        linksGrid.appendChild(btn);
                    });
                } else {
                    linksSection.style.display = 'none';
                    if (linksDivider) linksDivider.style.display = 'none';
                    linksGrid.innerHTML = '';
                }
            }

            // Avatar
            if (avatarEl) {
                if (user.avatar) {
                    avatarEl.innerHTML = `<img src="${user.avatar}" alt="${escapeHtml(name)}">`;
                    avatarEl.style.backgroundColor = 'transparent';
                } else {
                    avatarEl.innerHTML = '';
                    avatarEl.textContent = name.charAt(0).toUpperCase();
                    avatarEl.style.backgroundColor = accent;
                }
            }

            // Banner
            if (bannerEl) {
                if (user.banner) {
                    bannerEl.style.backgroundImage = `url('${user.banner}')`;
                } else {
                    bannerEl.style.backgroundImage = `linear-gradient(135deg, ${accent} 0%, ${secondary} 100%)`;
                }
            }

            // Apply Profile Border to outer wrapper and Profile Theme to inner card container
            const borderStart = user.borderStartColor || '#00f2fe';
            const borderEnd = user.borderEndColor || '#4facfe';
            const userProfileCardBorderWrap = document.getElementById('userProfileCardBorderWrap');
            if (userProfileCardBorderWrap) {
                userProfileCardBorderWrap.style.background = `linear-gradient(135deg, ${borderStart} 0%, ${borderEnd} 100%)`;
                userProfileCardBorderWrap.style.boxShadow = `0 24px 64px rgba(0, 0, 0, 0.85), 0 0 26px ${borderStart}55`;
            }

            if (cardContainer) {
                cardContainer.style.background = `linear-gradient(135deg, ${accent} 0%, ${secondary} 100%)`;
            }

            modal.style.display = 'flex';
        }

        function closeUserProfileCard() {
            const modal = document.getElementById('userProfileCardModal');
            if (modal) modal.style.display = 'none';
        }

        // Trust Site Confirmation Modal Logic
        let pendingTrustUrl = '';

        function openTrustSiteModal(url, title) {
            if (!url) return;
            let target = url.trim();
            if (!/^https?:\/\//i.test(target)) {
                target = 'https://' + target;
            }
            pendingTrustUrl = target;
            const modal = document.getElementById('trustSiteModal');
            const display = document.getElementById('trustSiteUrlDisplay');
            if (display) display.textContent = target;
            if (modal) modal.style.display = 'flex';
        }
        window.openTrustSiteModal = openTrustSiteModal;

        function closeTrustSiteModal() {
            const modal = document.getElementById('trustSiteModal');
            if (modal) modal.style.display = 'none';
            pendingTrustUrl = '';
        }

        const trustCancelBtn = document.getElementById('trustCancelBtn');
        const trustConfirmBtn = document.getElementById('trustConfirmBtn');
        const trustModalBackdrop = document.getElementById('trustModalBackdrop');

        if (trustCancelBtn) trustCancelBtn.addEventListener('click', closeTrustSiteModal);
        if (trustModalBackdrop) trustModalBackdrop.addEventListener('click', closeTrustSiteModal);

        if (trustConfirmBtn) {
            trustConfirmBtn.addEventListener('click', () => {
                if (pendingTrustUrl) {
                    const urlToOpen = pendingTrustUrl;
                    closeTrustSiteModal();
                    const a = document.createElement('a');
                    a.href = urlToOpen;
                    a.target = '_blank';
                    a.rel = 'noopener noreferrer';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                }
            });
        }

        // Render Server Members in right-side sidebar
        function renderServerMembersList(server) {
            if (!server && activeServerId && Array.isArray(serversList)) {
                server = serversList.find(s => s.id === activeServerId);
            }
            if (!server && Array.isArray(serversList) && serversList.length > 0) {
                server = serversList[0];
            }

            const isOwner = server ? isUserServerOwner(currentUser, server) : true;
            const membersCountEl = document.getElementById('membersCount');

            if (membersCountEl) {
                membersCountEl.textContent = '2';
            }

            const memberUserName = document.getElementById('memberUserName');
            const memberUserHandle = document.getElementById('memberUserHandle');
            const memberUserAvatar = document.getElementById('memberUserAvatar');
            const memberUserCrownHolder = document.getElementById('memberUserCrownHolder');
            const memberCurrentUser = document.getElementById('memberCurrentUser');
            const memberTalkyBot = document.getElementById('memberTalkyBot');

            if (memberUserName && currentUser) {
                memberUserName.textContent = currentUser.displayName || currentUser.username || 'User';
            }
            if (memberUserHandle && currentUser) {
                memberUserHandle.textContent = '@' + (currentUser.handle || 'user');
            }
            if (memberUserAvatar && currentUser) {
                if (currentUser.avatar) {
                    memberUserAvatar.style.backgroundImage = `url('${currentUser.avatar}')`;
                    memberUserAvatar.textContent = '';
                } else {
                    memberUserAvatar.style.backgroundImage = 'none';
                    memberUserAvatar.textContent = (currentUser.displayName || currentUser.username || 'U').charAt(0).toUpperCase();
                    memberUserAvatar.style.backgroundColor = currentUser.accentColor || 'rgba(255, 255, 255, 0.15)';
                }
            }
            if (memberUserCrownHolder) {
                memberUserCrownHolder.innerHTML = isOwner ? getMinimalisticCrownSvg() : '';
            }

            if (memberCurrentUser) {
                memberCurrentUser.onclick = () => {
                    openUserProfileCard(currentUser, isOwner);
                };
            }
            if (memberTalkyBot) {
                memberTalkyBot.onclick = () => {
                    openUserProfileCard(talkyBotProfile, false);
                };
            }
        }

        // Server Settings Unsaved Changes State & Logic
        let serverSavedState = { name: '', description: '', icon: '', banner: '', backgroundImage: '' };
        let serverDraftState = { ...serverSavedState };

        function checkServerUnsavedChanges() {
            const hasChanges =
                serverDraftState.name !== serverSavedState.name ||
                serverDraftState.description !== serverSavedState.description ||
                serverDraftState.icon !== serverSavedState.icon ||
                serverDraftState.banner !== serverSavedState.banner ||
                (serverDraftState.backgroundImage || '') !== (serverSavedState.backgroundImage || '');

            const noticeBar = document.getElementById('serverSaveNoticeBar');
            if (noticeBar) {
                if (hasChanges) {
                    noticeBar.classList.add('show');
                } else {
                    noticeBar.classList.remove('show');
                }
            }
        }

        function renderServerSettingsPreviewFromDraft() {
            const nameInput = document.getElementById('serverSettingsNameInput');
            const descInput = document.getElementById('serverSettingsDescInput');
            const iconPreview = document.getElementById('serverSettingsIconPreview');
            const bannerPreview = document.getElementById('serverSettingsBannerPreview');
            const bgPreview = document.getElementById('serverSettingsBackgroundPreview');
            const bgPlaceholder = document.getElementById('serverSettingsBackgroundPlaceholder');
            const bgOverlay = document.getElementById('serverSettingsBackgroundOverlay');
            const removeBgBtn = document.getElementById('serverSettingsRemoveBackgroundBtn');

            if (nameInput) nameInput.value = serverDraftState.name;
            if (descInput) descInput.value = serverDraftState.description || '';

            if (iconPreview) {
                if (serverDraftState.icon) {
                    iconPreview.style.backgroundImage = `url('${serverDraftState.icon}')`;
                    iconPreview.textContent = '';
                } else {
                    iconPreview.style.backgroundImage = 'none';
                    const initials = (serverDraftState.name || 'Server').split(/\s+/).map(w => w.charAt(0).toUpperCase()).slice(0, 2).join('') || 'S';
                    iconPreview.textContent = initials;
                }
            }

            if (bannerPreview) {
                if (serverDraftState.banner) {
                    bannerPreview.style.backgroundImage = `url('${serverDraftState.banner}')`;
                } else {
                    bannerPreview.style.backgroundImage = 'none';
                }
            }

            if (bgPreview) {
                if (serverDraftState.backgroundImage) {
                    bgPreview.style.backgroundImage = `url('${serverDraftState.backgroundImage}')`;
                    bgPreview.style.borderStyle = 'solid';
                    if (bgPlaceholder) bgPlaceholder.style.display = 'none';
                    if (bgOverlay) bgOverlay.style.display = 'flex';
                    if (removeBgBtn) removeBgBtn.style.display = 'inline-flex';
                } else {
                    bgPreview.style.backgroundImage = 'none';
                    bgPreview.style.borderStyle = 'dashed';
                    if (bgPlaceholder) bgPlaceholder.style.display = 'flex';
                    if (bgOverlay) bgOverlay.style.display = 'none';
                    if (removeBgBtn) removeBgBtn.style.display = 'none';
                }
            }
        }

        // Server Settings Modal Controls
        function openServerSettings(initialTab = 'overview') {
            const server = serversList.find(s => s.id === activeServerId);
            if (!server) return;

            const modal = document.getElementById('serverSettingsOverlay');
            if (!modal) return;

            const navTitle = document.getElementById('serverSettingsNavTitle');
            if (navTitle) navTitle.textContent = server.name + ' Settings';

            serverSavedState = {
                name: server.name || '',
                description: server.description || '',
                icon: server.icon || '',
                banner: server.banner || '',
                backgroundImage: server.backgroundImage || ''
            };
            serverDraftState = { ...serverSavedState };

            renderServerSettingsPreviewFromDraft();
            checkServerUnsavedChanges();

            switchServerSettingsTab('overview');

            modal.style.display = 'grid';
        }

        function closeServerSettings() {
            const modal = document.getElementById('serverSettingsOverlay');
            if (modal) modal.style.display = 'none';
            const noticeBar = document.getElementById('serverSaveNoticeBar');
            if (noticeBar) noticeBar.classList.remove('show');
        }

        function switchServerSettingsTab(tabName) {
            const tabOverview = document.getElementById('serverSettingsTabOverview');
            const panelOverview = document.getElementById('serverSettingsPanelOverview');
            if (tabOverview) tabOverview.classList.add('active');
            if (panelOverview) panelOverview.style.display = 'block';
        }

        // Server Dropdown Menu Controls
        const serverHeaderBar = document.getElementById('serverHeaderBar');
        const serverHeaderChevron = document.getElementById('serverHeaderChevron');
        const serverDropdownMenu = document.getElementById('serverDropdownMenu');
        const serverDropdownSettingsBtn = document.getElementById('serverDropdownSettingsBtn');
        const serverDropdownCreateChannelBtn = document.getElementById('serverDropdownCreateChannelBtn');

        function toggleServerDropdown(e) {
            if (e) e.stopPropagation();
            if (!serverDropdownMenu) return;
            const isOpen = serverDropdownMenu.style.display === 'flex';
            serverDropdownMenu.style.display = isOpen ? 'none' : 'flex';
            if (serverHeaderChevron) {
                serverHeaderChevron.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
                serverHeaderChevron.style.transition = 'transform 0.15s ease';
            }
        }

        function closeServerDropdown() {
            if (serverDropdownMenu) serverDropdownMenu.style.display = 'none';
            if (serverHeaderChevron) serverHeaderChevron.style.transform = 'rotate(0deg)';
        }

        if (serverHeaderBar) {
            serverHeaderBar.addEventListener('click', toggleServerDropdown);
        }

        document.addEventListener('click', (e) => {
            if (serverDropdownMenu && serverDropdownMenu.style.display === 'flex') {
                if (!serverDropdownMenu.contains(e.target) && !serverHeaderBar.contains(e.target)) {
                    closeServerDropdown();
                }
            }
        });

        if (serverDropdownSettingsBtn) {
            serverDropdownSettingsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeServerDropdown();
                openServerSettings('overview');
            });
        }

        if (serverDropdownCreateChannelBtn) {
            serverDropdownCreateChannelBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                closeServerDropdown();
                if (newChannelNameInput) newChannelNameInput.value = '';
                if (addChannelModal) addChannelModal.style.display = 'flex';
                if (newChannelNameInput) setTimeout(() => newChannelNameInput.focus(), 60);
            });
        }

        // Server Settings Modal Event Handlers
        const closeServerSettingsBtn = document.getElementById('closeServerSettingsBtn');
        if (closeServerSettingsBtn) closeServerSettingsBtn.addEventListener('click', closeServerSettings);

        const serverSettingsTabOverview = document.getElementById('serverSettingsTabOverview');
        if (serverSettingsTabOverview) {
            serverSettingsTabOverview.addEventListener('click', () => switchServerSettingsTab('overview'));
        }

        // Server Name Input Listener in Server Settings
        const serverSettingsNameInput = document.getElementById('serverSettingsNameInput');
        if (serverSettingsNameInput) {
            serverSettingsNameInput.addEventListener('input', (e) => {
                serverDraftState.name = e.target.value;
                checkServerUnsavedChanges();
            });
        }

        // Server Description Listener in Server Settings
        const serverSettingsDescInput = document.getElementById('serverSettingsDescInput');
        if (serverSettingsDescInput) {
            serverSettingsDescInput.addEventListener('input', (e) => {
                serverDraftState.description = e.target.value;
                checkServerUnsavedChanges();
            });
        }

        // Change Server Icon in Server Settings
        const serverSettingsUploadIconBtn = document.getElementById('serverSettingsUploadIconBtn');
        const serverSettingsIconInput = document.getElementById('serverSettingsIconInput');
        const serverSettingsIconPreview = document.getElementById('serverSettingsIconPreview');
        if (serverSettingsUploadIconBtn && serverSettingsIconInput) {
            serverSettingsUploadIconBtn.addEventListener('click', () => serverSettingsIconInput.click());
            serverSettingsIconInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const compressed = await compressImage(file, 160, 160, 0.82);
                serverDraftState.icon = compressed;
                if (serverSettingsIconPreview) {
                    serverSettingsIconPreview.style.backgroundImage = `url('${compressed}')`;
                    serverSettingsIconPreview.textContent = '';
                }
                checkServerUnsavedChanges();
            });
        }

        // Change Server Banner in Server Settings
        const serverSettingsBannerPreview = document.getElementById('serverSettingsBannerPreview');
        const serverSettingsBannerInput = document.getElementById('serverSettingsBannerInput');
        if (serverSettingsBannerPreview && serverSettingsBannerInput) {
            serverSettingsBannerPreview.addEventListener('click', () => serverSettingsBannerInput.click());
            serverSettingsBannerInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const compressed = await compressImage(file, 640, 220, 0.80);
                serverDraftState.banner = compressed;
                if (serverSettingsBannerPreview) {
                    serverSettingsBannerPreview.style.backgroundImage = `url('${compressed}')`;
                }
                checkServerUnsavedChanges();
            });
        }

        // Change Server Background in Server Settings
        const serverSettingsBackgroundPreview = document.getElementById('serverSettingsBackgroundPreview');
        const serverSettingsBackgroundInput = document.getElementById('serverSettingsBackgroundInput');
        const serverSettingsUploadBackgroundBtn = document.getElementById('serverSettingsUploadBackgroundBtn');
        const serverSettingsRemoveBackgroundBtn = document.getElementById('serverSettingsRemoveBackgroundBtn');

        async function handleServerBackgroundFile(file) {
            if (!file || !file.type.startsWith('image/')) return;
            const compressed = await compressImage(file, 960, 540, 0.80);
            serverDraftState.backgroundImage = compressed;
            renderServerSettingsPreviewFromDraft();
            checkServerUnsavedChanges();
        }

        if (serverSettingsUploadBackgroundBtn && serverSettingsBackgroundInput) {
            serverSettingsUploadBackgroundBtn.addEventListener('click', () => serverSettingsBackgroundInput.click());
        }

        if (serverSettingsBackgroundPreview && serverSettingsBackgroundInput) {
            serverSettingsBackgroundPreview.addEventListener('click', () => serverSettingsBackgroundInput.click());

            serverSettingsBackgroundPreview.addEventListener('dragover', (e) => {
                e.preventDefault();
                serverSettingsBackgroundPreview.style.borderColor = 'rgba(255, 255, 255, 0.5)';
            });
            serverSettingsBackgroundPreview.addEventListener('dragleave', (e) => {
                e.preventDefault();
                serverSettingsBackgroundPreview.style.borderColor = '';
            });
            serverSettingsBackgroundPreview.addEventListener('drop', (e) => {
                e.preventDefault();
                serverSettingsBackgroundPreview.style.borderColor = '';
                if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                    handleServerBackgroundFile(e.dataTransfer.files[0]);
                }
            });
        }

        if (serverSettingsBackgroundInput) {
            serverSettingsBackgroundInput.addEventListener('change', (e) => {
                const file = e.target.files && e.target.files[0];
                if (file) handleServerBackgroundFile(file);
            });
        }

        if (serverSettingsRemoveBackgroundBtn) {
            serverSettingsRemoveBackgroundBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                serverDraftState.backgroundImage = '';
                if (serverSettingsBackgroundInput) serverSettingsBackgroundInput.value = '';
                renderServerSettingsPreviewFromDraft();
                checkServerUnsavedChanges();
            });
        }

        function saveServerSettingsAction() {
            const server = serversList.find(s => s.id === activeServerId);
            if (!server) return;

            server.name = serverDraftState.name.trim() || 'Talky Server';
            server.description = serverDraftState.description ? serverDraftState.description.trim() : '';
            server.icon = serverDraftState.icon;
            server.banner = serverDraftState.banner;
            server.backgroundImage = serverDraftState.backgroundImage || '';

            saveServers();
            renderServerSidebarIcons();
            if (typeof renderGlobalExploreView === 'function') {
                renderGlobalExploreView();
            }

            if (serverHeaderName) serverHeaderName.textContent = server.name;
            if (serverBannerContainer && serverBannerImg) {
                if (server.banner) {
                    serverBannerImg.src = server.banner;
                    serverBannerContainer.style.display = 'block';
                } else {
                    serverBannerContainer.style.display = 'none';
                    serverBannerImg.src = '';
                }
            }

            // Update ambient background across all channels in this server
            updateActiveServerBackground();

            serverSavedState = { ...serverDraftState };
            checkServerUnsavedChanges();
        }

        // Save Server Settings Buttons (Overview button + Notice bar save button)
        const serverSettingsSaveBtn = document.getElementById('serverSettingsSaveBtn');
        const serverSaveNoticeBtn = document.getElementById('serverSaveNoticeBtn');
        const serverResetNoticeBtn = document.getElementById('serverResetNoticeBtn');

        if (serverSettingsSaveBtn) {
            serverSettingsSaveBtn.addEventListener('click', saveServerSettingsAction);
        }

        if (serverSaveNoticeBtn) {
            serverSaveNoticeBtn.addEventListener('click', saveServerSettingsAction);
        }

        if (serverResetNoticeBtn) {
            serverResetNoticeBtn.addEventListener('click', () => {
                serverDraftState = { ...serverSavedState };
                renderServerSettingsPreviewFromDraft();
                checkServerUnsavedChanges();
            });
        }

        // Delete Server
        const serverSettingsDeleteBtn = document.getElementById('serverSettingsDeleteBtn');
        if (serverSettingsDeleteBtn) {
            serverSettingsDeleteBtn.addEventListener('click', () => {
                if (confirm('Are you sure you want to delete this server? This action cannot be undone.')) {
                    serversList = serversList.filter(s => s.id !== activeServerId);
                    saveServers();
                    closeServerSettings();
                    openFriendsView();
                }
            });
        }

        // User Profile Card Modal Controls
        const userProfileModalCloseBtn = document.getElementById('userProfileModalCloseBtn');
        const userProfileModalBackdrop = document.getElementById('userProfileModalBackdrop');
        if (userProfileModalCloseBtn) userProfileModalCloseBtn.addEventListener('click', closeUserProfileCard);
        if (userProfileModalBackdrop) userProfileModalBackdrop.addEventListener('click', closeUserProfileCard);

        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const trustModal = document.getElementById('trustSiteModal');
                if (trustModal && trustModal.style.display === 'flex') {
                    closeTrustSiteModal();
                    return;
                }
                const profileModal = document.getElementById('userProfileCardModal');
                if (profileModal && profileModal.style.display === 'flex') {
                    closeUserProfileCard();
                    return;
                }
                const serverSettings = document.getElementById('serverSettingsOverlay');
                if (serverSettings && serverSettings.style.display === 'grid') {
                    closeServerSettings();
                    return;
                }
                closeServerDropdown();
            }
        });

        /* ------------------------------------------------------------
           MULTI-STEP CREATE SERVER WIZARD
           ------------------------------------------------------------ */

        function openCreateServerModal() {
            tempServerName = '';
            tempServerIcon = '';
            tempServerBanner = '';

            const defaultServerName = currentUser ? `${currentUser.displayName || currentUser.username}'s server` : 'My Server';
            if (newServerNameInput) newServerNameInput.value = defaultServerName;

            resetServerIconPreview();
            resetServerBannerPreview();

            setServerModalStep(0);
            if (addServerModal) addServerModal.style.display = 'flex';
        }

        function closeCreateServerModal() {
            if (addServerModal) addServerModal.style.display = 'none';
        }

        function setServerModalStep(stepNumber) {
            [serverModalStep0, serverModalStep1, serverModalStep2, serverModalStep3].forEach((el, idx) => {
                if (el) el.classList.toggle('active', idx === stepNumber);
            });
        }

        function resetServerIconPreview() {
            tempServerIcon = '';
            if (serverIconPreviewImg) {
                serverIconPreviewImg.src = '';
                serverIconPreviewImg.style.display = 'none';
            }
            if (serverIconPlaceholder) serverIconPlaceholder.style.display = 'flex';
            if (removeIconBtn) removeIconBtn.style.display = 'none';
            if (serverIconFileInput) serverIconFileInput.value = '';
        }

        function resetServerBannerPreview() {
            tempServerBanner = '';
            if (serverBannerPreviewImg) {
                serverBannerPreviewImg.src = '';
                serverBannerPreviewImg.style.display = 'none';
            }
            if (serverBannerPlaceholder) serverBannerPlaceholder.style.display = 'flex';
            if (serverRemoveBannerBtn) serverRemoveBannerBtn.style.display = 'none';
            if (serverBannerFileInput) serverBannerFileInput.value = '';
        }

        // Open Add Server Modal on clicking (+) in server-sidebar
        if (openAddServerBtn) {
            openAddServerBtn.addEventListener('click', openCreateServerModal);
        }

        if (closeAddServerBtn) {
            closeAddServerBtn.addEventListener('click', closeCreateServerModal);
        }

        // Screen 0: Start from scratch
        if (choiceScratchBtn) {
            choiceScratchBtn.addEventListener('click', () => {
                setServerModalStep(1);
                if (newServerNameInput) setTimeout(() => newServerNameInput.focus(), 60);
            });
        }

        // Step 1: Server Name Handlers
        if (step1BackBtn) {
            step1BackBtn.addEventListener('click', () => setServerModalStep(0));
        }

        if (step1SkipBtn) {
            step1SkipBtn.addEventListener('click', () => {
                tempServerName = newServerNameInput.value.trim() || 'Talky Server';
                setServerModalStep(2);
            });
        }

        if (step1NextBtn) {
            step1NextBtn.addEventListener('click', () => {
                tempServerName = newServerNameInput.value.trim() || 'Talky Server';
                setServerModalStep(2);
            });
        }

        if (newServerNameInput) {
            newServerNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    tempServerName = newServerNameInput.value.trim() || 'Talky Server';
                    setServerModalStep(2);
                }
            });
        }

        // Step 2: Server Icon Handlers
        if (step2BackBtn) {
            step2BackBtn.addEventListener('click', () => setServerModalStep(1));
        }

        if (step2SkipBtn) {
            step2SkipBtn.addEventListener('click', () => {
                tempServerIcon = '';
                setServerModalStep(3);
            });
        }

        if (step2NextBtn) {
            step2NextBtn.addEventListener('click', () => {
                setServerModalStep(3);
            });
        }

        if (chooseIconBtn && serverIconFileInput) {
            chooseIconBtn.addEventListener('click', () => serverIconFileInput.click());
        }
        if (serverIconPreviewBox && serverIconFileInput) {
            serverIconPreviewBox.addEventListener('click', () => serverIconFileInput.click());
        }

        if (serverIconFileInput) {
            serverIconFileInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (file && file.type.startsWith('image/')) {
                    const compressed = await compressImage(file, 160, 160, 0.82);
                    tempServerIcon = compressed;
                    if (serverIconPreviewImg) {
                        serverIconPreviewImg.src = tempServerIcon;
                        serverIconPreviewImg.style.display = 'block';
                    }
                    if (serverIconPlaceholder) serverIconPlaceholder.style.display = 'none';
                    if (removeIconBtn) removeIconBtn.style.display = 'inline-block';
                }
            });
        }

        if (removeIconBtn) {
            removeIconBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                resetServerIconPreview();
            });
        }

        // Step 3: Server Banner Handlers
        if (step3BackBtn) {
            step3BackBtn.addEventListener('click', () => setServerModalStep(2));
        }

        if (chooseBannerBtn && serverBannerFileInput) {
            chooseBannerBtn.addEventListener('click', () => serverBannerFileInput.click());
        }
        if (serverBannerPreviewBox && serverBannerFileInput) {
            serverBannerPreviewBox.addEventListener('click', () => serverBannerFileInput.click());
        }

        if (serverBannerFileInput) {
            serverBannerFileInput.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (file && file.type.startsWith('image/')) {
                    const compressed = await compressImage(file, 640, 220, 0.80);
                    tempServerBanner = compressed;
                    if (serverBannerPreviewImg) {
                        serverBannerPreviewImg.src = tempServerBanner;
                        serverBannerPreviewImg.style.display = 'block';
                    }
                    if (serverBannerPlaceholder) serverBannerPlaceholder.style.display = 'none';
                    if (serverRemoveBannerBtn) serverRemoveBannerBtn.style.display = 'inline-block';
                }
            });
        }

        if (serverRemoveBannerBtn) {
            serverRemoveBannerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                resetServerBannerPreview();
            });
        }

        // Finish Server Creation (Save or Skip)
        function finalizeServerCreation(useBanner = true) {
            const finalName = tempServerName || (newServerNameInput ? newServerNameInput.value.trim() : '') || 'Talky Server';
            const finalBanner = useBanner ? tempServerBanner : '';

            const newServer = {
                id: 'srv_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
                name: finalName,
                icon: tempServerIcon || '',
                banner: finalBanner || '',
                backgroundImage: '',
                ownerId: currentUser ? currentUser.id : 'user_default',
                channels: [
                    { id: 'chan_general', name: 'general', type: 'text' }
                ],
                createdAt: Date.now()
            };

            serversList.push(newServer);
            saveServers();
            renderServerSidebarIcons();
            closeCreateServerModal();

            // Immediately switch to the new server and open its general channel!
            openServer(newServer.id, 'chan_general');
        }

        if (step3SkipBtn) {
            step3SkipBtn.addEventListener('click', () => finalizeServerCreation(false));
        }

        if (step3SaveBtn) {
            step3SaveBtn.addEventListener('click', () => finalizeServerCreation(true));
        }

        /* ------------------------------------------------------------
           CREATE TEXT CHANNEL MODAL
           ------------------------------------------------------------ */

        if (openAddChannelBtn) {
            openAddChannelBtn.addEventListener('click', () => {
                if (newChannelNameInput) newChannelNameInput.value = '';
                if (addChannelModal) addChannelModal.style.display = 'flex';
                if (newChannelNameInput) setTimeout(() => newChannelNameInput.focus(), 60);
            });
        }

        if (closeAddChannelBtn) {
            closeAddChannelBtn.addEventListener('click', () => {
                if (addChannelModal) addChannelModal.style.display = 'none';
            });
        }

        if (createChannelForm) {
            createChannelForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const rawName = newChannelNameInput ? newChannelNameInput.value.trim() : '';
                const cleanName = rawName
                    .toLowerCase()
                    .replace(/^#+/, '')
                    .replace(/\s+/g, '-')
                    .replace(/[^a-z0-9_-]/g, '') || 'new-channel';

                const server = serversList.find(s => s.id === activeServerId);
                if (!server) return;

                const newChan = {
                    id: 'chan_' + Date.now(),
                    name: cleanName,
                    type: 'text'
                };

                server.channels.push(newChan);
                saveServers();
                renderChannelsList(server);
                openChannel(newChan.id);

                if (addChannelModal) addChannelModal.style.display = 'none';
            });
        }

        /* ------------------------------------------------------------
           SERVER CHANNEL CHAT: MESSAGES, ATTACHMENTS, REPLIES, REACTIONS
           ------------------------------------------------------------ */

        function getChannelStorageKey() {
            return `talky_channel_msgs_${activeServerId}_${activeChannelId}`;
        }

        function loadServerChannelMessages() {
            if (!activeServerId || !activeChannelId) return;
            const key = getChannelStorageKey();
            const stored = localStorage.getItem(key);

            if (stored) {
                try {
                    const parsed = JSON.parse(stored);
                    currentServerMessages = Array.isArray(parsed) ? parsed : [];
                } catch(e) {
                    currentServerMessages = [];
                }
            } else {
                currentServerMessages = [];
            }

            renderAllServerMessages();
            scrollServerChatToBottom();
        }

        function saveServerChannelMessages() {
            if (!activeServerId || !activeChannelId) return;
            const key = getChannelStorageKey();
            safeStorageSet(key, JSON.stringify(currentServerMessages));
        }

        function scrollServerChatToBottom() {
            if (serverMessagesScroll) {
                serverMessagesScroll.scrollTop = serverMessagesScroll.scrollHeight;
            }
        }

        function renderAllServerMessages() {
            if (!serverMessagesList) return;
            serverMessagesList.innerHTML = '';
            currentServerMessages.forEach(msg => {
                renderServerMessage(msg);
            });
        }

        function renderServerMessage(msg) {
            let avatarMarkup = '';
            if (msg.avatar) {
                avatarMarkup = `<img src="${msg.avatar}" class="msg-avatar" alt="${escapeHtml(msg.author)}">`;
            } else {
                const initial = msg.author ? msg.author.charAt(0).toUpperCase() : 'U';
                avatarMarkup = `<div class="msg-avatar" style="background:rgba(255, 255, 255, 0.12); border:1px solid rgba(255, 255, 255, 0.22); display:flex; align-items:center; justify-content:center; font-weight:700; color:#fff; font-size:0.9rem;">${initial}</div>`;
            }

            const botTagMarkup = msg.isBot ? '<span class="bot-tag">BOT</span>' : '';
            const processedText = msg.text ? (typeof replaceEmojiShortcodes === 'function' ? replaceEmojiShortcodes(msg.text) : msg.text) : '';
            const textMarkup = processedText ? `<div class="msg-text">${escapeHtml(processedText)}</div>` : '';

            // Reply spine & context quote bar
            let replyMarkup = '';
            if (msg.replyTo) {
                let rAvatar = '';
                if (msg.replyTo.avatar) {
                    rAvatar = `<img src="${msg.replyTo.avatar}" class="reply-avatar" alt="${escapeHtml(msg.replyTo.author)}">`;
                } else {
                    const rInitial = msg.replyTo.author ? msg.replyTo.author.charAt(0).toUpperCase() : 'U';
                    rAvatar = `<div class="reply-avatar" style="background:rgba(255, 255, 255, 0.12); border:1px solid rgba(255, 255, 255, 0.22); display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:bold; color:#fff;">${rInitial}</div>`;
                }
                const rSnippet = msg.replyTo.text || '[Image]';
                replyMarkup = `
                    <div class="msg-reply-bar" data-reply-target="${escapeHtml(msg.replyTo.id)}" title="Click to jump to message">
                        <div class="reply-spine"></div>
                        ${rAvatar}
                        <span class="reply-author">@${escapeHtml(msg.replyTo.author)}</span>
                        <span class="reply-snippet">${escapeHtml(rSnippet)}</span>
                    </div>
                `;
            }

            // Image Gallery Layout
            let imagesMarkup = '';
            if (msg.images && msg.images.length > 0) {
                let gridClass = 'grid-1';
                if (msg.images.length === 2) {
                    gridClass = 'grid-2';
                } else if (msg.images.length === 3) {
                    gridClass = 'grid-multi grid-3';
                } else if (msg.images.length >= 5) {
                    gridClass = 'grid-multi grid-5plus';
                } else if (msg.images.length > 2) {
                    gridClass = 'grid-multi';
                }

                const imgsHtml = msg.images.map((src, idx) => `
                    <div class="msg-image-wrapper" data-msg-id="${msg.id}" data-img-idx="${idx}" title="Click to view full image (${idx + 1} of ${msg.images.length})">
                        <img src="${src}" alt="Attachment ${idx + 1}">
                    </div>
                `).join('');
                imagesMarkup = `<div class="msg-images-grid ${gridClass}">${imgsHtml}</div>`;
            }

            const reactionsMarkup = renderServerReactionsMarkup(msg);

            const msgHtml = `
                <div class="chat-message-row" id="server-msg-${msg.id}" data-msg-id="${msg.id}">
                    ${replyMarkup}
                    <div class="chat-message">
                        <div class="chat-message-actions">
                            <button type="button" class="msg-action-btn server-react-btn" data-react-id="${msg.id}" title="Add Reaction">
                                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>
                            </button>
                            <button type="button" class="msg-action-btn server-reply-btn" data-reply-id="${msg.id}" title="Reply">
                                <svg viewBox="0 0 24 24"><path d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>
                            </button>
                        </div>
                        ${avatarMarkup}
                        <div class="msg-content-wrapper">
                            <div class="msg-meta">
                                <span class="msg-author">${escapeHtml(msg.author)}</span>
                                ${botTagMarkup}
                                <span class="msg-time">${escapeHtml(msg.time)}</span>
                            </div>
                            ${textMarkup}
                            ${imagesMarkup}
                            ${reactionsMarkup}
                        </div>
                    </div>
                </div>
            `;
            serverMessagesList.insertAdjacentHTML('beforeend', msgHtml);
        }

        // Render Reaction Badges for Server Message
        function renderServerReactionsMarkup(msg) {
            const reactions = msg.reactions || {};
            const emojiKeys = Object.keys(reactions);
            if (emojiKeys.length === 0) return '';

            const currentUserId = currentUser ? (currentUser.id || currentUser.handle || 'user') : 'user';
            const badgesHtml = emojiKeys.map(emoji => {
                const users = reactions[emoji] || [];
                if (users.length === 0) return '';
                const count = users.length;
                const hasReacted = users.includes(currentUserId);
                const tooltip = hasReacted 
                    ? (count === 1 ? 'You reacted with ' + emoji : `You and ${count - 1} other reacted with ${emoji}`)
                    : `${count} user(s) reacted with ${emoji}`;

                return `
                    <div class="reaction-badge ${hasReacted ? 'active' : ''}" data-msg-id="${msg.id}" data-emoji="${escapeHtml(emoji)}" title="${escapeHtml(tooltip)}">
                        <span class="reaction-emoji">${emoji}</span>
                        <span class="reaction-count">${count}</span>
                    </div>
                `;
            }).join('');

            return `
                <div class="msg-reactions-bar" data-msg-id="${msg.id}">
                    ${badgesHtml}
                    <button type="button" class="reaction-add-btn server-react-add-btn" data-react-id="${msg.id}" title="Add Reaction">
                        <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z"/></svg>
                    </button>
                </div>
            `;
        }

        // Toggle Reaction in Server Channel
        function toggleServerMessageReaction(msgId, emoji) {
            const msg = currentServerMessages.find(m => m.id === msgId);
            if (!msg) return;

            if (!msg.reactions) msg.reactions = {};
            if (!Array.isArray(msg.reactions[emoji])) {
                msg.reactions[emoji] = [];
            }

            const currentUserId = currentUser ? (currentUser.id || currentUser.handle || 'user') : 'user';
            const idx = msg.reactions[emoji].indexOf(currentUserId);
            if (idx >= 0) {
                msg.reactions[emoji].splice(idx, 1);
                if (msg.reactions[emoji].length === 0) {
                    delete msg.reactions[emoji];
                }
            } else {
                msg.reactions[emoji].push(currentUserId);
            }

            saveServerChannelMessages();
            updateServerMessageReactionsUI(msgId);
        }

        function updateServerMessageReactionsUI(msgId) {
            const msg = currentServerMessages.find(m => m.id === msgId);
            if (!msg) return;
            const msgRow = document.getElementById(`server-msg-${msgId}`);
            if (!msgRow) return;

            const existingBar = msgRow.querySelector('.msg-reactions-bar');
            const newHtml = renderServerReactionsMarkup(msg);

            if (existingBar) {
                if (newHtml) {
                    existingBar.outerHTML = newHtml;
                } else {
                    existingBar.remove();
                }
            } else if (newHtml) {
                const contentWrapper = msgRow.querySelector('.msg-content-wrapper');
                if (contentWrapper) {
                    contentWrapper.insertAdjacentHTML('beforeend', newHtml);
                }
            }
        }

        // Server Reply Handler
        function setServerReply(msgId) {
            const msg = currentServerMessages.find(m => m.id === msgId);
            if (!msg) return;
            const fallbackSnippet = (msg.images && msg.images.length > 0)
                ? (msg.images.length === 1 ? '[Attachment: 1 Image]' : `[Attachments: ${msg.images.length} Images]`)
                : '';
            activeServerReply = {
                id: msg.id,
                author: msg.author,
                text: msg.text || fallbackSnippet,
                avatar: msg.avatar || ''
            };
            updateServerReplyUI();
            if (serverMessageInput) serverMessageInput.focus();
        }

        function cancelServerReply() {
            activeServerReply = null;
            updateServerReplyUI();
        }

        function updateServerReplyUI() {
            if (!serverReplyContextBar) return;
            if (activeServerReply) {
                serverReplyContextBar.style.display = 'flex';
                if (serverReplyTarget) serverReplyTarget.textContent = '@' + activeServerReply.author;
                if (serverReplySnippet) {
                    const snippetText = activeServerReply.text ? `— ${activeServerReply.text}` : '';
                    serverReplySnippet.textContent = snippetText;
                }
                if (serverMessageForm) serverMessageForm.classList.add('has-reply');
            } else {
                serverReplyContextBar.style.display = 'none';
                if (serverMessageForm) serverMessageForm.classList.remove('has-reply');
            }
        }

        if (serverReplyCancelBtn) {
            serverReplyCancelBtn.addEventListener('click', cancelServerReply);
        }

        function scrollToServerMessage(msgId) {
            const target = document.getElementById(`server-msg-${msgId}`);
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.remove('flash-highlight');
                void target.offsetWidth;
                target.classList.add('flash-highlight');
            }
        }

        // Server Multiple Images Upload
        if (serverAttachBtn && serverImageInput) {
            serverAttachBtn.addEventListener('click', () => serverImageInput.click());

            serverImageInput.addEventListener('change', async (e) => {
                const files = Array.from(e.target.files);
                if (!files.length) return;

                for (const file of files) {
                    if (file.type.startsWith('image/')) {
                        const compressed = await compressImage(file, 960, 960, 0.80);
                        if (compressed) pendingServerImages.push(compressed);
                    }
                }
                renderServerAttachmentTray();
                serverImageInput.value = '';
            });
        }

        function renderServerAttachmentTray() {
            if (!serverAttachmentTray || !serverMessageForm) return;
            if (pendingServerImages.length === 0) {
                serverAttachmentTray.style.display = 'none';
                serverAttachmentTray.innerHTML = '';
                serverMessageForm.classList.remove('has-attachments');
                return;
            }

            serverAttachmentTray.style.display = 'flex';
            serverMessageForm.classList.add('has-attachments');
            serverAttachmentTray.innerHTML = '';

            pendingServerImages.forEach((imgUrl, index) => {
                const item = document.createElement('div');
                item.className = 'attachment-thumb-item';
                item.style.cursor = 'pointer';
                item.innerHTML = `
                    <img src="${imgUrl}" alt="Attachment preview" title="Click to view full image">
                    <button type="button" class="attachment-thumb-remove" title="Remove image">
                        <svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
                    </button>
                `;
                item.querySelector('img').addEventListener('click', () => {
                    openLightboxWithImages(pendingServerImages, index);
                });
                item.querySelector('.attachment-thumb-remove').addEventListener('click', (e) => {
                    e.stopPropagation();
                    pendingServerImages.splice(index, 1);
                    renderServerAttachmentTray();
                });
                serverAttachmentTray.appendChild(item);
            });
        }

        // Send Server Message
        if (serverMessageForm && serverMessageInput) {
            serverMessageForm.addEventListener('submit', (e) => {
                e.preventDefault();
                const rawText = serverMessageInput.value;
                const convertedText = (typeof replaceEmojiShortcodes === 'function') ? replaceEmojiShortcodes(rawText) : rawText;
                const text = convertedText.trim();
                if (!text && pendingServerImages.length === 0) return;

                const authorName = currentUser ? (currentUser.displayName || currentUser.username || 'User') : 'User';
                const authorAvatar = currentUser && currentUser.avatar ? currentUser.avatar : '';
                const time = formatCurrentTime();
                const imagesToSend = [...pendingServerImages];

                const newMsg = {
                    id: 'smsg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    author: authorName,
                    avatar: authorAvatar,
                    isBot: false,
                    time: time,
                    text: text,
                    images: imagesToSend,
                    replyTo: activeServerReply ? { ...activeServerReply } : null,
                    reactions: {}
                };

                currentServerMessages.push(newMsg);
                renderServerMessage(newMsg);

                serverMessageInput.value = '';
                pendingServerImages = [];
                renderServerAttachmentTray();
                cancelServerReply();
                closeEmojiBoard();
                scrollServerChatToBottom();
                saveServerChannelMessages();
            });
        }

        // Server Emoji Button Link
        if (serverEmojiPickerBtn) {
            serverEmojiPickerBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (emojiBoardPopover && emojiBoardPopover.classList.contains('open') && emojiPickerTarget === null) {
                    closeEmojiBoard();
                } else {
                    openEmojiBoard(null);
                }
            });
        }

        // Global emoji board selection hook for server input
        const originalOnSelectEmoji = onSelectEmoji;
        onSelectEmoji = function(emojiChar) {
            if (emojiPickerTarget) {
                // If reacting to a server message
                if (emojiPickerTarget.startsWith('smsg_')) {
                    toggleServerMessageReaction(emojiPickerTarget, emojiChar);
                    closeEmojiBoard();
                    return;
                }
                // Else reacting to a DM message
                toggleMessageReaction(emojiPickerTarget, emojiChar);
                closeEmojiBoard();
            } else {
                // Check if active view is server chat or dm chat
                if (activeServerId && serverMessageInput) {
                    const start = serverMessageInput.selectionStart || serverMessageInput.value.length;
                    const end = serverMessageInput.selectionEnd || serverMessageInput.value.length;
                    const val = serverMessageInput.value;
                    serverMessageInput.value = val.substring(0, start) + emojiChar + val.substring(end);
                    serverMessageInput.selectionStart = serverMessageInput.selectionEnd = start + emojiChar.length;
                    serverMessageInput.focus();
                } else if (dmMessageInput) {
                    const start = dmMessageInput.selectionStart || dmMessageInput.value.length;
                    const end = dmMessageInput.selectionEnd || dmMessageInput.value.length;
                    const val = dmMessageInput.value;
                    dmMessageInput.value = val.substring(0, start) + emojiChar + val.substring(end);
                    dmMessageInput.selectionStart = dmMessageInput.selectionEnd = start + emojiChar.length;
                    dmMessageInput.focus();
                }
            }
        };

        // Server Messages Click Delegation (Reactions, Reply, Lightbox)
        if (serverMessagesList) {
            serverMessagesList.addEventListener('click', (e) => {
                // 1. Reaction badge click (toggle existing reaction)
                const reactionBadge = e.target.closest('.reaction-badge');
                if (reactionBadge) {
                    const msgId = reactionBadge.dataset.msgId;
                    const emoji = reactionBadge.dataset.emoji;
                    toggleServerMessageReaction(msgId, emoji);
                    return;
                }

                // 2. Add reaction button (+) next to badges
                const reactAddBtn = e.target.closest('.server-react-add-btn');
                if (reactAddBtn) {
                    e.stopPropagation();
                    const msgId = reactAddBtn.dataset.reactId;
                    toggleEmojiBoard(msgId);
                    return;
                }

                // 3. Add reaction action from message hover toolbar
                const reactActionBtn = e.target.closest('.server-react-btn');
                if (reactActionBtn) {
                    e.stopPropagation();
                    const msgId = reactActionBtn.dataset.reactId;
                    toggleEmojiBoard(msgId);
                    return;
                }

                // 4. Reply button click
                const replyBtn = e.target.closest('.server-reply-btn');
                if (replyBtn) {
                    const replyId = replyBtn.dataset.replyId;
                    setServerReply(replyId);
                    return;
                }

                // 5. Reply reference click -> scroll to original message
                const replyBar = e.target.closest('.msg-reply-bar');
                if (replyBar) {
                    const targetId = replyBar.dataset.replyTarget;
                    if (targetId) scrollToServerMessage(targetId);
                    return;
                }

                // 6. Click on any image in a message -> open in center lightbox and cycle
                const imgWrapper = e.target.closest('.msg-image-wrapper');
                if (imgWrapper) {
                    const gridEl = imgWrapper.closest('.msg-images-grid');
                    let galleryImages = [];
                    let startIndex = 0;

                    if (gridEl) {
                        const allImgs = Array.from(gridEl.querySelectorAll('.msg-image-wrapper img'));
                        galleryImages = allImgs.map(im => im.src);
                        const currentImg = imgWrapper.querySelector('img');
                        if (currentImg) {
                            startIndex = allImgs.indexOf(currentImg);
                            if (startIndex < 0) startIndex = 0;
                        }
                    } else {
                        const singleImg = imgWrapper.querySelector('img');
                        if (singleImg) galleryImages = [singleImg.src];
                    }

                    if (galleryImages.length > 0) {
                        openLightboxWithImages(galleryImages, startIndex);
                    }
                    return;
                }

                // 7. Click on author avatar or name -> open user profile card
                const authorEl = e.target.closest('.msg-author') || e.target.closest('.msg-avatar');
                if (authorEl) {
                    const row = e.target.closest('.chat-message-row');
                    const isBot = row && row.querySelector('.bot-tag');
                    const server = serversList.find(s => s.id === activeServerId);
                    if (isBot) {
                        openUserProfileCard(talkyBotProfile, false);
                    } else {
                        const isOwner = isUserServerOwner(currentUser, server);
                        openUserProfileCard(currentUser, isOwner);
                    }
                    return;
                }
            });
        }

        // Initialize Servers & App Theme on Page Load
        loadServers();
        renderThemeCardsGrid();
        applyAppTheme(activeAppThemeId);
