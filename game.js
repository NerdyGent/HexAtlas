const TERRAINS = {
    plains: {
        name: 'Plains',
        color: '#90EE90',
        icon: 'https://api.iconify.design/mdi/wheat.svg?color=%23000000'
    },
    forest: {
        name: 'Forest',
        color: '#228B22',
        icon: 'https://api.iconify.design/mdi/pine-tree.svg?color=%23ffffff'
    },
    mountain: {
        name: 'Mountain',
        color: '#8B7355',
        icon: 'https://api.iconify.design/mdi/image-filter-hdr.svg?color=%23000000'
    },
    desert: {
        name: 'Desert',
        color: '#F4A460',
        icon: 'https://api.iconify.design/mdi/cactus.svg?color=%23000000'
    },
    water: {
        name: 'Water',
        color: '#4682B4',
        icon: 'https://api.iconify.design/mdi/waves.svg?color=%23ffffff'
    },
    swamp: {
        name: 'Swamp',
        color: '#556B2F',
        icon: 'https://api.iconify.design/mdi/water.svg?color=%23ffffff'
    },
    hills: {
        name: 'Hills',
        color: '#9ACD32',
        icon: 'https://api.iconify.design/mdi/terrain.svg?color=%23000000'
    },
    tundra: {
        name: 'Tundra',
        color: '#E0FFFF',
        icon: 'https://api.iconify.design/mdi/snowflake.svg?color=%23000000'
    },
    grassland: {
        name: 'Grassland',
        color: '#7CFC00',
        icon: 'https://api.iconify.design/mdi/grass.svg?color=%23000000'
    },
    jungle: {
        name: 'Jungle',
        color: '#006400',
        icon: 'https://api.iconify.design/mdi/palm-tree.svg?color=%23ffffff'
    }
};

const state = {
    hexMap: {
        viewMode: 'builder', // 'builder' or 'explorer'
        mode: 'paint',
        fillMode: false, // NEW: fill connected areas
        selectedTerrain: 'plains',
        selectedHex: null,
        hexes: new Map(),
        tokens: new Map(),
        landmarks: new Map(), // NEW: Landmarks/locations on hexes
        paths: [],
        selectedPath: null,
        hoveredPath: null,
        pathEditMode: false,
        draggingPathPoint: null,
        hoveredPathPoint: null,
        selectedToken: null,
        selectedLandmark: null, // NEW
        draggingToken: null,
        pendingToken: null,
        pendingLandmark: null, // NEW
        currentPath: null,
        pathType: 'road',
        pathStyle: 'straight',
        pathWidth: 4,
        pathColor: '#8B7355',
        viewport: { offsetX: 0, offsetY: 0, scale: 1 },
        isPanning: false,
        isPainting: false,
        lastPanPos: { x: 0, y: 0 },
        lastPaintPos: { q: null, r: null },
        hexSize: 30,
        brushSize: 1,
        paintSpeed: 8,
        paintThrottle: 0,
        brushPreviewHexes: [],
        // Cached bounds for performance
        //
        cachedBounds: null,
boundsNeedRecalc: true
    },
    dungeonEditor: null,
    nextTokenId: 1,
    nextPathId: 1,
    nextLandmarkId: 1 // NEW
};

const canvas = document.getElementById('hexCanvas');
const ctx = canvas.getContext('2d');
let hexIconCache = new Map();

// Hex Math
function hexToPixel(q, r) {
    const size = state.hexMap.hexSize * state.hexMap.viewport.scale;
    const x = size * (3/2 * q);
    const y = size * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
    return { 
        x: x + state.hexMap.viewport.offsetX + canvas.width / 2,
        y: y + state.hexMap.viewport.offsetY + canvas.height / 2
    };
}

function pixelToHex(x, y) {
    const adjX = x - canvas.width / 2 - state.hexMap.viewport.offsetX;
    const adjY = y - canvas.height / 2 - state.hexMap.viewport.offsetY;
    const size = state.hexMap.hexSize * state.hexMap.viewport.scale;
    const q = (2/3 * adjX) / size;
    const r = (-1/3 * adjX + Math.sqrt(3)/3 * adjY) / size;
    return axialRound(q, r);
}

function axialRound(q, r) {
    let s = -q - r;
    let rq = Math.round(q);
    let rr = Math.round(r);
    let rs = Math.round(s);
    const qDiff = Math.abs(rq - q);
    const rDiff = Math.abs(rr - r);
    const sDiff = Math.abs(rs - s);
    if (qDiff > rDiff && qDiff > sDiff) {
        rq = -rr - rs;
    } else if (rDiff > sDiff) {
        rr = -rq - rs;
    }
    return { q: rq, r: rr };
}

function drawHexagon(ctx, x, y, size) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i;
        const hx = x + size * Math.cos(angle);
        const hy = y + size * Math.sin(angle);
        if (i === 0) {
            ctx.moveTo(hx, hy);
        } else {
            ctx.lineTo(hx, hy);
        }
    }
    ctx.closePath();
}

function getHexNeighbors(q, r, radius) {
    const neighbors = [];
    for (let dq = -radius; dq <= radius; dq++) {
        for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr++) {
            if (dq === 0 && dr === 0) continue;
            neighbors.push({ q: q + dq, r: r + dr });
        }
    }
    return neighbors;
}

function getHexesInRadius(q, r, radius) {
    const hexes = [{ q, r }];
    if (radius > 0) {
        hexes.push(...getHexNeighbors(q, r, radius));
    }
    return hexes;
}
// ============================================================================
// SMART BOUNDS CACHING SYSTEM
// ============================================================================

function wouldExpandBounds(q, r) {
    if (state.hexMap.hexes.size === 0 || state.hexMap.boundsNeedRecalc) {
        return true;
    }
    
    const bounds = state.hexMap.cachedBounds;
    if (!bounds) return true;
    
    return q < bounds.minQ || q > bounds.maxQ || r < bounds.minR || r > bounds.maxR;
}

function wouldShrinkBounds(q, r) {
    if (state.hexMap.hexes.size <= 1) return true;
    
    const bounds = state.hexMap.cachedBounds;
    if (!bounds) return true;
    
    const isOnBoundary = (q === bounds.minQ || q === bounds.maxQ || 
                          r === bounds.minR || r === bounds.maxR);
    
    return isOnBoundary;
}

function recalculateBounds() {
    if (state.hexMap.hexes.size === 0) {
        state.hexMap.cachedBounds = null;
        state.hexMap.boundsNeedRecalc = false;
        return null;
    }
    
    let minQ = Infinity, maxQ = -Infinity;
    let minR = Infinity, maxR = -Infinity;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    const hexSize = state.hexMap.hexSize;
    
    state.hexMap.hexes.forEach(hex => {
        minQ = Math.min(minQ, hex.q);
        maxQ = Math.max(maxQ, hex.q);
        minR = Math.min(minR, hex.r);
        maxR = Math.max(maxR, hex.r);
        
        const x = hex.q * hexSize * 1.5;
        const y = (hex.r * hexSize * Math.sqrt(3)) + (hex.q * hexSize * Math.sqrt(3) / 2);
        
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    });
    
    state.hexMap.cachedBounds = { minQ, maxQ, minR, maxR, minX, maxX, minY, maxY };
    state.hexMap.boundsNeedRecalc = false;
    
    return state.hexMap.cachedBounds;
}

function updateBoundsForNewHex(q, r) {
    const hexSize = state.hexMap.hexSize;
    const x = q * hexSize * 1.5;
    const y = (r * hexSize * Math.sqrt(3)) + (q * hexSize * Math.sqrt(3) / 2);
    
    if (!state.hexMap.cachedBounds) {
        state.hexMap.cachedBounds = {
            minQ: q, maxQ: q,
            minR: r, maxR: r,
            minX: x, maxX: x,
            minY: y, maxY: y
        };
    } else {
        const bounds = state.hexMap.cachedBounds;
        bounds.minQ = Math.min(bounds.minQ, q);
        bounds.maxQ = Math.max(bounds.maxQ, q);
        bounds.minR = Math.min(bounds.minR, r);
        bounds.maxR = Math.max(bounds.maxR, r);
        bounds.minX = Math.min(bounds.minX, x);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxY = Math.max(bounds.maxY, y);
    }
}
// Hex Management
function getHex(q, r) {
    return state.hexMap.hexes.get(`${q},${r}`);
}

function setHex(q, r, terrain) {
    const key = `${q},${r}`;
    const existing = state.hexMap.hexes.get(key);
    const isNewHex = !existing;
    
    state.hexMap.hexes.set(key, {
        q, r, terrain,
        name: existing?.name || '',
        description: existing?.description || '',
        dungeon: existing?.dungeon || null
    });
    
    updateHexCount();
    markUnsaved();
    
    // Smart bounds update: only refresh minimap if bounds changed
    if (isNewHex) {
        const expandedBounds = wouldExpandBounds(q, r);
        if (expandedBounds) {
            updateBoundsForNewHex(q, r);
            refreshMinimapDebounced();
        }
    }
}

function deleteHex(q, r) {
    const wouldShrink = wouldShrinkBounds(q, r);
    
    state.hexMap.hexes.delete(`${q},${r}`);
    updateHexCount();
    markUnsaved();
    
    // Only recalculate and refresh if we deleted a boundary hex
    if (wouldShrink) {
        state.hexMap.boundsNeedRecalc = true;
        refreshMinimapDebounced();
    }
}

function updateHexCount() {
    const count = state.hexMap.hexes.size;
    const dungeonCount = Array.from(state.hexMap.hexes.values()).filter(h => h.dungeon).length;
    const tokenCount = state.hexMap.tokens.size;
    const landmarkCount = state.hexMap.landmarks.size;
    const pathCount = state.hexMap.paths.length;
    document.getElementById('viewName').textContent = `Hex Map (${count} hexes, ${dungeonCount} dungeons, ${landmarkCount} landmarks, ${tokenCount} tokens, ${pathCount} paths)`;
}

// ============================================================================
// PATH SYSTEM
// ============================================================================

const PATH_STYLES = {
    road: { color: '#8B7355', width: 4, dash: [] },
    river: { color: '#4682B4', width: 5, dash: [] },
    trail: { color: '#D2B48C', width: 2, dash: [5, 3] }
};

function selectPathType(type) {
    state.hexMap.pathType = type;
    document.querySelectorAll('[id^="pathType_"]').forEach(btn => {
        btn.classList.toggle('btn-primary', btn.id === `pathType_${type}`);
        btn.classList.toggle('btn-secondary', btn.id !== `pathType_${type}`);
    });
    // Update color to match the path type default
    const defaultColor = PATH_STYLES[type].color;
    state.hexMap.pathColor = defaultColor;
    document.getElementById('pathColor').value = defaultColor;
}

function selectPathStyle(style) {
    state.hexMap.pathStyle = style;
    document.querySelectorAll('[id^="pathStyle_"]').forEach(btn => {
        btn.classList.toggle('btn-primary', btn.id === `pathStyle_${style}`);
        btn.classList.toggle('btn-secondary', btn.id !== `pathStyle_${style}`);
    });
}

function updatePathWidth(value) {
    state.hexMap.pathWidth = parseInt(value);
    document.getElementById('pathWidthValue').textContent = value;
}

function updatePathColor(color) {
    state.hexMap.pathColor = color;
    // If currently drawing a path, update its color
    if (state.hexMap.currentPath) {
        state.hexMap.currentPath.color = color;
        renderHex();
    }
}

function resetPathColorToDefault() {
    const defaultColor = PATH_STYLES[state.hexMap.pathType].color;
    state.hexMap.pathColor = defaultColor;
    document.getElementById('pathColor').value = defaultColor;
    if (state.hexMap.currentPath) {
        state.hexMap.currentPath.color = defaultColor;
        renderHex();
    }
}

function startPath(q, r) {
    state.hexMap.currentPath = {
        id: `path_${state.nextPathId++}`,
        type: state.hexMap.pathType,
        style: state.hexMap.pathStyle,
        width: state.hexMap.pathWidth,
        color: state.hexMap.pathColor,
        points: [{ q, r }],
        created: new Date().toISOString()
    };
}

function addPathPoint(q, r) {
    if (!state.hexMap.currentPath) {
        startPath(q, r);
        return;
    }
    
    const lastPoint = state.hexMap.currentPath.points[state.hexMap.currentPath.points.length - 1];
    if (lastPoint.q === q && lastPoint.r === r) {
        return;
    }
    
    state.hexMap.currentPath.points.push({ q, r });
    renderHex();
}

function finishPath() {
    if (!state.hexMap.currentPath || state.hexMap.currentPath.points.length < 2) {
        state.hexMap.currentPath = null;
        return;
    }
    
    state.hexMap.paths.push({ ...state.hexMap.currentPath });
    state.hexMap.currentPath = null;
    updateHexCount();
    renderHex();
    markUnsaved();
}

function cancelPath() {
    state.hexMap.currentPath = null;
    state.hexMap.selectedPath = null;
    renderHex();
}

function deletePath(pathId) {
    const index = state.hexMap.paths.findIndex(p => p.id === pathId);
    if (index !== -1) {
        state.hexMap.paths.splice(index, 1);
        updateHexCount();
        renderHex();
        markUnsaved();
    }
}

function findPathAtPixel(x, y) {
    const clickTolerance = 15; // pixels
    let closestPath = null;
    let closestDistance = clickTolerance;
    
    // Check all paths to see if click is near any path segment
    for (let i = state.hexMap.paths.length - 1; i >= 0; i--) {
        const path = state.hexMap.paths[i];
        
        // Check each segment of the path
        for (let j = 0; j < path.points.length - 1; j++) {
            const p1 = hexToPixel(path.points[j].q, path.points[j].r);
            const p2 = hexToPixel(path.points[j + 1].q, path.points[j + 1].r);
            
            // Calculate distance from click point to line segment
            const distance = distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y);
            
            if (distance < closestDistance) {
                closestDistance = distance;
                closestPath = path;
            }
        }
    }
    
    return closestPath;
}

// Helper function to calculate distance from point to line segment
function distanceToLineSegment(px, py, x1, y1, x2, y2) {
    const A = px - x1;
    const B = py - y1;
    const C = x2 - x1;
    const D = y2 - y1;
    
    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    
    if (lenSq !== 0) {
        param = dot / lenSq;
    }
    
    let xx, yy;
    
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }
    
    const dx = px - xx;
    const dy = py - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

function findPathSegmentAtPixel(x, y, path) {
    if (!path || path.points.length < 2) return null;
    
    const clickTolerance = 15;
    let closestSegment = null;
    let closestDistance = clickTolerance;
    
    for (let i = 0; i < path.points.length - 1; i++) {
        const p1 = hexToPixel(path.points[i].q, path.points[i].r);
        const p2 = hexToPixel(path.points[i + 1].q, path.points[i + 1].r);
        
        const distance = distanceToLineSegment(x, y, p1.x, p1.y, p2.x, p2.y);
        
        if (distance < closestDistance) {
            closestDistance = distance;
            closestSegment = i;
        }
    }
    
    return closestSegment;
}

// Get all hexes between two hex coordinates using hex line algorithm
function getHexLine(q0, r0, q1, r1) {
    const distance = Math.max(
        Math.abs(q0 - q1),
        Math.abs(r0 - r1),
        Math.abs((-q0 - r0) - (-q1 - r1))
    );
    
    if (distance === 0) return [{ q: q0, r: r0 }];
    
    const hexes = [];
    for (let i = 0; i <= distance; i++) {
        const t = i / distance;
        const q = q0 * (1 - t) + q1 * t;
        const r = r0 * (1 - t) + r1 * t;
        const rounded = axialRound(q, r);
        hexes.push(rounded);
    }
    
    return hexes;
}

// Get all hexes that a path passes through
function getPathHexes(path) {
    if (!path || path.points.length < 2) return [];
    
    const hexSet = new Set();
    
    // Get hexes for each segment
    for (let i = 0; i < path.points.length - 1; i++) {
        const p1 = path.points[i];
        const p2 = path.points[i + 1];
        const lineHexes = getHexLine(p1.q, p1.r, p2.q, p2.r);
        
        lineHexes.forEach(hex => {
            hexSet.add(`${hex.q},${hex.r}`);
        });
    }
    
    // Convert back to array of {q, r} objects
    return Array.from(hexSet).map(key => {
        const [q, r] = key.split(',').map(Number);
        return { q, r };
    });
}

