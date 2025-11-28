// ============================================================================
// SETTLEMENT INTEGRATION FOR HEXATLAS
// Uses post-render hook system for clean integration
// ============================================================================

(function() {
    'use strict';
    
    console.log('🏰 Settlement Integration loading...');
    
    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    
    const CONFIG = {
        ZOOM: {
            REGIONAL_START: 2.5,
            SETTLEMENT_START: 6.0
        },
        FADE: {
            ICON_START: 3.0,
            ICON_END: 5.5,
            SETTLEMENT_START: 4.0,
            SETTLEMENT_END: 6.0
        }
    };
    
    // ========================================================================
    // STATE
    // ========================================================================
    
    const settlementState = {
        detailLevel: 'WORLD',
        initialized: false
    };
    
    // ========================================================================
    // HELPERS
    // ========================================================================
    
    function getDetailLevel(scale) {
        if (scale < CONFIG.ZOOM.REGIONAL_START) return 'WORLD';
        if (scale < CONFIG.ZOOM.SETTLEMENT_START) return 'REGIONAL';
        return 'SETTLEMENT';
    }
    
    function getIconOpacity(scale) {
        if (scale <= CONFIG.FADE.ICON_START) return 1.0;
        if (scale >= CONFIG.FADE.ICON_END) return 0.0;
        return 1.0 - (scale - CONFIG.FADE.ICON_START) / (CONFIG.FADE.ICON_END - CONFIG.FADE.ICON_START);
    }
    
    function getSettlementOpacity(scale) {
        if (scale <= CONFIG.FADE.SETTLEMENT_START) return 0.0;
        if (scale >= CONFIG.FADE.SETTLEMENT_END) return 1.0;
        return (scale - CONFIG.FADE.SETTLEMENT_START) / (CONFIG.FADE.SETTLEMENT_END - CONFIG.FADE.SETTLEMENT_START);
    }
    
    function settlementToCanvas(hex, localX, localY) {
        const center = window.hexToPixel(hex.q, hex.r);
        const hexSize = window.state.hexMap.hexSize * window.state.hexMap.viewport.scale;
        const scaleFactor = hexSize * 0.95;
        return {
            x: center.x + localX * scaleFactor,
            y: center.y + localY * scaleFactor
        };
    }
    
    function isInsideHex(localX, localY) {
        return Math.sqrt(localX * localX + localY * localY) < 0.92;
    }
    
    function generateId(prefix) {
        return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    }
    
    // ========================================================================
    // SETTLEMENT DATA
    // ========================================================================
    
    function ensureSettlement(hex) {
        if (!hex.settlement) {
            hex.settlement = {
                type: 'empty',
                districts: [],
                buildings: [],
                roads: [],
                forests: []
            };
        }
        return hex.settlement;
    }
    
    const PALETTES = {
        warm: { roof: ['#c45c3b', '#b54a2e', '#d47050'], wall: ['#6b4a3a', '#5a3d2d'], shadow: '#3a2a1a' },
        cool: { roof: ['#4a6a8a', '#3a5a7a', '#5a7a9a'], wall: ['#5a5a6a', '#4a4a5a'], shadow: '#2a2a3a' },
        earth: { roof: ['#8b7355', '#7a6244', '#9c8466'], wall: ['#a89070', '#988060'], shadow: '#4a3a2a' }
    };
    
    function randomPalette() {
        const keys = Object.keys(PALETTES);
        return PALETTES[keys[Math.floor(Math.random() * keys.length)]];
    }
    
    function randomFrom(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }
    
    // ========================================================================
    // GENERATION
    // ========================================================================
    
    window.generateSettlement = function(hex, type) {
        console.log('🏰 Generating', type, 'for hex', hex.q, hex.r);
        const s = ensureSettlement(hex);
        s.type = type;
        s.districts = [];
        s.buildings = [];
        s.roads = [];
        s.forests = [];
        
        if (type === 'city') {
            for (let i = 0; i < 5; i++) {
                const angle = (i / 5) * Math.PI * 2;
                const dist = 0.25 + Math.random() * 0.3;
                addDistrict(s, Math.cos(angle) * dist, Math.sin(angle) * dist, 0.18);
            }
            addDistrict(s, 0, 0, 0.22);
            s.roads.push({ points: [{x:-0.85,y:0},{x:0.85,y:0}], width: 0.025 });
            s.roads.push({ points: [{x:0,y:-0.85},{x:0,y:0.85}], width: 0.025 });
        } else if (type === 'town') {
            for (let i = 0; i < 3; i++) {
                const angle = (i / 3) * Math.PI * 2 + Math.random() * 0.5;
                const dist = 0.15 + Math.random() * 0.2;
                addDistrict(s, Math.cos(angle) * dist, Math.sin(angle) * dist, 0.14);
            }
        } else if (type === 'village') {
            const cx = (Math.random() - 0.5) * 0.3;
            const cy = (Math.random() - 0.5) * 0.3;
            for (let i = 0; i < 12; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * 0.2;
                const x = cx + Math.cos(angle) * dist;
                const y = cy + Math.sin(angle) * dist;
                if (isInsideHex(x, y)) addBuilding(s, x, y);
            }
            if (Math.random() > 0.5) {
                const fa = Math.random() * Math.PI * 2;
                addForest(s, Math.cos(fa) * 0.55, Math.sin(fa) * 0.55, 0.18);
            }
        } else if (type === 'wilderness') {
            const terrain = hex.terrain || 'plains';
            const count = (terrain === 'forest' || terrain === 'jungle') ? 4 : 2;
            for (let i = 0; i < count; i++) {
                const angle = Math.random() * Math.PI * 2;
                const dist = Math.random() * 0.5;
                const x = Math.cos(angle) * dist;
                const y = Math.sin(angle) * dist;
                if (isInsideHex(x, y)) addForest(s, x, y, 0.15 + Math.random() * 0.1);
            }
        }
        
        window.renderHex();
    };
    
    function addDistrict(s, cx, cy, radius) {
        s.districts.push({
            id: generateId('d'),
            cx, cy, radius,
            color: `hsla(${Math.random()*360}, 40%, 50%, 0.12)`,
            borderColor: `hsla(${Math.random()*360}, 40%, 40%, 0.4)`
        });
        const count = Math.floor(radius * 100) + 8;
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * radius * 0.85;
            const x = cx + Math.cos(a) * d;
            const y = cy + Math.sin(a) * d;
            if (isInsideHex(x, y)) addBuilding(s, x, y);
        }
    }
    
    function addBuilding(s, x, y) {
        const p = randomPalette();
        s.buildings.push({
            id: generateId('b'),
            x, y,
            w: 0.018 + Math.random() * 0.025,
            h: 0.012 + Math.random() * 0.018,
            rot: Math.random() * Math.PI * 2,
            roof: randomFrom(p.roof),
            wall: randomFrom(p.wall),
            shadow: p.shadow
        });
    }
    
    function addForest(s, cx, cy, radius) {
        const trees = [];
        const count = Math.floor(radius * radius * 2500) + 8;
        for (let i = 0; i < count; i++) {
            const a = Math.random() * Math.PI * 2;
            const d = Math.sqrt(Math.random()) * radius;
            const x = cx + Math.cos(a) * d;
            const y = cy + Math.sin(a) * d;
            if (isInsideHex(x, y)) {
                trees.push({
                    x, y,
                    size: 0.006 + Math.random() * 0.01,
                    hue: 100 + Math.random() * 40
                });
            }
        }
        s.forests.push({ id: generateId('f'), cx, cy, radius, trees });
    }
    
    // ========================================================================
    // RENDERING
    // ========================================================================
    
    function renderSettlementLayer(ctx, hex, center, size) {
        const s = hex.settlement;
        if (!s) return;
        
        const opacity = getSettlementOpacity(window.state.hexMap.viewport.scale);
        if (opacity <= 0) return;
        
        ctx.save();
        ctx.globalAlpha = opacity;
        
        // Clip to hex
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 3) * i;
            const hx = center.x + size * 0.96 * Math.cos(angle);
            const hy = center.y + size * 0.96 * Math.sin(angle);
            if (i === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.clip();
        
        // Roads
        s.roads.forEach(road => {
            if (road.points.length < 2) return;
            ctx.beginPath();
            const p0 = settlementToCanvas(hex, road.points[0].x, road.points[0].y);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < road.points.length; i++) {
                const p = settlementToCanvas(hex, road.points[i].x, road.points[i].y);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = '#8B7355';
            ctx.lineWidth = road.width * size * 0.95;
            ctx.lineCap = 'round';
            ctx.stroke();
        });
        
        // Districts
        s.districts.forEach(d => {
            const c = settlementToCanvas(hex, d.cx, d.cy);
            const r = d.radius * size * 0.95;
            ctx.beginPath();
            ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
            ctx.fillStyle = d.color;
            ctx.fill();
            ctx.strokeStyle = d.borderColor;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        });
        
        // Forests
        s.forests.forEach(f => {
            const sorted = [...f.trees].sort((a, b) => a.y - b.y);
            sorted.forEach(t => {
                const c = settlementToCanvas(hex, t.x, t.y);
                const r = t.size * size * 0.95;
                ctx.beginPath();
                ctx.ellipse(c.x + r*0.2, c.y + r*0.3, r*0.6, r*0.3, 0, 0, Math.PI*2);
                ctx.fillStyle = 'rgba(0,0,0,0.15)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
                ctx.fillStyle = `hsl(${t.hue}, 55%, 30%)`;
                ctx.fill();
            });
        });
        
        // Buildings
        const sorted = [...s.buildings].sort((a, b) => a.y - b.y);
        sorted.forEach(b => {
            const c = settlementToCanvas(hex, b.x, b.y);
            const w = b.w * size * 0.95;
            const h = b.h * size * 0.95;
            
            ctx.save();
            ctx.translate(c.x, c.y);
            ctx.rotate(b.rot);
            
            const wd = Math.max(1.5, w * 0.12);
            ctx.fillStyle = b.wall;
            ctx.beginPath();
            ctx.moveTo(w/2, -h/2);
            ctx.lineTo(w/2 + wd, -h/2 + wd);
            ctx.lineTo(w/2 + wd, h/2 + wd);
            ctx.lineTo(-w/2 + wd, h/2 + wd);
            ctx.lineTo(-w/2, h/2);
            ctx.lineTo(w/2, h/2);
            ctx.closePath();
            ctx.fill();
            
            ctx.fillStyle = 'rgba(0,0,0,0.2)';
            ctx.fillRect(-w/2 + 1.5, -h/2 + 1.5, w, h);
            
            ctx.fillStyle = b.roof;
            ctx.fillRect(-w/2, -h/2, w, h);
            
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            ctx.fillRect(-w/2, -h/2, w, h * 0.25);
            
            ctx.strokeStyle = b.shadow;
            ctx.lineWidth = 0.8;
            ctx.strokeRect(-w/2, -h/2, w, h);
            
            ctx.restore();
        });
        
        ctx.restore();
    }
    
    // ========================================================================
    // POST-RENDER HOOK
    // ========================================================================
    
    function settlementPostRenderHook(ctx, scale) {
        const newLevel = getDetailLevel(scale);
        
        // Update UI when level changes
        if (newLevel !== settlementState.detailLevel) {
            console.log('🏰 Detail level changed:', settlementState.detailLevel, '→', newLevel);
            settlementState.detailLevel = newLevel;
            updateUI();
        }
        
        // Render settlements
        const settlementOpacity = getSettlementOpacity(scale);
        if (settlementOpacity > 0) {
            const range = window.getVisibleHexRange();
            for (let r = range.minR; r <= range.maxR; r++) {
                for (let q = range.minQ; q <= range.maxQ; q++) {
                    const hex = window.getHex(q, r);
                    if (hex && hex.settlement) {
                        const pos = window.hexToPixel(hex.q, hex.r);
                        const size = window.state.hexMap.hexSize * scale;
                        renderSettlementLayer(ctx, hex, pos, size);
                    }
                }
            }
        }
        
        // Update zoom display
        const zoomEl = document.getElementById('zoomLevel');
        if (zoomEl) {
            const icons = { WORLD: '🌍', REGIONAL: '🗺️', SETTLEMENT: '🏰' };
            zoomEl.innerHTML = `${Math.round(scale * 100)}% <span style="opacity:0.6;font-size:11px;">${icons[newLevel] || ''}</span>`;
        }
    }
    
    // ========================================================================
    // ICON FADING (patch drawHexTile)
    // ========================================================================
    
    function patchDrawHexTile() {
        const originalDrawHexTile = window.drawHexTile;
        if (!originalDrawHexTile) {
            console.warn('🏰 drawHexTile not found, skipping icon fade patch');
            return;
        }
        
        window.drawHexTile = function(hex) {
            const scale = window.state.hexMap.viewport.scale;
            const iconOpacity = getIconOpacity(scale);
            
            // If icons should be fully visible, just use original function
            if (iconOpacity >= 1.0) {
                return originalDrawHexTile(hex);
            }
            
            const pos = window.hexToPixel(hex.q, hex.r);
            const size = window.state.hexMap.hexSize * scale;
            
            // Draw hex terrain
            const hexPack = window.HEX_PACKS[window.currentHexPack];
            if (hexPack && hexPack.useImages) {
                const terrainFile = hexPack.terrainMapping[hex.terrain];
                if (terrainFile) {
                    const cacheKey = `${window.currentHexPack}_${hex.terrain}`;
                    const hexImage = window.hexPackImageCache.get(cacheKey);
                    if (hexImage) {
                        const hexWidth = size * 2;
                        const hexHeight = size * Math.sqrt(3);
                        const imageWidth = hexWidth * window.HEX_IMAGE_WIDTH_SCALE;
                        const imageHeight = hexHeight * window.HEX_IMAGE_HEIGHT_SCALE;
                        const xOffset = size * window.HEX_IMAGE_X_OFFSET;
                        const yOffset = size * window.HEX_IMAGE_Y_OFFSET;
                        window.ctx.drawImage(hexImage, 
                            pos.x - imageWidth/2 + xOffset, 
                            pos.y - imageHeight/2 + yOffset,
                            imageWidth, imageHeight
                        );
                    } else {
                        window.ctx.fillStyle = window.TERRAINS[hex.terrain].color;
                        window.drawHexagon(window.ctx, pos.x, pos.y, size);
                        window.ctx.fill();
                        window.ctx.strokeStyle = '#2d3748';
                        window.ctx.lineWidth = 2;
                        window.ctx.stroke();
                    }
                }
            } else {
                // Basic pack - draw terrain
                window.ctx.fillStyle = window.TERRAINS[hex.terrain].color;
                window.drawHexagon(window.ctx, pos.x, pos.y, size);
                window.ctx.fill();
                window.ctx.strokeStyle = '#2d3748';
                window.ctx.lineWidth = 2;
                window.ctx.stroke();
                
                // Terrain icon with fade
                if (iconOpacity > 0 && size > 15) {
                    const landmark = window.getLandmark ? window.getLandmark(hex.q, hex.r) : null;
                    const hideIcon = landmark && landmark.hideTerrainIcon !== false;
                    
                    if (!hideIcon) {
                        const icon = window.hexIconCache.get(hex.terrain);
                        if (icon) {
                            window.ctx.save();
                            window.ctx.globalAlpha = iconOpacity;
                            const iconSize = size * 0.8;
                            window.ctx.drawImage(icon, pos.x - iconSize/2, pos.y - iconSize/2, iconSize, iconSize);
                            window.ctx.restore();
                        }
                    }
                }
            }
            
            // Landmark icon with fade
            if (iconOpacity > 0) {
                const lm = window.getLandmark ? window.getLandmark(hex.q, hex.r) : null;
                if (lm && lm.style === 'icon' && lm.icon && size > 8) {
                    const icon = window.landmarkIconCache.get(lm.icon);
                    if (icon) {
                        window.ctx.save();
                        window.ctx.globalAlpha = iconOpacity;
                        const iconSize = size * 0.8 * (lm.size || 1.0);
                        window.ctx.drawImage(icon, pos.x - iconSize/2, pos.y - iconSize/2, iconSize, iconSize);
                        window.ctx.restore();
                    }
                }
            }
            
            // Dungeon indicator with fade
            if (hex.dungeon && iconOpacity > 0) {
                window.ctx.save();
                window.ctx.globalAlpha = iconOpacity;
                window.ctx.fillStyle = '#f59e0b';
                window.ctx.beginPath();
                window.ctx.arc(pos.x + size * 0.4, pos.y - size * 0.4, size * 0.15, 0, Math.PI * 2);
                window.ctx.fill();
                window.ctx.restore();
            }
        };
        
        console.log('✅ drawHexTile patched for icon fading');
    }
    
    // ========================================================================
    // UI
    // ========================================================================
    
    function createUI() {
        const sidebar = document.querySelector('.sidebar-left');
        if (!sidebar) {
            console.warn('🏰 Sidebar not found');
            return;
        }
        
        const section = document.createElement('div');
        section.id = 'settlementSection';
        section.className = 'tool-section';
        section.style.display = 'none';
        section.innerHTML = `
            <h3>🏰 Settlement View</h3>
            <p style="font-size:11px;color:#9ca3af;margin-bottom:10px;">Generate for center hex:</p>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <button class="btn btn-secondary" onclick="genSettlement('city')" style="padding:10px;">🏰 City</button>
                <button class="btn btn-secondary" onclick="genSettlement('town')" style="padding:10px;">🏘️ Town</button>
                <button class="btn btn-secondary" onclick="genSettlement('village')" style="padding:10px;">🏡 Village</button>
                <button class="btn btn-secondary" onclick="genSettlement('wilderness')" style="padding:10px;">🌲 Wild</button>
            </div>
            <button class="btn btn-secondary" onclick="clearSettlement()" style="width:100%;margin-top:8px;padding:8px;font-size:12px;">🗑️ Clear</button>
        `;
        
        const toolsSection = document.getElementById('toolsSection');
        if (toolsSection && toolsSection.parentNode) {
            toolsSection.parentNode.insertBefore(section, toolsSection.nextSibling);
        } else {
            sidebar.appendChild(section);
        }
        
        console.log('✅ Settlement UI created');
    }
    
    function updateUI() {
        const section = document.getElementById('settlementSection');
        if (section) {
            const shouldShow = settlementState.detailLevel === 'SETTLEMENT';
            section.style.display = shouldShow ? 'block' : 'none';
        }
    }
    
    // Global button handlers
    window.genSettlement = function(type) {
        const canvas = document.getElementById('hexCanvas');
        if (!canvas) return;
        const coords = window.pixelToHex(canvas.width / 2, canvas.height / 2);
        const hex = window.getHex(coords.q, coords.r);
        if (hex) window.generateSettlement(hex, type);
    };
    
    window.clearSettlement = function() {
        const canvas = document.getElementById('hexCanvas');
        if (!canvas) return;
        const coords = window.pixelToHex(canvas.width / 2, canvas.height / 2);
        const hex = window.getHex(coords.q, coords.r);
        if (hex) {
            hex.settlement = null;
            window.renderHex();
        }
    };
    
    // ========================================================================
    // INIT
    // ========================================================================
    
    function init() {
        console.log('🏰 Settlement init() checking prerequisites...');
        
        if (!window.state || !window.state.hexMap || !window.renderHex) {
            console.log('🏰 Prerequisites not ready, retrying in 200ms...');
            setTimeout(init, 200);
            return;
        }
        
        if (settlementState.initialized) {
            console.log('🏰 Already initialized');
            return;
        }
        settlementState.initialized = true;
        
        // Initialize post-render hooks array if not exists
        if (!window.postRenderHooks) {
            window.postRenderHooks = [];
        }
        
        // Register our hook
        window.postRenderHooks.push(settlementPostRenderHook);
        console.log('✅ Post-render hook registered');
        
        // Patch drawHexTile for icon fading
        patchDrawHexTile();
        
        // Create UI
        createUI();
        
        // Set flag so game.js knows we're handling zoom display
        window.settlementIntegrationLoaded = true;
        
        console.log('✅ Settlement Integration ready! Zoom past 600% to see settlement view.');
        
        // Trigger initial render
        window.renderHex();
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
    } else {
        setTimeout(init, 300);
    }
    
})();