function showPathDetails(path) {
    const panel = document.getElementById('hexDetailsPanel');
    const pathTypeNames = {
        road: 'Road',
        river: 'River',
        trail: 'Trail'
    };
    
    const editModeButton = state.hexMap.pathEditMode 
        ? '<button class="btn btn-primary" style="width: 100%;" onclick="togglePathEditMode()">✓ Done Editing</button>'
        : '<button class="btn btn-secondary" style="width: 100%;" onclick="togglePathEditMode()">✏️ Edit Points</button>';
    
    panel.innerHTML = `
        <div class="details-header">
            <h2>${pathTypeNames[path.type]} Path</h2>
            <div class="coords">${path.points.length} waypoints · ${path.style} style</div>
        </div>
        <div class="details-content">
            <div class="form-group">
                ${editModeButton}
            </div>
            <div class="form-group">
                <label class="form-label">Path Type</label>
                <select class="form-select" onchange="updatePathType('${path.id}', this.value)">
                    <option value="road" ${path.type === 'road' ? 'selected' : ''}>Road</option>
                    <option value="river" ${path.type === 'river' ? 'selected' : ''}>River</option>
                    <option value="trail" ${path.type === 'trail' ? 'selected' : ''}>Trail</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Path Style</label>
                <select class="form-select" onchange="updatePathStyleField('${path.id}', this.value)">
                    <option value="straight" ${path.style === 'straight' ? 'selected' : ''}>━ Straight</option>
                    <option value="curved" ${path.style === 'curved' ? 'selected' : ''}>⌢ Curved</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Path Width</label>
                <div class="slider-container">
                    <input type="range" class="slider" id="pathWidthEdit_${path.id}" min="2" max="12" value="${path.width}" 
                           oninput="updatePathWidthField('${path.id}', this.value)">
                    <span class="slider-value" id="pathWidthEditValue_${path.id}">${path.width}</span>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Path Color</label>
                <input type="color" id="pathColorEdit_${path.id}" value="${path.color || PATH_STYLES[path.type].color}" 
                       onchange="updatePathColorField('${path.id}', this.value)"
                       style="width: 100%; height: 40px; border: 2px solid #3d4758; border-radius: 6px; background: transparent; cursor: pointer;">
            </div>
            <div class="form-group">
                <label class="form-label">Waypoints ${state.hexMap.pathEditMode ? '<span style="color: #f59e0b;">(Edit Mode)</span>' : ''}</label>
                <div style="max-height: 200px; overflow-y: auto; background: #2d3748; border-radius: 6px; padding: 8px;">
                    ${path.points.map((p, i) => `
                        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; font-size: 12px; color: #e1e8ed; border-bottom: 1px solid #3d4758; background: #2d3748; border-radius: 4px; margin-bottom: 4px;">
                            <span>${i === 0 ? 'ðŸŸ¢' : i === path.points.length - 1 ? 'ðŸ”´' : 'ðŸ”µ'} Point ${i + 1}: (${p.q}, ${p.r})</span>
                            <div style="display: flex; gap: 4px;">
                                ${i < path.points.length - 1 ? `<button onclick="insertPointAfter('${path.id}', ${i})" style="padding: 2px 6px; font-size: 10px; background: #667eea; color: white; border: none; border-radius: 3px; cursor: pointer;" title="Add point after">+</button>` : ''}
                                ${path.points.length > 2 ? `<button onclick="deletePathPoint('${path.id}', ${i})" style="padding: 2px 6px; font-size: 10px; background: #f56565; color: white; border: none; border-radius: 3px; cursor: pointer;" title="Delete point">×</button>` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Split Path (Create Branch)</label>
                <div style="max-height: 150px; overflow-y: auto; background: #2d3748; border-radius: 6px; padding: 8px;">
                    <p style="font-size: 11px; color: #a0aec0; margin-bottom: 8px;">Click a point below to split the path there:</p>
                    ${path.points.map((p, i) => {
                        if (i === 0 || i === path.points.length - 1) return '';
                        return `
                            <button onclick="splitPathAt('${path.id}', ${i})" 
                                    style="width: 100%; padding: 8px; margin-bottom: 4px; background: #667eea; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; text-align: left;"
                                    onmouseover="this.style.background='#5568d3'" 
                                    onmouseout="this.style.background='#667eea'">
                                ✂️ Split at Point ${i + 1} (${p.q}, ${p.r})
                            </button>
                        `;
                    }).join('')}
                </div>
            </div>
            <div style="font-size: 11px; color: #718096; line-height: 1.5; padding: 12px; background: #2d3748; border-radius: 6px;">
                <strong>${state.hexMap.pathEditMode ? 'Edit Mode Tips:' : 'Path Info:'}</strong><br>
                ${state.hexMap.pathEditMode ? 
                    '• Drag points on the map to move them<br>• Click + to add points between segments<br>• Click × to remove points<br>• Double-click path line to insert point' :
                    '• Click "Edit Points" to modify path<br>• Use + buttons to add waypoints<br>• Split to create Y/T intersections<br>• Double-click path to insert point'
                }
            </div>
        </div>
        <div class="details-actions">
            <button class="btn btn-secondary" style="flex: 1" onclick="deselectPath()">Close</button>
            <button class="btn btn-danger" style="flex: 1" onclick="deleteCurrentPath()">Delete Path</button>
        </div>
    `;
}

function updatePathType(pathId, type) {
    const path = state.hexMap.paths.find(p => p.id === pathId);
    if (path) {
        path.type = type;
        renderHex();
        showPathDetails(path);
        markUnsaved();
    }
}

function updatePathStyleField(pathId, style) {
    const path = state.hexMap.paths.find(p => p.id === pathId);
    if (path) {
        path.style = style;
        renderHex();
        markUnsaved();
    }
}

function updatePathWidthField(pathId, width) {
    const path = state.hexMap.paths.find(p => p.id === pathId);
    if (path) {
        path.width = parseInt(width);
        document.getElementById(`pathWidthEditValue_${pathId}`).textContent = width;
        renderHex();
        markUnsaved();
    }
}

function updatePathColorField(pathId, color) {
    const path = state.hexMap.paths.find(p => p.id === pathId);
    if (path) {
        path.color = color;
        renderHex();
        markUnsaved();
    }
}

function deselectPath() {
    state.hexMap.selectedPath = null;
    state.hexMap.pathEditMode = false;
    state.hexMap.draggingPathPoint = null;
    state.hexMap.hoveredPathPoint = null;
    deselectHex();
}

function togglePathEditMode() {
    state.hexMap.pathEditMode = !state.hexMap.pathEditMode;
    if (state.hexMap.selectedPath) {
        showPathDetails(state.hexMap.selectedPath);
    }
    renderHex();
}

function insertPointAfter(pathId, pointIndex) {
    const path = state.hexMap.paths.find(p => p.id === pathId);
    if (!path || pointIndex >= path.points.length - 1) return;
    
    // Calculate midpoint between this point and the next
    const p1 = path.points[pointIndex];
    const p2 = path.points[pointIndex + 1];
    const midQ = Math.round((p1.q + p2.q) / 2);
    const midR = Math.round((p1.r + p2.r) / 2);
    
    // Insert the new point
    path.points.splice(pointIndex + 1, 0, { q: midQ, r: midR });
    
    showPathDetails(path);
    renderHex();
}

function deletePathPoint(pathId, pointIndex) {
    const path = state.hexMap.paths.find(p => p.id === pathId);
    if (!path || path.points.length <= 2) {
        alert('Cannot delete point - paths must have at least 2 points');
        return;
    }
    
    path.points.splice(pointIndex, 1);
    showPathDetails(path);
    renderHex();
}

function splitPathAt(pathId, pointIndex) {
    const path = state.hexMap.paths.find(p => p.id === pathId);
    if (!path) return;
    
    // Create new path from split point to end
    const newPath = {
        id: `path_${state.nextPathId++}`,
        type: path.type,
        style: path.style,
        width: path.width,
        color: path.color || PATH_STYLES[path.type].color,
        points: path.points.slice(pointIndex),
        created: new Date().toISOString()
    };
    
    // Truncate original path at split point
    path.points = path.points.slice(0, pointIndex + 1);
    
    // Add the new path
    state.hexMap.paths.push(newPath);
    
    // Select the new path
    state.hexMap.selectedPath = newPath;
    showPathDetails(newPath);
    renderHex();
    
    alert(`Path split! Original path has ${path.points.length} points, new branch has ${newPath.points.length} points.`);
}

function findPathPointAtPixel(x, y, path) {
    if (!path) return null;
    
    const clickRadius = 20; // pixels
    
    for (let i = 0; i < path.points.length; i++) {
        const point = path.points[i];
        const pos = hexToPixel(point.q, point.r);
        const distance = Math.sqrt((x - pos.x) ** 2 + (y - pos.y) ** 2);
        
        if (distance <= clickRadius) {
            return { pointIndex: i, point: point };
        }
    }
    
    return null;
}

function deleteCurrentPath() {
    if (state.hexMap.selectedPath && confirm('Delete this path? This cannot be undone.')) {
        deletePath(state.hexMap.selectedPath.id);
        state.hexMap.selectedPath = null;
        state.hexMap.pathEditMode = false;
        state.hexMap.draggingPathPoint = null;
        state.hexMap.hoveredPathPoint = null;
        deselectHex();
        renderHex();
    }
}

function drawPath(path) {
    if (path.points.length < 2) return;
    
    const style = PATH_STYLES[path.type];
    const width = (path.width || style.width) * state.hexMap.viewport.scale;
    
    ctx.save();
    ctx.strokeStyle = path.color || style.color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    
    if (style.dash.length > 0) {
        ctx.setLineDash(style.dash.map(d => d * state.hexMap.viewport.scale));
    }
    
    ctx.beginPath();
    
    if (path.style === 'curved' && path.points.length > 2) {
        // Draw smooth curved path
        const firstPoint = hexToPixel(path.points[0].q, path.points[0].r);
        ctx.moveTo(firstPoint.x, firstPoint.y);
        
        for (let i = 1; i < path.points.length - 1; i++) {
            const p0 = hexToPixel(path.points[i - 1].q, path.points[i - 1].r);
            const p1 = hexToPixel(path.points[i].q, path.points[i].r);
            const p2 = hexToPixel(path.points[i + 1].q, path.points[i + 1].r);
            
            // Calculate control points for smooth curve
            const cp1x = p1.x - (p2.x - p0.x) * 0.15;
            const cp1y = p1.y - (p2.y - p0.y) * 0.15;
            const cp2x = p1.x + (p2.x - p0.x) * 0.15;
            const cp2y = p1.y + (p2.y - p0.y) * 0.15;
            
            ctx.quadraticCurveTo(cp1x, cp1y, p1.x, p1.y);
            
            if (i === path.points.length - 2) {
                ctx.quadraticCurveTo(cp2x, cp2y, p2.x, p2.y);
            }
        }
        
        if (path.points.length === 2) {
            const p1 = hexToPixel(path.points[1].q, path.points[1].r);
            ctx.lineTo(p1.x, p1.y);
        }
    } else {
        // Draw straight path
        path.points.forEach((point, index) => {
            const { x, y } = hexToPixel(point.q, point.r);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
    }
    
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw path points for editing
    if (path === state.hexMap.currentPath) {
        path.points.forEach((point, index) => {
            const { x, y } = hexToPixel(point.q, point.r);
            ctx.fillStyle = index === 0 ? '#10b981' : index === path.points.length - 1 ? '#ef4444' : '#667eea';
            ctx.beginPath();
            ctx.arc(x, y, 5 * state.hexMap.viewport.scale, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2;
            ctx.stroke();
        });
    }
    
    ctx.restore();
}

function drawPathHighlight(path) {
    if (path.points.length < 2) return;
    
    ctx.save();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = (path.width + 4) * state.hexMap.viewport.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.5;
    ctx.setLineDash([8, 4]);
    
    ctx.beginPath();
    
    if (path.style === 'curved' && path.points.length > 2) {
        const firstPoint = hexToPixel(path.points[0].q, path.points[0].r);
        ctx.moveTo(firstPoint.x, firstPoint.y);
        
        for (let i = 1; i < path.points.length - 1; i++) {
            const p0 = hexToPixel(path.points[i - 1].q, path.points[i - 1].r);
            const p1 = hexToPixel(path.points[i].q, path.points[i].r);
            const p2 = hexToPixel(path.points[i + 1].q, path.points[i + 1].r);
            
            const cp1x = p1.x - (p2.x - p0.x) * 0.15;
            const cp1y = p1.y - (p2.y - p0.y) * 0.15;
            const cp2x = p1.x + (p2.x - p0.x) * 0.15;
            const cp2y = p1.y + (p2.y - p0.y) * 0.15;
            
            ctx.quadraticCurveTo(cp1x, cp1y, p1.x, p1.y);
            
            if (i === path.points.length - 2) {
                ctx.quadraticCurveTo(cp2x, cp2y, p2.x, p2.y);
            }
        }
        
        if (path.points.length === 2) {
            const p1 = hexToPixel(path.points[1].q, path.points[1].r);
            ctx.lineTo(p1.x, p1.y);
        }
    } else {
        path.points.forEach((point, index) => {
            const { x, y } = hexToPixel(point.q, point.r);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
    }
    
    ctx.stroke();
    ctx.restore();
}

function drawPathHoverHighlight(path) {
    if (path.points.length < 2) return;
    
    ctx.save();
    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = (path.width + 3) * state.hexMap.viewport.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.3;
    
    ctx.beginPath();
    
    if (path.style === 'curved' && path.points.length > 2) {
        const firstPoint = hexToPixel(path.points[0].q, path.points[0].r);
        ctx.moveTo(firstPoint.x, firstPoint.y);
        
        for (let i = 1; i < path.points.length - 1; i++) {
            const p0 = hexToPixel(path.points[i - 1].q, path.points[i - 1].r);
            const p1 = hexToPixel(path.points[i].q, path.points[i].r);
            const p2 = hexToPixel(path.points[i + 1].q, path.points[i + 1].r);
            
            const cp1x = p1.x - (p2.x - p0.x) * 0.15;
            const cp1y = p1.y - (p2.y - p0.y) * 0.15;
            const cp2x = p1.x + (p2.x - p0.x) * 0.15;
            const cp2y = p1.y + (p2.y - p0.y) * 0.15;
            
            ctx.quadraticCurveTo(cp1x, cp1y, p1.x, p1.y);
            
            if (i === path.points.length - 2) {
                ctx.quadraticCurveTo(cp2x, cp2y, p2.x, p2.y);
            }
        }
        
        if (path.points.length === 2) {
            const p1 = hexToPixel(path.points[1].q, path.points[1].r);
            ctx.lineTo(p1.x, p1.y);
        }
    } else {
        path.points.forEach((point, index) => {
            const { x, y } = hexToPixel(point.q, point.r);
            if (index === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        });
    }
    
    ctx.stroke();
    ctx.restore();
}

// ============================================================================
// TOKEN SYSTEM
// ============================================================================

function createToken(q, r, data = {}) {
    const tokenId = `token_${state.nextTokenId++}`;
    const token = {
        id: tokenId,
        q, r,
        name: data.name || 'New Token',
        type: data.type || 'player',
        color: data.color || '#667eea',
        label: data.label || 'T',
        size: data.size || 1,
        attributes: data.attributes || {},
        notes: data.notes || '',
        visible: data.visible !== false,
        scale: 1,
        created: new Date().toISOString()
    };
    state.hexMap.tokens.set(tokenId, token);
    updateHexCount();
    markUnsaved();
    return token;
}

function getToken(tokenId) {
    return state.hexMap.tokens.get(tokenId);
}

function getTokensAt(q, r) {
    return Array.from(state.hexMap.tokens.values()).filter(t => t.q === q && t.r === r);
}

function moveToken(tokenId, q, r) {
    const token = getToken(tokenId);
    if (token) {
        token.q = q;
        token.r = r;
        renderHex();
    }
}

function deleteToken(tokenId) {
    state.hexMap.tokens.delete(tokenId);
    updateHexCount();
    renderHex();
    markUnsaved();
}

function findTokenAtPixel(x, y) {
    const hex = pixelToHex(x, y);
    const tokens = getTokensAt(hex.q, hex.r);
    if (tokens.length === 0) return null;
    return tokens[tokens.length - 1];
}

function animateTokenScale(tokenId, targetScale, duration = 200) {
    const token = getToken(tokenId);
    if (!token) return;
    
    const startScale = token.scale;
    const startTime = Date.now();
    
    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        token.scale = startScale + (targetScale - startScale) * eased;
        renderHex();
        if (progress < 1) requestAnimationFrame(animate);
    }
    animate();
}

// ============================================================================
// LANDMARK SYSTEM
// ============================================================================

function createLandmark(q, r, data = {}) {
    const key = `${q},${r}`;
    const landmarkId = `landmark_${state.nextLandmarkId++}`;
    const landmark = {
        id: landmarkId,
        q, r,
        name: data.name || 'New Landmark',
        type: data.type || 'custom',
        style: data.style || 'circle', // 'icon', 'circle', 'badge'
        icon: data.icon || '',
        color: data.color || '#FFD700',
        showLabel: data.showLabel !== false,
        labelPosition: data.labelPosition || 'above',
        size: data.size || 1.0,
        attributes: data.attributes || {},
        notes: data.notes || '',
        visible: data.visible !== false,
        created: new Date().toISOString()
    };
    state.hexMap.landmarks.set(key, landmark);
    updateHexCount();
    markUnsaved();
    return landmark;
}

function getLandmark(q, r) {
    return state.hexMap.landmarks.get(`${q},${r}`);
}

function getLandmarkById(landmarkId) {
    for (const landmark of state.hexMap.landmarks.values()) {
        if (landmark.id === landmarkId) return landmark;
    }
    return null;
}

function deleteLandmark(q, r) {
    state.hexMap.landmarks.delete(`${q},${r}`);
    updateHexCount();
    renderHex();
    markUnsaved();
}

function deleteLandmarkById(landmarkId) {
    for (const [key, landmark] of state.hexMap.landmarks.entries()) {
        if (landmark.id === landmarkId) {
            state.hexMap.landmarks.delete(key);
            updateHexCount();
            renderHex();
            markUnsaved();
            return;
        }
    }
}

function findLandmarkAtPixel(x, y) {
    const hex = pixelToHex(x, y);
    return getLandmark(hex.q, hex.r);
}

function showTokenCreator() {
    const panel = document.getElementById('hexDetailsPanel');
    panel.innerHTML = `
        <div class="details-header">
            <h2>Create New Token</h2>
        </div>
        <div class="details-content">
            <div class="form-group">
                <label class="form-label">Token Name</label>
                <input type="text" class="form-input" id="newTokenName" placeholder="e.g., Aragorn, Party Alpha">
            </div>
            <div class="form-group">
                <label class="form-label">Type</label>
                <select class="form-select" id="newTokenType">
                    <option value="player">Player Character</option>
                    <option value="party">Party/Group</option>
                    <option value="npc">NPC/Ally</option>
                    <option value="monster">Monster/Enemy</option>
                    <option value="landmark">Landmark/POI</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Label Text</label>
                <input type="text" class="form-input" id="newTokenLabel" value="P" maxlength="20">
                <div style="font-size: 11px; color: #718096; margin-top: 4px;">Text shown on token</div>
            </div>
            <div class="form-group">
                <label class="form-label">Token Size</label>
                <div class="slider-container">
                    <input type="range" class="slider" id="newTokenSize" min="0.5" max="5" step="0.1" value="1"
                           oninput="document.getElementById('newTokenSizeValue').textContent = parseFloat(this.value).toFixed(1)">
                    <span class="slider-value" id="newTokenSizeValue">1.0</span>
                </div>
                <div style="font-size: 11px; color: #718096; margin-top: 4px;">Larger tokens show more text</div>
            </div>
            <div class="form-group">
                <label class="form-label">Color</label>
                <input type="color" class="form-input" id="newTokenColor" value="#667eea" style="height: 50px; cursor: pointer;">
            </div>
            <div class="form-group">
                <label class="form-label">Attributes (JSON)</label>
                <textarea class="form-input" id="newTokenAttributes" placeholder='{"level": 5, "hp": 45}' style="min-height: 80px; font-family: monospace; font-size: 12px;"></textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-input" id="newTokenNotes" placeholder="Additional notes..."></textarea>
            </div>
        </div>
        <div class="details-actions">
            <button class="btn btn-secondary" style="flex: 1" onclick="cancelTokenCreator()">Cancel</button>
            <button class="btn btn-primary" style="flex: 1" onclick="confirmTokenCreator()">Create & Place</button>
        </div>
    `;
    document.getElementById('newTokenName').focus();
}

function cancelTokenCreator() {
    deselectHex();
}

function confirmTokenCreator() {
    const name = document.getElementById('newTokenName').value.trim();
    const type = document.getElementById('newTokenType').value;
    const label = document.getElementById('newTokenLabel').value.trim() || 'T';
    const color = document.getElementById('newTokenColor').value;
    const size = parseFloat(document.getElementById('newTokenSize').value);
    const attributesText = document.getElementById('newTokenAttributes').value.trim();
    const notes = document.getElementById('newTokenNotes').value.trim();
    
    let attributes = {};
    if (attributesText) {
        try {
            attributes = JSON.parse(attributesText);
        } catch (e) {
            alert('Invalid JSON in attributes field. Please fix and try again.');
            return;
        }
    }
    
    if (!name) {
        alert('Please enter a token name.');
        return;
    }
    
    state.hexMap.pendingToken = { name, type, label, color, size, attributes, notes };
    deselectHex();
    document.getElementById('instructionText').textContent = 'Click any hex to place token';
    document.getElementById('modeText').textContent = 'Token Placement';
}

function showTokenDetails(token) {
    const panel = document.getElementById('hexDetailsPanel');
    const attributesJson = JSON.stringify(token.attributes, null, 2);
    const hasPathfinding = token.attributes?.pathfinding === true;
    
    panel.innerHTML = `
        <div class="minimap-container">
            <div class="minimap-header">
                <span class="minimap-title">Map Overview</span>
                <span class="minimap-stats" id="minimapStats">...</span>
            </div>
            <div class="minimap-wrapper">
                <canvas id="minimapCanvas" class="minimap-canvas"></canvas>
                <div id="minimapViewport" class="minimap-viewport"></div>
            </div>
        </div>

        <div class="details-header">
            <h2 style="display: flex; align-items: center; gap: 8px;">
                <span style="display: inline-block; width: 32px; height: 32px; border-radius: 50%; background: ${token.color}; border: 2px solid #000; text-align: center; line-height: 28px; color: white; font-weight: bold; font-size: 14px;">${token.label.charAt(0).toUpperCase()}</span>
                ${token.name}
            </h2>
            <div class="coords">${token.type.charAt(0).toUpperCase() + token.type.slice(1)} · Hex (${token.q}, ${token.r})</div>
        </div>
        <div class="details-content">
            ${hasPathfinding ? `
            <div class="form-group" style="background: #667eea; padding: 12px; border-radius: 8px;">
                <label class="form-label" style="color: white; margin-bottom: 8px;">ðŸ—ºï¸ Pathfinding Active</label>
                <button class="btn btn-secondary" style="width: 100%; margin-bottom: 8px;" onclick="selectPathfindingDestination('${token.id}')">
                    ðŸ“ Select Destination Hex
                </button>
                <button class="btn btn-danger" style="width: 100%;" onclick="stopPathfinding('${token.id}')">
                    ℹ️ Stop Pathfinding
                </button>
                ${token.pathfindingRoute ? `<div style="color: white; font-size: 11px; margin-top: 8px;">Route: ${token.pathfindingRoute.length} hexes</div>` : ''}
            </div>
            ` : ''}
            <div class="form-group">
                <label class="form-label">Token Name</label>
                <input type="text" class="form-input" value="${token.name}" onchange="updateTokenField('${token.id}', 'name', this.value)">
            </div>
            <div class="form-group">
                <label class="form-label">Type</label>
                <select class="form-select" onchange="updateTokenField('${token.id}', 'type', this.value)">
                    <option value="player" ${token.type === 'player' ? 'selected' : ''}>Player Character</option>
                    <option value="party" ${token.type === 'party' ? 'selected' : ''}>Party/Group</option>
                    <option value="npc" ${token.type === 'npc' ? 'selected' : ''}>NPC/Ally</option>
                    <option value="monster" ${token.type === 'monster' ? 'selected' : ''}>Monster/Enemy</option>
                    <option value="landmark" ${token.type === 'landmark' ? 'selected' : ''}>Landmark/POI</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Label Text</label>
                <input type="text" class="form-input" value="${token.label}" maxlength="20" onchange="updateTokenField('${token.id}', 'label', this.value); renderHex();">
            </div>
            <div class="form-group">
                <label class="form-label">Token Size</label>
                <div class="slider-container">
                    <input type="range" class="slider" id="tokenSize_${token.id}" min="0.5" max="5" step="0.1" value="${token.size}" oninput="updateTokenSize('${token.id}', this.value)">
                    <span class="slider-value" id="tokenSizeValue_${token.id}">${token.size.toFixed(1)}</span>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Color</label>
                <input type="color" class="form-input" value="${token.color}" style="height: 50px; cursor: pointer;" onchange="updateTokenField('${token.id}', 'color', this.value); renderHex();">
            </div>
            <div class="form-group">
                <label class="form-label">Attributes (JSON)</label>
                <textarea class="form-input" id="tokenAttributes_${token.id}" style="min-height: 120px; font-family: monospace; font-size: 12px;" onchange="updateTokenAttributes('${token.id}', this.value)">${attributesJson}</textarea>
                <div style="font-size: 11px; color: #718096; margin-top: 4px;">
                    ðŸ’¡ Set <strong>"pathfinding": true</strong> to enable pathfinding
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-input" onchange="updateTokenField('${token.id}', 'notes', this.value)">${token.notes}</textarea>
            </div>
        </div>
        <div class="details-actions">
            <button class="btn btn-secondary" style="flex: 1" onclick="deselectToken()">Close</button>
            <button class="btn btn-danger" style="flex: 1" onclick="deleteCurrentToken()">Delete Token</button>
        </div>
    `;
    
    setTimeout(initializeMinimap, 0);
}

function updateTokenField(tokenId, field, value) {
    const token = getToken(tokenId);
    if (token) {
        token[field] = value;
        markUnsaved();
    }
}

function updateTokenSize(tokenId, value) {
    const token = getToken(tokenId);
    if (token) {
        token.size = parseFloat(value);
        document.getElementById(`tokenSizeValue_${tokenId}`).textContent = parseFloat(value).toFixed(1);
        renderHex();
        markUnsaved();
    }
}

function updateTokenAttributes(tokenId, jsonText) {
    const token = getToken(tokenId);
    if (!token) return;
    try {
        const oldPathfinding = token.attributes?.pathfinding;
        token.attributes = JSON.parse(jsonText);
        const newPathfinding = token.attributes?.pathfinding;
        
        // Refresh panel if pathfinding state changed
        if (oldPathfinding !== newPathfinding) {
            showTokenDetails(token);
        }
        markUnsaved();
    } catch (e) {
        alert('Invalid JSON format. Changes not saved.');
        document.getElementById(`tokenAttributes_${tokenId}`).value = JSON.stringify(token.attributes, null, 2);
    }
}

function deselectToken() {
    state.hexMap.selectedToken = null;
    deselectHex();
}

function deleteCurrentToken() {
    if (state.hexMap.selectedToken && confirm('Delete this token? This cannot be undone.')) {
        deleteToken(state.hexMap.selectedToken.id);
        deselectToken();
    }
}

// ============================================================================
// LANDMARK UI FUNCTIONS
// ============================================================================

function showLandmarkCreator() {
    const panel = document.getElementById('hexDetailsPanel');
    panel.innerHTML = `
        <div class="details-header">
            <h2>Create New Landmark</h2>
        </div>
        <div class="details-content">
            <div class="form-group">
                <label class="form-label">Landmark Name</label>
                <input type="text" class="form-input" id="newLandmarkName" placeholder="e.g., Rivendell, Dragon's Lair">
            </div>
            <div class="form-group">
                <label class="form-label">Style</label>
                <select class="form-select" id="newLandmarkStyle" onchange="updateLandmarkStylePreview()">
                    <option value="circle">Circle</option>
                    <option value="icon">Icon (URL)</option>
                    <option value="badge">Badge</option>
                </select>
            </div>
            <div class="form-group" id="landmarkIconGroup" style="display: none;">
                <label class="form-label">Icon URL</label>
                <input type="text" class="form-input" id="newLandmarkIcon" placeholder="https://game-icons.net/...">
                <div style="font-size: 11px; color: #718096; margin-top: 4px;">Use game-icons.net URLs</div>
            </div>
            <div class="form-group">
                <label class="form-label">Color</label>
                <input type="color" class="form-input" id="newLandmarkColor" value="#FFD700" style="height: 50px; cursor: pointer;">
            </div>
            <div class="form-group">
                <label class="form-label">Size</label>
                <div class="slider-container">
                    <input type="range" class="slider" id="newLandmarkSize" min="0.5" max="2.5" step="0.1" value="1.0"
                           oninput="document.getElementById('newLandmarkSizeValue').textContent = parseFloat(this.value).toFixed(1)">
                    <span class="slider-value" id="newLandmarkSizeValue">1.0</span>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">
                    <input type="checkbox" id="newLandmarkShowLabel" checked style="margin-right: 8px;">
                    Show Name Label
                </label>
            </div>
            <div class="form-group" id="landmarkLabelPosGroup">
                <label class="form-label">Label Position</label>
                <select class="form-select" id="newLandmarkLabelPos">
                    <option value="above">Above</option>
                    <option value="below">Below</option>
                    <option value="inside">Inside</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Attributes (JSON)</label>
                <textarea class="form-input" id="newLandmarkAttributes" placeholder='{"type": "town", "population": 5000}' style="min-height: 80px; font-family: monospace; font-size: 12px;"></textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-input" id="newLandmarkNotes" placeholder="Additional notes..."></textarea>
            </div>
        </div>
        <div class="details-actions">
            <button class="btn btn-secondary" style="flex: 1" onclick="cancelLandmarkCreator()">Cancel</button>
            <button class="btn btn-primary" style="flex: 1" onclick="confirmLandmarkCreator()">Create & Place</button>
        </div>
    `;
    document.getElementById('newLandmarkName').focus();
    updateLandmarkStylePreview();
}

function updateLandmarkStylePreview() {
    const style = document.getElementById('newLandmarkStyle').value;
    const iconGroup = document.getElementById('landmarkIconGroup');
    
    iconGroup.style.display = (style === 'icon') ? 'block' : 'none';
}

function cancelLandmarkCreator() {
    deselectHex();
}

function confirmLandmarkCreator() {
    const name = document.getElementById('newLandmarkName').value.trim();
    const style = document.getElementById('newLandmarkStyle').value;
    const icon = document.getElementById('newLandmarkIcon').value.trim();
    const color = document.getElementById('newLandmarkColor').value;
    const size = parseFloat(document.getElementById('newLandmarkSize').value);
    const showLabel = document.getElementById('newLandmarkShowLabel').checked;
    const labelPosition = document.getElementById('newLandmarkLabelPos').value;
    const attributesText = document.getElementById('newLandmarkAttributes').value.trim();
    const notes = document.getElementById('newLandmarkNotes').value.trim();
    
    let attributes = {};
    if (attributesText) {
        try {
            attributes = JSON.parse(attributesText);
        } catch (e) {
            alert('Invalid JSON in attributes field. Please fix and try again.');
            return;
        }
    }
    
    if (!name) {
        alert('Please enter a landmark name.');
        return;
    }
    
    if (style === 'icon' && !icon) {
        alert('Please enter an icon URL for icon style.');
        return;
    }
    
    state.hexMap.pendingLandmark = { 
        name, 
        style, 
        icon, 
        color, 
        size, 
        showLabel, 
        labelPosition,
        attributes, 
        notes 
    };
    deselectHex();
    document.getElementById('instructionText').textContent = 'Click any hex to place landmark';
    document.getElementById('modeText').textContent = 'Landmark Placement';
}

function showLandmarkDetails(landmark) {
    const panel = document.getElementById('hexDetailsPanel');
    const attributesJson = JSON.stringify(landmark.attributes, null, 2);
    
    panel.innerHTML = `
        <div class="minimap-container">
            <div class="minimap-header">
                <span class="minimap-title">Map Overview</span>
                <span class="minimap-stats" id="minimapStats">...</span>
            </div>
            <div class="minimap-wrapper">
                <canvas id="minimapCanvas" class="minimap-canvas"></canvas>
                <div id="minimapViewport" class="minimap-viewport"></div>
            </div>
        </div>

        <div class="details-header">
            <h2>${landmark.name}</h2>
            <div class="coords">Landmark · Hex (${landmark.q}, ${landmark.r})</div>
        </div>
        <div class="details-content">
            <div class="form-group">
                <label class="form-label">Landmark Name</label>
                <input type="text" class="form-input" value="${landmark.name}" onchange="updateLandmarkField('${landmark.id}', 'name', this.value)">
            </div>
            <div class="form-group">
                <label class="form-label">Style</label>
                <select class="form-select" onchange="updateLandmarkField('${landmark.id}', 'style', this.value); renderHex();">
                    <option value="circle" ${landmark.style === 'circle' ? 'selected' : ''}>Circle</option>
                    <option value="icon" ${landmark.style === 'icon' ? 'selected' : ''}>Icon</option>
                    <option value="badge" ${landmark.style === 'badge' ? 'selected' : ''}>Badge</option>
                </select>
            </div>
            ${landmark.style === 'icon' ? `
            <div class="form-group">
                <label class="form-label">Icon URL</label>
                <input type="text" class="form-input" value="${landmark.icon || ''}" onchange="updateLandmarkField('${landmark.id}', 'icon', this.value); renderHex();">
            </div>
            ` : ''}
            <div class="form-group">
                <label class="form-label">Color</label>
                <input type="color" class="form-input" value="${landmark.color}" style="height: 50px; cursor: pointer;" onchange="updateLandmarkField('${landmark.id}', 'color', this.value); renderHex();">
            </div>
            <div class="form-group">
                <label class="form-label">Size</label>
                <div class="slider-container">
                    <input type="range" class="slider" id="landmarkSize_${landmark.id}" min="0.5" max="2.5" step="0.1" value="${landmark.size}" oninput="updateLandmarkSize('${landmark.id}', this.value)">
                    <span class="slider-value" id="landmarkSizeValue_${landmark.id}">${landmark.size.toFixed(1)}</span>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">
                    <input type="checkbox" ${landmark.showLabel ? 'checked' : ''} onchange="updateLandmarkField('${landmark.id}', 'showLabel', this.checked); renderHex();" style="margin-right: 8px;">
                    Show Name Label
                </label>
            </div>
            <div class="form-group">
                <label class="form-label">Label Position</label>
                <select class="form-select" onchange="updateLandmarkField('${landmark.id}', 'labelPosition', this.value); renderHex();">
                    <option value="above" ${landmark.labelPosition === 'above' ? 'selected' : ''}>Above</option>
                    <option value="below" ${landmark.labelPosition === 'below' ? 'selected' : ''}>Below</option>
                    <option value="inside" ${landmark.labelPosition === 'inside' ? 'selected' : ''}>Inside</option>
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">Attributes (JSON)</label>
                <textarea class="form-input" id="landmarkAttributes_${landmark.id}" style="min-height: 120px; font-family: monospace; font-size: 12px;" onchange="updateLandmarkAttributes('${landmark.id}', this.value)">${attributesJson}</textarea>
            </div>
            <div class="form-group">
                <label class="form-label">Notes</label>
                <textarea class="form-input" onchange="updateLandmarkField('${landmark.id}', 'notes', this.value)">${landmark.notes}</textarea>
            </div>
        </div>
        <div class="details-actions">
            <button class="btn btn-secondary" style="flex: 1" onclick="deselectLandmark()">Close</button>
            <button class="btn btn-danger" style="flex: 1" onclick="deleteCurrentLandmark()">Delete Landmark</button>
        </div>
    `;
    
    setTimeout(initializeMinimap, 0);
}

function updateLandmarkField(landmarkId, field, value) {
    const landmark = getLandmarkById(landmarkId);
    if (landmark) {
        landmark[field] = value;
        markUnsaved();
    }
}

function updateLandmarkSize(landmarkId, value) {
    const landmark = getLandmarkById(landmarkId);
    if (landmark) {
        landmark.size = parseFloat(value);
        document.getElementById(`landmarkSizeValue_${landmarkId}`).textContent = parseFloat(value).toFixed(1);
        renderHex();
        markUnsaved();
    }
}

function updateLandmarkAttributes(landmarkId, jsonText) {
    const landmark = getLandmarkById(landmarkId);
    if (!landmark) return;
    
    try {
        landmark.attributes = JSON.parse(jsonText);
        markUnsaved();
    } catch (e) {
        alert('Invalid JSON in attributes field.');
    }
}

function deselectLandmark() {
    state.hexMap.selectedLandmark = null;
    deselectHex();
}

function deleteCurrentLandmark() {
    if (state.hexMap.selectedLandmark && confirm('Delete this landmark? This cannot be undone.')) {
        deleteLandmarkById(state.hexMap.selectedLandmark.id);
        deselectLandmark();
    }
}

// ============================================================================
// PATHFINDING SYSTEM
// ============================================================================

let pathfindingState = {
    selectingDestination: false,
    tokenId: null
};

function selectPathfindingDestination(tokenId) {
    pathfindingState.selectingDestination = true;
    pathfindingState.tokenId = tokenId;
    
    // Close the panel temporarily
    const token = getToken(tokenId);
    if (token) {
        state.hexMap.selectedToken = null;
        document.getElementById('hexDetailsPanel').innerHTML = `
            <div class="no-selection">
                <div class="no-selection-icon">ðŸ“</div>
                <p style="font-size: 16px; font-weight: 600;">Click destination hex</p>
                <p style="margin-top: 8px; font-size: 12px;">The token will pathfind to this location</p>
                <button class="btn btn-secondary" style="margin-top: 16px;" onclick="cancelPathfindingSelection()">Cancel</button>
            </div>
        `;
    }
}

function cancelPathfindingSelection() {
    pathfindingState.selectingDestination = false;
    const token = getToken(pathfindingState.tokenId);
    pathfindingState.tokenId = null;
    if (token) {
        state.hexMap.selectedToken = token;
        showTokenDetails(token);
    }
}

function stopPathfinding(tokenId) {
    const token = getToken(tokenId);
    if (token) {
        token.pathfindingRoute = null;
        token.pathfindingIndex = 0;
        showTokenDetails(token);
        renderHex();
    }
}

// Build a graph of all hexes connected by paths
function buildRoadNetwork() {
    const network = new Map(); // key: "q,r", value: Set of neighbor "q,r" strings
    
    state.hexMap.paths.forEach(path => {
        const hexes = getPathHexes(path);
        
        // Connect consecutive hexes along the path
        for (let i = 0; i < hexes.length - 1; i++) {
            const h1 = `${hexes[i].q},${hexes[i].r}`;
            const h2 = `${hexes[i + 1].q},${hexes[i + 1].r}`;
            
            if (!network.has(h1)) network.set(h1, new Set());
            if (!network.has(h2)) network.set(h2, new Set());
            
            network.get(h1).add(h2);
            network.get(h2).add(h1);
        }
    });
    
    console.log(`Road network built: ${network.size} hexes with paths, ${state.hexMap.paths.length} paths total`);
    return network;
}

// A* pathfinding algorithm
function findPath(startQ, startR, endQ, endR) {
    const network = buildRoadNetwork();
    const startKey = `${startQ},${startR}`;
    const endKey = `${endQ},${endR}`;
    
    // Check if start and end are on the road network
    if (!network.has(startKey)) {
        console.log('Start hex is not on any path');
        return null;
    }
    if (!network.has(endKey)) {
        console.log('End hex is not on any path');
        return null;
    }
    
    const openSet = new Set([startKey]);
    const cameFrom = new Map();
    const gScore = new Map();
    const fScore = new Map();
    
    gScore.set(startKey, 0);
    fScore.set(startKey, heuristic(startQ, startR, endQ, endR));
    
    while (openSet.size > 0) {
        // Find node in openSet with lowest fScore
        let current = null;
        let lowestF = Infinity;
        openSet.forEach(key => {
            const f = fScore.get(key) || Infinity;
            if (f < lowestF) {
                lowestF = f;
                current = key;
            }
        });
        
        if (current === endKey) {
            // Reconstruct path
            return reconstructPath(cameFrom, current);
        }
        
        openSet.delete(current);
        
        const neighbors = network.get(current) || new Set();
        neighbors.forEach(neighborKey => {
            const tentativeG = (gScore.get(current) || Infinity) + 1;
            
            if (tentativeG < (gScore.get(neighborKey) || Infinity)) {
                cameFrom.set(neighborKey, current);
                gScore.set(neighborKey, tentativeG);
                
                const [nq, nr] = neighborKey.split(',').map(Number);
                fScore.set(neighborKey, tentativeG + heuristic(nq, nr, endQ, endR));
                
                openSet.add(neighborKey);
            }
        });
    }
    
    // No path found
    return null;
}

function heuristic(q1, r1, q2, r2) {
    // Hex distance
    return Math.max(
        Math.abs(q1 - q2),
        Math.abs(r1 - r2),
        Math.abs((-q1 - r1) - (-q2 - r2))
    );
}

function reconstructPath(cameFrom, current) {
    const path = [current];
    while (cameFrom.has(current)) {
        current = cameFrom.get(current);
        path.unshift(current);
    }
    return path.map(key => {
        const [q, r] = key.split(',').map(Number);
        return { q, r };
    });
}

function startTokenPathfinding(tokenId, destQ, destR) {
    const token = getToken(tokenId);
    if (!token) {
        alert('Token not found!');
        return;
    }
    
    // Build network to check what's available
    const network = buildRoadNetwork();
    
    if (network.size === 0) {
        alert('No paths on the map! Draw some roads first.');
        return;
    }
    
    // Find nearest path hex to start position
    const startKey = `${token.q},${token.r}`;
    let actualStartQ = token.q;
    let actualStartR = token.r;
    
    if (!network.has(startKey)) {
        // Token is not on a path, find nearest path hex
        const nearestStart = findNearestPathHex(token.q, token.r, network);
        if (!nearestStart) {
            alert('Token is not near any path! Place the token on or near a road first.');
            return;
        }
        actualStartQ = nearestStart.q;
        actualStartR = nearestStart.r;
        console.log(`Token moved from (${token.q},${token.r}) to nearest path at (${actualStartQ},${actualStartR})`);
    }
    
    // Find nearest path hex to destination
    const destKey = `${destQ},${destR}`;
    let actualDestQ = destQ;
    let actualDestR = destR;
    
    if (!network.has(destKey)) {
        const nearestDest = findNearestPathHex(destQ, destR, network);
        if (!nearestDest) {
            alert('Destination is not near any path! Click on or near a road.');
            return;
        }
        actualDestQ = nearestDest.q;
        actualDestR = nearestDest.r;
        console.log(`Destination moved from (${destQ},${destR}) to nearest path at (${actualDestQ},${actualDestR})`);
    }
    
    const path = findPath(actualStartQ, actualStartR, actualDestQ, actualDestR);
    
    if (!path) {
        alert('No route found! Make sure the roads are connected between start and destination.');
        return;
    }
    
    console.log(`Path found with ${path.length} hexes`);
    
    token.pathfindingRoute = path;
    token.pathfindingIndex = 0;
    
    // Start the movement animation
    animateTokenAlongPath(tokenId);
    
    // Update UI
    state.hexMap.selectedToken = token;
    showTokenDetails(token);
    renderHex();
}

function findNearestPathHex(q, r, network) {
    let nearestHex = null;
    let nearestDist = Infinity;
    
    network.forEach((neighbors, key) => {
        const [hq, hr] = key.split(',').map(Number);
        const dist = heuristic(q, r, hq, hr);
        if (dist < nearestDist) {
            nearestDist = dist;
            nearestHex = { q: hq, r: hr };
        }
    });
    
    // Only return if within reasonable distance (5 hexes)
    return nearestDist <= 5 ? nearestHex : null;
}

function animateTokenAlongPath(tokenId) {
    const token = getToken(tokenId);
    if (!token || !token.pathfindingRoute) return;
    
    // Move to next hex
    token.pathfindingIndex++;
    
    if (token.pathfindingIndex >= token.pathfindingRoute.length) {
        // Reached destination
        token.pathfindingRoute = null;
        token.pathfindingIndex = 0;
        if (state.hexMap.selectedToken?.id === tokenId) {
            showTokenDetails(token);
        }
        renderHex();
        return;
    }
    
    const nextHex = token.pathfindingRoute[token.pathfindingIndex];
    token.q = nextHex.q;
    token.r = nextHex.r;
    renderHex();
    
    // Continue animation
    setTimeout(() => animateTokenAlongPath(tokenId), 500); // Move every 500ms
}

// Painting Functions
function paintHex(q, r) {
    const hexes = getHexesInRadius(q, r, state.hexMap.brushSize - 1);
    hexes.forEach(hex => {
        setHex(hex.q, hex.r, state.hexMap.selectedTerrain);
    });
}

function eraseHex(q, r) {
    const hexes = getHexesInRadius(q, r, state.hexMap.brushSize - 1);
    hexes.forEach(hex => {
        deleteHex(hex.q, hex.r);
    });
}

function floodFill(startQ, startR, targetTerrain) {
    const startHex = getHex(startQ, startR);
    const startTerrain = startHex ? startHex.terrain : null;
    
    if (startTerrain === targetTerrain) return;
    
    const queue = [{ q: startQ, r: startR }];
    const visited = new Set();
    const maxFill = 5000;
    let filled = 0;
    let boundsExpanded = false;
    
    while (queue.length > 0 && filled < maxFill) {
        const { q, r } = queue.shift();
        const key = `${q},${r}`;
        
        if (visited.has(key)) continue;
        visited.add(key);
        
        const hex = getHex(q, r);
        const currentTerrain = hex ? hex.terrain : null;
        
        if (currentTerrain !== startTerrain) continue;
        
        // Check if this will expand bounds
        if (!boundsExpanded && wouldExpandBounds(q, r)) {
            boundsExpanded = true;
        }
        
        setHex(q, r, targetTerrain);
        filled++;
        
        const neighbors = [
            { q: q + 1, r: r },
            { q: q - 1, r: r },
            { q: q, r: r + 1 },
            { q: q, r: r - 1 },
            { q: q + 1, r: r - 1 },
            { q: q - 1, r: r + 1 }
        ];
        
        neighbors.forEach(n => {
            if (!visited.has(`${n.q},${n.r}`)) {
                queue.push(n);
            }
        });
    }
    
    // Only refresh minimap if bounds actually changed during fill
    if (boundsExpanded) {
        refreshMinimapDebounced();
    }
    
    renderHex();
}

function checkAutoPan(mouseX, mouseY) {
    const edgeThreshold = 50;
    const panSpeed = 10;
    
    let didPan = false;
    
    if (mouseX < edgeThreshold) {
        state.hexMap.viewport.offsetX += panSpeed;
        didPan = true;
    } else if (mouseX > canvas.width - edgeThreshold) {
        state.hexMap.viewport.offsetX -= panSpeed;
        didPan = true;
    }
    
    if (mouseY < edgeThreshold) {
        state.hexMap.viewport.offsetY += panSpeed;
        didPan = true;
    } else if (mouseY > canvas.height - edgeThreshold) {
        state.hexMap.viewport.offsetY -= panSpeed;
        didPan = true;
    }
    
    return didPan;
}

function getVisibleHexRange() {
    const margin = 5;
    
    const corners = [
        { x: 0, y: 0 },
        { x: canvas.width, y: 0 },
        { x: 0, y: canvas.height },
        { x: canvas.width, y: canvas.height }
    ];
    
    const hexCorners = corners.map(corner => pixelToHex(corner.x, corner.y));
    
    let minQ = Infinity, maxQ = -Infinity;
    let minR = Infinity, maxR = -Infinity;
    
    hexCorners.forEach(hex => {
        minQ = Math.min(minQ, hex.q);
        maxQ = Math.max(maxQ, hex.q);
        minR = Math.min(minR, hex.r);
        maxR = Math.max(maxR, hex.r);
    });
    
    return { 
        minQ: minQ - margin, 
        maxQ: maxQ + margin, 
        minR: minR - margin, 
        maxR: maxR + margin 
    };
}

async function loadHexIcon(terrain) {
    if (hexIconCache.has(terrain)) {
        return hexIconCache.get(terrain);
    }
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            hexIconCache.set(terrain, img);
            resolve(img);
        };
        img.onerror = () => resolve(null);
        img.src = TERRAINS[terrain].icon;
    });
}

async function preloadHexIcons() {
    const promises = Object.keys(TERRAINS).map(terrain => loadHexIcon(terrain));
    await Promise.all(promises);
    renderHex();
}

function renderHex() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const { minQ, maxQ, minR, maxR } = getVisibleHexRange();
    const size = state.hexMap.hexSize * state.hexMap.viewport.scale;
    
    // Draw grid
    ctx.strokeStyle = '#1a1f26';
    ctx.lineWidth = 1;
    for (let q = minQ; q <= maxQ; q++) {
        for (let r = minR; r <= maxR; r++) {
            const hex = getHex(q, r);
            if (!hex) {
                const { x, y } = hexToPixel(q, r);
                drawHexagon(ctx, x, y, size);
                ctx.stroke();
            }
        }
    }
    
    // Draw painted hexes
    for (let q = minQ; q <= maxQ; q++) {
        for (let r = minR; r <= maxR; r++) {
            const hex = getHex(q, r);
            if (hex) {
                drawHexTile(hex);
            }
        }
    }
    
    // Draw completed paths
    state.hexMap.paths.forEach(path => drawPath(path));
    
    // Draw current path being created
    if (state.hexMap.currentPath) {
        drawPath(state.hexMap.currentPath);
    }
    
    // Draw hovered path highlight (lighter)
    if (state.hexMap.hoveredPath && state.hexMap.hoveredPath !== state.hexMap.selectedPath) {
        drawPathHoverHighlight(state.hexMap.hoveredPath);
    }
    
    // Draw selected path highlight (brighter)
    if (state.hexMap.selectedPath) {
        drawPathHighlight(state.hexMap.selectedPath);
    }
    
    // Draw landmarks
    state.hexMap.landmarks.forEach(landmark => {
        if (landmark.visible) drawLandmark(landmark);
    });
    
    // Draw tokens
    state.hexMap.tokens.forEach(token => {
        if (token.visible) drawToken(token);
    });
    
    // Draw brush preview
    if (state.hexMap.brushPreviewHexes.length > 0 && (state.hexMap.mode === 'paint' || state.hexMap.mode === 'erase')) {
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.5;
        state.hexMap.brushPreviewHexes.forEach(({ q, r }) => {
            const { x, y } = hexToPixel(q, r);
            drawHexagon(ctx, x, y, size);
            ctx.stroke();
        });
        ctx.globalAlpha = 1;
    }
    
    // Draw selected hex
    if (state.hexMap.selectedHex) {
        const { x, y } = hexToPixel(state.hexMap.selectedHex.q, state.hexMap.selectedHex.r);
        ctx.strokeStyle = '#667eea';
        ctx.lineWidth = 3;
        drawHexagon(ctx, x, y, size);
        ctx.stroke();
    }
    
    // Draw selected token highlight
    if (state.hexMap.selectedToken) {
        const { x, y } = hexToPixel(state.hexMap.selectedToken.q, state.hexMap.selectedToken.r);
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 4]);
        drawHexagon(ctx, x, y, size);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Draw pathfinding routes for tokens
    state.hexMap.tokens.forEach(token => {
        if (token.pathfindingRoute && token.pathfindingRoute.length > 0) {
            drawPathfindingRoute(token);
        }
    });
    
    // Draw path points when in edit mode
    if (state.hexMap.pathEditMode && state.hexMap.selectedPath) {
        drawPathPoints(state.hexMap.selectedPath);
    }
    
    // Update minimap if it exists
    if (document.getElementById('minimapCanvas')) {
        updateMinimapViewport();
    }
}

function drawPathfindingRoute(token) {
    if (!token.pathfindingRoute || token.pathfindingRoute.length < 2) return;
    
    ctx.save();
    ctx.strokeStyle = token.color;
    ctx.lineWidth = 6 * state.hexMap.viewport.scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([10, 5]);
    
    ctx.beginPath();
    token.pathfindingRoute.forEach((point, index) => {
        const { x, y } = hexToPixel(point.q, point.r);
        if (index === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    });
    ctx.stroke();
    
    // Draw destination marker
    const dest = token.pathfindingRoute[token.pathfindingRoute.length - 1];
    const { x, y } = hexToPixel(dest.q, dest.r);
    ctx.globalAlpha = 1;
    ctx.fillStyle = token.color;
    ctx.beginPath();
    ctx.arc(x, y, 8 * state.hexMap.viewport.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.restore();
}

function drawPathPoints(path) {
    path.points.forEach((point, index) => {
        const { x, y } = hexToPixel(point.q, point.r);
        const isHovered = state.hexMap.hoveredPathPoint?.pointIndex === index;
        const isDragging = state.hexMap.draggingPathPoint?.pointIndex === index;
        
        // Point circle
        ctx.save();
        ctx.fillStyle = isDragging ? '#f59e0b' : isHovered ? '#667eea' : '#ffffff';
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 2;
        
        const radius = isDragging ? 10 : isHovered ? 9 : 7;
        
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Point number
        ctx.fillStyle = '#000000';
        ctx.font = 'bold 10px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((index + 1).toString(), x, y);
        
        // Start/End indicators
        if (index === 0) {
            ctx.fillStyle = '#10b981';
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.globalAlpha = 0.3;
            ctx.fill();
            ctx.globalAlpha = 1;
        } else if (index === path.points.length - 1) {
            ctx.fillStyle = '#ef4444';
            ctx.beginPath();
            ctx.arc(x, y, 12, 0, Math.PI * 2);
            ctx.globalAlpha = 0.3;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
        
        ctx.restore();
    });
}

function drawHexTile(hex) {
    const { x, y } = hexToPixel(hex.q, hex.r);
    const size = state.hexMap.hexSize * state.hexMap.viewport.scale;
    
    ctx.fillStyle = TERRAINS[hex.terrain].color;
    drawHexagon(ctx, x, y, size);
    ctx.fill();
    
    ctx.strokeStyle = '#2d3748';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    const icon = hexIconCache.get(hex.terrain);
    if (icon && size > 15) {
        const iconSize = size * 0.8;
        ctx.drawImage(icon, x - iconSize/2, y - iconSize/2, iconSize, iconSize);
    }
    
    if (hex.dungeon) {
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(x + size * 0.4, y - size * 0.4, size * 0.15, 0, Math.PI * 2);
        ctx.fill();
    }
}

function drawToken(token) {
    const { x, y } = hexToPixel(token.q, token.r);
    const size = state.hexMap.hexSize * state.hexMap.viewport.scale;
    const tokenSize = size * 0.85 * token.size * token.scale;
    
    // Safety check: don't render if too small
    if (tokenSize <= 0 || size <= 0) return;
    
    const radius = Math.max(1, tokenSize / 2); // Ensure minimum radius of 1
    
    ctx.save();
    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.arc(x + 2, y + 2, radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Token circle
    ctx.fillStyle = token.color;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = Math.max(1, 2 * token.scale);
    ctx.stroke();
    
    // Display text based on size
    let displayText = token.label;
    if (token.size < 0.8) {
        displayText = token.label.charAt(0).toUpperCase();
    } else if (token.size < 1.3) {
        if (token.label.length > 3) {
            const words = token.label.trim().split(/\s+/);
            displayText = words.length > 1 ? words.map(w => w.charAt(0).toUpperCase()).join('').slice(0, 3) : token.label.slice(0, 3).toUpperCase();
        } else {
            displayText = token.label.toUpperCase();
        }
    } else {
        displayText = token.label.length > 10 ? token.label.slice(0, 10) : token.label;
    }
    
    // Only render text if token is large enough
    if (tokenSize > 10) {
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fontSize = Math.max(10, tokenSize * 0.35);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 1;
        ctx.shadowOffsetY = 1;
        ctx.fillText(displayText, x, y);
    }
    ctx.restore();
}

function drawLandmark(landmark) {
    const { x, y } = hexToPixel(landmark.q, landmark.r);
    const size = state.hexMap.hexSize * state.hexMap.viewport.scale;
    const landmarkSize = size * 0.75 * landmark.size;
    
    // Safety check: don't render if too small
    if (landmarkSize <= 0 || size <= 0) return;
    
    const radius = Math.max(1, landmarkSize / 2); // Ensure minimum radius of 1
    
    ctx.save();
    
    if (landmark.style === 'circle') {
        // Outer glow
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius + 8);
        gradient.addColorStop(0, landmark.color);
        gradient.addColorStop(0.7, landmark.color);
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.globalAlpha = 0.3;
        ctx.beginPath();
        ctx.arc(x, y, radius + 8, 0, Math.PI * 2);
        ctx.fill();
        
        // Main circle with gradient
        ctx.globalAlpha = 0.85;
        const mainGradient = ctx.createRadialGradient(
            x - landmarkSize * 0.2, 
            y - landmarkSize * 0.2, 
            0, 
            x, 
            y, 
            radius
        );
        mainGradient.addColorStop(0, lightenColor(landmark.color, 30));
        mainGradient.addColorStop(1, landmark.color);
        ctx.fillStyle = mainGradient;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        
        // Border
        ctx.globalAlpha = 1;
        ctx.strokeStyle = darkenColor(landmark.color, 30);
        ctx.lineWidth = Math.max(1, 3);
        ctx.stroke();
        
        // Inner highlight (only if large enough)
        if (radius > 5) {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x - landmarkSize * 0.15, y - landmarkSize * 0.15, radius - 5, Math.PI, Math.PI * 1.5);
            ctx.stroke();
        }
        
    } else if (landmark.style === 'icon' && landmark.icon) {
        // Icon style - draw placeholder for now
        ctx.fillStyle = landmark.color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(1, 2);
        ctx.stroke();
        
        // Icon placeholder (only if large enough)
        if (landmarkSize > 10) {
            ctx.fillStyle = '#000000';
            ctx.font = `bold ${landmarkSize * 0.5}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('ðŸ›ï¸', x, y);
        }
    } else if (landmark.style === 'badge') {
        // Badge style - small corner indicator
        const badgeSize = size * 0.4 * landmark.size;
        const badgeRadius = Math.max(1, badgeSize / 2);
        const offsetX = size * 0.3;
        const offsetY = -size * 0.3;
        
        // Glow
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = landmark.color;
        ctx.beginPath();
        ctx.arc(x + offsetX, y + offsetY, badgeRadius + 4, 0, Math.PI * 2);
        ctx.fill();
        
        // Main badge
        ctx.globalAlpha = 1;
        ctx.fillStyle = landmark.color;
        ctx.beginPath();
        ctx.arc(x + offsetX, y + offsetY, badgeRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = Math.max(1, 2);
        ctx.stroke();
    }
    
    // Draw label if enabled (only if landmark is large enough)
    if (landmark.showLabel && landmark.name && landmarkSize > 10) {
        const fontSize = Math.max(11, size * 0.28);
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        
        let labelY = y;
        if (landmark.labelPosition === 'above') {
            labelY = y - radius - fontSize / 2 - 4;
            ctx.textBaseline = 'bottom';
        } else if (landmark.labelPosition === 'below') {
            labelY = y + radius + fontSize / 2 + 4;
            ctx.textBaseline = 'top';
        } else { // inside
            labelY = y;
            ctx.textBaseline = 'middle';
        }
        
        // Text outline (thicker for better visibility)
        ctx.globalAlpha = 1;
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = 4;
        ctx.strokeText(landmark.name, x, labelY);
        
        // Text fill
        ctx.fillStyle = '#ffffff';
        ctx.fillText(landmark.name, x, labelY);
    }
    
    ctx.restore();
}

// Helper functions for color manipulation
function lightenColor(color, percent) {
    const num = parseInt(color.replace("#",""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, (num >> 16) + amt);
    const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
    const B = Math.min(255, (num & 0x0000FF) + amt);
    return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

function darkenColor(color, percent) {
    const num = parseInt(color.replace("#",""), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.max(0, (num >> 16) - amt);
    const G = Math.max(0, (num >> 8 & 0x00FF) - amt);
    const B = Math.max(0, (num & 0x0000FF) - amt);
    return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

// Mode Management
function setViewMode(viewMode) {
    state.hexMap.viewMode = viewMode;
    
    // Update view mode buttons
    document.querySelectorAll('.view-mode-option').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.viewMode === viewMode);
    });
    
    // Show/hide tools section based on view mode
    const toolsSection = document.getElementById('toolsSection');
    const brushSection = document.getElementById('brushSettingsSection');
    const terrainSection = document.getElementById('terrainPaletteSection');
    const tokenSection = document.getElementById('tokenCreatorSection');
    const pathSection = document.getElementById('pathCreatorSection');
    
    if (viewMode === 'explorer') {
        // Hide all builder tools
        toolsSection.style.display = 'none';
        brushSection.style.display = 'none';
        terrainSection.style.display = 'none';
        tokenSection.style.display = 'none';
        pathSection.style.display = 'none';
        
        // Cancel any in-progress actions
        state.hexMap.isPainting = false;
        state.hexMap.pendingToken = null;
        if (state.hexMap.currentPath) {
            cancelPath();
        }
    } else {
        // Show builder tools
        toolsSection.style.display = 'block';
        // Let setHexMode handle which sections to show
        setHexMode(state.hexMap.mode);
    }
    
    updateUI();
    renderHex();
}

function setHexMode(mode) {
    state.hexMap.mode = mode;
    state.hexMap.pendingToken = null;
    state.hexMap.pendingLandmark = null;
    state.hexMap.hoveredPath = null;
    
    // Cancel any in-progress path
    if (state.hexMap.currentPath) {
        cancelPath();
    }
    
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    const tokenSection = document.getElementById('tokenCreatorSection');
    const landmarkSection = document.getElementById('landmarkCreatorSection');
    const brushSection = document.getElementById('brushSettingsSection');
    const terrainSection = document.getElementById('terrainPaletteSection');
    const pathSection = document.getElementById('pathCreatorSection');
    
    tokenSection.style.display = 'none';
    landmarkSection.style.display = 'none';
    brushSection.style.display = 'none';
    terrainSection.style.display = 'none';
    pathSection.style.display = 'none';
    
    if (mode === 'token') {
        tokenSection.style.display = 'block';
    } else if (mode === 'landmark') {
        landmarkSection.style.display = 'block';
    } else if (mode === 'path') {
        pathSection.style.display = 'block';
        selectPathType(state.hexMap.pathType);
        selectPathStyle(state.hexMap.pathStyle);
    } else if (mode === 'paint') {
        brushSection.style.display = 'block';
        terrainSection.style.display = 'block';
    }
    updateUI();
}

function selectTerrain(terrain) {
    if (terrain === 'clear') {
        state.hexMap.selectedTerrain = 'clear';
        document.querySelectorAll('.terrain-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.terrain === 'clear');
        });
        document.getElementById('terrainText').textContent = 'Clear Hex';
        return;
    }
    
    state.hexMap.selectedTerrain = terrain;
    document.querySelectorAll('.terrain-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.terrain === terrain);
    });
    document.getElementById('terrainText').textContent = TERRAINS[terrain].name;
}

function updateBrushSize(value) {
    state.hexMap.brushSize = parseInt(value);
    document.getElementById('brushSizeValue').textContent = value;
}

function updatePaintSpeed(value) {
    state.hexMap.paintSpeed = parseInt(value);
    document.getElementById('paintSpeedValue').textContent = value;
}

function toggleFillMode(enabled) {
    state.hexMap.fillMode = enabled;
}

function updateUI() {
    const modeText = document.getElementById('modeText');
    const instructionText = document.getElementById('instructionText');
    
    // If in Explorer mode, show different instructions
    if (state.hexMap.viewMode === 'explorer') {
        modeText.textContent = 'Explorer Mode';
        instructionText.textContent = 'Click hexes/tokens/landmarks to view info · Drag tokens to move · Right-click drag to pan';
        canvas.style.cursor = 'default';
        return;
    }
    
    const cursorMap = {
        paint: 'crosshair',
        token: 'crosshair',
        path: 'crosshair',
        landmark: 'crosshair'
    };
    
    const instructions = {
        paint: 'Click to paint · Shift+Click to select hex · Drag for continuous painting · Right-click drag to pan',
        token: state.hexMap.pendingToken ? 'Click a hex to place token · ESC to cancel' : 'Click to place token · Shift+Click token to select · Drag token to move',
        landmark: state.hexMap.pendingLandmark ? 'Click a hex to place landmark · ESC to cancel' : 'Click to create landmark · Shift+Click landmark to select',
        path: state.hexMap.pathEditMode ? 'Drag points to move · Click + to insert · Click × to delete · Right-click to pan' : 
              state.hexMap.currentPath ? 'Click to add waypoints · Double-click to finish · ESC to cancel' : 
              'Click to draw new path · Shift+Click path to select/edit'
    };
    
    canvas.style.cursor = cursorMap[state.hexMap.mode] || 'default';
    modeText.textContent = state.hexMap.mode.charAt(0).toUpperCase() + state.hexMap.mode.slice(1) + ' Tool';
    instructionText.textContent = instructions[state.hexMap.mode];
}

// Mouse Events
// ============================================================================
// UNIFIED TOUCH AND MOUSE EVENT HANDLERS
// ============================================================================

let touchState = {
    isPinching: false,
    lastPinchDistance: 0,
    lastTouchPos: { x: 0, y: 0 },
    touches: []
};

// Unified pointer down handler
function handlePointerDown(x, y, button, isTouch, shiftKey = false, detail = 1) {
    const rect = canvas.getBoundingClientRect();
    const canvasX = x - rect.left;
    const canvasY = y - rect.top;
    const hex = pixelToHex(canvasX, canvasY);
    
    // Right click or two-finger touch = pan
    if (button === 2 || button === 1 || (isTouch && touchState.touches.length >= 2)) {
        state.hexMap.isPanning = true;
        state.hexMap.lastPanPos = { x: canvasX, y: canvasY };
        canvas.style.cursor = 'grabbing';
        return;
    }
    
    // Left click / single touch
    if (button === 0 || isTouch) {
        // EXPLORER MODE
        if (state.hexMap.viewMode === 'explorer') {
            const clickedToken = findTokenAtPixel(canvasX, canvasY);
            if (clickedToken) {
                state.hexMap.draggingToken = clickedToken;
                state.hexMap.selectedToken = clickedToken;
                state.hexMap.selectedHex = null;
                animateTokenScale(clickedToken.id, 1.3, 150);
                showTokenDetails(clickedToken);
                canvas.style.cursor = 'grabbing';
            } else {
                const existingHex = getHex(hex.q, hex.r);
                if (existingHex) {
                    state.hexMap.selectedToken = null;
                    selectHex(existingHex);
                }
            }
            return;
        }
        
        // BUILDER MODE
        if (pathfindingState.selectingDestination) {
            pathfindingState.selectingDestination = false;
            startTokenPathfinding(pathfindingState.tokenId, hex.q, hex.r);
            pathfindingState.tokenId = null;
            return;
        }
        
        // SHIFT+CLICK SELECTION (desktop only)
        if (shiftKey && !isTouch) {
            if (state.hexMap.mode === 'paint') {
                const existingHex = getHex(hex.q, hex.r);
                if (existingHex) {
                    state.hexMap.selectedToken = null;
                    selectHex(existingHex);
                }
                return;
            } else if (state.hexMap.mode === 'token') {
                const clickedToken = findTokenAtPixel(canvasX, canvasY);
                if (clickedToken) {
                    state.hexMap.selectedToken = clickedToken;
                    state.hexMap.selectedHex = null;
                    animateTokenScale(clickedToken.id, 1.2, 200);
                    setTimeout(() => animateTokenScale(clickedToken.id, 1.0, 200), 200);
                    showTokenDetails(clickedToken);
                    renderHex();
                }
                return;
            } else if (state.hexMap.mode === 'landmark') {
                const clickedLandmark = findLandmarkAtPixel(canvasX, canvasY);
                if (clickedLandmark) {
                    state.hexMap.selectedLandmark = clickedLandmark;
                    state.hexMap.selectedHex = null;
                    state.hexMap.selectedToken = null;
                    showLandmarkDetails(clickedLandmark);
                    renderHex();
                }
                return;
            } else if (state.hexMap.mode === 'path') {
                const clickedPath = findPathAtPixel(canvasX, canvasY);
                if (clickedPath) {
                    state.hexMap.selectedPath = clickedPath;
                    state.hexMap.selectedHex = null;
                    state.hexMap.selectedToken = null;
                    showPathDetails(clickedPath);
                    renderHex();
                }
                return;
            }
        }
        
        // Path mode
        if (state.hexMap.mode === 'path') {
            if (state.hexMap.pathEditMode && state.hexMap.selectedPath) {
                const clickedPoint = findPathPointAtPixel(canvasX, canvasY, state.hexMap.selectedPath);
                if (clickedPoint) {
                    state.hexMap.draggingPathPoint = clickedPoint;
                    canvas.style.cursor = 'grabbing';
                    return;
                }
                
                if (detail === 2) {
                    const segmentIndex = findPathSegmentAtPixel(canvasX, canvasY, state.hexMap.selectedPath);
                    if (segmentIndex !== null) {
                        insertPointAfter(state.hexMap.selectedPath.id, segmentIndex);
                        return;
                    }
                }
                return;
            }
            
            if (detail === 2) {
                if (state.hexMap.currentPath) {
                    finishPath();
                    return;
                }
                
                if (state.hexMap.selectedPath) {
                    const segmentIndex = findPathSegmentAtPixel(canvasX, canvasY, state.hexMap.selectedPath);
                    if (segmentIndex !== null) {
                        insertPointAfter(state.hexMap.selectedPath.id, segmentIndex);
                        return;
                    }
                }
            } else {
                if (!state.hexMap.currentPath && !shiftKey) {
                    const clickedPath = findPathAtPixel(canvasX, canvasY);
                    if (clickedPath) {
                        state.hexMap.selectedPath = clickedPath;
                        state.hexMap.selectedHex = null;
                        state.hexMap.selectedToken = null;
                        showPathDetails(clickedPath);
                        renderHex();
                        return;
                    }
                }
                
                if (state.hexMap.currentPath || !state.hexMap.selectedPath) {
                    addPathPoint(hex.q, hex.r);
                }
            }
            return;
        }
        
        // Token mode
        if (state.hexMap.mode === 'token') {
            const clickedToken = findTokenAtPixel(canvasX, canvasY);
            if (clickedToken && !shiftKey) {
                state.hexMap.draggingToken = clickedToken;
                animateTokenScale(clickedToken.id, 1.3, 150);
                canvas.style.cursor = 'grabbing';
            } else if (state.hexMap.pendingToken) {
                const newToken = createToken(hex.q, hex.r, state.hexMap.pendingToken);
                state.hexMap.pendingToken = null;
                newToken.scale = 0;
                animateTokenScale(newToken.id, 1, 300);
                renderHex();
                updateUI();
            } else if (!shiftKey) {
                showTokenCreator();
            }
            return;
        }
        
        // Landmark mode
        if (state.hexMap.mode === 'landmark') {
            if (state.hexMap.pendingLandmark) {
                const newLandmark = createLandmark(hex.q, hex.r, state.hexMap.pendingLandmark);
                state.hexMap.pendingLandmark = null;
                renderHex();
                updateUI();
            } else if (!shiftKey) {
                const clickedLandmark = findLandmarkAtPixel(canvasX, canvasY);
                if (clickedLandmark) {
                    state.hexMap.selectedLandmark = clickedLandmark;
                    state.hexMap.selectedHex = null;
                    state.hexMap.selectedToken = null;
                    showLandmarkDetails(clickedLandmark);
                    renderHex();
                } else {
                    showLandmarkCreator();
                }
            }
            return;
        }
        
        // Paint mode
        if (state.hexMap.mode === 'paint') {
            if (state.hexMap.fillMode && state.hexMap.selectedTerrain !== 'clear') {
                floodFill(hex.q, hex.r, state.hexMap.selectedTerrain);
            } else {
                state.hexMap.isPainting = true;
                
                if (state.hexMap.selectedTerrain === 'clear') {
                    const hexesToClear = getHexesInRadius(hex.q, hex.r, state.hexMap.brushSize - 1);
                    hexesToClear.forEach(h => deleteHex(h.q, h.r));
                } else {
                    paintHex(hex.q, hex.r);
                }
                
                state.hexMap.lastPaintPos = hex;
                state.hexMap.paintThrottle = 0;
            }
            renderHex();
        }
    }
}

// Mouse events
canvas.addEventListener('mousedown', (e) => {
    handlePointerDown(e.clientX, e.clientY, e.button, false, e.shiftKey, e.detail);
});

// Touch events
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchState.touches = Array.from(e.touches);
    
    if (e.touches.length === 1) {
        // Single touch
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        const hex = pixelToHex(x, y);
        
        // Start long-press timer for context menu
        mobileState.longPressTriggered = false;
        mobileState.longPressTimer = setTimeout(() => {
            // Long press detected
            const existingHex = getHex(hex.q, hex.r);
            if (existingHex && isMobile) {
                mobileState.longPressTriggered = true;
                
                // Haptic feedback if available
                if (navigator.vibrate) {
                    navigator.vibrate(50);
                }
                
                showContextMenu(touch.clientX, touch.clientY, existingHex);
            }
        }, 500); // 500ms long press
        
        handlePointerDown(touch.clientX, touch.clientY, 0, true);
    } else if (e.touches.length === 2) {
        // Cancel long press timer
        if (mobileState.longPressTimer) {
            clearTimeout(mobileState.longPressTimer);
            mobileState.longPressTimer = null;
        }
        
        // Two finger touch - start pinch or pan
        touchState.isPinching = true;
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        touchState.lastPinchDistance = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
        );
        
        // Use midpoint for panning
        const rect = canvas.getBoundingClientRect();
        const midX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        const midY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
        state.hexMap.lastPanPos = { x: midX, y: midY };
        state.hexMap.isPanning = true;
    }
}, { passive: false });

canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hex = pixelToHex(x, y);
    
    if (state.hexMap.isPanning) {
        const dx = x - state.hexMap.lastPanPos.x;
        const dy = y - state.hexMap.lastPanPos.y;
        state.hexMap.viewport.offsetX += dx;
        state.hexMap.viewport.offsetY += dy;
        state.hexMap.lastPanPos = { x, y };
        renderHex();
        return;
    }
    
    if (state.hexMap.draggingToken) {
        const targetHex = pixelToHex(x, y);
        if (targetHex.q !== state.hexMap.draggingToken.q || targetHex.r !== state.hexMap.draggingToken.r) {
            state.hexMap.draggingToken.q = targetHex.q;
            state.hexMap.draggingToken.r = targetHex.r;
        }
        renderHex();
        return;
    }
    
    if (state.hexMap.viewMode === 'explorer') {
        const hoverToken = findTokenAtPixel(x, y);
        canvas.style.cursor = hoverToken ? 'pointer' : 'default';
        return;
    }
    
    if (state.hexMap.draggingPathPoint) {
        const targetHex = pixelToHex(x, y);
        const point = state.hexMap.selectedPath.points[state.hexMap.draggingPathPoint.pointIndex];
        if (point.q !== targetHex.q || point.r !== targetHex.r) {
            point.q = targetHex.q;
            point.r = targetHex.r;
            renderHex();
        }
        return;
    }
    
    if (state.hexMap.mode === 'path') {
        if (state.hexMap.pathEditMode && state.hexMap.selectedPath) {
            const hoveredPoint = findPathPointAtPixel(x, y, state.hexMap.selectedPath);
            if (hoveredPoint !== state.hexMap.hoveredPathPoint) {
                state.hexMap.hoveredPathPoint = hoveredPoint;
                canvas.style.cursor = hoveredPoint ? 'move' : 'crosshair';
                renderHex();
            }
        } else if (!state.hexMap.currentPath) {
            const hoveredPath = findPathAtPixel(x, y);
            if (hoveredPath !== state.hexMap.hoveredPath) {
                state.hexMap.hoveredPath = hoveredPath;
                canvas.style.cursor = hoveredPath ? 'pointer' : 'crosshair';
                renderHex();
            }
        }
    }
    
    if (state.hexMap.mode === 'paint') {
        state.hexMap.brushPreviewHexes = getHexesInRadius(hex.q, hex.r, state.hexMap.brushSize - 1);
        if (!state.hexMap.isPainting) {
            renderHex();
        }
    }
    
    if (state.hexMap.mode === 'token' && !state.hexMap.draggingToken) {
        const hoverToken = findTokenAtPixel(x, y);
        canvas.style.cursor = hoverToken ? 'pointer' : 'crosshair';
    }
    
    if (state.hexMap.isPainting) {
        const didPan = checkAutoPan(x, y);
        const speedMultiplier = 11 - state.hexMap.paintSpeed;
        state.hexMap.paintThrottle++;
        
        if (state.hexMap.paintThrottle >= speedMultiplier || didPan) {
            const shouldPaint = (hex.q !== state.hexMap.lastPaintPos.q || hex.r !== state.hexMap.lastPaintPos.r);
            
            if (shouldPaint) {
                if (state.hexMap.mode === 'paint') {
                    if (state.hexMap.selectedTerrain === 'clear') {
                        const hexesToClear = getHexesInRadius(hex.q, hex.r, state.hexMap.brushSize - 1);
                        hexesToClear.forEach(h => deleteHex(h.q, h.r));
                    } else {
                        paintHex(hex.q, hex.r);
                    }
                }
                state.hexMap.lastPaintPos = hex;
                renderHex();
            } else if (didPan) {
                renderHex();
            }
            state.hexMap.paintThrottle = 0;
        }
    }
});

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    touchState.touches = Array.from(e.touches);
    
    // Cancel long-press if finger moves
    if (mobileState.longPressTimer) {
        clearTimeout(mobileState.longPressTimer);
        mobileState.longPressTimer = null;
    }
    
    if (e.touches.length === 2 && touchState.isPinching) {
        // Pinch zoom
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const distance = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
        );
        
        if (touchState.lastPinchDistance > 0) {
            const rect = canvas.getBoundingClientRect();
            const midX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
            const midY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
            
            const worldX = (midX - canvas.width / 2 - state.hexMap.viewport.offsetX) / state.hexMap.viewport.scale;
            const worldY = (midY - canvas.height / 2 - state.hexMap.viewport.offsetY) / state.hexMap.viewport.scale;
            
            const zoomFactor = distance / touchState.lastPinchDistance;
            const newScale = Math.max(0.1, Math.min(3, state.hexMap.viewport.scale * zoomFactor));
            
            state.hexMap.viewport.offsetX = midX - canvas.width / 2 - worldX * newScale;
            state.hexMap.viewport.offsetY = midY - canvas.height / 2 - worldY * newScale;
            state.hexMap.viewport.scale = newScale;
            
            renderHex();
            document.getElementById('zoomLevel').textContent = Math.round(newScale * 100) + '%';
        }
        
        touchState.lastPinchDistance = distance;
        
        // Two-finger pan
        const rect = canvas.getBoundingClientRect();
        const midX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
        const midY = (touch1.clientY + touch2.clientY) / 2 - rect.top;
        
        if (state.hexMap.isPanning) {
            const dx = midX - state.hexMap.lastPanPos.x;
            const dy = midY - state.hexMap.lastPanPos.y;
            state.hexMap.viewport.offsetX += dx;
            state.hexMap.viewport.offsetY += dy;
        }
        
        state.hexMap.lastPanPos = { x: midX, y: midY };
        
    } else if (e.touches.length === 1) {
        // Single finger drag
        const touch = e.touches[0];
        const rect = canvas.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        
        if (state.hexMap.draggingToken) {
            const targetHex = pixelToHex(x, y);
            if (targetHex.q !== state.hexMap.draggingToken.q || targetHex.r !== state.hexMap.draggingToken.r) {
                state.hexMap.draggingToken.q = targetHex.q;
                state.hexMap.draggingToken.r = targetHex.r;
            }
            renderHex();
        } else if (state.hexMap.isPainting) {
            const hex = pixelToHex(x, y);
            if (hex.q !== state.hexMap.lastPaintPos.q || hex.r !== state.hexMap.lastPaintPos.r) {
                if (state.hexMap.selectedTerrain === 'clear') {
                    const hexesToClear = getHexesInRadius(hex.q, hex.r, state.hexMap.brushSize - 1);
                    hexesToClear.forEach(h => deleteHex(h.q, h.r));
                } else {
                    paintHex(hex.q, hex.r);
                }
                state.hexMap.lastPaintPos = hex;
                renderHex();
            }
        }
    }
}, { passive: false });

canvas.addEventListener('mouseup', () => {
    if (state.hexMap.draggingToken) {
        animateTokenScale(state.hexMap.draggingToken.id, 1.0, 200);
        state.hexMap.draggingToken = null;
    }
    if (state.hexMap.draggingPathPoint) {
        state.hexMap.draggingPathPoint = null;
        if (state.hexMap.selectedPath) {
            showPathDetails(state.hexMap.selectedPath);
        }
    }
    state.hexMap.isPainting = false;
    state.hexMap.isPanning = false;
    
    const cursorMap = {
        paint: 'crosshair',
        token: 'crosshair',
        path: 'crosshair',
        landmark: 'crosshair'
    };
    canvas.style.cursor = state.hexMap.viewMode === 'explorer' ? 'default' : (cursorMap[state.hexMap.mode] || 'default');
});

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    touchState.touches = Array.from(e.touches);
    
    // Cancel long-press timer
    if (mobileState.longPressTimer) {
        clearTimeout(mobileState.longPressTimer);
        mobileState.longPressTimer = null;
    }
    
    // If long press was triggered, don't process normal touch action
    if (mobileState.longPressTriggered) {
        mobileState.longPressTriggered = false;
        return;
    }
    
    if (e.touches.length === 0) {
        // All fingers lifted
        touchState.isPinching = false;
        touchState.lastPinchDistance = 0;
        state.hexMap.isPanning = false;
        state.hexMap.isPainting = false;
        
        if (state.hexMap.draggingToken) {
            animateTokenScale(state.hexMap.draggingToken.id, 1.0, 200);
            state.hexMap.draggingToken = null;
        }
    } else if (e.touches.length === 1) {
        // One finger remains
        touchState.isPinching = false;
        touchState.lastPinchDistance = 0;
    }
}, { passive: false });

canvas.addEventListener('mouseleave', () => {
    state.hexMap.isPainting = false;
    state.hexMap.isPanning = false;
    state.hexMap.brushPreviewHexes = [];
    state.hexMap.hoveredPath = null;
    state.hexMap.hoveredPathPoint = null;
    state.hexMap.draggingPathPoint = null;
    if (state.hexMap.draggingToken) {
        animateTokenScale(state.hexMap.draggingToken.id, 1.0, 200);
        state.hexMap.draggingToken = null;
    }
    renderHex();
});

canvas.addEventListener('contextmenu', (e) => e.preventDefault());

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    console.log('Wheel event:', e.deltaY, 'Current scale:', state.hexMap.viewport.scale);
    
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Calculate world position before zoom
    const worldX = (mouseX - canvas.width / 2 - state.hexMap.viewport.offsetX) / state.hexMap.viewport.scale;
    const worldY = (mouseY - canvas.height / 2 - state.hexMap.viewport.offsetY) / state.hexMap.viewport.scale;
    
    // Apply zoom
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    const newScale = Math.max(0.1, Math.min(3, state.hexMap.viewport.scale * zoomFactor));
    
    console.log('New scale:', newScale);
    
    // Calculate new offset to keep world position under mouse
    state.hexMap.viewport.offsetX = mouseX - canvas.width / 2 - worldX * newScale;
    state.hexMap.viewport.offsetY = mouseY - canvas.height / 2 - worldY * newScale;
    state.hexMap.viewport.scale = newScale;
    
    renderHex();
    document.getElementById('zoomLevel').textContent = Math.round(state.hexMap.viewport.scale * 100) + '%';
}, { passive: false });

document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in input fields
    const isTyping = document.activeElement.tagName === 'INPUT' || 
                   document.activeElement.tagName === 'TEXTAREA' ||
                   document.activeElement.isContentEditable;
    
    if (isTyping) return;
    
    if (e.key === 'Escape') {
        if (state.hexMap.currentPath) {
            cancelPath();
            updateUI();
        } else if (state.hexMap.pendingToken) {
            state.hexMap.pendingToken = null;
            updateUI();
        } else if (state.hexMap.selectedPath) {
            deselectPath();
        }
    }
});

     function zoomIn() {
    // Zoom towards center of viewport
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Calculate world position at center before zoom
    const worldX = (centerX - canvas.width / 2 - state.hexMap.viewport.offsetX) / state.hexMap.viewport.scale;
    const worldY = (centerY - canvas.height / 2 - state.hexMap.viewport.offsetY) / state.hexMap.viewport.scale;
    
    // Apply zoom
    const newScale = Math.min(3, state.hexMap.viewport.scale * 1.2);
    
    // Calculate new offset to keep world position at center
    state.hexMap.viewport.offsetX = centerX - canvas.width / 2 - worldX * newScale;
    state.hexMap.viewport.offsetY = centerY - canvas.height / 2 - worldY * newScale;
    state.hexMap.viewport.scale = newScale;
    
    renderHex();
    document.getElementById('zoomLevel').textContent = Math.round(state.hexMap.viewport.scale * 100) + '%';
}

      function zoomOut() {
    // Zoom away from center of viewport
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    
    // Calculate world position at center before zoom
    const worldX = (centerX - canvas.width / 2 - state.hexMap.viewport.offsetX) / state.hexMap.viewport.scale;
    const worldY = (centerY - canvas.height / 2 - state.hexMap.viewport.offsetY) / state.hexMap.viewport.scale;
    
    // Apply zoom
    const newScale = Math.max(0.1, state.hexMap.viewport.scale / 1.2);
    
    // Calculate new offset to keep world position at center
    state.hexMap.viewport.offsetX = centerX - canvas.width / 2 - worldX * newScale;
    state.hexMap.viewport.offsetY = centerY - canvas.height / 2 - worldY * newScale;
    state.hexMap.viewport.scale = newScale;
    
    renderHex();
    document.getElementById('zoomLevel').textContent = Math.round(state.hexMap.viewport.scale * 100) + '%';
}

function selectHex(hex) {
    state.hexMap.selectedHex = hex;
    renderHex();
    showHexDetails(hex);
}

function showHexDetails(hex) {
    const panel = document.getElementById('hexDetailsPanel');
    const hasDungeon = hex.dungeon ? true : false;
    
    panel.innerHTML = `
        <div class="minimap-container">
            <div class="minimap-header">
                <span class="minimap-title">Map Overview</span>
                <span class="minimap-stats" id="minimapStats">...</span>
            </div>
            <div class="minimap-wrapper">
                <canvas id="minimapCanvas" class="minimap-canvas"></canvas>
                <div id="minimapViewport" class="minimap-viewport"></div>
            </div>
        </div>

        <div class="details-header">
            <h2>${hex.name || 'Unnamed Hex'}</h2>
            <div class="coords">Hex (${hex.q}, ${hex.r}) · ${TERRAINS[hex.terrain].name}</div>
        </div>
        
        <div class="details-content">
            <div class="form-group">
                <label class="form-label">Hex Name</label>
                <input type="text" class="form-input" value="${hex.name}" 
                       onchange="updateHexName('${hex.q}', '${hex.r}', this.value)"
                       placeholder="Unnamed hex">
            </div>

            <div class="form-group">
                <label class="form-label">Terrain Type</label>
                <select class="form-select" onchange="updateHexTerrain('${hex.q}', '${hex.r}', this.value)">
                    ${Object.keys(TERRAINS).map(t => `
                        <option value="${t}" ${t === hex.terrain ? 'selected' : ''}>
                            ${TERRAINS[t].name}
                        </option>
                    `).join('')}
                </select>
            </div>

            <div class="form-group">
                <label class="form-label">Description</label>
                <textarea class="form-input" 
                          onchange="updateHexDescription('${hex.q}', '${hex.r}', this.value)"
                          placeholder="Add description...">${hex.description}</textarea>
            </div>
        </div>

        <div class="details-actions">
            <button class="btn btn-secondary" style="flex: 1" onclick="deselectHex()">Close</button>
            <button class="btn btn-danger" style="flex: 1" onclick="deleteCurrentHex()">Delete Hex</button>
        </div>
    `;
    
    // Initialize minimap after DOM is ready
    setTimeout(initializeMinimap, 0);
}

function updateHexName(q, r, name) {
    const hex = getHex(parseInt(q), parseInt(r));
    if (hex) {
        hex.name = name;
        markUnsaved();
    }
}

function updateHexTerrain(q, r, terrain) {
    const hex = getHex(parseInt(q), parseInt(r));
    if (hex) {
        hex.terrain = terrain;
        renderHex();
        showHexDetails(hex);
        markUnsaved();
    }
}

function updateHexDescription(q, r, description) {
    const hex = getHex(parseInt(q), parseInt(r));
    if (hex) {
        hex.description = description;
        markUnsaved();
    }
}

function deselectHex() {
    state.hexMap.selectedHex = null;
    renderHex();
    document.getElementById('hexDetailsPanel').innerHTML = `
        <div class="minimap-container">
            <div class="minimap-header">
                <span class="minimap-title">Map Overview</span>
                <span class="minimap-stats" id="minimapStats">...</span>
            </div>
            <div class="minimap-wrapper">
                <canvas id="minimapCanvas" class="minimap-canvas"></canvas>
                <div id="minimapViewport" class="minimap-viewport"></div>
            </div>
        </div>
        
        <div class="no-selection">
            <div class="no-selection-icon">⬡</div>
            <p>Select a hex to view details</p>
            <p style="margin-top: 8px; font-size: 12px;">Click any hex on the map</p>
        </div>
    `;
    
    setTimeout(initializeMinimap, 0);
}

function deleteCurrentHex() {
    if (state.hexMap.selectedHex) {
        deleteHex(state.hexMap.selectedHex.q, state.hexMap.selectedHex.r);
        deselectHex();
    }
}

// MINIMAP FUNCTIONALITY
let minimapState = {
    dragging: false,
    lastRenderTime: 0,
    renderScheduled: false,
    renderTimeout: null
};

function refreshMinimapDebounced() {
    // Clear any existing timeout
    if (minimapState.renderTimeout) {
        clearTimeout(minimapState.renderTimeout);
    }
    
    // Set a new timeout to render after painting stops
    minimapState.renderTimeout = setTimeout(() => {
        if (document.getElementById('minimapCanvas')) {
            renderMinimap();
        }
        minimapState.renderTimeout = null;
    }, 150); // Wait 150ms after last change
}

function initializeMinimap() {
    const canvas = document.getElementById('minimapCanvas');
    const viewport = document.getElementById('minimapViewport');
    const wrapper = document.querySelector('.minimap-wrapper');
    
    if (!canvas || !viewport || !wrapper) return;
    
    renderMinimap();
    
    // Dragging state
    let isDragging = false;
    
    // Start dragging viewport
    viewport.addEventListener('mousedown', (e) => {
        isDragging = true;
        minimapState.dragging = true;
        
        e.preventDefault();
        e.stopPropagation();
    });
    
    // Handle dragging
    const handleMouseMove = (e) => {
        if (!isDragging) return;
        
        const scale = parseFloat(canvas.dataset.scale);
        const minX = parseFloat(canvas.dataset.minX);
        const minY = parseFloat(canvas.dataset.minY);
        
        const canvasRect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - canvasRect.left;
        const mouseY = e.clientY - canvasRect.top;
        
        // Convert mouse position to world coordinates
        const worldX = (mouseX / scale) + minX;
        const worldY = (mouseY / scale) + minY;
        
        // Set viewport to center on this world position
        // offsetX/offsetY represent the negative of the world position we're viewing
        state.hexMap.viewport.offsetX = -worldX * state.hexMap.viewport.scale;
        state.hexMap.viewport.offsetY = -worldY * state.hexMap.viewport.scale;
        
        renderHex();
    };
    
    const handleMouseUp = () => {
        isDragging = false;
        minimapState.dragging = false;
    };
    
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    
    // Click to jump
    canvas.addEventListener('mousedown', (e) => {
        if (e.target !== canvas) return; // Only on canvas, not viewport
        
        const scale = parseFloat(canvas.dataset.scale);
        const minX = parseFloat(canvas.dataset.minX);
        const minY = parseFloat(canvas.dataset.minY);
        
        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        // Convert to world coordinates
        const worldX = (mouseX / scale) + minX;
        const worldY = (mouseY / scale) + minY;
        
        // Center viewport on clicked position
        state.hexMap.viewport.offsetX = -worldX * state.hexMap.viewport.scale;
        state.hexMap.viewport.offsetY = -worldY * state.hexMap.viewport.scale;
        
        renderHex();
    });
}
function getMapBounds() {
    if (state.hexMap.boundsNeedRecalc || !state.hexMap.cachedBounds) {
        return recalculateBounds();
    }
    return state.hexMap.cachedBounds;
}

function getMinimapScale(bounds, canvasSize) {
    const hexSize = state.hexMap.hexSize;
    const worldWidth = bounds.maxX - bounds.minX + hexSize * 2;
    const worldHeight = bounds.maxY - bounds.minY + hexSize * 2;
    const scale = Math.min(canvasSize / worldWidth, canvasSize / worldHeight);
    return scale;
}

function renderMinimap() {
    const canvas = document.getElementById('minimapCanvas');
    const stats = document.getElementById('minimapStats');
    
    if (!canvas || !stats) return;
    
    const ctx = canvas.getContext('2d', { alpha: false });
    const rect = canvas.getBoundingClientRect();
    
    if (state.hexMap.hexes.size === 0) {
        canvas.width = rect.width;
        canvas.height = rect.height;
        ctx.fillStyle = '#0a0e13';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        stats.textContent = 'No hexes';
        return;
    }
    
    const bounds = getMapBounds();
    const hexSize = state.hexMap.hexSize;
    
    // Use ACTUAL pixel bounds from placed hexes - no calculation tricks
    const actualWidth = bounds.maxX - bounds.minX;
    const actualHeight = bounds.maxY - bounds.minY;
    
    // Add ONLY enough padding for one hex radius on each side
    const padding = hexSize * 0.5;
    const totalWidth = actualWidth + padding * 2;
    const totalHeight = actualHeight + padding * 2;
    
    // Scale to fill 98% of available space
    const scale = Math.min((rect.width * 0.98) / totalWidth, (rect.height * 0.98) / totalHeight);
    
    // Calculate map extent for styling decisions
    const mapExtentQ = Math.max(Math.abs(bounds.minQ), Math.abs(bounds.maxQ));
    const mapExtentR = Math.max(Math.abs(bounds.minR), Math.abs(bounds.maxR));
    const mapExtent = Math.max(mapExtentQ, mapExtentR);
    
    // Determine pixel size per hex based on extent
    let pixelsPerHex;
    let renderAsHexagons = false;
    
    if (mapExtent <= 5) {
        pixelsPerHex = Math.max(10, 10 * scale);
        renderAsHexagons = true;
    } else if (mapExtent <= 10) {
        pixelsPerHex = Math.max(8, 8 * scale);
        renderAsHexagons = true;
    } else if (mapExtent <= 15) {
        pixelsPerHex = Math.max(6, 6 * scale);
        renderAsHexagons = true;
    } else if (mapExtent <= 25) {
        pixelsPerHex = 5;
    } else if (mapExtent <= 40) {
        pixelsPerHex = 4;
    } else if (mapExtent <= 70) {
        pixelsPerHex = 3;
    } else if (mapExtent <= 120) {
        pixelsPerHex = 2;
    } else {
        pixelsPerHex = 1;
    }
    
    // Set canvas to exact scaled size
    canvas.width = Math.ceil(totalWidth * scale);
    canvas.height = Math.ceil(totalHeight * scale);
    
    // Store transform data
    canvas.dataset.scale = scale;
    canvas.dataset.minX = bounds.minX - padding;
    canvas.dataset.minY = bounds.minY - padding;
    
    stats.textContent = `${state.hexMap.hexes.size} hexes`;
    
    // Clear
    ctx.fillStyle = '#0a0e13';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.imageSmoothingEnabled = false;
    
    const offsetX = bounds.minX - padding;
    const offsetY = bounds.minY - padding;
    
    // Render hexes
    if (renderAsHexagons) {
        // Small maps: draw actual mini hexagons
        state.hexMap.hexes.forEach(hex => {
            const worldX = hex.q * hexSize * 1.5;
            const worldY = (hex.r * hexSize * Math.sqrt(3)) + (hex.q * hexSize * Math.sqrt(3) / 2);
            
            const x = (worldX - offsetX) * scale;
            const y = (worldY - offsetY) * scale;
            
            const terrain = TERRAINS[hex.terrain];
            ctx.fillStyle = terrain ? terrain.color : '#4a5568';
            
            // Draw hexagon
            const hexRadius = pixelsPerHex * 0.45;
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i;
                const hx = x + hexRadius * Math.cos(angle);
                const hy = y + hexRadius * Math.sin(angle);
                if (i === 0) ctx.moveTo(hx, hy);
                else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.fill();
            
            // Border
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
            ctx.lineWidth = 0.5;
            ctx.stroke();
        });
    } else {
        // Large maps: solid pixel blocks
        state.hexMap.hexes.forEach(hex => {
            const worldX = hex.q * hexSize * 1.5;
            const worldY = (hex.r * hexSize * Math.sqrt(3)) + (hex.q * hexSize * Math.sqrt(3) / 2);
            
            const x = Math.floor((worldX - offsetX) * scale);
            const y = Math.floor((worldY - offsetY) * scale);
            
            const terrain = TERRAINS[hex.terrain];
            ctx.fillStyle = terrain ? terrain.color : '#4a5568';
            ctx.fillRect(x, y, pixelsPerHex, pixelsPerHex);
        });
    }
    
    // Landmarks
    if (state.hexMap.landmarks.size > 0) {
        state.hexMap.landmarks.forEach(landmark => {
            const worldX = landmark.q * hexSize * 1.5;
            const worldY = (landmark.r * hexSize * Math.sqrt(3)) + (landmark.q * hexSize * Math.sqrt(3) / 2);
            
            const x = (worldX - offsetX) * scale;
            const y = (worldY - offsetY) * scale;
            
            ctx.fillStyle = landmark.color || '#ff6b6b';
            const landmarkRadius = (pixelsPerHex * 0.6);
            ctx.beginPath();
            ctx.arc(x, y, landmarkRadius, 0, Math.PI * 2);
            ctx.fill();
        });
    }
    
    updateMinimapViewport();
}

function updateMinimapViewport() {
    const viewport = document.getElementById('minimapViewport');
    const canvas = document.getElementById('minimapCanvas');
    const wrapper = document.querySelector('.minimap-wrapper');
    
    if (!viewport || !canvas || !wrapper) return;
    if (state.hexMap.hexes.size === 0) return;
    
    // Get stored transform data
    const scale = parseFloat(canvas.dataset.scale);
    const minX = parseFloat(canvas.dataset.minX);
    const minY = parseFloat(canvas.dataset.minY);
    
    // Get canvas position within wrapper (it's centered)
    const wrapperRect = wrapper.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const canvasOffsetX = canvasRect.left - wrapperRect.left;
    const canvasOffsetY = canvasRect.top - wrapperRect.top;
    
    // Get main canvas visible area in world coordinates
    const mainCanvas = document.getElementById('hexCanvas');
    const visibleWidth = mainCanvas.width / state.hexMap.viewport.scale;
    const visibleHeight = mainCanvas.height / state.hexMap.viewport.scale;
    
    // Current viewport center in world coordinates
    // The viewport offset represents how much the world is shifted
    // Negative offset means we're looking at positive world coords
    const viewCenterX = -state.hexMap.viewport.offsetX / state.hexMap.viewport.scale;
    const viewCenterY = -state.hexMap.viewport.offsetY / state.hexMap.viewport.scale;
    
    // Convert to minimap pixel coordinates (on canvas)
    const minimapCenterX = (viewCenterX - minX) * scale;
    const minimapCenterY = (viewCenterY - minY) * scale;
    
    // Calculate viewport size on minimap
    const viewWidth = visibleWidth * scale;
    const viewHeight = visibleHeight * scale;
    
    // Position viewport (centered on view center, offset by canvas position in wrapper)
    const left = canvasOffsetX + minimapCenterX - viewWidth / 2;
    const top = canvasOffsetY + minimapCenterY - viewHeight / 2;
    
    viewport.style.left = left + 'px';
    viewport.style.top = top + 'px';
    viewport.style.width = viewWidth + 'px';
    viewport.style.height = viewHeight + 'px';
}

function exportHexMap() {
    const worldData = {
        version: '1.2',
        exportDate: new Date().toISOString(),
        metadata: {
            totalHexes: state.hexMap.hexes.size,
            totalLandmarks: state.hexMap.landmarks.size,
            totalTokens: state.hexMap.tokens.size,
            totalPaths: state.hexMap.paths.length
        },
        viewport: state.hexMap.viewport,
        hexes: [],
        landmarks: [],
        tokens: [],
        paths: []
    };
    
    Array.from(state.hexMap.hexes.values()).forEach(hex => {
        const hexData = {
            q: hex.q,
            r: hex.r,
            terrain: hex.terrain,
            name: hex.name || '',
            description: hex.description || ''
        };
        worldData.hexes.push(hexData);
    });
    
    Array.from(state.hexMap.landmarks.values()).forEach(landmark => {
        worldData.landmarks.push({
            id: landmark.id,
            q: landmark.q,
            r: landmark.r,
            name: landmark.name,
            type: landmark.type,
            style: landmark.style,
            icon: landmark.icon,
            color: landmark.color,
            showLabel: landmark.showLabel,
            labelPosition: landmark.labelPosition,
            size: landmark.size,
            attributes: landmark.attributes,
            notes: landmark.notes,
            visible: landmark.visible,
            created: landmark.created
        });
    });
    
    Array.from(state.hexMap.tokens.values()).forEach(token => {
        worldData.tokens.push({
            id: token.id,
            q: token.q,
            r: token.r,
            name: token.name,
            type: token.type,
            color: token.color,
            label: token.label,
            size: token.size,
            attributes: token.attributes,
            notes: token.notes,
            visible: token.visible,
            created: token.created
        });
    });
    
    state.hexMap.paths.forEach(path => {
        const pathHexes = getPathHexes(path);
        worldData.paths.push({
            id: path.id,
            type: path.type,
            style: path.style,
            width: path.width,
            color: path.color || PATH_STYLES[path.type].color,
            points: path.points,
            hexes: pathHexes, // All hexes this path passes through
            created: path.created
        });
    });
    
    const json = JSON.stringify(worldData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    a.download = `hexworld-${timestamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    alert(`World exported successfully!\n\n${worldData.metadata.totalHexes} hexes\n${worldData.metadata.totalLandmarks} landmarks\n${worldData.metadata.totalTokens} tokens\n${worldData.metadata.totalPaths} paths`);
}

function exportHexMapAsImage() {
    if (state.hexMap.hexes.size === 0) {
        alert('No hexes to export! Create some hexes first.');
        return;
    }

    showExportDialog();
}

function showExportDialog() {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
        background: #1a202c;
        border-radius: 12px;
        padding: 24px;
        width: 400px;
        max-width: 90%;
        color: #e2e8f0;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    `;

    dialog.innerHTML = `
        <h2 style="margin: 0 0 20px 0; font-size: 24px; color: #667eea;">Export Image Settings</h2>
        
        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; font-weight: bold;">Export Mode</label>
            <div style="display: flex; gap: 10px;">
                <label style="flex: 1; cursor: pointer;">
                    <input type="radio" name="exportMode" value="viewport" checked style="margin-right: 6px;">
                    Current View
                </label>
                <label style="flex: 1; cursor: pointer;">
                    <input type="radio" name="exportMode" value="fullmap" style="margin-right: 6px;">
                    Full Map
                </label>
            </div>
            <div style="font-size: 12px; color: #a0aec0; margin-top: 6px;">
                Current View: Exports what you see now with zoom<br>
                Full Map: Exports entire map at custom resolution
            </div>
        </div>

        <div style="margin-bottom: 20px;">
            <label style="display: block; margin-bottom: 8px; font-weight: bold;">
                Hex Size (pixels)
                <span id="hexSizeValue" style="color: #667eea;">30</span>
            </label>
            <input type="range" id="hexSizeSlider" min="10" max="200" value="30" step="5"
                   style="width: 100%; cursor: pointer;">
            <div style="display: flex; justify-content: space-between; font-size: 11px; color: #718096; margin-top: 4px;">
                <span>10px - Low Quality</span>
                <span>200px - Ultra HD</span>
            </div>
        </div>

        <div id="resolutionPreview" style="margin-bottom: 20px; padding: 12px; background: #2d3748; border-radius: 8px; font-size: 13px;">
            <strong>Estimated Resolution:</strong> <span id="estimatedRes">Calculating...</span><br>
            <span style="color: #a0aec0;">File size: <span id="estimatedSize">~2-5 MB</span></span>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 24px;">
            <button id="exportBtn" class="btn btn-primary" style="flex: 1; padding: 12px; font-size: 16px; border: none; border-radius: 8px; cursor: pointer; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; font-weight: bold;">
                🖼️ Export
            </button>
            <button id="cancelBtn" class="btn btn-secondary" style="padding: 12px 20px; font-size: 16px; border: none; border-radius: 8px; cursor: pointer; background: #4a5568; color: white;">
                Cancel
            </button>
        </div>
    `;

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    // Get elements
    const hexSizeSlider = dialog.querySelector('#hexSizeSlider');
    const hexSizeValue = dialog.querySelector('#hexSizeValue');
    const estimatedRes = dialog.querySelector('#estimatedRes');
    const estimatedSize = dialog.querySelector('#estimatedSize');
    const exportModeRadios = dialog.querySelectorAll('input[name="exportMode"]');
    const exportBtn = dialog.querySelector('#exportBtn');
    const cancelBtn = dialog.querySelector('#cancelBtn');

    // Update preview
    function updatePreview() {
        const hexSize = parseInt(hexSizeSlider.value);
        const mode = dialog.querySelector('input[name="exportMode"]:checked').value;
        
        hexSizeValue.textContent = hexSize + 'px';

        let width, height;
        if (mode === 'viewport') {
            width = canvas.width;
            height = canvas.height;
        } else {
            // Calculate bounds in hex coordinates
            let minQ = Infinity, maxQ = -Infinity;
            let minR = Infinity, maxR = -Infinity;
            
            state.hexMap.hexes.forEach(hex => {
                minQ = Math.min(minQ, hex.q);
                maxQ = Math.max(maxQ, hex.q);
                minR = Math.min(minR, hex.r);
                maxR = Math.max(maxR, hex.r);
            });
            
            // Calculate pixel bounds with custom hex size
            let minX = Infinity, maxX = -Infinity;
            let minY = Infinity, maxY = -Infinity;
            
            state.hexMap.hexes.forEach(hex => {
                const x = hexSize * (3/2 * hex.q);
                const y = hexSize * (Math.sqrt(3)/2 * hex.q + Math.sqrt(3) * hex.r);
                minX = Math.min(minX, x);
                maxX = Math.max(maxX, x);
                minY = Math.min(minY, y);
                maxY = Math.max(maxY, y);
            });
            
            const padding = hexSize * 2;
            width = Math.round(maxX - minX + (padding * 2) + hexSize * 2);
            height = Math.round(maxY - minY + (padding * 2) + hexSize * 2);
        }

        estimatedRes.textContent = `${width} × ${height}px`;
        
        const megapixels = (width * height) / 1000000;
        const estimatedMB = Math.max(1, Math.round(megapixels * 0.5));
        estimatedSize.textContent = `~${estimatedMB}-${estimatedMB + 2} MB`;
    }

    hexSizeSlider.addEventListener('input', updatePreview);
    exportModeRadios.forEach(radio => radio.addEventListener('change', updatePreview));

    exportBtn.addEventListener('click', () => {
        const hexSize = parseInt(hexSizeSlider.value);
        const mode = dialog.querySelector('input[name="exportMode"]:checked').value;
        document.body.removeChild(overlay);
        performExport(mode, hexSize);
    });

    cancelBtn.addEventListener('click', () => {
        document.body.removeChild(overlay);
    });

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            document.body.removeChild(overlay);
        }
    });

    updatePreview();
}

function performExport(mode, hexSize) {
    const exportCanvas = document.createElement('canvas');
    const exportCtx = exportCanvas.getContext('2d');

    if (mode === 'viewport') {
        // ============ VIEWPORT MODE: Export exactly what's on screen ============
        exportCanvas.width = canvas.width;
        exportCanvas.height = canvas.height;
        
        // Fill background
        exportCtx.fillStyle = '#0a0d11';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        
        // Draw all hexes using current viewport
        state.hexMap.hexes.forEach(hex => {
            const pos = hexToPixel(hex.q, hex.r);
            const size = state.hexMap.hexSize * state.hexMap.viewport.scale;
            
            const terrain = TERRAINS[hex.terrain];
            
            exportCtx.save();
            exportCtx.translate(pos.x, pos.y);
            
            exportCtx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i;
                const hx = size * Math.cos(angle);
                const hy = size * Math.sin(angle);
                if (i === 0) {
                    exportCtx.moveTo(hx, hy);
                } else {
                    exportCtx.lineTo(hx, hy);
                }
            }
            exportCtx.closePath();
            
            exportCtx.fillStyle = terrain.color;
            exportCtx.fill();
            
            exportCtx.strokeStyle = '#2d3748';
            exportCtx.lineWidth = 1;
            exportCtx.stroke();
            
            exportCtx.restore();
        });

        // Draw paths for viewport mode
        state.hexMap.paths.forEach(path => {
            exportCtx.save();
            exportCtx.strokeStyle = path.color || PATH_STYLES[path.type].color;
            exportCtx.lineWidth = path.width * state.hexMap.viewport.scale;
            exportCtx.lineCap = 'round';
            exportCtx.lineJoin = 'round';

            if (path.style === 'curved' && path.points.length > 2) {
                exportCtx.beginPath();
                for (let i = 0; i < path.points.length - 1; i++) {
                    const p1 = path.points[i];
                    const p2 = path.points[i + 1];
                    
                    const pos1 = hexToPixel(p1.q, p1.r);
                    const pos2 = hexToPixel(p2.q, p2.r);
                    
                    if (i === 0) {
                        exportCtx.moveTo(pos1.x, pos1.y);
                    }
                    
                    if (i < path.points.length - 2) {
                        const p3 = path.points[i + 2];
                        const pos3 = hexToPixel(p3.q, p3.r);
                        
                        const cpX = pos2.x;
                        const cpY = pos2.y;
                        const endX = (pos2.x + pos3.x) / 2;
                        const endY = (pos2.y + pos3.y) / 2;
                        
                        exportCtx.quadraticCurveTo(cpX, cpY, endX, endY);
                    } else {
                        exportCtx.lineTo(pos2.x, pos2.y);
                    }
                }
                exportCtx.stroke();
            } else {
                exportCtx.beginPath();
                path.points.forEach((point, i) => {
                    const pos = hexToPixel(point.q, point.r);
                    if (i === 0) {
                        exportCtx.moveTo(pos.x, pos.y);
                    } else {
                        exportCtx.lineTo(pos.x, pos.y);
                    }
                });
                exportCtx.stroke();
            }
            exportCtx.restore();
        });

        // Draw landmarks for viewport mode
        state.hexMap.landmarks.forEach(landmark => {
            if (!landmark.visible) return;
            
            const pos = hexToPixel(landmark.q, landmark.r);
            const size = (landmark.size || 1) * state.hexMap.hexSize * state.hexMap.viewport.scale * 0.4;
            
            exportCtx.save();
            exportCtx.translate(pos.x, pos.y);
            
            exportCtx.fillStyle = landmark.color || '#FFD700';
            exportCtx.beginPath();
            exportCtx.arc(0, 0, size, 0, Math.PI * 2);
            exportCtx.fill();
            
            exportCtx.strokeStyle = '#000000';
            exportCtx.lineWidth = 2;
            exportCtx.stroke();
            
            if (landmark.showLabel && landmark.name) {
                const labelOffset = size + 8;
                let textX = 0;
                let textY = labelOffset;
                
                if (landmark.labelPosition === 'top') textY = -labelOffset;
                else if (landmark.labelPosition === 'left') { textX = -labelOffset; textY = 0; }
                else if (landmark.labelPosition === 'right') { textX = labelOffset; textY = 0; }
                
                exportCtx.fillStyle = '#FFFFFF';
                exportCtx.strokeStyle = '#000000';
                exportCtx.lineWidth = 3;
                exportCtx.font = 'bold 12px Arial';
                exportCtx.textAlign = 'center';
                exportCtx.textBaseline = 'middle';
                
                exportCtx.strokeText(landmark.name, textX, textY);
                exportCtx.fillText(landmark.name, textX, textY);
            }
            
            exportCtx.restore();
        });

        // Draw tokens for viewport mode
        state.hexMap.tokens.forEach(token => {
            if (!token.visible) return;
            
            const pos = hexToPixel(token.q, token.r);
            const size = (token.size || 1) * state.hexMap.hexSize * state.hexMap.viewport.scale * 0.3;
            
            exportCtx.save();
            exportCtx.translate(pos.x, pos.y);
            
            exportCtx.fillStyle = token.color || '#FF6B6B';
            exportCtx.beginPath();
            exportCtx.arc(0, 0, size, 0, Math.PI * 2);
            exportCtx.fill();
            
            exportCtx.strokeStyle = '#FFFFFF';
            exportCtx.lineWidth = 2;
            exportCtx.stroke();
            
            if (token.label) {
                exportCtx.fillStyle = '#FFFFFF';
                exportCtx.strokeStyle = '#000000';
                exportCtx.lineWidth = 3;
                exportCtx.font = 'bold 10px Arial';
                exportCtx.textAlign = 'center';
                exportCtx.textBaseline = 'middle';
                
                exportCtx.strokeText(token.label, 0, size + 10);
                exportCtx.fillText(token.label, 0, size + 10);
            }
            
            exportCtx.restore();
        });
        
    } else {
        // ============ FULL MAP MODE: Export entire map at custom hex size ============
        
        // Calculate bounds in hex coordinates
        let minQ = Infinity, maxQ = -Infinity;
        let minR = Infinity, maxR = -Infinity;
        
        state.hexMap.hexes.forEach(hex => {
            minQ = Math.min(minQ, hex.q);
            maxQ = Math.max(maxQ, hex.q);
            minR = Math.min(minR, hex.r);
            maxR = Math.max(maxR, hex.r);
        });
        
        // Helper function to convert hex coords to pixel coords for full map export
        function hexToPixelFullMap(q, r) {
            const x = hexSize * (3/2 * q);
            const y = hexSize * (Math.sqrt(3)/2 * q + Math.sqrt(3) * r);
            return { x, y };
        }
        
        // Calculate pixel bounds
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        
        state.hexMap.hexes.forEach(hex => {
            const pos = hexToPixelFullMap(hex.q, hex.r);
            minX = Math.min(minX, pos.x);
            maxX = Math.max(maxX, pos.x);
            minY = Math.min(minY, pos.y);
            maxY = Math.max(maxY, pos.y);
        });
        
        // Add padding
        const padding = hexSize * 2;
        const offsetX = -minX + padding;
        const offsetY = -minY + padding;
        
        exportCanvas.width = Math.round(maxX - minX + (padding * 2) + hexSize * 2);
        exportCanvas.height = Math.round(maxY - minY + (padding * 2) + hexSize * 2);
        
        // Fill background
        exportCtx.fillStyle = '#0a0d11';
        exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        
        // Draw all hexes
        state.hexMap.hexes.forEach(hex => {
            const pos = hexToPixelFullMap(hex.q, hex.r);
            const x = pos.x + offsetX;
            const y = pos.y + offsetY;
            
            const terrain = TERRAINS[hex.terrain];
            
            exportCtx.save();
            exportCtx.translate(x, y);
            
            exportCtx.beginPath();
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i;
                const hx = hexSize * Math.cos(angle);
                const hy = hexSize * Math.sin(angle);
                if (i === 0) {
                    exportCtx.moveTo(hx, hy);
                } else {
                    exportCtx.lineTo(hx, hy);
                }
            }
            exportCtx.closePath();
            
            exportCtx.fillStyle = terrain.color;
            exportCtx.fill();
            
            exportCtx.strokeStyle = '#2d3748';
            exportCtx.lineWidth = 1;
            exportCtx.stroke();
            
            exportCtx.restore();
        });

        // Draw paths for full map mode
        state.hexMap.paths.forEach(path => {
            exportCtx.save();
            exportCtx.strokeStyle = path.color || PATH_STYLES[path.type].color;
            exportCtx.lineWidth = path.width * (hexSize / state.hexMap.hexSize);
            exportCtx.lineCap = 'round';
            exportCtx.lineJoin = 'round';

            if (path.style === 'curved' && path.points.length > 2) {
                exportCtx.beginPath();
                for (let i = 0; i < path.points.length - 1; i++) {
                    const p1 = path.points[i];
                    const p2 = path.points[i + 1];
                    
                    const pos1 = hexToPixelFullMap(p1.q, p1.r);
                    const pos2 = hexToPixelFullMap(p2.q, p2.r);
                    
                    const x1 = pos1.x + offsetX;
                    const y1 = pos1.y + offsetY;
                    const x2 = pos2.x + offsetX;
                    const y2 = pos2.y + offsetY;
                    
                    if (i === 0) {
                        exportCtx.moveTo(x1, y1);
                    }
                    
                    if (i < path.points.length - 2) {
                        const p3 = path.points[i + 2];
                        const pos3 = hexToPixelFullMap(p3.q, p3.r);
                        const x3 = pos3.x + offsetX;
                        const y3 = pos3.y + offsetY;
                        
                        const cpX = x2;
                        const cpY = y2;
                        const endX = (x2 + x3) / 2;
                        const endY = (y2 + y3) / 2;
                        
                        exportCtx.quadraticCurveTo(cpX, cpY, endX, endY);
                    } else {
                        exportCtx.lineTo(x2, y2);
                    }
                }
                exportCtx.stroke();
            } else {
                exportCtx.beginPath();
                path.points.forEach((point, i) => {
                    const pos = hexToPixelFullMap(point.q, point.r);
                    const x = pos.x + offsetX;
                    const y = pos.y + offsetY;
                    
                    if (i === 0) {
                        exportCtx.moveTo(x, y);
                    } else {
                        exportCtx.lineTo(x, y);
                    }
                });
                exportCtx.stroke();
            }
            exportCtx.restore();
        });

        // Draw landmarks for full map mode
        state.hexMap.landmarks.forEach(landmark => {
            if (!landmark.visible) return;
            
            const pos = hexToPixelFullMap(landmark.q, landmark.r);
            const x = pos.x + offsetX;
            const y = pos.y + offsetY;
            const size = (landmark.size || 1) * hexSize * 0.4;
            
            exportCtx.save();
            exportCtx.translate(x, y);
            
            exportCtx.fillStyle = landmark.color || '#FFD700';
            exportCtx.beginPath();
            exportCtx.arc(0, 0, size, 0, Math.PI * 2);
            exportCtx.fill();
            
            exportCtx.strokeStyle = '#000000';
            exportCtx.lineWidth = 2;
            exportCtx.stroke();
            
            if (landmark.showLabel && landmark.name) {
                const labelOffset = size + 8;
                let textX = 0;
                let textY = labelOffset;
                
                if (landmark.labelPosition === 'top') textY = -labelOffset;
                else if (landmark.labelPosition === 'left') { textX = -labelOffset; textY = 0; }
                else if (landmark.labelPosition === 'right') { textX = labelOffset; textY = 0; }
                
                const fontSize = Math.max(10, Math.round(12 * (hexSize / state.hexMap.hexSize)));
                
                exportCtx.fillStyle = '#FFFFFF';
                exportCtx.strokeStyle = '#000000';
                exportCtx.lineWidth = 3;
                exportCtx.font = `bold ${fontSize}px Arial`;
                exportCtx.textAlign = 'center';
                exportCtx.textBaseline = 'middle';
                
                exportCtx.strokeText(landmark.name, textX, textY);
                exportCtx.fillText(landmark.name, textX, textY);
            }
            
            exportCtx.restore();
        });

        // Draw tokens for full map mode
        state.hexMap.tokens.forEach(token => {
            if (!token.visible) return;
            
            const pos = hexToPixelFullMap(token.q, token.r);
            const x = pos.x + offsetX;
            const y = pos.y + offsetY;
            const size = (token.size || 1) * hexSize * 0.3;
            
            exportCtx.save();
            exportCtx.translate(x, y);
            
            exportCtx.fillStyle = token.color || '#FF6B6B';
            exportCtx.beginPath();
            exportCtx.arc(0, 0, size, 0, Math.PI * 2);
            exportCtx.fill();
            
            exportCtx.strokeStyle = '#FFFFFF';
            exportCtx.lineWidth = 2;
            exportCtx.stroke();
            
            if (token.label) {
                const fontSize = Math.max(8, Math.round(10 * (hexSize / state.hexMap.hexSize)));
                
                exportCtx.fillStyle = '#FFFFFF';
                exportCtx.strokeStyle = '#000000';
                exportCtx.lineWidth = 3;
                exportCtx.font = `bold ${fontSize}px Arial`;
                exportCtx.textAlign = 'center';
                exportCtx.textBaseline = 'middle';
                
                exportCtx.strokeText(token.label, 0, size + 10);
                exportCtx.fillText(token.label, 0, size + 10);
            }
            
            exportCtx.restore();
        });
    }

    // Convert canvas to blob and download
    exportCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        a.download = `hexworld-${mode}-${timestamp}.png`;
        a.click();
        URL.revokeObjectURL(url);
        
        alert(`Map exported as image!\n\nMode: ${mode === 'viewport' ? 'Current View' : 'Full Map'}\nResolution: ${exportCanvas.width}x${exportCanvas.height}px\nHex Size: ${mode === 'viewport' ? Math.round(state.hexMap.hexSize * state.hexMap.viewport.scale) : hexSize}px`);
    }, 'image/png');
}

function importHexMap() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            
            if (!data.hexes || !Array.isArray(data.hexes)) {
                alert('Invalid world file format');
                return;
            }
            
            state.hexMap.hexes.clear();
            state.hexMap.landmarks.clear();
            state.hexMap.tokens.clear();
            state.hexMap.paths = [];
            state.hexMap.selectedHex = null;
            state.hexMap.selectedLandmark = null;
            state.hexMap.selectedToken = null;
            state.hexMap.currentPath = null;
            
            data.hexes.forEach(hexData => {
                const key = `${hexData.q},${hexData.r}`;
                state.hexMap.hexes.set(key, {
                    q: hexData.q,
                    r: hexData.r,
                    terrain: hexData.terrain,
                    name: hexData.name || '',
                    description: hexData.description || ''
                });
            });
            
            if (data.landmarks && Array.isArray(data.landmarks)) {
                data.landmarks.forEach(landmarkData => {
                    const key = `${landmarkData.q},${landmarkData.r}`;
                    state.hexMap.landmarks.set(key, {
                        id: landmarkData.id,
                        q: landmarkData.q,
                        r: landmarkData.r,
                        name: landmarkData.name,
                        type: landmarkData.type,
                        style: landmarkData.style,
                        icon: landmarkData.icon,
                        color: landmarkData.color,
                        showLabel: landmarkData.showLabel !== false,
                        labelPosition: landmarkData.labelPosition || 'above',
                        size: landmarkData.size || 1.0,
                        attributes: landmarkData.attributes || {},
                        notes: landmarkData.notes || '',
                        visible: landmarkData.visible !== false,
                        created: landmarkData.created
                    });
                    const idNum = parseInt(landmarkData.id.split('_')[1]);
                    if (idNum >= state.nextLandmarkId) {
                        state.nextLandmarkId = idNum + 1;
                    }
                });
            }
            
            if (data.tokens && Array.isArray(data.tokens)) {
                data.tokens.forEach(tokenData => {
                    state.hexMap.tokens.set(tokenData.id, {
                        id: tokenData.id,
                        q: tokenData.q,
                        r: tokenData.r,
                        name: tokenData.name,
                        type: tokenData.type,
                        color: tokenData.color,
                        label: tokenData.label,
                        size: tokenData.size,
                        attributes: tokenData.attributes || {},
                        notes: tokenData.notes || '',
                        visible: tokenData.visible !== false,
                        scale: 1,
                        created: tokenData.created
                    });
                    const idNum = parseInt(tokenData.id.split('_')[1]);
                    if (idNum >= state.nextTokenId) {
                        state.nextTokenId = idNum + 1;
                    }
                });
            }
            
            if (data.paths && Array.isArray(data.paths)) {
                data.paths.forEach(pathData => {
                    state.hexMap.paths.push({
                        id: pathData.id,
                        type: pathData.type,
                        style: pathData.style,
                        width: pathData.width,
                        color: pathData.color || PATH_STYLES[pathData.type].color,
                        points: pathData.points,
                        created: pathData.created
                    });
                    const idNum = parseInt(pathData.id.split('_')[1]);
                    if (idNum >= state.nextPathId) {
                        state.nextPathId = idNum + 1;
                    }
                });
            }
            
            if (data.viewport) {
                state.hexMap.viewport = data.viewport;
            }
               // Force bounds recalculation after import
            state.hexMap.boundsNeedRecalc = true;
            updateHexCount();
            deselectHex();
            renderHex();
            
            const landmarkCount = data.landmarks ? data.landmarks.length : 0;
            const tokenCount = data.tokens ? data.tokens.length : 0;
            const pathCount = data.paths ? data.paths.length : 0;
            alert(`World imported successfully!\n\n${data.hexes.length} hexes\n${landmarkCount} landmarks\n${tokenCount} tokens\n${pathCount} paths`);
            
        } catch (error) {
            console.error('Import error:', error);
            alert('Error importing world file. Please check the file format.');
        }
    };
    input.click();
}

function clearHexMap() {
    if (confirm('Clear all hexes, tokens, and paths? This cannot be undone.')) {
        state.hexMap.hexes.clear();
        state.hexMap.tokens.clear();
        state.hexMap.paths = [];
        state.hexMap.selectedHex = null;
        state.hexMap.selectedToken = null;
        state.hexMap.selectedPath = null;
        state.hexMap.currentPath = null;
        // Reset bounds cache
        state.hexMap.cachedBounds = null;
        state.hexMap.boundsNeedRecalc = true;
        
        // Clear the cached data
        clearMapCache().then(() => {
            console.log('Map and cache cleared');
            updateSaveIndicator('idle');
        }).catch(err => {
            console.error('Error clearing cache:', err);
        });
        
        updateHexCount();
        deselectHex();
        renderHex();
    }
}

function createStarterMap() {
    state.hexMap.hexes.clear();
    state.hexMap.tokens.clear();
    state.hexMap.paths = [];
    state.hexMap.selectedHex = null;
    state.hexMap.selectedToken = null;
    state.hexMap.currentPath = null;
    
    const mapWidth = 10;
    const mapHeight = 10;
    
    for (let col = 0; col < mapWidth; col++) {
        for (let row = 0; row < mapHeight; row++) {
            const q = col - Math.floor(mapWidth / 2);
            const r = row - Math.floor(mapHeight / 2) - Math.floor(col / 2);
            
            let terrain;
            const centerQ = 0;
            const centerR = 0;
            const distance = Math.sqrt((q - centerQ) ** 2 + (r - centerR) ** 2);
            
            if (distance < 2) {
                terrain = 'grassland';
            } else if (distance < 3) {
                terrain = Math.random() > 0.5 ? 'plains' : 'forest';
            } else if (distance < 4) {
                terrain = Math.random() > 0.7 ? 'hills' : 'forest';
            } else if (distance < 5) {
                const rand = Math.random();
                if (rand > 0.7) terrain = 'mountain';
                else if (rand > 0.4) terrain = 'hills';
                else terrain = 'forest';
            } else {
                const rand = Math.random();
                if (rand > 0.8) terrain = 'mountain';
                else if (rand > 0.6) terrain = 'water';
                else if (rand > 0.4) terrain = 'desert';
                else terrain = 'tundra';
            }
            setHex(q, r, terrain);
        }
    }
    
    updateHexCount();
    deselectHex();
    renderHex();
}

function updateHexTopBar() {
    const actions = document.getElementById('topbarActions');
    actions.innerHTML = `
        <button class="btn btn-secondary" onclick="importHexMap()">📥 Import World</button>
        <button class="btn btn-secondary" onclick="exportHexMap()">💾 Export JSON</button>
        <button class="btn btn-secondary" onclick="exportHexMapAsImage()">🖼️ Export Image</button>
        <button class="btn btn-danger" onclick="clearHexMap()">Clear Map</button>
    `;
}

// ===== INDEXEDDB AUTO-SAVE SYSTEM =====
const DB_NAME = 'HexWorldsDB';
const DB_VERSION = 1;
const STORE_NAME = 'mapData';
const AUTO_SAVE_INTERVAL = 3000; // Auto-save every 3 seconds

let db = null;
let autoSaveTimer = null;
let hasUnsavedChanges = false;

// Initialize IndexedDB
function initDatabase() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => {
            console.error('Failed to open database');
            reject(request.error);
        };
        
        request.onsuccess = () => {
            db = request.result;
            console.log('Database initialized successfully');
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
}

// Save map data to IndexedDB
function saveMapToCache() {
    if (!db) return;
    
    updateSaveIndicator('saving');
    
    const mapData = {
        id: 'currentMap',
        timestamp: Date.now(),
        data: {
            hexes: Array.from(state.hexMap.hexes.entries()).map(([key, hex]) => ({
                q: hex.q,
                r: hex.r,
                terrain: hex.terrain,
                name: hex.name,
                description: hex.description
            })),
            landmarks: Array.from(state.hexMap.landmarks.entries()).map(([key, landmark]) => ({
                id: landmark.id,
                q: landmark.q,
                r: landmark.r,
                name: landmark.name,
                type: landmark.type,
                style: landmark.style,
                icon: landmark.icon,
                color: landmark.color,
                showLabel: landmark.showLabel,
                labelPosition: landmark.labelPosition,
                size: landmark.size,
                attributes: landmark.attributes,
                notes: landmark.notes,
                visible: landmark.visible,
                created: landmark.created
            })),
            tokens: Array.from(state.hexMap.tokens.entries()).map(([id, token]) => ({
                id: token.id,
                q: token.q,
                r: token.r,
                name: token.name,
                type: token.type,
                color: token.color,
                label: token.label,
                size: token.size,
                attributes: token.attributes,
                notes: token.notes,
                visible: token.visible,
                created: token.created
            })),
            paths: state.hexMap.paths.map(path => ({
                id: path.id,
                type: path.type,
                style: path.style,
                width: path.width,
                color: path.color,
                points: path.points,
                created: path.created
            })),
            viewport: state.hexMap.viewport,
            nextLandmarkId: state.nextLandmarkId,
            nextTokenId: state.nextTokenId,
            nextPathId: state.nextPathId
        }
    };
    
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(mapData);
    
    request.onsuccess = () => {
        hasUnsavedChanges = false;
        updateSaveIndicator('saved');
        setTimeout(() => updateSaveIndicator('idle'), 2000);
    };
    
    request.onerror = () => {
        console.error('Failed to save map to cache');
        updateSaveIndicator('error');
    };
}

// Load map data from IndexedDB
function loadMapFromCache() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject('Database not initialized');
            return;
        }
        
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get('currentMap');
        
        request.onsuccess = () => {
            if (request.result) {
                resolve(request.result.data);
            } else {
                resolve(null);
            }
        };
        
        request.onerror = () => {
            reject(request.error);
        };
    });
}

// Clear cached data from IndexedDB
function clearMapCache() {
    return new Promise((resolve, reject) => {
        if (!db) {
            resolve();
            return;
        }
        
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete('currentMap');
        
        request.onsuccess = () => {
            console.log('Cache cleared successfully');
            resolve();
        };
        
        request.onerror = () => {
            console.error('Failed to clear cache');
            reject(request.error);
        };
    });
}

// Update save indicator UI
function updateSaveIndicator(status) {
    // Use the new save button system
    const saveBtn = document.getElementById('saveBtn');
    const saveText = document.getElementById('saveText');
    const saveIcon = document.getElementById('saveIcon');
    
    if (!saveBtn || !saveText || !saveIcon) return;
    
    saveBtn.classList.remove('saving', 'saved');
    saveIcon.classList.remove('spinning');
    
    switch (status) {
        case 'saving':
            saveBtn.classList.add('saving');
            saveText.textContent = 'Saving...';
            saveIcon.classList.add('spinning');
            saveBtn.title = 'Saving your changes...';
            break;
        case 'saved':
            saveBtn.classList.add('saved');
            saveText.textContent = 'Saved';
            saveBtn.title = 'All changes saved';
            break;
        case 'error':
            saveText.textContent = 'Save Error';
            saveBtn.title = 'Error saving changes';
            break;
        case 'idle':
        default:
            saveText.textContent = 'Saved';
            saveBtn.title = 'Auto-save enabled';
            break;
    }
}

// Mark that changes have been made
function markUnsaved() {
    hasUnsavedChanges = true;
}

// Start auto-save timer
function startAutoSave() {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
    }
    
    autoSaveTimer = setInterval(() => {
        if (hasUnsavedChanges) {
            saveMapToCache();
        }
    }, AUTO_SAVE_INTERVAL);
}

// Stop auto-save timer
function stopAutoSave() {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
        autoSaveTimer = null;
    }
}

// Restore map from cache
async function restoreMapFromCache() {
    try {
        const cachedData = await loadMapFromCache();
        
        if (!cachedData) {
            console.log('No cached data found');
            return false;
        }
        
        // Clear current state
        state.hexMap.hexes.clear();
        state.hexMap.landmarks.clear();
        state.hexMap.tokens.clear();
        state.hexMap.paths = [];
        state.hexMap.selectedHex = null;
        state.hexMap.selectedToken = null;
        state.hexMap.selectedPath = null;
        state.hexMap.currentPath = null;
        
        // Restore hexes
        cachedData.hexes.forEach(hexData => {
            const key = `${hexData.q},${hexData.r}`;
            state.hexMap.hexes.set(key, {
                q: hexData.q,
                r: hexData.r,
                terrain: hexData.terrain,
                name: hexData.name || '',
                description: hexData.description || ''
            });
        });
        
        // Restore landmarks
        if (cachedData.landmarks) {
            cachedData.landmarks.forEach(landmarkData => {
                const key = `${landmarkData.q},${landmarkData.r}`;
                state.hexMap.landmarks.set(key, {
                    id: landmarkData.id,
                    q: landmarkData.q,
                    r: landmarkData.r,
                    name: landmarkData.name,
                    type: landmarkData.type,
                    style: landmarkData.style,
                    icon: landmarkData.icon,
                    color: landmarkData.color,
                    showLabel: landmarkData.showLabel !== false,
                    labelPosition: landmarkData.labelPosition || 'above',
                    size: landmarkData.size || 1.0,
                    attributes: landmarkData.attributes || {},
                    notes: landmarkData.notes || '',
                    visible: landmarkData.visible !== false,
                    created: landmarkData.created
                });
            });
        }
        
        // Restore tokens
        if (cachedData.tokens) {
            cachedData.tokens.forEach(tokenData => {
                state.hexMap.tokens.set(tokenData.id, {
                    id: tokenData.id,
                    q: tokenData.q,
                    r: tokenData.r,
                    name: tokenData.name,
                    type: tokenData.type,
                    color: tokenData.color,
                    label: tokenData.label,
                    size: tokenData.size,
                    attributes: tokenData.attributes || {},
                    notes: tokenData.notes || '',
                    visible: tokenData.visible !== false,
                    scale: 1,
                    created: tokenData.created
                });
            });
        }
        
        // Restore paths
        if (cachedData.paths) {
            state.hexMap.paths = cachedData.paths.map(pathData => ({
                id: pathData.id,
                type: pathData.type,
                style: pathData.style,
                width: pathData.width,
                color: pathData.color,
                points: pathData.points,
                created: pathData.created
            }));
        }
        
        // Restore viewport
        if (cachedData.viewport) {
            state.hexMap.viewport = cachedData.viewport;
        }
        
        // Restore ID counters
        if (cachedData.nextLandmarkId) state.nextLandmarkId = cachedData.nextLandmarkId;
        if (cachedData.nextTokenId) state.nextTokenId = cachedData.nextTokenId;
        if (cachedData.nextPathId) state.nextPathId = cachedData.nextPathId;
        
        updateHexCount();
        deselectHex();
        renderHex();
        
        console.log('Map restored from cache successfully');
        return true;
        
    } catch (error) {
        console.error('Failed to restore map from cache:', error);
        return false;
    }
}

function resizeCanvas() {
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = canvas.parentElement.offsetHeight;
    renderHex();
}

async function init() {
    const terrainPalette = document.getElementById('terrainPalette');
    Object.entries(TERRAINS).forEach(([key, terrain]) => {
        const btn = document.createElement('button');
        btn.className = `terrain-btn ${key === 'plains' ? 'active' : ''}`;
        btn.dataset.terrain = key;
        btn.onclick = () => selectTerrain(key);
        btn.innerHTML = `
            <div class="terrain-icon" style="background: ${terrain.color}">
                <img src="${terrain.icon}" alt="${terrain.name}">
            </div>
            <span class="terrain-name">${terrain.name}</span>
        `;
        terrainPalette.appendChild(btn);
    });
    
    // Add Clear Hex button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'terrain-btn';
    clearBtn.dataset.terrain = 'clear';
    clearBtn.onclick = () => selectTerrain('clear');
    clearBtn.innerHTML = `
        <div class="terrain-icon" style="background: #2d3748; border: 2px dashed #4a5568;">
            <svg style="width: 24px; height: 24px; fill: #a0aec0;" viewBox="0 0 24 24">
                <path d="M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z" />
            </svg>
        </div>
        <span class="terrain-name">Clear Hex</span>
    `;
    terrainPalette.appendChild(clearBtn);
    
    // Initialize database
    try {
        await initDatabase();
        
        // Try to restore from cache
        const restored = await restoreMapFromCache();
        
        // If no cached data, create starter map
        if (!restored) {
            createStarterMap();
        }
        
        // Start auto-save
        startAutoSave();
        
    } catch (error) {
        console.error('Database initialization failed:', error);
        // Fallback to starter map if database fails
        createStarterMap();
    }
    
    preloadHexIcons();
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();
    updateUI();
    updateHexTopBar();
    
    // Initialize minimap
    setTimeout(initializeMinimap, 100);
}

init();
// ============================================================================
// MOBILE RESPONSIVE SYSTEM
// ============================================================================

let isMobile = false;
let mobileState = {
    sheetExpanded: false,
    currentTab: 'tools',
    touchStartY: 0,
    touchCurrentY: 0,
    longPressTimer: null,
    longPressTriggered: false,
    contextMenuOpen: false,
    minimapFullscreen: false
};

function detectMobile() {
    isMobile = window.innerWidth <= 768 || 
               ('ontouchstart' in window) || 
               (navigator.maxTouchPoints > 0);
    return isMobile;
}

function initMobileUI() {
    if (!detectMobile()) return;

    console.log('Mobile device detected - initializing mobile UI');

    // Create mobile bottom sheet
    createMobileBottomSheet();

    // Create mobile minimap
    createMobileMinimap();

    // Update canvas overlay for mobile
    updateMobileOverlay();

    // Set initial mode
    setHexMode('paint');
    selectTerrain('plains');
}

function createMobileBottomSheet() {
    const main = document.querySelector('.main');
    
    const sheet = document.createElement('div');
    sheet.className = 'mobile-bottom-sheet collapsed';
    sheet.id = 'mobileBottomSheet';
    
    sheet.innerHTML = `
        <div class="mobile-sheet-handle" id="mobileSheetHandle"></div>
        
        <div class="mobile-tabs">
            <button class="mobile-tab active" data-tab="tools">🎨 Tools</button>
            <button class="mobile-tab" data-tab="path">🛤️ Paths</button>
            <button class="mobile-tab" data-tab="token">🎭 Tokens</button>
        </div>

        <div class="mobile-content">
            <!-- Tools Tab -->
            <div class="mobile-tab-content" id="mobileToolsTab">
                <div class="mobile-section-header">Select Tool</div>
                
                <div class="mobile-tool-grid">
                    <div class="mobile-tool-card active" data-mode="paint" onclick="switchMobileTool('paint')">
                        <div class="mode-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M7,14C5.9,14 5,13.1 5,12C5,10.9 5.9,10 7,10C8.1,10 9,10.9 9,12C9,13.1 8.1,14 7,14M12.6,10C11.8,7.7 9.6,6 7,6C3.7,6 1,8.7 1,12C1,15.3 3.7,18 7,18C9.6,18 11.8,16.3 12.6,14H16V18H20V14H23V10H12.6Z"/>
                            </svg>
                        </div>
                        <span class="mobile-tool-label">Paint</span>
                    </div>
                    <div class="mobile-tool-card" data-mode="select" onclick="switchMobileTool('select')">
                        <div class="mode-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12,2C17.53,2 22,6.47 22,12C22,17.53 17.53,22 12,22C6.47,22 2,17.53 2,12C2,6.47 6.47,2 12,2M15.59,7L12,10.59L8.41,7L7,8.41L10.59,12L7,15.59L8.41,17L12,13.41L15.59,17L17,15.59L13.41,12L17,8.41L15.59,7Z"/>
                            </svg>
                        </div>
                        <span class="mobile-tool-label">Select</span>
                    </div>
                    <div class="mobile-tool-card" data-mode="path" onclick="switchMobileTool('path')">
                        <div class="mode-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M14,16.94L8.58,11.5L14,6.06L15.06,7.12L11.18,11L19,11V13H11.18L15.06,16.88L14,16.94M2,11V13H8V11H2Z"/>
                            </svg>
                        </div>
                        <span class="mobile-tool-label">Path</span>
                    </div>
                    <div class="mobile-tool-card" data-mode="token" onclick="switchMobileTool('token')">
                        <div class="mode-icon">
                            <svg viewBox="0 0 24 24" fill="currentColor">
                                <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z"/>
                            </svg>
                        </div>
                        <span class="mobile-tool-label">Token</span>
                    </div>
                </div>

                <!-- Dynamic Tool Options -->
                <div id="mobileToolOptions" style="margin-top: 20px;">
                    <!-- Brush Size (for Paint tool) -->
                    <div id="mobileBrushSize" style="display: block;">
                        <div class="mobile-section-header">Brush Size</div>
                        <div class="mobile-brush-control">
                            <div class="mobile-slider-control">
                                <input type="range" class="slider" min="1" max="5" value="1" 
                                       oninput="updateBrushSize(this.value); document.getElementById('mobileBrushSizeValue').textContent = this.value">
                                <span class="slider-value" id="mobileBrushSizeValue">1</span>
                            </div>
                        </div>
                    </div>

                    <!-- Terrain Selection (for Paint tool) -->
                    <div id="mobileTerrainPicker" style="display: block;">
                        <div class="mobile-section-header">Select Terrain</div>
                        <div class="mobile-terrain-scroll" id="mobileTerrainScrollInTools">
                            <!-- Will be populated dynamically -->
                        </div>
                    </div>
                </div>
            </div>


            <!-- Path Tab -->
            <div class="mobile-tab-content" id="mobilePathTab" style="display: none;">
                <div class="mobile-section-header">Path Tools</div>
                <div class="mobile-info-card">
                    <strong style="color: #667eea;">🛤️ Path Mode:</strong><br>
                    • Tap hexes to create waypoints<br>
                    • Double-tap to finish path<br>
                    • Paths coming soon!
                </div>
            </div>

            <!-- Token Tab -->
            <div class="mobile-tab-content" id="mobileTokenTab" style="display: none;">
                <div class="mobile-section-header">Token Tools</div>
                <div class="mobile-info-card">
                    <strong style="color: #667eea;">🎭 Token Mode:</strong><br>
                    • Tap to place tokens<br>
                    • Drag to move tokens<br>
                    • Full UI coming soon!
                </div>
            </div>
        </div>
    `;
    
    main.appendChild(sheet);

    // Populate terrain scroll
    populateMobileTerrainScroll();

    // Add touch handlers
    setupMobileSheetHandlers();

    // Add tab switchers
    setupMobileTabSwitchers();
}

function populateMobileTerrainScroll(scrollId = 'mobileTerrainScroll') {
    const scroll = document.getElementById(scrollId);
    if (!scroll) return;

    Object.entries(TERRAINS).forEach(([key, terrain]) => {
        const card = document.createElement('div');
        card.className = `mobile-terrain-card ${key === 'plains' ? 'active' : ''}`;
        card.dataset.terrain = key;
        card.onclick = () => {
            selectTerrain(key);
            updateMobileTerrainSelection(key);
        };
        
        card.innerHTML = `
            <div class="mobile-terrain-icon" style="background: ${terrain.color}">
                <img src="${terrain.icon}" alt="${terrain.name}">
            </div>
            <span class="mobile-terrain-name">${terrain.name}</span>
        `;
        
        scroll.appendChild(card);
    });
}

function updateMobileTerrainSelection(terrain) {
    document.querySelectorAll('.mobile-terrain-card').forEach(card => {
        card.classList.toggle('active', card.dataset.terrain === terrain);
    });
}

function setupMobileSheetHandlers() {
    const handle = document.getElementById('mobileSheetHandle');
    const sheet = document.getElementById('mobileBottomSheet');
    const tabs = document.querySelector('.mobile-tabs');
    
    if (!handle || !sheet) return;

    let startY = 0;
    let currentY = 0;
    let startTime = 0;
    let isDragging = false;
    let initialTransform = 0;

    // Make entire tab bar draggable
    const dragElements = [handle, tabs];
    
    dragElements.forEach(element => {
        element.addEventListener('touchstart', (e) => {
            startY = e.touches[0].clientY;
            startTime = Date.now();
            isDragging = false;
            
            // Get current transform value
            const style = window.getComputedStyle(sheet);
            const matrix = new DOMMatrix(style.transform);
            initialTransform = matrix.m42; // translateY value
            
            e.preventDefault();
        }, { passive: false });

        element.addEventListener('touchmove', (e) => {
            if (!startY) return;
            
            currentY = e.touches[0].clientY;
            const diff = currentY - startY;
            
            // Start dragging after 5px movement
            if (Math.abs(diff) > 5) {
                isDragging = true;
                sheet.classList.add('mobile-sheet-dragging');
                
                // Calculate new position
                const sheetHeight = sheet.offsetHeight;
                const collapsedHeight = 52;
                const maxDrag = sheetHeight - collapsedHeight;
                
                let newTransform = initialTransform + diff;
                
                // Clamp between fully expanded (0) and collapsed
                newTransform = Math.max(0, Math.min(maxDrag, newTransform));
                
                sheet.style.transform = `translateY(${newTransform}px)`;
            }
            
            e.preventDefault();
        }, { passive: false });

        element.addEventListener('touchend', (e) => {
            if (!isDragging) {
                // Just a tap, toggle
                toggleMobileSheet();
            } else {
                // Drag ended, determine final position based on velocity
                const dragDuration = Date.now() - startTime;
                const dragDistance = currentY - startY;
                const velocity = dragDistance / dragDuration; // px/ms
                
                const style = window.getComputedStyle(sheet);
                const matrix = new DOMMatrix(style.transform);
                const currentTransform = matrix.m42;
                
                const sheetHeight = sheet.offsetHeight;
                const collapsedHeight = 52;
                const threshold = (sheetHeight - collapsedHeight) / 2;
                
                // Fast swipe detection
                const isFastSwipe = Math.abs(velocity) > 0.5;
                
                if (isFastSwipe) {
                    // Fast swipe overrides position
                    if (velocity > 0) {
                        collapseMobileSheet();
                    } else {
                        expandMobileSheet();
                    }
                } else {
                    // Slow drag, snap to nearest position
                    if (currentTransform > threshold) {
                        collapseMobileSheet();
                    } else {
                        expandMobileSheet();
                    }
                }
                
                // Re-enable transition
                sheet.classList.remove('mobile-sheet-dragging');
                sheet.style.transform = '';
            }
            
            startY = 0;
            currentY = 0;
            isDragging = false;
            
            e.preventDefault();
        }, { passive: false });
    });

    // Click on handle still toggles
    handle.addEventListener('click', (e) => {
        if (!isDragging) {
            toggleMobileSheet();
        }
    });
}

function setupMobileTabSwitchers() {
    document.querySelectorAll('.mobile-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchMobileTab(tabName);
        });
    });
}

function switchMobileTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.mobile-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.mobile-tab-content').forEach(content => {
        content.style.display = 'none';
    });
    
    const targetTab = document.getElementById(`mobile${tabName.charAt(0).toUpperCase() + tabName.slice(1)}Tab`);
    if (targetTab) {
        targetTab.style.display = 'block';
    }

    mobileState.currentTab = tabName;

    // Expand sheet when switching tabs
    if (!mobileState.sheetExpanded) {
        expandMobileSheet();
    }
}

function toggleMobileSheet() {
    if (mobileState.sheetExpanded) {
        collapseMobileSheet();
    } else {
        expandMobileSheet();
    }
}

function expandMobileSheet() {
    const sheet = document.getElementById('mobileBottomSheet');
    if (sheet) {
        sheet.classList.remove('collapsed');
        sheet.classList.add('expanded');
        mobileState.sheetExpanded = true;
    }
}

function collapseMobileSheet() {
    const sheet = document.getElementById('mobileBottomSheet');
    if (sheet) {
        sheet.classList.remove('expanded');
        sheet.classList.add('collapsed');
        mobileState.sheetExpanded = false;
    }
}

function createMobileMinimap() {
    const canvasContainer = document.querySelector('.canvas-container');
    
    const minimap = document.createElement('div');
    minimap.className = 'mobile-minimap-float';
    minimap.id = 'mobileMinimap';
    
    const minimapCanvas = document.createElement('canvas');
    minimapCanvas.id = 'mobileMinimapCanvas';
    minimap.appendChild(minimapCanvas);
    
    canvasContainer.appendChild(minimap);
    
    // Click to open fullscreen
    minimap.addEventListener('click', () => {
        openFullscreenMinimap();
    });
    
    // Render minimap periodically
    setInterval(() => {
        if (isMobile && state.hexMap.hexes.size > 0) {
            renderMobileMinimap();
        }
    }, 1000);
}

function renderMobileMinimap() {
    const canvas = document.getElementById('mobileMinimapCanvas');
    if (!canvas || state.hexMap.hexes.size === 0) return;

    const ctx = canvas.getContext('2d');
    canvas.width = 100;
    canvas.height = 100;

    ctx.fillStyle = '#0a0d11';
    ctx.fillRect(0, 0, 100, 100);

    const bounds = getMapBounds();
    const scale = getMinimapScale(bounds, 100);

    state.hexMap.hexes.forEach(hex => {
        const x = ((hex.q * state.hexMap.hexSize * 1.5) - bounds.minX) * scale;
        const y = (((hex.r * state.hexMap.hexSize * Math.sqrt(3)) + (hex.q * state.hexMap.hexSize * Math.sqrt(3) / 2)) - bounds.minY) * scale;
        
        ctx.fillStyle = TERRAINS[hex.terrain].color;
        ctx.fillRect(Math.floor(x), Math.floor(y), Math.max(2, 3 * scale), Math.max(2, 3 * scale));
    });
}

function updateMobileOverlay() {
    const overlay = document.querySelector('.canvas-overlay');
    if (overlay && isMobile) {
        // Simplify overlay for mobile
        overlay.style.width = 'auto';
        overlay.style.maxWidth = '80%';
    }
}

// Update existing setHexMode to work with mobile
const originalSetHexMode = setHexMode;
setHexMode = function(mode) {
    originalSetHexMode(mode);
    
    if (isMobile) {
        // Update mobile tool cards
        document.querySelectorAll('.mobile-tool-card').forEach(card => {
            card.classList.toggle('active', card.dataset.mode === mode);
        });
    }
};

// ============================================================================
// CONTEXT MENU SYSTEM
// ============================================================================

function showContextMenu(x, y, hex) {
    // Remove existing context menu
    const existing = document.querySelector('.context-menu');
    if (existing) existing.remove();
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    
    const menuItems = [
        { icon: '🎨', label: 'Paint with...', action: () => {
            mobileState.sheetExpanded = false;
            switchMobileTab('tools');
            expandMobileSheet();
            closeContextMenu();
        }},
        { icon: '📍', label: 'Place Token', action: () => {
            switchMobileTab('token');
            closeContextMenu();
            showTokenCreator();
        }},
        { icon: '🛤️', label: 'Start Path Here', action: () => {
            switchMobileTab('path');
            closeContextMenu();
            addPathPoint(hex.q, hex.r);
        }},
        { icon: '👁️', label: 'View Details', action: () => {
            selectHex(hex);
            closeContextMenu();
        }},
        { icon: '🗑️', label: 'Clear Hex', danger: true, action: () => {
            deleteHex(hex.q, hex.r);
            closeContextMenu();
            renderHex();
        }}
    ];
    
    menuItems.forEach(item => {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item' + (item.danger ? ' danger' : '');
        menuItem.innerHTML = `
            <span class="context-menu-icon">${item.icon}</span>
            <span>${item.label}</span>
        `;
        menuItem.addEventListener('click', item.action);
        menu.appendChild(menuItem);
    });
    
    document.body.appendChild(menu);
    mobileState.contextMenuOpen = true;
    
    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', handleContextMenuOutsideClick);
        canvas.addEventListener('touchstart', handleContextMenuOutsideClick);
    }, 100);
    
    // Adjust position if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
        menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
        menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
    }
}

function handleContextMenuOutsideClick(e) {
    const menu = document.querySelector('.context-menu');
    if (menu && !menu.contains(e.target)) {
        closeContextMenu();
    }
}

function closeContextMenu() {
    const menu = document.querySelector('.context-menu');
    if (menu) {
        menu.remove();
        mobileState.contextMenuOpen = false;
        document.removeEventListener('click', handleContextMenuOutsideClick);
        canvas.removeEventListener('touchstart', handleContextMenuOutsideClick);
    }
}

// ============================================================================
// FULLSCREEN MINIMAP
// ============================================================================

function openFullscreenMinimap() {
    if (mobileState.minimapFullscreen) return;
    
    const overlay = document.createElement('div');
    overlay.className = 'minimap-fullscreen';
    overlay.id = 'minimapFullscreen';
    
    overlay.innerHTML = `
        <div class="minimap-fullscreen-header">
            <h3>📍 Map Overview</h3>
            <button class="minimap-fullscreen-close" onclick="closeFullscreenMinimap()">✕</button>
        </div>
        <div class="minimap-fullscreen-canvas">
            <canvas id="fullscreenMinimapCanvas"></canvas>
            <div class="minimap-viewport-box" id="minimapViewportBox"></div>
        </div>
        <div class="minimap-fullscreen-actions">
            <button class="minimap-action-btn" onclick="jumpToMapCenter()">
                🎯 Center Map
            </button>
            <button class="minimap-action-btn" onclick="jumpToLastEdit()">
                📍 Last Edit
            </button>
        </div>
    `;
    
    document.body.appendChild(overlay);
    mobileState.minimapFullscreen = true;
    
    // Render fullscreen minimap
    setTimeout(() => {
        renderFullscreenMinimap();
        setupFullscreenMinimapInteraction();
    }, 50);
}

function closeFullscreenMinimap() {
    const overlay = document.getElementById('minimapFullscreen');
    if (overlay) {
        overlay.classList.add('closing');
        setTimeout(() => {
            overlay.remove();
            mobileState.minimapFullscreen = false;
        }, 300); // Match animation duration
    }
}

function renderFullscreenMinimap() {
    const canvas = document.getElementById('fullscreenMinimapCanvas');
    if (!canvas || state.hexMap.hexes.size === 0) return;
    
    const container = canvas.parentElement;
    const ctx = canvas.getContext('2d');
    
    // Set canvas size to container
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    
    ctx.fillStyle = '#0a0d11';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    const bounds = getMapBounds();
    const scaleX = (canvas.width - 40) / (bounds.maxX - bounds.minX || 1);
    const scaleY = (canvas.height - 40) / (bounds.maxY - bounds.minY || 1);
    const scale = Math.min(scaleX, scaleY);
    
    const offsetX = (canvas.width - (bounds.maxX - bounds.minX) * scale) / 2;
    const offsetY = (canvas.height - (bounds.maxY - bounds.minY) * scale) / 2;
    
    // Draw hexes with better visibility
    state.hexMap.hexes.forEach(hex => {
        const x = ((hex.q * state.hexMap.hexSize * 1.5) - bounds.minX) * scale + offsetX;
        const y = (((hex.r * state.hexMap.hexSize * Math.sqrt(3)) + (hex.q * state.hexMap.hexSize * Math.sqrt(3) / 2)) - bounds.minY) * scale + offsetY;
        
        // Draw hex as circle with glow
        const hexSize = Math.max(4, 8 * scale);
        
        // Glow effect
        ctx.shadowBlur = 6;
        ctx.shadowColor = TERRAINS[hex.terrain].color;
        
        // Main hex
        ctx.fillStyle = TERRAINS[hex.terrain].color;
        ctx.beginPath();
        ctx.arc(x, y, hexSize, 0, Math.PI * 2);
        ctx.fill();
        
        // Border for contrast
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.stroke();
    });
    
    // Reset shadow for tokens
    ctx.shadowBlur = 0;
    
    // Draw tokens
    state.hexMap.tokens.forEach(token => {
        const x = ((token.q * state.hexMap.hexSize * 1.5) - bounds.minX) * scale + offsetX;
        const y = (((token.r * state.hexMap.hexSize * Math.sqrt(3)) + (token.q * state.hexMap.hexSize * Math.sqrt(3) / 2)) - bounds.minY) * scale + offsetY;
        
        ctx.fillStyle = token.color;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, Math.max(5, 8 * scale), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
    });
    
    // Draw viewport box
    updateViewportBox(scale, offsetX, offsetY, bounds);
}

function updateViewportBox(scale, offsetX, offsetY, bounds) {
    const box = document.getElementById('minimapViewportBox');
    const canvas = document.getElementById('hexCanvas');
    if (!box || !canvas) return;
    
    // Calculate viewport corners in world space
    const viewportWidth = canvas.width / state.hexMap.viewport.scale;
    const viewportHeight = canvas.height / state.hexMap.viewport.scale;
    
    const worldCenterX = (canvas.width / 2 - state.hexMap.viewport.offsetX) / state.hexMap.viewport.scale;
    const worldCenterY = (canvas.height / 2 - state.hexMap.viewport.offsetY) / state.hexMap.viewport.scale;
    
    const worldLeft = worldCenterX - viewportWidth / 2;
    const worldTop = worldCenterY - viewportHeight / 2;
    
    // Convert to minimap coordinates
    const minimapLeft = (worldLeft - bounds.minX) * scale + offsetX;
    const minimapTop = (worldTop - bounds.minY) * scale + offsetY;
    const minimapWidth = viewportWidth * scale;
    const minimapHeight = viewportHeight * scale;
    
    box.style.left = minimapLeft + 'px';
    box.style.top = minimapTop + 'px';
    box.style.width = minimapWidth + 'px';
    box.style.height = minimapHeight + 'px';
}

function setupFullscreenMinimapInteraction() {
    const canvas = document.getElementById('fullscreenMinimapCanvas');
    if (!canvas) return;
    
    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        
        jumpToMinimapPosition(x, y, canvas);
    });
}

function jumpToMinimapPosition(x, y, canvas) {
    const bounds = getMapBounds();
    const scaleX = (canvas.width - 40) / (bounds.maxX - bounds.minX || 1);
    const scaleY = (canvas.height - 40) / (bounds.maxY - bounds.minY || 1);
    const scale = Math.min(scaleX, scaleY);
    
    const offsetX = (canvas.width - (bounds.maxX - bounds.minX) * scale) / 2;
    const offsetY = (canvas.height - (bounds.maxY - bounds.minY) * scale) / 2;
    
    // Convert minimap coordinates to world coordinates
    const worldX = (x - offsetX) / scale + bounds.minX;
    const worldY = (y - offsetY) / scale + bounds.minY;
    
    // Center viewport on this position
    const hexCanvas = document.getElementById('hexCanvas');
    state.hexMap.viewport.offsetX = hexCanvas.width / 2 - worldX * state.hexMap.viewport.scale;
    state.hexMap.viewport.offsetY = hexCanvas.height / 2 - worldY * state.hexMap.viewport.scale;
    
    renderHex();
    renderFullscreenMinimap();
}

function jumpToMapCenter() {
    const bounds = getMapBounds();
    const centerX = (bounds.minX + bounds.maxX) / 2;
    const centerY = (bounds.minY + bounds.maxY) / 2;
    
    const hexCanvas = document.getElementById('hexCanvas');
    state.hexMap.viewport.offsetX = hexCanvas.width / 2 - centerX * state.hexMap.viewport.scale;
    state.hexMap.viewport.offsetY = hexCanvas.height / 2 - centerY * state.hexMap.viewport.scale;
    
    renderHex();
    if (mobileState.minimapFullscreen) {
        renderFullscreenMinimap();
    }
}

function jumpToLastEdit() {
    // Jump to last painted hex
    if (state.hexMap.lastPaintPos) {
        const hex = state.hexMap.lastPaintPos;
        const worldX = hex.q * state.hexMap.hexSize * 1.5;
        const worldY = (hex.r * state.hexMap.hexSize * Math.sqrt(3)) + (hex.q * state.hexMap.hexSize * Math.sqrt(3) / 2);
        
        const hexCanvas = document.getElementById('hexCanvas');
        state.hexMap.viewport.offsetX = hexCanvas.width / 2 - worldX * state.hexMap.viewport.scale;
        state.hexMap.viewport.offsetY = hexCanvas.height / 2 - worldY * state.hexMap.viewport.scale;
        
        renderHex();
        if (mobileState.minimapFullscreen) {
            renderFullscreenMinimap();
        }
    }
}

// Initialize mobile UI on load
window.addEventListener('load', () => {
    if (detectMobile()) {
        setTimeout(initMobileUI, 100);
    }
});

// Handle orientation changes
window.addEventListener('orientationchange', () => {
    setTimeout(() => {
        resizeCanvas();
        if (isMobile) {
            renderMobileMinimap();
        }
    }, 100);
});

// Handle window resize
let resizeTimeout;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        const wasMobile = isMobile;
        detectMobile();
        
        if (wasMobile !== isMobile) {
            // Device type changed, reload
            location.reload();
        }
    }, 250);
});
// ============================================================================
// MOBILE TOOL SWITCHING
// ============================================================================

function switchMobileTool(mode) {
    // Update mode
    setHexMode(mode);
    
    // Update tool cards
    document.querySelectorAll('.mobile-tool-card').forEach(card => {
        card.classList.toggle('active', card.dataset.mode === mode);
    });
    
    // Show/hide relevant tool options
    const brushSize = document.getElementById('mobileBrushSize');
    const terrainPicker = document.getElementById('mobileTerrainPicker');
    
    if (mode === 'paint') {
        // Show brush size and terrain for paint tool
        brushSize.style.display = 'block';
        terrainPicker.style.display = 'block';
    } else if (mode === 'select') {
        // Hide everything for select
        brushSize.style.display = 'none';
        terrainPicker.style.display = 'none';
    } else if (mode === 'path') {
        // Hide for path
        brushSize.style.display = 'none';
        terrainPicker.style.display = 'none';
    } else if (mode === 'token') {
        // Hide for token
        brushSize.style.display = 'none';
        terrainPicker.style.display = 'none';
    }
}
// ============================================================================
// HEADER MENU FUNCTIONALITY
// ============================================================================

// Dropdown functionality - combined for all buttons
const allDropdowns = ['fileBtn', 'exportBtn', 'moreBtn', 'profileBtn'];

allDropdowns.forEach(btnId => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    
    const menuId = btnId.replace('Btn', 'Menu');
    const menu = document.getElementById(menuId);
    if (!menu) return;
    
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other dropdowns
        allDropdowns.forEach(otherId => {
            if (otherId !== btnId) {
                const otherMenu = document.getElementById(otherId.replace('Btn', 'Menu'));
                if (otherMenu) otherMenu.classList.remove('show');
            }
        });
        // Toggle current dropdown
        menu.classList.toggle('show');
    });
});

// Close dropdowns when clicking outside
document.addEventListener('click', () => {
    allDropdowns.forEach(btnId => {
        const menu = document.getElementById(btnId.replace('Btn', 'Menu'));
        if (menu) menu.classList.remove('show');
    });
});

// Manual save button click
document.getElementById('saveBtn')?.addEventListener('click', () => {
    if (typeof saveMapToCache === 'function') {
        // Mark as changed to trigger save
        hasUnsavedChanges = true;
        saveMapToCache();
    }
});

// Export functions
function exportAsJSON() {
    try {
        const mapData = {
            hexes: Object.fromEntries(state.hexMap.hexes),
            tokens: Array.from(state.hexMap.tokens.values()),
            landmarks: Array.from(state.hexMap.landmarks.values()),
            paths: state.hexMap.paths,
            version: '1.0'
        };
        
        const dataStr = JSON.stringify(mapData, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'hexworlds-map.json';
        link.click();
        URL.revokeObjectURL(url);
        
        console.log('Map exported as JSON');
    } catch (error) {
        console.error('Error exporting JSON:', error);
        alert('Error exporting map as JSON');
    }
}

function exportAsPNG() {
    try {
        const canvas = document.getElementById('hexCanvas');
        if (!canvas) {
            alert('Canvas not found');
            return;
        }
        
        const link = document.createElement('a');
        link.download = 'hexworlds-map.png';
        link.href = canvas.toDataURL('image/png');
        link.click();
        
        console.log('Map exported as PNG');
    } catch (error) {
        console.error('Error exporting PNG:', error);
        alert('Error exporting map as PNG');
    }
}

function exportAsCSV() {
    try {
        let csv = 'Q,R,Terrain\n';
        
        state.hexMap.hexes.forEach((hex, key) => {
            csv += `${hex.q},${hex.r},${hex.terrain}\n`;
        });
        
        const dataBlob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(dataBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'hexworlds-terrain.csv';
        link.click();
        URL.revokeObjectURL(url);
        
        console.log('Terrain exported as CSV');
    } catch (error) {
        console.error('Error exporting CSV:', error);
        alert('Error exporting terrain as CSV');
    }
}

function shareMap() {
    try {
        const mapData = {
            hexes: Object.fromEntries(state.hexMap.hexes),
            tokens: Array.from(state.hexMap.tokens.values()),
            landmarks: Array.from(state.hexMap.landmarks.values()),
            paths: state.hexMap.paths
        };
        
        const dataStr = JSON.stringify(mapData);
        const encoded = btoa(dataStr);
        const shareUrl = `${window.location.origin}${window.location.pathname}?map=${encoded}`;
        
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(shareUrl).then(() => {
                alert('Share link copied to clipboard!');
            }).catch(() => {
                promptCopyUrl(shareUrl);
            });
        } else {
            promptCopyUrl(shareUrl);
        }
    } catch (error) {
        console.error('Error creating share link:', error);
        alert('Error creating share link');
    }
}

function promptCopyUrl(url) {
    const input = document.createElement('input');
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand('copy');
    document.body.removeChild(input);
    alert('Share link copied to clipboard!');
}

// Modal functions
function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.add('show');
        // Close all dropdowns
        allDropdowns.forEach(btnId => {
            const menu = document.getElementById(btnId.replace('Btn', 'Menu'));
            if (menu) menu.classList.remove('show');
        });
    }
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
        modal.classList.remove('show');
    }
}

function openSettingsModal() {
    openModal('settingsModal');
}

function openThemesModal() {
    openModal('themesModal');
    // Update active selections when modal opens
    updateThemeModalSelections();
}

function updateThemeModalSelections() {
    // Get current theme and accent from localStorage
    const currentTheme = localStorage.getItem('hexworlds-theme') || 'dark';
    const currentAccent = localStorage.getItem('hexworlds-accent') || 'purple';
    
    // Update theme mode cards
    const themeCards = document.querySelectorAll('#themesModal .setting-group:first-child .theme-card');
    themeCards.forEach(card => {
        card.classList.remove('active');
        const cardTheme = card.id.replace('theme-', '');
        if (cardTheme === currentTheme) {
            card.classList.add('active');
        }
    });
    
    // Update accent color cards
    const accentCards = document.querySelectorAll('#themesModal .setting-group:last-child .theme-card');
    accentCards.forEach(card => {
        card.classList.remove('active');
        const cardAccent = card.id.replace('accent-', '');
        if (cardAccent === currentAccent) {
            card.classList.add('active');
        }
    });
    
    // Update selected variables
    selectedThemeMode = currentTheme;
    selectedAccentColor = currentAccent;
}

function openShortcutsModal() {
    openModal('shortcutsModal');
}

// Close modal when clicking overlay
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('show');
        }
    });
});

// Settings functions
function switchSettingsTab(tabName) {
    console.log('Switching to settings tab:', tabName);
    // Future: Switch between different settings panels
}

function toggleSetting(toggle) {
    toggle.classList.toggle('active');
    // Future: Save setting to localStorage
}

function saveSettings() {
    console.log('Saving settings...');
    // Future: Persist settings to localStorage
    closeModal('settingsModal');
    alert('Settings saved!');
}

// Theme functions
let selectedThemeMode = 'dark';
let selectedAccentColor = 'purple';

function selectTheme(card, theme) {
    const cards = card.parentElement.querySelectorAll('.theme-card');
    cards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectedThemeMode = theme;
    console.log('Theme selected:', theme);
}

function selectAccent(card, accent) {
    const cards = card.parentElement.querySelectorAll('.theme-card');
    cards.forEach(c => c.classList.remove('active'));
    card.classList.add('active');
    selectedAccentColor = accent;
    console.log('Accent selected:', accent);
}

function applyTheme() {
    // Apply theme mode
    if (selectedThemeMode === 'light') {
        document.body.classList.add('theme-light');
        document.body.classList.remove('theme-dark');
    } else {
        document.body.classList.add('theme-dark');
        document.body.classList.remove('theme-light');
    }
    
    // Apply accent color
    const accentClasses = ['accent-purple', 'accent-blue', 'accent-green', 'accent-amber', 'accent-red', 'accent-teal'];
    accentClasses.forEach(cls => document.body.classList.remove(cls));
    document.body.classList.add(`accent-${selectedAccentColor}`);
    
    // Save to localStorage
    localStorage.setItem('hexworlds-theme', selectedThemeMode);
    localStorage.setItem('hexworlds-accent', selectedAccentColor);
    
    closeModal('themesModal');
    
    console.log('Theme applied:', selectedThemeMode, selectedAccentColor);
}

// Load saved theme on page load
function loadSavedTheme() {
    const savedTheme = localStorage.getItem('hexworlds-theme') || 'dark';
    const savedAccent = localStorage.getItem('hexworlds-accent') || 'purple';
    
    selectedThemeMode = savedTheme;
    selectedAccentColor = savedAccent;
    
    // Apply theme
    if (savedTheme === 'light') {
        document.body.classList.add('theme-light');
    } else {
        document.body.classList.add('theme-dark');
    }
    
    // Apply accent
    document.body.classList.add(`accent-${savedAccent}`);
    
    // Update UI to show active selections
    setTimeout(() => {
        const themeCard = document.getElementById(`theme-${savedTheme}`);
        const accentCard = document.getElementById(`accent-${savedAccent}`);
        
        if (themeCard) {
            document.querySelectorAll('#themesModal .theme-grid')[0]
                .querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
            themeCard.classList.add('active');
        }
        
        if (accentCard) {
            document.querySelectorAll('#themesModal .theme-grid')[1]
                .querySelectorAll('.theme-card').forEach(c => c.classList.remove('active'));
            accentCard.classList.add('active');
        }
    }, 100);
    
    console.log('Loaded saved theme:', savedTheme, savedAccent);
}

// Load theme when page loads
loadSavedTheme();


// ESC key to close modals
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-overlay.show').forEach(modal => {
            modal.classList.remove('show');
        });
        // Also close dropdowns
        allDropdowns.forEach(btnId => {
            const menu = document.getElementById(btnId.replace('Btn', 'Menu'));
            if (menu) menu.classList.remove('show');
        });
    }
});

console.log('Header menu functionality initialized');

// ============================================================================
// FILE MENU FUNCTIONALITY
// ============================================================================

// New Map
function newMap() {
    if (confirm('Create a new map? This will clear your current map. Make sure you\'ve saved!')) {
        // Clear all hex data
        state.hexMap.hexes.clear();
        state.hexMap.tokens.clear();
        state.hexMap.landmarks.clear();
        state.hexMap.paths = [];
        
        // Reset IDs
        state.nextTokenId = 1;
        state.nextLandmarkId = 1;
        state.nextPathId = 1;
        
        // Reset camera
        state.hexMap.viewport = { offsetX: 0, offsetY: 0, scale: 1 };
        
        // Redraw
        render();
        
        // Mark as unsaved and trigger save
        hasUnsavedChanges = true;
        saveMapToCache();
        
        console.log('New map created');
    }
}

// Import Map from File
function importMapFromFile() {
    document.getElementById('importFileInput').click();
}

// Handle File Import
function handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    
    if (file.type === 'application/json' || file.name.endsWith('.json')) {
        reader.onload = (e) => {
            try {
                const mapData = JSON.parse(e.target.result);
                
                // Validate the data
                if (!mapData.hexes && !mapData.tokens && !mapData.landmarks) {
                    alert('Invalid map file format');
                    return;
                }
                
                // Import the data
                if (confirm('Import this map? This will replace your current map. Make sure you\'ve saved!')) {
                    // Clear existing data
                    state.hexMap.hexes.clear();
                    state.hexMap.tokens.clear();
                    state.hexMap.landmarks.clear();
                    state.hexMap.paths = [];
                    
                    // Import hexes
                    if (mapData.hexes) {
                        if (Array.isArray(mapData.hexes)) {
                            // Array format (from export)
                            mapData.hexes.forEach(hex => {
                                const key = `${hex.q},${hex.r}`;
                                state.hexMap.hexes.set(key, hex);
                            });
                        } else {
                            // Object format (legacy)
                            Object.entries(mapData.hexes).forEach(([key, hex]) => {
                                state.hexMap.hexes.set(key, hex);
                            });
                        }
                    }
                    
                    // Import tokens
                    if (mapData.tokens) {
                        if (Array.isArray(mapData.tokens)) {
                            mapData.tokens.forEach(token => {
                                state.hexMap.tokens.set(token.id, token);
                            });
                        }
                    }
                    
                    // Import landmarks
                    if (mapData.landmarks) {
                        if (Array.isArray(mapData.landmarks)) {
                            mapData.landmarks.forEach(landmark => {
                                const key = `${landmark.q},${landmark.r}`;
                                state.hexMap.landmarks.set(key, landmark);
                            });
                        }
                    }
                    
                    // Import paths
                    if (mapData.paths) {
                        state.hexMap.paths = mapData.paths;
                    }
                    
                    // Restore viewport if available
                    if (mapData.viewport) {
                        state.hexMap.viewport = mapData.viewport;
                    }
                    
                    // Force bounds recalculation
                    state.hexMap.boundsNeedRecalc = true;
                    
                    // Redraw
                    updateHexCount();
                    deselectHex();
                    renderHex();
                    
                    // Mark as unsaved and save
                    hasUnsavedChanges = true;
                    saveMapToCache();
                    
                    console.log('Map imported successfully');
                    alert('Map imported successfully!');
                }
            } catch (error) {
                console.error('Error importing map:', error);
                alert('Error importing map file. Please make sure it\'s a valid HexWorlds JSON file.');
            }
        };
        reader.readAsText(file);
    } else if (file.type.startsWith('image/')) {
        // Future: Import from image functionality
        alert('Image import coming soon! For now, please use JSON files.');
    }
    
    // Reset file input
    event.target.value = '';
}

// Open Examples Modal
function openExamplesModal() {
    openModal('examplesModal');
}

// Load Example Map
function loadExampleMap(mapType) {
    if (!confirm('Load this example map? This will replace your current map. Make sure you\'ve saved!')) {
        return;
    }
    
    // Clear current map
    state.hexMap.hexes.clear();
    state.hexMap.tokens.clear();
    state.hexMap.landmarks.clear();
    state.hexMap.paths = [];
    
    // Reset IDs
    state.nextTokenId = 1;
    state.nextLandmarkId = 1;
    state.nextPathId = 1;
    
    // Generate example based on type
    switch(mapType) {
        case 'island':
            generateIslandMap();
            break;
        case 'dungeon':
            generateDungeonMap();
            break;
        case 'village':
            generateVillageMap();
            break;
        case 'wilderness':
            generateWildernessMap();
            break;
    }
    
    render();
    closeModal('examplesModal');
    
    // Mark as unsaved and save
    hasUnsavedChanges = true;
    saveMapToCache();
    
    console.log('Loaded example map:', mapType);
}

// Generate Island Map
function generateIslandMap() {
    const centerQ = 0, centerR = 0;
    const radius = 8;
    
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            const distance = Math.sqrt(q * q + r * r);
            
            if (distance <= radius) {
                let terrain = 'water';
                
                if (distance < 3) {
                    terrain = 'plains';
                } else if (distance < 5) {
                    terrain = Math.random() > 0.5 ? 'forest' : 'plains';
                } else if (distance < 6) {
                    terrain = 'sand';
                } else {
                    terrain = 'water';
                }
                
                const key = `${q},${r}`;
                state.hexMap.hexes.set(key, { q, r, terrain });
            }
        }
    }
    
    // Add a landmark
    state.hexMap.landmarks.set('example-palm-tree', {
        id: 'example-palm-tree',
        name: 'Palm Tree',
        icon: '🌴',
        q: 2,
        r: -1,
        type: 'location',
        showLabel: true,
        visible: true
    });
}

// Generate Dungeon Map
function generateDungeonMap() {
    const rooms = [
        { q: 0, r: 0, size: 3 },
        { q: 6, r: -3, size: 2 },
        { q: -5, r: 3, size: 2 },
        { q: 3, r: 4, size: 2 }
    ];
    
    rooms.forEach(room => {
        for (let q = room.q - room.size; q <= room.q + room.size; q++) {
            for (let r = room.r - room.size; r <= room.r + room.size; r++) {
                if (Math.abs(q - room.q) + Math.abs(r - room.r) <= room.size) {
                    const key = `${q},${r}`;
                    state.hexMap.hexes.set(key, { q, r, terrain: 'stone' });
                }
            }
        }
    });
    
    // Add corridors (simplified)
    const corridors = [
        { from: [0, 0], to: [6, -3] },
        { from: [0, 0], to: [-5, 3] },
        { from: [0, 0], to: [3, 4] }
    ];
    
    corridors.forEach(corridor => {
        const [q1, r1] = corridor.from;
        const [q2, r2] = corridor.to;
        const steps = Math.max(Math.abs(q2 - q1), Math.abs(r2 - r1));
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const q = Math.round(q1 + (q2 - q1) * t);
            const r = Math.round(r1 + (r2 - r1) * t);
            const key = `${q},${r}`;
            if (!state.hexMap.hexes.has(key)) {
                state.hexMap.hexes.set(key, { q, r, terrain: 'stone' });
            }
        }
    });
}

// Generate Village Map
function generateVillageMap() {
    const centerQ = 0, centerR = 0;
    const radius = 7;
    
    // Base terrain
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            const distance = Math.sqrt(q * q + r * r);
            
            if (distance <= radius) {
                const key = `${q},${r}`;
                state.hexMap.hexes.set(key, { q, r, terrain: 'plains' });
            }
        }
    }
    
    // Add some paths
    for (let i = -5; i <= 5; i++) {
        const key1 = `${i},0`;
        const key2 = `0,${i}`;
        if (state.hexMap.hexes.has(key1)) {
            state.hexMap.hexes.set(key1, { q: i, r: 0, terrain: 'sand' });
        }
        if (state.hexMap.hexes.has(key2)) {
            state.hexMap.hexes.set(key2, { q: 0, r: i, terrain: 'sand' });
        }
    }
    
    // Add landmarks
    const buildings = [
        { name: 'Inn', icon: '🏠', q: 3, r: 3 },
        { name: 'Shop', icon: '🏪', q: -3, r: 3 },
        { name: 'Church', icon: '⛪', q: 0, r: -4 },
        { name: 'Well', icon: '🪣', q: 0, r: 0 }
    ];
    
    buildings.forEach((building, i) => {
        const id = `example-building-${i}`;
        state.hexMap.landmarks.set(id, {
            id,
            ...building,
            type: 'location',
            showLabel: true,
            visible: true
        });
    });
}

// Generate Wilderness Map
function generateWildernessMap() {
    const centerQ = 0, centerR = 0;
    const radius = 8;
    
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            const distance = Math.sqrt(q * q + r * r);
            
            if (distance <= radius) {
                const noise = Math.random();
                let terrain = 'forest';
                
                if (noise < 0.2) {
                    terrain = 'plains';
                } else if (noise > 0.8) {
                    terrain = 'hills';
                }
                
                const key = `${q},${r}`;
                state.hexMap.hexes.set(key, { q, r, terrain });
            }
        }
    }
    
    // Add a path
    for (let i = -6; i <= 6; i++) {
        const q = i;
        const r = Math.floor(i / 2);
        const key = `${q},${r}`;
        if (state.hexMap.hexes.has(key)) {
            state.hexMap.hexes.set(key, { q, r, terrain: 'sand' });
        }
    }
}

console.log('File menu functionality initialized');