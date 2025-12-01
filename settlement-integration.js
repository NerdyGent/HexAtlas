// ============================================================================
// SETTLEMENT INTEGRATION FOR HEXATLAS - FIXED VERSION
// ============================================================================

(function() {
    'use strict';
    console.log('🏰 Settlement Integration loading...');
    
    // CONFIG
    const CONFIG = {
        ZOOM: { REGIONAL_START: 2.0, SETTLEMENT_START: 4.0 },
        FADE: { ICON_START: 2.5, ICON_END: 4.5, SETTLEMENT_START: 3.0, SETTLEMENT_END: 4.5 },
        // LOD thresholds for forests
        FOREST_LOD: {
            BLOB_ONLY: 0.3,
            SPARSE_TREES: 0.5,
            MEDIUM_TREES: 0.8,
            DENSE_TREES: 1.2
        },
        // Size constraints for settlements
        SIZES: {
            BLOCK: {
                MIN_WIDTH: 25,
                MAX_WIDTH: 120,
                MIN_HEIGHT: 25,
                MAX_HEIGHT: 120,
                MIN_AREA: 800,
                MAX_AREA: 12000,
                MIN_ASPECT: 0.3,  // Minimum width/height ratio (avoids thin slivers)
                MAX_ASPECT: 3.0   // Maximum width/height ratio
            },
            DISTRICT: {
                MIN_AREA: 5000,
                GAP: 12  // Gap between blocks
            },
            BUILDING: {
                MIN_SIZE: 5,
                MAX_SIZE: 14,
                MIN_DEPTH: 4,
                MAX_DEPTH: 12
            }
        },
        // Modern UX settings
        UX: {
            SMOOTHING_FACTOR: 0.35,        // Higher = snappier, lower = smoother
            VERTEX_RADIUS: 8,              // Base vertex handle size
            VERTEX_HOVER_RADIUS: 11,       // Hovered vertex size
            VERTEX_ACTIVE_RADIUS: 13,      // Dragging vertex size
            EDGE_HIT_AREA: 14,             // Click area for edges
            SELECTION_GLOW_WIDTH: 8,       // Selection outline glow
            DOUBLE_CLICK_TIME: 350,        // ms for double-click detection
            DOUBLE_CLICK_DIST: 15,         // pixels for double-click detection
            // Colors
            COLORS: {
                selection: 0x667eea,
                selectionGlow: 0x667eea,
                hover: 0x818cf8,
                vertex: 0xffffff,
                vertexHover: 0xfbbf24,
                vertexActive: 0xf59e0b,
                edgeHover: 0xfbbf24
            }
        }
    };
    
    // STATE
    const settlementState = {
        detailLevel: 'WORLD',
        initialized: false,
        pixiApp: null,
        pixiContainer: null,
        worldContainer: null,
        worldGraphics: null,
        activeHex: null,
        currentTool: 'district',
        selectedObject: null,
        editingPointIndex: -1,
        isDragging: false,
        dragStart: { x: 0, y: 0 },
        dragTarget: null,
        // Enhanced UX state
        hoveredObject: null,
        hoveredVertex: null,
        hoveredEdge: null,
        dragType: null,           // 'vertex', 'shape', or 'edge'
        dragOffset: { x: 0, y: 0 },
        smoothDragTarget: { x: 0, y: 0 },
        originalDragPoint: null,
        animationFrameId: null
    };
    
    // HELPERS
    function getDetailLevel(scale) {
        if (scale < CONFIG.ZOOM.REGIONAL_START) return 'WORLD';
        if (scale < CONFIG.ZOOM.SETTLEMENT_START) return 'REGIONAL';
        return 'SETTLEMENT';
    }
    function getSettlementOpacity(scale) {
        if (scale <= CONFIG.FADE.SETTLEMENT_START) return 0.0;
        if (scale >= CONFIG.FADE.SETTLEMENT_END) return 1.0;
        return (scale - CONFIG.FADE.SETTLEMENT_START) / (CONFIG.FADE.SETTLEMENT_END - CONFIG.FADE.SETTLEMENT_START);
    }
    
    // Get forest LOD level (0-4, higher = more detail)
    function getForestLODLevel(zoom) {
        if (zoom < CONFIG.FOREST_LOD.BLOB_ONLY) return 0;
        if (zoom < CONFIG.FOREST_LOD.SPARSE_TREES) return 1;
        if (zoom < CONFIG.FOREST_LOD.MEDIUM_TREES) return 2;
        if (zoom < CONFIG.FOREST_LOD.DENSE_TREES) return 3;
        return 4;
    }
    
    // Per-hex data
    function getSettlementData(hex) {
        if (!hex) return null;
        if (!hex.settlementData) {
            hex.settlementData = { cities: [], districts: [], blocks: [], buildings: [], roads: [], forests: [], idCounter: 0 };
        }
        return hex.settlementData;
    }
    function generateId(hex) { 
        if (hex) {
            const data = getSettlementData(hex); 
            return ++data.idCounter; 
        }
        return Math.floor(Math.random() * 1000000);
    }
    
    // PIXI - Fixed to ensure transparent background
    function loadPixiJS() {
        return new Promise((resolve, reject) => {
            if (window.PIXI) { resolve(); return; }
            const script = document.createElement('script');
            script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pixi.js/7.3.2/pixi.min.js';
            script.onload = () => { console.log('✅ PixiJS loaded'); resolve(); };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }
    
    function createPixiOverlay() {
        const hexCanvas = document.getElementById('hexCanvas');
        if (!hexCanvas || !window.PIXI) return null;
        
        let container = document.getElementById('settlement-pixi-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'settlement-pixi-container';
            container.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;opacity:0;transition:opacity 0.5s ease;z-index:5;';
            hexCanvas.parentElement.style.position = 'relative';
            hexCanvas.parentElement.appendChild(container);
        }
        
        // Create PIXI app with explicit transparent background
        const app = new PIXI.Application({ 
            width: hexCanvas.width, 
            height: hexCanvas.height, 
            backgroundAlpha: 0,
            resolution: window.devicePixelRatio || 1, 
            autoDensity: true,
            antialias: true
        });
        
        container.appendChild(app.view);
        app.view.style.cssText = 'width:100%;height:100%;pointer-events:none;display:block;';
        
        const worldContainer = new PIXI.Container();
        app.stage.addChild(worldContainer);
        const worldGraphics = new PIXI.Graphics();
        worldContainer.addChild(worldGraphics);
        
        settlementState.pixiApp = app;
        settlementState.pixiContainer = container;
        settlementState.worldContainer = worldContainer;
        settlementState.worldGraphics = worldGraphics;
        
        // Resize observer
        new ResizeObserver(() => { 
            try { 
                app.renderer.resize(hexCanvas.width, hexCanvas.height); 
                renderSettlement(); 
            } catch(e) {} 
        }).observe(hexCanvas);
        
        console.log('✅ PixiJS overlay created');
        return app;
    }

    // ========== CITY CLASS ==========
    class City {
        constructor(x, y, size, hex) {
            this.hex = hex;
            this.id = generateId(hex);
            this.type = 'city';
            this.x = x;
            this.y = y;
            this.rotation = 0;
            this.districts = [];
            
            const sides = 8;
            this.points = [];
            for (let i = 0; i < sides; i++) {
                const angle = (i / sides) * Math.PI * 2;
                this.points.push({ x: Math.cos(angle) * size, y: Math.sin(angle) * size });
            }
        }

        getWorldPoints() {
            const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
            return this.points.map(p => ({
                x: this.x + p.x * cos - p.y * sin,
                y: this.y + p.x * sin + p.y * cos
            }));
        }

        contains(x, y) {
            const points = this.getWorldPoints();
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
            }
            return inside;
        }

        subdivideIntoDistricts() {
            const cityData = getSettlementData(this.hex);
            // Clear old districts
            this.districts.forEach(d => {
                cityData.districts = cityData.districts.filter(dd => dd.id !== d.id);
                d.blocks.forEach(b => {
                    cityData.blocks = cityData.blocks.filter(bb => bb.id !== b.id);
                    cityData.buildings = cityData.buildings.filter(bl => bl.blockId !== b.id);
                });
            });
            this.districts = [];

            const region = { points: this.getWorldPoints(), depth: 0 };
            const targetDistricts = 8 + Math.floor(Math.random() * 8);
            const regions = this.partitionRegion(region, targetDistricts);
            
            const gap = 12;
            for (let reg of regions) {
                const shrunk = this.shrinkPolygon(reg.points, gap / 2);
                if (shrunk && shrunk.length >= 3) {
                    const district = this.createDistrictFromRegion(shrunk);
                    if (district) {
                        this.districts.push(district);
                        cityData.districts.push(district);
                        district.subdivideIntoBlocks();
                    }
                }
            }
        }

        shrinkPolygon(points, distance) {
            const shrunk = [], n = points.length;
            for (let i = 0; i < n; i++) {
                const prev = points[(i - 1 + n) % n], curr = points[i], next = points[(i + 1) % n];
                const e1 = { x: curr.x - prev.x, y: curr.y - prev.y }, l1 = Math.hypot(e1.x, e1.y);
                const n1 = l1 > 0 ? { x: -e1.y / l1, y: e1.x / l1 } : { x: 0, y: 0 };
                const e2 = { x: next.x - curr.x, y: next.y - curr.y }, l2 = Math.hypot(e2.x, e2.y);
                const n2 = l2 > 0 ? { x: -e2.y / l2, y: e2.x / l2 } : { x: 0, y: 0 };
                const avg = { x: (n1.x + n2.x) / 2, y: (n1.y + n2.y) / 2 }, al = Math.hypot(avg.x, avg.y);
                if (al > 0.01) shrunk.push({ x: curr.x + (avg.x / al) * distance, y: curr.y + (avg.y / al) * distance });
            }
            return shrunk.length >= 3 ? shrunk : null;
        }

        partitionRegion(region, targetCount) {
            const regions = [region];
            let attempts = 0;
            while (regions.length < targetCount && attempts < targetCount * 3) {
                attempts++;
                let li = 0, la = this.getRegionArea(regions[0]);
                for (let i = 1; i < regions.length; i++) {
                    const a = this.getRegionArea(regions[i]);
                    if (a > la) { la = a; li = i; }
                }
                if (la < 2000) break;
                const split = this.splitRegion(regions[li]);
                if (split) { regions.splice(li, 1); regions.push(split[0], split[1]); }
            }
            return regions;
        }

        splitRegion(region) {
            const bounds = this.getRegionBounds(region);
            const w = bounds.maxX - bounds.minX, h = bounds.maxY - bounds.minY;
            if (Math.random() < 0.5) {
                return this.splitRegionVertical(region, bounds.minX + w * (0.3 + Math.random() * 0.4));
            } else {
                return this.splitRegionHorizontal(region, bounds.minY + h * (0.3 + Math.random() * 0.4));
            }
        }

        splitRegionVertical(region, splitX) {
            const left = [], right = [], points = region.points;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i], p2 = points[(i + 1) % points.length];
                if (p1.x < splitX) left.push({...p1});
                if (p1.x >= splitX) right.push({...p1});
                if ((p1.x < splitX && p2.x >= splitX) || (p1.x >= splitX && p2.x < splitX)) {
                    const t = (splitX - p1.x) / (p2.x - p1.x);
                    const int = { x: splitX, y: p1.y + t * (p2.y - p1.y) };
                    left.push({...int}); right.push({...int});
                }
            }
            return (left.length >= 3 && right.length >= 3) ?
                [{ points: left, depth: region.depth + 1 }, { points: right, depth: region.depth + 1 }] : null;
        }

        splitRegionHorizontal(region, splitY) {
            const top = [], bottom = [], points = region.points;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i], p2 = points[(i + 1) % points.length];
                if (p1.y < splitY) top.push({...p1});
                if (p1.y >= splitY) bottom.push({...p1});
                if ((p1.y < splitY && p2.y >= splitY) || (p1.y >= splitY && p2.y < splitY)) {
                    const t = (splitY - p1.y) / (p2.y - p1.y);
                    const int = { x: p1.x + t * (p2.x - p1.x), y: splitY };
                    top.push({...int}); bottom.push({...int});
                }
            }
            return (top.length >= 3 && bottom.length >= 3) ?
                [{ points: top, depth: region.depth + 1 }, { points: bottom, depth: region.depth + 1 }] : null;
        }

        getRegionBounds(region) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let p of region.points) {
                minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
            }
            return { minX, minY, maxX, maxY };
        }

        getRegionArea(region) {
            let area = 0;
            for (let i = 0; i < region.points.length; i++) {
                const p1 = region.points[i], p2 = region.points[(i + 1) % region.points.length];
                area += p1.x * p2.y - p2.x * p1.y;
            }
            return Math.abs(area / 2);
        }

        createDistrictFromRegion(worldPoints) {
            let cx = 0, cy = 0;
            for (let p of worldPoints) { cx += p.x; cy += p.y; }
            cx /= worldPoints.length; cy /= worldPoints.length;
            const district = new District(cx, cy, 100, this.hex);
            district.cityId = this.id;
            district.points = worldPoints.map(p => ({ x: p.x - cx, y: p.y - cy }));
            return district;
        }
    }

    // ========== DISTRICT CLASS ==========
    class District {
        constructor(x, y, size, hex) {
            this.hex = hex;
            this.id = generateId(hex);
            this.type = 'district';
            this.x = x; this.y = y;
            this.rotation = 0;
            this.blocks = [];
            this.cityId = null;
            
            const sides = 6;
            this.points = [];
            for (let i = 0; i < sides; i++) {
                const angle = (i / sides) * Math.PI * 2;
                this.points.push({ x: Math.cos(angle) * size, y: Math.sin(angle) * size });
            }
        }

        getWorldPoints() {
            const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
            return this.points.map(p => ({
                x: this.x + p.x * cos - p.y * sin,
                y: this.y + p.x * sin + p.y * cos
            }));
        }

        contains(x, y) {
            const points = this.getWorldPoints();
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
            }
            return inside;
        }

        subdivideIntoBlocks() {
            const cityData = getSettlementData(this.hex);
            this.blocks.forEach(b => {
                cityData.blocks = cityData.blocks.filter(bb => bb.id !== b.id);
                cityData.buildings = cityData.buildings.filter(bl => bl.blockId !== b.id);
            });
            this.blocks = [];

            const region = { points: this.getWorldPoints(), depth: 0 };
            const targetBlocks = 25 + Math.floor(Math.random() * 20);
            const regions = this.partitionRegion(region, targetBlocks);
            
            const gap = 12;
            for (let reg of regions) {
                const shrunk = this.shrinkPolygon(reg.points, gap / 2);
                if (shrunk && shrunk.length >= 3) {
                    const block = this.createBlockFromRegion(shrunk);
                    if (block) {
                        this.blocks.push(block);
                        cityData.blocks.push(block);
                        block.generateBuildings();
                    }
                }
            }
        }

        shrinkPolygon(points, distance) {
            const shrunk = [], n = points.length;
            for (let i = 0; i < n; i++) {
                const prev = points[(i - 1 + n) % n], curr = points[i], next = points[(i + 1) % n];
                const e1 = { x: curr.x - prev.x, y: curr.y - prev.y }, l1 = Math.hypot(e1.x, e1.y);
                const n1 = l1 > 0 ? { x: -e1.y / l1, y: e1.x / l1 } : { x: 0, y: 0 };
                const e2 = { x: next.x - curr.x, y: next.y - curr.y }, l2 = Math.hypot(e2.x, e2.y);
                const n2 = l2 > 0 ? { x: -e2.y / l2, y: e2.x / l2 } : { x: 0, y: 0 };
                const avg = { x: (n1.x + n2.x) / 2, y: (n1.y + n2.y) / 2 }, al = Math.hypot(avg.x, avg.y);
                if (al > 0.01) shrunk.push({ x: curr.x + (avg.x / al) * distance, y: curr.y + (avg.y / al) * distance });
            }
            return shrunk.length >= 3 ? shrunk : null;
        }

        partitionRegion(region, targetCount) {
            const regions = [region];
            const minArea = CONFIG.SIZES.BLOCK.MIN_AREA * 1.5;  // Account for shrinking
            const limits = CONFIG.SIZES.BLOCK;
            
            let attempts = 0;
            while (regions.length < targetCount && attempts < targetCount * 4) {
                attempts++;
                
                // Find largest region that can still be split
                let bestIdx = -1;
                let bestArea = 0;
                
                for (let i = 0; i < regions.length; i++) {
                    const area = this.getRegionArea(regions[i]);
                    const bounds = this.getRegionBounds(regions[i]);
                    const width = bounds.maxX - bounds.minX;
                    const height = bounds.maxY - bounds.minY;
                    
                    // Only consider regions large enough to split into two valid blocks
                    if (area > minArea * 2.5 && 
                        width > limits.MIN_WIDTH * 2.2 && 
                        height > limits.MIN_HEIGHT * 2.2 &&
                        area > bestArea) {
                        bestArea = area;
                        bestIdx = i;
                    }
                }
                
                if (bestIdx < 0) break;  // No splittable regions left
                
                const split = this.splitRegion(regions[bestIdx]);
                if (split) {
                    // Validate both halves meet minimum requirements
                    const area1 = this.getRegionArea(split[0]);
                    const area2 = this.getRegionArea(split[1]);
                    const bounds1 = this.getRegionBounds(split[0]);
                    const bounds2 = this.getRegionBounds(split[1]);
                    
                    const w1 = bounds1.maxX - bounds1.minX;
                    const h1 = bounds1.maxY - bounds1.minY;
                    const w2 = bounds2.maxX - bounds2.minX;
                    const h2 = bounds2.maxY - bounds2.minY;
                    
                    const aspect1 = Math.min(w1, h1) / Math.max(w1, h1);
                    const aspect2 = Math.min(w2, h2) / Math.max(w2, h2);
                    
                    // Only accept split if both halves are valid
                    if (area1 >= minArea && area2 >= minArea &&
                        w1 >= limits.MIN_WIDTH && h1 >= limits.MIN_HEIGHT &&
                        w2 >= limits.MIN_WIDTH && h2 >= limits.MIN_HEIGHT &&
                        aspect1 >= limits.MIN_ASPECT * 0.8 && aspect2 >= limits.MIN_ASPECT * 0.8) {
                        regions.splice(bestIdx, 1);
                        regions.push(split[0], split[1]);
                    }
                }
            }
            return regions;
        }

        splitRegion(region) {
            const points = region.points;
            if (points.length < 4) return null;
            
            const bounds = this.getRegionBounds(region);
            const width = bounds.maxX - bounds.minX;
            const height = bounds.maxY - bounds.minY;
            const limits = CONFIG.SIZES.BLOCK;
            
            // Get shape distribution from sliders
            const rectPercent = Math.max(0, parseInt(document.getElementById('verticalSlider')?.value || '30')) / 100;
            const rhombusPercent = Math.max(0, parseInt(document.getElementById('diagonalSlider')?.value || '40')) / 100;
            
            const splitType = Math.random();
            const rectThreshold = rectPercent;
            const rhombusThreshold = rectThreshold + rhombusPercent;
            
            // Calculate safe split range to avoid thin slivers
            const minSplitRatio = Math.max(0.25, limits.MIN_WIDTH / width, limits.MIN_HEIGHT / height);
            const maxSplitRatio = Math.min(0.75, 1 - minSplitRatio);
            
            // If we can't make a valid split, don't split
            if (minSplitRatio >= maxSplitRatio) return null;
            
            if (splitType < rectThreshold) {
                // Straight splits (vertical or horizontal) -> rectangles
                // Choose direction based on aspect ratio - split the longer dimension
                if (width > height * 1.2) {
                    const splitRatio = minSplitRatio + Math.random() * (maxSplitRatio - minSplitRatio);
                    return this.splitRegionVertical(region, bounds.minX + width * splitRatio);
                } else if (height > width * 1.2) {
                    const splitRatio = minSplitRatio + Math.random() * (maxSplitRatio - minSplitRatio);
                    return this.splitRegionHorizontal(region, bounds.minY + height * splitRatio);
                } else {
                    // Square-ish region, random direction
                    const splitRatio = minSplitRatio + Math.random() * (maxSplitRatio - minSplitRatio);
                    if (Math.random() < 0.5) {
                        return this.splitRegionVertical(region, bounds.minX + width * splitRatio);
                    } else {
                        return this.splitRegionHorizontal(region, bounds.minY + height * splitRatio);
                    }
                }
            } else if (splitType < rhombusThreshold) {
                // Balanced diagonal -> rhombuses
                return this.splitRegionDiagonal(region, bounds, true, minSplitRatio, maxSplitRatio);
            } else {
                // Extreme diagonal -> triangles (but constrained)
                return this.splitRegionDiagonal(region, bounds, false, minSplitRatio, maxSplitRatio);
            }
        }

        splitRegionDiagonal(region, bounds, balanced = true, minRatioOverride = null, maxRatioOverride = null) {
            const points = region.points;
            const width = bounds.maxX - bounds.minX;
            const height = bounds.maxY - bounds.minY;
            
            // Use provided ratios or defaults
            const minRatio = minRatioOverride !== null ? minRatioOverride : (balanced ? 0.25 : 0.15);
            const maxRatio = maxRatioOverride !== null ? maxRatioOverride : (balanced ? 0.75 : 0.85);
            
            const edge1Ratio = minRatio + Math.random() * (maxRatio - minRatio);
            const edge2Ratio = minRatio + Math.random() * (maxRatio - minRatio);
            
            const splitChoice = Math.random();
            let splitStart, splitEnd;
            
            if (splitChoice < 0.25) {
                splitStart = { x: bounds.minX + width * edge1Ratio, y: bounds.minY };
                splitEnd = { x: bounds.minX + width * edge2Ratio, y: bounds.maxY };
            } else if (splitChoice < 0.5) {
                splitStart = { x: bounds.minX, y: bounds.minY + height * edge1Ratio };
                splitEnd = { x: bounds.maxX, y: bounds.minY + height * edge2Ratio };
            } else if (splitChoice < 0.75) {
                splitStart = { x: bounds.minX + width * edge1Ratio, y: bounds.minY };
                splitEnd = { x: bounds.maxX, y: bounds.minY + height * edge2Ratio };
            } else {
                splitStart = { x: bounds.minX, y: bounds.minY + height * edge1Ratio };
                splitEnd = { x: bounds.minX + width * edge2Ratio, y: bounds.maxY };
            }
            
            const part1 = [], part2 = [];
            
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                
                const side1 = this.pointSideOfLine(p1, splitStart, splitEnd);
                
                if (side1 <= 0) part1.push({...p1});
                if (side1 >= 0) part2.push({...p1});
                
                const side2 = this.pointSideOfLine(p2, splitStart, splitEnd);
                if ((side1 < 0 && side2 > 0) || (side1 > 0 && side2 < 0)) {
                    const intersect = this.lineIntersection(p1, p2, splitStart, splitEnd);
                    if (intersect) {
                        part1.push({...intersect});
                        part2.push({...intersect});
                    }
                }
            }
            
            return (part1.length >= 3 && part2.length >= 3) ?
                [{ points: part1, depth: region.depth + 1 }, { points: part2, depth: region.depth + 1 }] : null;
        }

        pointSideOfLine(point, lineStart, lineEnd) {
            return (lineEnd.x - lineStart.x) * (point.y - lineStart.y) - 
                   (lineEnd.y - lineStart.y) * (point.x - lineStart.x);
        }

        lineIntersection(p1, p2, p3, p4) {
            const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
            if (Math.abs(denom) < 0.0001) return null;
            const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
            return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
        }

        splitRegionVertical(region, splitX) {
            const left = [], right = [], points = region.points;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i], p2 = points[(i + 1) % points.length];
                if (p1.x < splitX) left.push({...p1});
                if (p1.x >= splitX) right.push({...p1});
                if ((p1.x < splitX && p2.x >= splitX) || (p1.x >= splitX && p2.x < splitX)) {
                    const t = (splitX - p1.x) / (p2.x - p1.x);
                    left.push({ x: splitX, y: p1.y + t * (p2.y - p1.y) });
                    right.push({ x: splitX, y: p1.y + t * (p2.y - p1.y) });
                }
            }
            return (left.length >= 3 && right.length >= 3) ?
                [{ points: left, depth: region.depth + 1 }, { points: right, depth: region.depth + 1 }] : null;
        }

        splitRegionHorizontal(region, splitY) {
            const top = [], bottom = [], points = region.points;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i], p2 = points[(i + 1) % points.length];
                if (p1.y < splitY) top.push({...p1});
                if (p1.y >= splitY) bottom.push({...p1});
                if ((p1.y < splitY && p2.y >= splitY) || (p1.y >= splitY && p2.y < splitY)) {
                    const t = (splitY - p1.y) / (p2.y - p1.y);
                    top.push({ x: p1.x + t * (p2.x - p1.x), y: splitY });
                    bottom.push({ x: p1.x + t * (p2.x - p1.x), y: splitY });
                }
            }
            return (top.length >= 3 && bottom.length >= 3) ?
                [{ points: top, depth: region.depth + 1 }, { points: bottom, depth: region.depth + 1 }] : null;
        }

        getRegionBounds(region) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let p of region.points) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
            return { minX, minY, maxX, maxY };
        }

        getRegionArea(region) {
            let area = 0;
            for (let i = 0; i < region.points.length; i++) {
                const p1 = region.points[i], p2 = region.points[(i + 1) % region.points.length];
                area += p1.x * p2.y - p2.x * p1.y;
            }
            return Math.abs(area / 2);
        }

        createBlockFromRegion(worldPoints) {
            // Calculate bounds and metrics
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            let cx = 0, cy = 0;
            for (let p of worldPoints) {
                cx += p.x; cy += p.y;
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            }
            cx /= worldPoints.length; cy /= worldPoints.length;
            
            const width = maxX - minX;
            const height = maxY - minY;
            const area = this.getPolygonArea(worldPoints);
            const aspectRatio = Math.min(width, height) / Math.max(width, height);
            
            const limits = CONFIG.SIZES.BLOCK;
            
            // Reject blocks that are too small
            if (width < limits.MIN_WIDTH || height < limits.MIN_HEIGHT) {
                console.log('🏰 Block rejected: too small', { width: width.toFixed(1), height: height.toFixed(1) });
                return null;
            }
            
            // Reject blocks with area too small
            if (area < limits.MIN_AREA) {
                console.log('🏰 Block rejected: area too small', { area: area.toFixed(0) });
                return null;
            }
            
            // Reject blocks that are too thin (bad aspect ratio)
            if (aspectRatio < limits.MIN_ASPECT) {
                console.log('🏰 Block rejected: too thin', { aspectRatio: aspectRatio.toFixed(2) });
                return null;
            }
            
            const block = new Block(cx, cy, 100, 100, this.hex);
            block.districtId = this.id;
            block.points = worldPoints.map(p => ({ x: p.x - cx, y: p.y - cy }));
            return block;
        }
        
        getPolygonArea(points) {
            let area = 0;
            for (let i = 0; i < points.length; i++) {
                const p1 = points[i];
                const p2 = points[(i + 1) % points.length];
                area += p1.x * p2.y - p2.x * p1.y;
            }
            return Math.abs(area / 2);
        }
    }

    // ========== BLOCK CLASS ==========
    class Block {
        constructor(x, y, width, height, hex) {
            this.hex = hex;
            this.id = generateId(hex);
            this.type = 'block';
            this.x = x; this.y = y;
            this.width = width; this.height = height;
            this.rotation = 0;
            this.buildings = [];
            this.trees = [];  // Trees in block
            this.districtId = null;
            const hw = width / 2, hh = height / 2;
            this.points = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
        }

        getWorldPoints() {
            const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
            return this.points.map(p => ({
                x: this.x + p.x * cos - p.y * sin,
                y: this.y + p.x * sin + p.y * cos
            }));
        }

        contains(x, y) {
            const points = this.getWorldPoints();
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
            }
            return inside;
        }

        getBlockBounds() {
            const points = this.getWorldPoints();
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            points.forEach(p => { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); });
            return { minX, maxX, minY, maxY };
        }

        getEdges(points) {
            const edges = [];
            for (let i = 0; i < points.length; i++) {
                edges.push({ p1: points[i], p2: points[(i + 1) % points.length], index: i });
            }
            return edges;
        }

        generateBuildings() {
            const cityData = getSettlementData(this.hex);
            this.buildings.forEach(b => { cityData.buildings = cityData.buildings.filter(bl => bl.id !== b.id); });
            this.buildings = [];
            this.trees = [];  // Clear trees too
            
            const buildingMode = document.getElementById('buildingMode')?.value || 'perimeter';
            const worldPoints = this.getWorldPoints();
            
            if (buildingMode === 'original') {
                this.generateBuildingsOriginal(worldPoints);
            } else if (buildingMode === 'perimeter') {
                this.generateBuildingsPerimeter(worldPoints);
            } else if (buildingMode === 'mixed') {
                this.generateBuildingsMixed(worldPoints);
            }
            
            // Generate trees after buildings (so they don't overlap)
            this.generateTrees();
        }

        generateBuildingsOriginal(worldPoints) {
            const bounds = this.getBlockBounds();
            const edges = this.getEdges(worldPoints);
            const density = parseFloat(document.getElementById('buildingDensity')?.value || 1.0);
            const cityData = getSettlementData(this.hex);
            
            const targetCount = Math.floor((10 + Math.floor(Math.random() * 10)) * density);
            const edgeAlignedCount = Math.floor(targetCount * 0.75);
            
            // Place edge-aligned buildings
            for (let i = 0; i < edgeAlignedCount * 3 && this.buildings.length < edgeAlignedCount; i++) {
                const edge = edges[Math.floor(Math.random() * edges.length)];
                const building = this.createEdgeBuildingOriginal(edge, worldPoints);
                
                if (building && this.isValidPlacement(building, worldPoints)) {
                    this.buildings.push(building);
                    cityData.buildings.push(building);
                }
            }
            
            // Fill remaining space with randomly oriented buildings
            for (let i = 0; i < (targetCount - edgeAlignedCount) * 3 && this.buildings.length < targetCount; i++) {
                const building = this.createRandomBuilding(bounds, worldPoints);
                
                if (building && this.isValidPlacement(building, worldPoints)) {
                    this.buildings.push(building);
                    cityData.buildings.push(building);
                }
            }
        }

        generateBuildingsPerimeter(worldPoints) {
            const edges = this.getEdges(worldPoints);
            edges.forEach(edge => this.placePerimeterBuildings(edge, worldPoints));
        }

        generateBuildingsMixed(worldPoints) {
            const bounds = this.getBlockBounds();
            const edges = this.getEdges(worldPoints);
            const density = parseFloat(document.getElementById('buildingDensity')?.value || 1.0);
            const cityData = getSettlementData(this.hex);
            
            // First: Place perimeter buildings along all edges
            edges.forEach(edge => this.placePerimeterBuildings(edge, worldPoints));
            
            // Second: Add more random buildings inside the block
            const blockArea = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
            const avgBuildingArea = 100;
            const baseCount = Math.floor(blockArea / avgBuildingArea * 0.3);
            const targetInteriorCount = Math.floor(Math.max(8, baseCount) * density);
            
            let interiorAdded = 0;
            for (let i = 0; i < targetInteriorCount * 4 && interiorAdded < targetInteriorCount; i++) {
                const building = this.createRandomBuilding(bounds, worldPoints);
                if (building && this.isValidPlacement(building, worldPoints)) {
                    this.buildings.push(building);
                    cityData.buildings.push(building);
                    interiorAdded++;
                }
            }
        }

        createEdgeBuildingOriginal(edge, blockPoints) {
            const { p1, p2 } = edge;
            const edgeLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (edgeLength < 10) return null;
            
            const t = 0.1 + Math.random() * 0.8;
            const x = p1.x + (p2.x - p1.x) * t;
            const y = p1.y + (p2.y - p1.y) * t;
            const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            
            const width = 8 + Math.random() * 8;
            const depth = 6 + Math.random() * 6;
            
            const building = new Building(x, y, width, depth, this.hex);
            building.blockId = this.id;
            building.rotation = edgeAngle;
            building.isPerimeter = false;
            
            const inset = building.depth / 2 + 2;
            const normal = edgeAngle + Math.PI / 2;
            building.x += Math.cos(normal) * inset;
            building.y += Math.sin(normal) * inset;
            
            return building;
        }

        createRandomBuilding(bounds, blockPoints) {
            const margin = 10;
            const x = bounds.minX + margin + Math.random() * (bounds.maxX - bounds.minX - margin * 2);
            const y = bounds.minY + margin + Math.random() * (bounds.maxY - bounds.minY - margin * 2);
            
            if (!this.contains(x, y)) return null;
            
            const minSize = 6, maxSize = 12;
            const width = minSize + Math.random() * (maxSize - minSize);
            const depth = minSize * 0.6 + Math.random() * (maxSize - minSize) * 0.8;
            
            const building = new Building(x, y, width, depth, this.hex);
            building.blockId = this.id;
            building.rotation = Math.random() * Math.PI * 2;
            building.isPerimeter = false;
            
            return building;
        }

        placePerimeterBuildings(edge, blockPoints) {
            const { p1, p2 } = edge;
            const edgeLength = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            if (edgeLength < 15) return;
            
            const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
            let inwardNormal = edgeAngle + Math.PI / 2;
            
            const centerX = blockPoints.reduce((s, p) => s + p.x, 0) / blockPoints.length;
            const centerY = blockPoints.reduce((s, p) => s + p.y, 0) / blockPoints.length;
            const midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
            const testX = midX + Math.cos(inwardNormal) * 5;
            const testY = midY + Math.sin(inwardNormal) * 5;
            if (Math.hypot(testX - centerX, testY - centerY) > Math.hypot(midX - centerX, midY - centerY)) {
                inwardNormal += Math.PI;
            }

            const density = parseFloat(document.getElementById('buildingDensity')?.value || 1.0);
            const minSize = 6, maxSize = 12;
            const gap = (1 + Math.random() * 2) / density;
            
            let currentDist = 2;
            const cityData = getSettlementData(this.hex);
            
            while (currentDist < edgeLength - 2) {
                const bw = minSize + 1 + Math.random() * (maxSize - minSize - 2);
                const bd = minSize * 0.8 + Math.random() * (maxSize - minSize);
                
                if (currentDist + bw > edgeLength - 2) break;
                
                const t = (currentDist + bw / 2) / edgeLength;
                const fx = p1.x + (p2.x - p1.x) * t;
                const fy = p1.y + (p2.y - p1.y) * t;
                const bx = fx + Math.cos(inwardNormal) * (bd / 2 + 1);
                const by = fy + Math.sin(inwardNormal) * (bd / 2 + 1);
                
                const building = new Building(bx, by, bw, bd, this.hex);
                building.blockId = this.id;
                building.rotation = edgeAngle;
                building.isPerimeter = true;
                
                if (this.isValidPlacement(building, blockPoints)) {
                    this.buildings.push(building);
                    cityData.buildings.push(building);
                }
                currentDist += bw + gap;
            }
        }

        isValidPlacement(building, blockPoints) {
            // Check all corners are inside block
            for (let p of building.getWorldPoints()) {
                if (!this.contains(p.x, p.y)) return false;
            }
            // Check overlap with other buildings
            for (let b of this.buildings) {
                const dist = Math.hypot(b.x - building.x, b.y - building.y);
                const minDist = (Math.max(b.width, b.depth) + Math.max(building.width, building.depth)) / 2 + 3;
                if (dist < minDist) {
                    if (this.polygonsOverlap(building, b)) return false;
                }
            }
            return true;
        }

        polygonsOverlap(building1, building2) {
            const shape1 = this.getBuildingWorldPolygon(building1);
            const shape2 = this.getBuildingWorldPolygon(building2);
            
            // Separating Axis Theorem
            const axes = [];
            for (let polygon of [shape1, shape2]) {
                for (let i = 0; i < polygon.length; i++) {
                    const p1 = polygon[i], p2 = polygon[(i + 1) % polygon.length];
                    axes.push({ x: -(p2.y - p1.y), y: p2.x - p1.x });
                }
            }
            
            for (let axis of axes) {
                const len = Math.hypot(axis.x, axis.y);
                if (len < 0.0001) continue;
                const normAxis = { x: axis.x / len, y: axis.y / len };
                
                let min1 = Infinity, max1 = -Infinity;
                for (let p of shape1) {
                    const proj = p.x * normAxis.x + p.y * normAxis.y;
                    min1 = Math.min(min1, proj); max1 = Math.max(max1, proj);
                }
                
                let min2 = Infinity, max2 = -Infinity;
                for (let p of shape2) {
                    const proj = p.x * normAxis.x + p.y * normAxis.y;
                    min2 = Math.min(min2, proj); max2 = Math.max(max2, proj);
                }
                
                if (max1 < min2 || max2 < min1) return false;
            }
            return true;
        }

        getBuildingWorldPolygon(building) {
            const shape = building.getShape ? building.getShape() : building.points;
            const cos = Math.cos(building.rotation), sin = Math.sin(building.rotation);
            return shape.map(p => ({
                x: building.x + p.x * cos - p.y * sin,
                y: building.y + p.x * sin + p.y * cos
            }));
        }

        // Generate trees in block that don't overlap buildings
        generateTrees() {
            this.trees = [];
            
            const treesEnabled = document.getElementById('blockTreesEnabled')?.checked || false;
            if (!treesEnabled) return;
            
            const treeDensity = parseFloat(document.getElementById('blockTreeDensity')?.value || 0.5);
            const bounds = this.getBlockBounds();
            const worldPoints = this.getWorldPoints();
            
            const area = (bounds.maxX - bounds.minX) * (bounds.maxY - bounds.minY);
            const baseTreeCount = Math.floor(area / 200 * treeDensity);
            const targetCount = Math.max(2, Math.min(baseTreeCount, 20));
            
            const minTreeRadius = 3, maxTreeRadius = 6;
            
            for (let attempt = 0; attempt < targetCount * 5 && this.trees.length < targetCount; attempt++) {
                const x = bounds.minX + Math.random() * (bounds.maxX - bounds.minX);
                const y = bounds.minY + Math.random() * (bounds.maxY - bounds.minY);
                const radius = minTreeRadius + Math.random() * (maxTreeRadius - minTreeRadius);
                
                if (!this.pointInPolygon({ x, y }, worldPoints)) continue;
                
                // Check distance from buildings
                let overlapsBuilding = false;
                const margin = radius + 3;
                
                for (const building of this.buildings) {
                    const bPoly = this.getBuildingWorldPolygon(building);
                    if (this.pointInPolygon({ x, y }, bPoly)) { overlapsBuilding = true; break; }
                    
                    for (let i = 0; i < bPoly.length; i++) {
                        if (this.pointToSegmentDistance({ x, y }, bPoly[i], bPoly[(i + 1) % bPoly.length]) < margin) {
                            overlapsBuilding = true; break;
                        }
                    }
                    if (overlapsBuilding) break;
                }
                if (overlapsBuilding) continue;
                
                // Check distance from other trees
                let tooCloseToTree = false;
                for (const tree of this.trees) {
                    if (Math.hypot(x - tree.x, y - tree.y) < tree.radius + radius + 2) {
                        tooCloseToTree = true; break;
                    }
                }
                if (tooCloseToTree) continue;
                
                // Check distance from block edges
                let tooCloseToEdge = false;
                for (let i = 0; i < worldPoints.length; i++) {
                    if (this.pointToSegmentDistance({ x, y }, worldPoints[i], worldPoints[(i + 1) % worldPoints.length]) < radius + 2) {
                        tooCloseToEdge = true; break;
                    }
                }
                if (tooCloseToEdge) continue;
                
                this.trees.push({ x, y, radius });
            }
        }

        pointInPolygon(point, polygon) {
            let inside = false;
            for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
                const xi = polygon[i].x, yi = polygon[i].y;
                const xj = polygon[j].x, yj = polygon[j].y;
                if (((yi > point.y) !== (yj > point.y)) && (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi)) {
                    inside = !inside;
                }
            }
            return inside;
        }

        pointToSegmentDistance(point, segStart, segEnd) {
            const dx = segEnd.x - segStart.x, dy = segEnd.y - segStart.y;
            const lengthSq = dx * dx + dy * dy;
            if (lengthSq === 0) return Math.hypot(point.x - segStart.x, point.y - segStart.y);
            
            let t = ((point.x - segStart.x) * dx + (point.y - segStart.y) * dy) / lengthSq;
            t = Math.max(0, Math.min(1, t));
            
            return Math.hypot(point.x - (segStart.x + t * dx), point.y - (segStart.y + t * dy));
        }

        render(graphics, isSelected, zoom = 1) {
            const worldPoints = this.getWorldPoints();
            const lineScale = 1 / Math.max(0.5, zoom);
            
            // Block fill
            graphics.lineStyle(0);
            graphics.beginFill(0x3a4a5a, 0.3);
            graphics.moveTo(worldPoints[0].x, worldPoints[0].y);
            for (let i = 1; i < worldPoints.length; i++) graphics.lineTo(worldPoints[i].x, worldPoints[i].y);
            graphics.closePath();
            graphics.endFill();
            
            // Block outline
            graphics.lineStyle(Math.max(0.5, 1 * lineScale), 0x4a5a6a, 0.8);
            graphics.moveTo(worldPoints[0].x, worldPoints[0].y);
            for (let i = 1; i < worldPoints.length; i++) graphics.lineTo(worldPoints[i].x, worldPoints[i].y);
            graphics.closePath();
            
            // Render block trees
            if (this.trees && this.trees.length > 0) {
                this.renderBlockTrees(graphics, zoom);
            }
            
            if (isSelected) {
                graphics.lineStyle(2 * lineScale, 0x667eea, 1);
                graphics.moveTo(worldPoints[0].x, worldPoints[0].y);
                for (let i = 1; i < worldPoints.length; i++) graphics.lineTo(worldPoints[i].x, worldPoints[i].y);
                graphics.closePath();
                
                // Control points with white outline
                const handleSize = Math.max(5, 7 / zoom);
                graphics.lineStyle(Math.max(1, 2 * lineScale), 0xffffff, 1);
                graphics.beginFill(0x667eea);
                worldPoints.forEach(p => graphics.drawCircle(p.x, p.y, handleSize));
                graphics.endFill();
            }
        }

        renderBlockTrees(graphics, zoom) {
            const showShadows = zoom > 0.5;
            const showInnerDetail = zoom > 0.7;
            
            const shadowColor = 0x1a2a1f;
            const darkTeal = 0x2f4f3f;
            const midGreen = 0x4a7a5a;
            
            const generateSimpleBlob = (cx, cy, radius, points, seed) => {
                const result = [];
                for (let i = 0; i < points; i++) {
                    const angle = (i / points) * Math.PI * 2;
                    const noise = Math.sin(angle * 3 + seed) * 0.12 + Math.sin(angle * 5 + seed * 2) * 0.08;
                    const r = radius * (1 + noise);
                    result.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
                }
                return result;
            };
            
            const drawBlob = (points) => {
                if (points.length < 3) return;
                graphics.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
                graphics.closePath();
            };
            
            [...this.trees].sort((a, b) => a.y - b.y).forEach((tree, idx) => {
                const r = tree.radius;
                const seed = idx * 5.7;
                
                if (showShadows) {
                    const shadowBlob = generateSimpleBlob(tree.x + r * 0.2, tree.y + r * 0.25, r * 0.8, 8, seed);
                    graphics.lineStyle(0);
                    graphics.beginFill(shadowColor, 1);
                    drawBlob(shadowBlob);
                    graphics.endFill();
                }
                
                const crownBlob = generateSimpleBlob(tree.x, tree.y, r, 10, seed + 1);
                graphics.lineStyle(0);
                graphics.beginFill(midGreen, 1);
                drawBlob(crownBlob);
                graphics.endFill();
                
                if (showInnerDetail) {
                    const innerBlob = generateSimpleBlob(tree.x + r * 0.15, tree.y + r * 0.15, r * 0.5, 6, seed + 2);
                    graphics.beginFill(darkTeal, 1);
                    drawBlob(innerBlob);
                    graphics.endFill();
                }
            });
        }
    }

    // ========== BUILDING CLASS ==========
    class Building {
        constructor(x, y, width = 12, height = 8, hex) {
            this.hex = hex;
            this.id = generateId(hex);
            this.type = 'building';
            this.x = x; this.y = y;
            this.rotation = 0;
            this.blockId = null;
            this.width = width;
            this.depth = height;
            this.updateShape();
            this.roofHue = Math.random() > 0.5 ? 'warm' : 'cool';
        }

        updateShape() {
            const hw = this.width / 2, hh = this.depth / 2;
            this.points = [{ x: -hw, y: -hh }, { x: hw, y: -hh }, { x: hw, y: hh }, { x: -hw, y: hh }];
        }

        getWorldPoints() {
            const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
            return this.points.map(p => ({
                x: this.x + p.x * cos - p.y * sin,
                y: this.y + p.x * sin + p.y * cos
            }));
        }

        contains(x, y) {
            const points = this.getWorldPoints();
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
            }
            return inside;
        }

        render(graphics, isSelected, zoom = 1) {
            const worldPoints = this.getWorldPoints();
            const cos = Math.cos(this.rotation);
            const sin = Math.sin(this.rotation);
            
            // LOD: Detail level based on zoom
            const detailLevel = Math.min(3, Math.max(0.5, zoom));
            const lineScale = 1 / Math.max(0.5, zoom);
            
            // LOD thresholds
            const showWalls = zoom > 0.4;
            const showRoofLines = zoom > 0.6;
            const showTileLines = zoom > 1.2;
            
            // Colors based on roof hue
            let roofColor, roofDark, roofLight, wallColor, wallDark, strokeColor;
            if (this.roofHue === 'warm') {
                roofColor = 0xc45c3b;
                roofDark = 0x8b3a2a;
                roofLight = 0xd47050;
                wallColor = 0x6b4a3a;
                wallDark = 0x4a3025;
                strokeColor = 0x3a2a1a;
            } else {
                roofColor = 0x4a6a8a;
                roofDark = 0x3a4a5a;
                roofLight = 0x5a7a9a;
                wallColor = 0x5a5a6a;
                wallDark = 0x3a3a4a;
                strokeColor = 0x2a2a3a;
            }
            
            // Calculate local bounds
            let minLX = Infinity, maxLX = -Infinity, minLY = Infinity, maxLY = -Infinity;
            this.points.forEach(p => {
                minLX = Math.min(minLX, p.x);
                maxLX = Math.max(maxLX, p.x);
                minLY = Math.min(minLY, p.y);
                maxLY = Math.max(maxLY, p.y);
            });
            
            const localWidth = maxLX - minLX;
            const localHeight = maxLY - minLY;
            const localCenterX = (minLX + maxLX) / 2;
            const localCenterY = (minLY + maxLY) / 2;
            const buildingSize = Math.max(localWidth, localHeight);
            
            // Transform local point to world
            const toWorld = (lx, ly) => ({
                x: this.x + lx * cos - ly * sin,
                y: this.y + lx * sin + ly * cos
            });
            
            // LOD: Only draw walls when zoomed in enough
            if (showWalls) {
                const wallEdges = [];
                for (let i = 0; i < worldPoints.length; i++) {
                    const p1 = worldPoints[i];
                    const p2 = worldPoints[(i + 1) % worldPoints.length];
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const nx = dy;
                    const ny = -dx;
                    if (ny > 0 || (ny >= -0.1 && nx > 0)) {
                        wallEdges.push({ p1, p2, i });
                    }
                }
                
                const wallHeight = Math.max(2, buildingSize * 0.15);
                const wallOffset = Math.max(1, buildingSize * 0.08);
                wallEdges.forEach(edge => {
                    graphics.lineStyle(0);
                    graphics.beginFill(wallColor, 1);
                    graphics.moveTo(edge.p1.x, edge.p1.y);
                    graphics.lineTo(edge.p2.x, edge.p2.y);
                    graphics.lineTo(edge.p2.x + wallOffset, edge.p2.y + wallHeight);
                    graphics.lineTo(edge.p1.x + wallOffset, edge.p1.y + wallHeight);
                    graphics.closePath();
                    graphics.endFill();
                    
                    if (detailLevel > 1) {
                        graphics.beginFill(wallDark, 0.4);
                        graphics.moveTo(edge.p1.x + wallOffset * 0.5, edge.p1.y + wallHeight * 0.6);
                        graphics.lineTo(edge.p2.x + wallOffset * 0.5, edge.p2.y + wallHeight * 0.6);
                        graphics.lineTo(edge.p2.x + wallOffset, edge.p2.y + wallHeight);
                        graphics.lineTo(edge.p1.x + wallOffset, edge.p1.y + wallHeight);
                        graphics.closePath();
                        graphics.endFill();
                    }
                });
            }
            
            // Draw main roof fill
            graphics.lineStyle(0);
            graphics.beginFill(roofColor, 1);
            graphics.moveTo(worldPoints[0].x, worldPoints[0].y);
            for (let i = 1; i < worldPoints.length; i++) {
                graphics.lineTo(worldPoints[i].x, worldPoints[i].y);
            }
            graphics.closePath();
            graphics.endFill();
            
            // LOD: Only draw roof lines when zoomed in enough
            if (showRoofLines) {
                const gableDepth = Math.min(localWidth, localHeight) * 0.3;
                const isWide = localWidth > localHeight;
                
                // Tile lines at high zoom
                if (showTileLines && buildingSize > 15) {
                    const tileSpacing = Math.max(2, 6 / detailLevel);
                    graphics.lineStyle(0.5 * lineScale, roofDark, 0.3);
                    
                    if (isWide) {
                        for (let ly = minLY + tileSpacing; ly < maxLY - tileSpacing; ly += tileSpacing) {
                            const p1 = toWorld(minLX + gableDepth * 0.3, ly);
                            const p2 = toWorld(maxLX - gableDepth * 0.3, ly);
                            graphics.moveTo(p1.x, p1.y);
                            graphics.lineTo(p2.x, p2.y);
                        }
                    } else {
                        for (let lx = minLX + tileSpacing; lx < maxLX - tileSpacing; lx += tileSpacing) {
                            const p1 = toWorld(lx, minLY + gableDepth * 0.3);
                            const p2 = toWorld(lx, maxLY - gableDepth * 0.3);
                            graphics.moveTo(p1.x, p1.y);
                            graphics.lineTo(p2.x, p2.y);
                        }
                    }
                }
                
                // Draw gabled roof structure with lines to ACTUAL corners
                const roofLineWidth = Math.max(0.5, 1.5 * lineScale);
                graphics.lineStyle(roofLineWidth, roofDark, 1);
                
                if (isWide) {
                    // Left gable - lines go to actual corners
                    const leftTopCorner = toWorld(minLX, minLY);
                    const leftTip = toWorld(minLX + gableDepth, localCenterY);
                    const leftBotCorner = toWorld(minLX, maxLY);
                    
                    graphics.moveTo(leftTopCorner.x, leftTopCorner.y);
                    graphics.lineTo(leftTip.x, leftTip.y);
                    graphics.lineTo(leftBotCorner.x, leftBotCorner.y);
                    
                    // Ridge line
                    const ridgeRight = toWorld(maxLX - gableDepth, localCenterY);
                    graphics.moveTo(leftTip.x, leftTip.y);
                    graphics.lineTo(ridgeRight.x, ridgeRight.y);
                    
                    // Right gable - lines go to actual corners
                    const rightTopCorner = toWorld(maxLX, minLY);
                    const rightTip = toWorld(maxLX - gableDepth, localCenterY);
                    const rightBotCorner = toWorld(maxLX, maxLY);
                    
                    graphics.moveTo(rightTopCorner.x, rightTopCorner.y);
                    graphics.lineTo(rightTip.x, rightTip.y);
                    graphics.lineTo(rightBotCorner.x, rightBotCorner.y);
                    
                } else {
                    // Top gable - lines go to actual corners
                    const topLeftCorner = toWorld(minLX, minLY);
                    const topTip = toWorld(localCenterX, minLY + gableDepth);
                    const topRightCorner = toWorld(maxLX, minLY);
                    
                    graphics.moveTo(topLeftCorner.x, topLeftCorner.y);
                    graphics.lineTo(topTip.x, topTip.y);
                    graphics.lineTo(topRightCorner.x, topRightCorner.y);
                    
                    // Ridge line
                    const ridgeBot = toWorld(localCenterX, maxLY - gableDepth);
                    graphics.moveTo(topTip.x, topTip.y);
                    graphics.lineTo(ridgeBot.x, ridgeBot.y);
                    
                    // Bottom gable - lines go to actual corners
                    const botLeftCorner = toWorld(minLX, maxLY);
                    const botTip = toWorld(localCenterX, maxLY - gableDepth);
                    const botRightCorner = toWorld(maxLX, maxLY);
                    
                    graphics.moveTo(botLeftCorner.x, botLeftCorner.y);
                    graphics.lineTo(botTip.x, botTip.y);
                    graphics.lineTo(botRightCorner.x, botRightCorner.y);
                }
            }
            
            // Draw outline
            const outlineWidth = Math.max(0.5, 1.5 * lineScale);
            graphics.lineStyle(outlineWidth, strokeColor, 1);
            graphics.moveTo(worldPoints[0].x, worldPoints[0].y);
            for (let i = 1; i < worldPoints.length; i++) {
                graphics.lineTo(worldPoints[i].x, worldPoints[i].y);
            }
            graphics.closePath();
            
            // Selection handles
            if (isSelected) {
                graphics.lineStyle(2 * lineScale, 0x667eea, 1);
                graphics.moveTo(worldPoints[0].x, worldPoints[0].y);
                for (let i = 1; i < worldPoints.length; i++) {
                    graphics.lineTo(worldPoints[i].x, worldPoints[i].y);
                }
                graphics.closePath();
                
                const handleSize = Math.max(5, 7 / zoom);
                graphics.lineStyle(Math.max(1, 2 * lineScale), 0xffffff, 1);
                graphics.beginFill(0x667eea);
                worldPoints.forEach(p => {
                    graphics.drawCircle(p.x, p.y, handleSize);
                });
                graphics.endFill();
            }
        }
    }

    // ========== FOREST CLASS ==========
    class Forest {
        constructor(x, y, size, hex) {
            this.hex = hex;
            this.id = generateId(hex);
            this.type = 'forest';
            this.x = x; this.y = y;
            this.rotation = 0;
            
            const sides = 8;
            this.points = [];
            for (let i = 0; i < sides; i++) {
                const angle = (i / sides) * Math.PI * 2;
                this.points.push({ x: Math.cos(angle) * size, y: Math.sin(angle) * size * 0.7 });
            }
            this.trees = [];
            this.generateTrees();
        }

        getWorldPoints() {
            const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
            return this.points.map(p => ({
                x: this.x + p.x * cos - p.y * sin,
                y: this.y + p.x * sin + p.y * cos
            }));
        }

        contains(x, y) {
            const points = this.getWorldPoints();
            let inside = false;
            for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
                const xi = points[i].x, yi = points[i].y, xj = points[j].x, yj = points[j].y;
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
            }
            return inside;
        }

        containsLocal(x, y) {
            let inside = false;
            for (let i = 0, j = this.points.length - 1; i < this.points.length; j = i++) {
                const xi = this.points[i].x, yi = this.points[i].y, xj = this.points[j].x, yj = this.points[j].y;
                if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
            }
            return inside;
        }

        generateTrees() {
            // Get settings from UI sliders
            const density = parseFloat(document.getElementById('forestDensity')?.value || 1.0);
            const baseTreeSize = parseInt(document.getElementById('treeSize')?.value || 12);
            
            this.trees = [];
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            this.points.forEach(p => {
                minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
                minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
            });
            
            // Use Poisson disk-like sampling with jittered grid for more natural distribution
            const minDist = baseTreeSize * 0.6 / density;  // Minimum distance between trees
            const cellSize = minDist / Math.sqrt(2);
            const gridWidth = Math.ceil((maxX - minX) / cellSize);
            const gridHeight = Math.ceil((maxY - minY) / cellSize);
            
            // Use golden angle for more natural spiral-like distribution
            const goldenAngle = Math.PI * (3 - Math.sqrt(5));
            let seed = this.id || Math.random() * 10000;
            
            // Seeded random function for consistent results
            const seededRandom = () => {
                seed = (seed * 9301 + 49297) % 233280;
                return seed / 233280;
            };
            
            // Generate candidate points with jittered Poisson-like distribution
            const candidates = [];
            for (let gx = 0; gx < gridWidth; gx++) {
                for (let gy = 0; gy < gridHeight; gy++) {
                    // Add randomness based on position hash for variety
                    const hash = (gx * 73856093 + gy * 19349663) % 1000 / 1000;
                    
                    // Jitter amount varies by cell for more organic feel
                    const jitterScale = 0.7 + hash * 0.5;
                    const jx = (seededRandom() - 0.5) * cellSize * jitterScale;
                    const jy = (seededRandom() - 0.5) * cellSize * jitterScale;
                    
                    const tx = minX + (gx + 0.5) * cellSize + jx;
                    const ty = minY + (gy + 0.5) * cellSize + jy;
                    
                    // Check containment using bezier-aware smooth boundary
                    if (this.containsLocalSmooth(tx, ty)) {
                        candidates.push({
                            x: tx, y: ty,
                            hash: hash,
                            gridX: gx,
                            gridY: gy
                        });
                    }
                }
            }
            
            // Filter candidates to ensure minimum distance (Poisson-like)
            const accepted = [];
            for (const candidate of candidates) {
                let tooClose = false;
                for (const tree of accepted) {
                    const dist = Math.sqrt((candidate.x - tree.x) ** 2 + (candidate.y - tree.y) ** 2);
                    // Use variable minimum distance based on tree sizes
                    const minRequired = minDist * (0.7 + candidate.hash * 0.3);
                    if (dist < minRequired) {
                        tooClose = true;
                        break;
                    }
                }
                if (!tooClose) {
                    const size = baseTreeSize * (0.75 + seededRandom() * 0.5);
                    accepted.push({
                        x: candidate.x,
                        y: candidate.y,
                        radius: size / 2,
                        hash: candidate.hash,
                        gridX: candidate.gridX,
                        gridY: candidate.gridY
                    });
                }
            }
            
            this.trees = accepted;
            this.trees.sort((a, b) => a.y - b.y);
        }
        
        // Smooth containment check that accounts for bezier-like curves
        containsLocalSmooth(x, y) {
            // First do basic polygon check
            if (!this.containsLocal(x, y)) return false;
            
            // Then check distance from edges - trees should be slightly inside
            // This creates a natural buffer from the bezier boundary
            const margin = 3;  // Pixels inside from edge
            const n = this.points.length;
            
            for (let i = 0; i < n; i++) {
                const p1 = this.points[i];
                const p2 = this.points[(i + 1) % n];
                
                // Distance from point to line segment
                const dx = p2.x - p1.x;
                const dy = p2.y - p1.y;
                const lenSq = dx * dx + dy * dy;
                
                if (lenSq > 0) {
                    const t = Math.max(0, Math.min(1, ((x - p1.x) * dx + (y - p1.y) * dy) / lenSq));
                    const closestX = p1.x + t * dx;
                    const closestY = p1.y + t * dy;
                    const distToEdge = Math.sqrt((x - closestX) ** 2 + (y - closestY) ** 2);
                    
                    if (distToEdge < margin) return false;
                }
            }
            
            return true;
        }
        
        // Get trees for LOD using hash-based selection (avoids visible grid patterns)
        getTreesForLOD(lodLevel) {
            if (lodLevel >= 4) return this.trees;
            if (lodLevel === 0) return [];
            
            // LOD ratios: 1=25%, 2=50%, 3=75%, 4=100%
            const keepRatio = [0, 0.25, 0.5, 0.75, 1.0][lodLevel];
            
            if (keepRatio >= 1) return this.trees;
            
            // Use hash-based selection for natural-looking distribution at all LODs
            return this.trees.filter(tree => {
                // Create a deterministic but seemingly random value from tree position
                // Using prime multipliers for good distribution
                const hash = Math.abs(
                    Math.sin(tree.x * 12.9898 + tree.y * 78.233 + (tree.hash || 0) * 43.758) * 43758.5453
                ) % 1;
                
                return hash < keepRatio;
            });
        }

        render(graphics, isSelected, zoom = 1) {
            const cos = Math.cos(this.rotation), sin = Math.sin(this.rotation);
            const lineScale = 1 / Math.max(0.5, zoom);
            const toWorld = (p) => ({ x: this.x + p.x * cos - p.y * sin, y: this.y + p.x * sin + p.y * cos });
            
            const lodLevel = getForestLODLevel(zoom);
            const treesToRender = this.getTreesForLOD(lodLevel);
            
            const shadowColor = 0x1a2a1f, darkTeal = 0x2f4f3f, midGreen = 0x4a7a5a, lightGreen = 0x5a8a65, strokeColor = 0x1a2a1f;
            
            const generateBlob = (cx, cy, baseRadius, bumpiness, pointCount, seed) => {
                const points = [];
                for (let i = 0; i < pointCount; i++) {
                    const angle = (i / pointCount) * Math.PI * 2;
                    const noise = Math.sin(angle * 3 + seed) * 0.15 + Math.sin(angle * 5 + seed * 2) * 0.08;
                    const r = baseRadius * (1 + noise * bumpiness);
                    points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r });
                }
                return points;
            };
            
            const drawBlob = (points) => {
                if (points.length < 3) return;
                graphics.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
                graphics.closePath();
            };
            
            // Smooth curve helper using quadratic bezier
            const drawSmoothCurve = (points) => {
                if (points.length < 3) { drawBlob(points); return; }
                const len = points.length;
                graphics.moveTo((points[len-1].x + points[0].x)/2, (points[len-1].y + points[0].y)/2);
                for (let i = 0; i < len; i++) {
                    const p1 = points[i], p2 = points[(i+1) % len];
                    graphics.quadraticCurveTo(p1.x, p1.y, (p1.x + p2.x)/2, (p1.y + p2.y)/2);
                }
                graphics.closePath();
            };
            
            // LOD 0: Render the actual forest shape as a smooth filled blob
            if (lodLevel === 0) {
                const worldShape = this.points.map(p => toWorld(p));
                graphics.lineStyle(0);
                graphics.beginFill(midGreen, 0.9);
                drawSmoothCurve(worldShape);
                graphics.endFill();
                graphics.lineStyle(Math.max(1, 2 * lineScale), darkTeal, 0.8);
                drawSmoothCurve(worldShape);
            } else {
                // LOD 1-4: Render trees
                const showShadows = lodLevel >= 2;
                const showHighlights = lodLevel >= 3;
                
                [...treesToRender].sort((a, b) => a.y - b.y).forEach((tree, idx) => {
                    const w = toWorld(tree);
                    const r = tree.radius;
                    // Use grid position for consistent seed (so trees look the same at all LODs)
                    const seed = ((tree.gridX || 0) * 17 + (tree.gridY || 0) * 31) * 7.3;
                    
                    if (showShadows) {
                        const shadowBlob = generateBlob(w.x + r * 0.25, w.y + r * 0.3, r * 0.85, 1.0, 6, seed);
                        graphics.lineStyle(0);
                        graphics.beginFill(shadowColor, 1);
                        drawBlob(shadowBlob);
                        graphics.endFill();
                    }
                    
                    const crownBlob = generateBlob(w.x, w.y, r, 1.0, lodLevel >= 3 ? 10 : 6, seed + 1);
                    graphics.lineStyle(0);
                    graphics.beginFill(midGreen, 1);
                    drawBlob(crownBlob);
                    graphics.endFill();
                    
                    const innerBlob = generateBlob(w.x + r * 0.2, w.y + r * 0.2, r * 0.55, 1.2, 5, seed + 2);
                    graphics.beginFill(darkTeal, 1);
                    drawBlob(innerBlob);
                    graphics.endFill();
                    
                    if (showHighlights) {
                        const highlightBlob = generateBlob(w.x - r * 0.25, w.y - r * 0.2, r * 0.35, 1.2, 5, seed + 3);
                        graphics.beginFill(lightGreen, 1);
                        drawBlob(highlightBlob);
                        graphics.endFill();
                        
                        graphics.lineStyle(Math.max(0.5, lineScale), strokeColor, 1);
                        drawBlob(crownBlob);
                    }
                });
            }
            
            // Selection: smooth outline with visible vertices
            if (isSelected) {
                const wp = this.getWorldPoints();
                graphics.lineStyle(Math.max(1, 2 * lineScale), 0x667eea, 1);
                drawSmoothCurve(wp);
                
                // Large vertex handles with white outline
                const handleSize = Math.max(6, 8 / zoom);
                graphics.lineStyle(Math.max(1, 2 * lineScale), 0xffffff, 1);
                graphics.beginFill(0x667eea);
                wp.forEach(p => graphics.drawCircle(p.x, p.y, handleSize));
                graphics.endFill();
            }
        }
    }

    // ========== RENDERING ==========
    function renderSettlement() {
        if (!settlementState.pixiApp) {
            console.log('🏰 renderSettlement: No pixiApp');
            return;
        }
        if (!settlementState.activeHex) {
            console.log('🏰 renderSettlement: No activeHex');
            return;
        }
        
        try {
            const graphics = settlementState.worldGraphics;
            const worldContainer = settlementState.worldContainer;
            graphics.clear();
            
            const hex = settlementState.activeHex;
            const data = hex.settlementData;
            if (!data) {
                console.log('🏰 renderSettlement: No settlement data for hex');
                return;
            }
            
            console.log('🏰 Rendering settlement:', {
                cities: data.cities.length,
                districts: data.districts.length,
                blocks: data.blocks.length,
                buildings: data.buildings.length,
                forests: data.forests.length
            });
            
            const hexCenter = window.hexToPixel(hex.q, hex.r);
            const scale = window.state.hexMap.viewport.scale;
            
            worldContainer.position.set(hexCenter.x, hexCenter.y);
            worldContainer.scale.set(scale * 0.01);
            const zoom = scale * 0.01;
            
            function drawPolygon(points, fillColor, fillAlpha, strokeColor, strokeAlpha, lineWidth) {
                if (!points || points.length < 3) return;
                graphics.beginFill(fillColor, fillAlpha);
                graphics.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
                graphics.closePath();
                graphics.endFill();
                graphics.lineStyle(lineWidth, strokeColor, strokeAlpha);
                graphics.moveTo(points[0].x, points[0].y);
                for (let i = 1; i < points.length; i++) graphics.lineTo(points[i].x, points[i].y);
                graphics.closePath();
            }
            
            // Get background color settings from UI
            const showCityBg = document.getElementById('cityBgEnabled')?.checked || false;
            const showDistrictBg = document.getElementById('districtBgEnabled')?.checked ?? true;
            const cityBgColor = parseInt(document.getElementById('cityBgColor')?.value.replace('#', '') || 'd4c4a4', 16);
            const districtBgColor = parseInt(document.getElementById('districtBgColor')?.value.replace('#', '') || 'c4a76c', 16);
            
            // Render in order: cities, districts, blocks, buildings, forests
            data.cities.forEach(c => {
                // City background fill if enabled
                if (showCityBg) {
                    const pts = c.getWorldPoints();
                    graphics.lineStyle(0);
                    graphics.beginFill(cityBgColor, 0.5);
                    graphics.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i].x, pts[i].y);
                    graphics.closePath();
                    graphics.endFill();
                }
                
                drawPolygon(c.getWorldPoints(), 0xa855f7, 0.05, 0xa855f7, 0.4, 2.5);
                if (settlementState.selectedObject === c) {
                    const pts = c.getWorldPoints();
                    const handleSize = Math.max(6, 8 / zoom);
                    graphics.lineStyle(Math.max(1, 2 / zoom), 0xffffff, 1);
                    graphics.beginFill(0xa855f7);
                    pts.forEach(p => graphics.drawCircle(p.x, p.y, handleSize));
                    graphics.endFill();
                }
            });
            
            data.districts.forEach(d => {
                // District background fill if enabled
                if (showDistrictBg) {
                    const pts = d.getWorldPoints();
                    graphics.lineStyle(0);
                    graphics.beginFill(districtBgColor, 0.6);
                    graphics.moveTo(pts[0].x, pts[0].y);
                    for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i].x, pts[i].y);
                    graphics.closePath();
                    graphics.endFill();
                }
                
                drawPolygon(d.getWorldPoints(), 0x667eea, 0.1, 0x667eea, 0.6, 2);
                if (settlementState.selectedObject === d) {
                    const pts = d.getWorldPoints();
                    const handleSize = Math.max(6, 8 / zoom);
                    graphics.lineStyle(Math.max(1, 2 / zoom), 0xffffff, 1);
                    graphics.beginFill(0x667eea);
                    pts.forEach(p => graphics.drawCircle(p.x, p.y, handleSize));
                    graphics.endFill();
                }
            });
            
            data.blocks.forEach(b => {
                b.render(graphics, settlementState.selectedObject === b, zoom);
            });
            
            data.buildings.forEach(b => b.render(graphics, settlementState.selectedObject === b, zoom));
            data.forests.forEach(f => f.render(graphics, settlementState.selectedObject === f, zoom));
            
            // ========== MODERN UX OVERLAYS ==========
            renderModernSelectionUI(graphics, zoom);
            
        } catch (error) {
            console.error('🏰 Render error:', error);
        }
    }
    
    // Enhanced selection rendering with hover states
    function renderModernSelectionUI(graphics, zoom) {
        const selected = settlementState.selectedObject;
        const hovered = settlementState.hoveredObject;
        const hoveredVertex = settlementState.hoveredVertex;
        const hoveredEdge = settlementState.hoveredEdge;
        const colors = CONFIG.UX.COLORS;
        const lineScale = 1 / Math.max(0.3, zoom);
        
        // Render hover outline on non-selected objects
        if (hovered && hovered !== selected && hovered.getWorldPoints) {
            const pts = hovered.getWorldPoints();
            if (pts && pts.length >= 3) {
                // Soft glow
                graphics.lineStyle(Math.max(4, 6 * lineScale), colors.hover, 0.25);
                graphics.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i].x, pts[i].y);
                graphics.closePath();
                
                // Main outline
                graphics.lineStyle(Math.max(1.5, 2.5 * lineScale), colors.hover, 0.7);
                graphics.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i].x, pts[i].y);
                graphics.closePath();
            }
        }
        
        // Enhanced selection for cities/districts (that don't use .render())
        if (selected && selected.getWorldPoints) {
            const pts = selected.getWorldPoints();
            if (pts && pts.length >= 3) {
                // Animated pulsing glow
                const pulsePhase = (Date.now() % 2000) / 2000;
                const pulseAlpha = 0.12 + Math.sin(pulsePhase * Math.PI * 2) * 0.08;
                
                graphics.lineStyle(Math.max(6, 10 * lineScale), colors.selectionGlow, pulseAlpha);
                graphics.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i].x, pts[i].y);
                graphics.closePath();
                
                // Selection outline
                graphics.lineStyle(Math.max(2, 3 * lineScale), colors.selection, 1);
                graphics.moveTo(pts[0].x, pts[0].y);
                for (let i = 1; i < pts.length; i++) graphics.lineTo(pts[i].x, pts[i].y);
                graphics.closePath();
                
                // Edge highlight for adding vertices
                if (hoveredEdge && hoveredEdge.object === selected) {
                    const edgeIdx = hoveredEdge.edgeIndex;
                    const p1 = pts[edgeIdx];
                    const p2 = pts[(edgeIdx + 1) % pts.length];
                    
                    // Highlight the edge
                    graphics.lineStyle(Math.max(3, 5 * lineScale), colors.edgeHover, 0.8);
                    graphics.moveTo(p1.x, p1.y);
                    graphics.lineTo(p2.x, p2.y);
                    
                    // Show potential vertex position with plus icon
                    const edgePoint = hoveredEdge.point;
                    const baseRadius = CONFIG.UX.VERTEX_RADIUS / Math.max(0.3, zoom);
                    
                    // Glow
                    graphics.lineStyle(0);
                    graphics.beginFill(colors.edgeHover, 0.3);
                    graphics.drawCircle(edgePoint.x, edgePoint.y, baseRadius * 1.5);
                    graphics.endFill();
                    
                    // Circle
                    graphics.lineStyle(Math.max(2, 2.5 * lineScale), 0x000000, 0.5);
                    graphics.beginFill(colors.edgeHover, 0.95);
                    graphics.drawCircle(edgePoint.x, edgePoint.y, baseRadius * 0.85);
                    graphics.endFill();
                    
                    // Plus icon
                    const iconSize = baseRadius * 0.5;
                    graphics.lineStyle(Math.max(1.5, 2 * lineScale), 0x000000, 0.8);
                    graphics.moveTo(edgePoint.x - iconSize, edgePoint.y);
                    graphics.lineTo(edgePoint.x + iconSize, edgePoint.y);
                    graphics.moveTo(edgePoint.x, edgePoint.y - iconSize);
                    graphics.lineTo(edgePoint.x, edgePoint.y + iconSize);
                }
                
                // Vertex handles with states
                const baseRadius = CONFIG.UX.VERTEX_RADIUS / Math.max(0.3, zoom);
                const hoverRadius = CONFIG.UX.VERTEX_HOVER_RADIUS / Math.max(0.3, zoom);
                const activeRadius = CONFIG.UX.VERTEX_ACTIVE_RADIUS / Math.max(0.3, zoom);
                
                pts.forEach((p, idx) => {
                    let radius = baseRadius;
                    let fillColor = colors.vertex;
                    let strokeColor = colors.selection;
                    
                    // Check if vertex is hovered
                    const isHovered = hoveredVertex && 
                                     hoveredVertex.object === selected && 
                                     hoveredVertex.index === idx;
                    
                    // Check if vertex is being dragged
                    const isDragging = settlementState.isDragging && 
                                      settlementState.dragType === 'vertex' &&
                                      settlementState.dragTarget?.object === selected &&
                                      settlementState.dragTarget?.index === idx;
                    
                    if (isDragging) {
                        radius = activeRadius;
                        fillColor = colors.vertexActive;
                        strokeColor = 0xd97706;
                    } else if (isHovered) {
                        radius = hoverRadius;
                        fillColor = colors.vertexHover;
                        strokeColor = colors.vertexActive;
                    }
                    
                    // Outer glow
                    graphics.lineStyle(0);
                    graphics.beginFill(strokeColor, 0.2);
                    graphics.drawCircle(p.x, p.y, radius + 4 * lineScale);
                    graphics.endFill();
                    
                    // Main circle
                    graphics.lineStyle(Math.max(2, 2.5 * lineScale), strokeColor, 1);
                    graphics.beginFill(fillColor, 1);
                    graphics.drawCircle(p.x, p.y, radius);
                    graphics.endFill();
                    
                    // Inner highlight (3D effect)
                    graphics.lineStyle(0);
                    graphics.beginFill(0xffffff, 0.4);
                    graphics.drawCircle(p.x - radius * 0.25, p.y - radius * 0.25, radius * 0.3);
                    graphics.endFill();
                });
            }
        }
    }

    // ========== CLICK HANDLING ==========
    // Double-click tracking
    let lastClickTime = 0;
    let lastClickPos = { x: 0, y: 0 };
    const DOUBLE_CLICK_TIME = 350;
    const DOUBLE_CLICK_DIST = 15;
    
    function setupClickHandler() {
        window.settlementClickHandler = function(canvasX, canvasY, hexCoords, button) {
            // Force update detail level and active hex on click
            const scale = window.state.hexMap.viewport.scale;
            const currentLevel = getDetailLevel(scale);
            if (currentLevel !== settlementState.detailLevel) {
                settlementState.detailLevel = currentLevel;
                updateUI();
            }
            
            console.log('🏰 Click received:', { 
                canvasX: canvasX.toFixed(0), 
                canvasY: canvasY.toFixed(0), 
                button, 
                scale: scale.toFixed(2),
                detailLevel: settlementState.detailLevel, 
                activeHex: settlementState.activeHex ? `${settlementState.activeHex.q},${settlementState.activeHex.r}` : 'null',
                hexCoords: hexCoords ? `${hexCoords.q},${hexCoords.r}` : 'null'
            });
            
            if (button !== 0) {
                console.log('🏰 Ignoring non-left click');
                return false;
            }
            
            if (settlementState.detailLevel !== 'SETTLEMENT') {
                console.log('🏰 Not in settlement mode, level:', settlementState.detailLevel, 'scale:', scale);
                return false;
            }
            
            // Use activeHex if set, otherwise try to find the hex from hexCoords
            let activeHex = settlementState.activeHex;
            if (!activeHex && hexCoords) {
                // hexes is a Map, not an array - use get() with key string
                activeHex = window.getHex ? window.getHex(hexCoords.q, hexCoords.r) :
                            window.state.hexMap.hexes.get(`${hexCoords.q},${hexCoords.r}`);
                if (activeHex) {
                    console.log('🏰 Using clicked hex as activeHex:', hexCoords.q, hexCoords.r);
                    settlementState.activeHex = activeHex;
                }
            }
            
            // Last resort - use getCenterHex
            if (!activeHex) {
                activeHex = getCenterHex();
                if (activeHex) {
                    console.log('🏰 Using center hex as activeHex:', activeHex.q, activeHex.r);
                    settlementState.activeHex = activeHex;
                }
            }
            
            if (!activeHex) {
                console.log('🏰 No active hex available!');
                return false;
            }
            
            const hexCenter = window.hexToPixel(activeHex.q, activeHex.r);
            const settlementScale = scale * 0.01;
            
            const sx = (canvasX - hexCenter.x) / settlementScale;
            const sy = (canvasY - hexCenter.y) / settlementScale;
            
            const data = getSettlementData(activeHex);
            const tool = settlementState.currentTool;
            
            // Check for double-click
            const now = Date.now();
            const timeDiff = now - lastClickTime;
            const distDiff = Math.hypot(canvasX - lastClickPos.x, canvasY - lastClickPos.y);
            const isDoubleClick = timeDiff < DOUBLE_CLICK_TIME && distDiff < DOUBLE_CLICK_DIST;
            lastClickTime = now;
            lastClickPos = { x: canvasX, y: canvasY };
            
            console.log('🏰 Click:', sx.toFixed(0), sy.toFixed(0), 'Tool:', tool, 'DoubleClick:', isDoubleClick);
            
            // ===== DOUBLE-CLICK =====
            if (isDoubleClick) {
                // Double-click on edge of selected object: add vertex
                if (settlementState.selectedObject && settlementState.hoveredEdge) {
                    const edgeInfo = settlementState.hoveredEdge;
                    addVertexToEdge(settlementState.selectedObject, edgeInfo.edgeIndex, edgeInfo.point);
                    console.log('🏰 Added vertex at edge', edgeInfo.edgeIndex);
                    settlementState.hoveredEdge = null;
                    renderSettlement();
                    return true;
                }
                
                // Double-click on empty space: create new object
                const clickedObj = findObjectAt(sx, sy, data);
                if (!clickedObj) {
                    console.log('🏰 Creating new object:', tool);
                    createNewObject(sx, sy, tool, activeHex, data);
                    renderSettlement();
                    updateHierarchy();
                    return true;
                }
                return true;
            }
            
            // ===== SINGLE-CLICK =====
            
            // Check if clicking on a vertex of selected object (use hover state for accuracy)
            if (settlementState.selectedObject && settlementState.hoveredVertex) {
                const ctrlPt = settlementState.hoveredVertex;
                window.settlementStartDrag('vertex', { 
                    type: 'vertex', 
                    index: ctrlPt.index, 
                    object: ctrlPt.object 
                }, { x: sx, y: sy });
                console.log('🏰 Started dragging vertex', ctrlPt.index);
                return true;
            }
            
            // Check if clicking on existing object - select and allow drag
            const clicked = findObjectAt(sx, sy, data);
            if (clicked) {
                settlementState.selectedObject = clicked;
                window.settlementStartDrag('shape', { 
                    type: 'shape', 
                    object: clicked 
                }, { x: sx, y: sy });
                console.log('🏰 Selected:', clicked.type, clicked.id);
                renderSettlement();
                updateHierarchy();
                return true;
            }
            
            // Click on empty: deselect
            if (settlementState.selectedObject) {
                settlementState.selectedObject = null;
                settlementState.hoveredVertex = null;
                settlementState.hoveredEdge = null;
                console.log('🏰 Deselected');
                renderSettlement();
                return true;
            }
            
            return false;
        };
    }
    
    // Find point on edge for adding vertices (legacy fallback)
    function findEdgePointAt(sx, sy, obj) {
        return findEdgeAt(sx, sy, obj);
    }
    
    function addVertexToEdge(obj, edgeIndex, worldPoint) {
        if (!obj || !obj.points) return;
        const cos = Math.cos(-obj.rotation), sin = Math.sin(-obj.rotation);
        const localX = (worldPoint.x - obj.x) * cos - (worldPoint.y - obj.y) * sin;
        const localY = (worldPoint.x - obj.x) * sin + (worldPoint.y - obj.y) * cos;
        obj.points.splice(edgeIndex + 1, 0, { x: localX, y: localY });
        regenerateObject(obj);
    }
    
    function createNewObject(sx, sy, tool, activeHex, data) {
        if (tool === 'city') {
            const city = new City(sx, sy, 150, activeHex);
            data.cities.push(city);
            city.subdivideIntoDistricts();
            settlementState.selectedObject = city;
        } else if (tool === 'district') {
            const district = new District(sx, sy, 80, activeHex);
            data.districts.push(district);
            district.subdivideIntoBlocks();
            settlementState.selectedObject = district;
        } else if (tool === 'block') {
            const block = new Block(sx, sy, 40, 40, activeHex);
            data.blocks.push(block);
            block.generateBuildings();
            settlementState.selectedObject = block;
        } else if (tool === 'building') {
            const building = new Building(sx, sy, 10, 8, activeHex);
            data.buildings.push(building);
            settlementState.selectedObject = building;
        } else if (tool === 'forest') {
            const forest = new Forest(sx, sy, 60, activeHex);
            data.forests.push(forest);
            settlementState.selectedObject = forest;
        }
    }
    
    function regenerateObject(obj) {
        if (!obj) return;
        if (obj.type === 'city') obj.subdivideIntoDistricts();
        else if (obj.type === 'district') obj.subdivideIntoBlocks();
        else if (obj.type === 'block') obj.generateBuildings();
        else if (obj.type === 'forest' && obj.generateTrees) obj.generateTrees();
    }
    
    // ========== MODERN UX UTILITIES ==========
    
    // Smooth linear interpolation
    function lerp(start, end, factor) {
        return start + (end - start) * factor;
    }
    
    // Distance between two points
    function pointDistance(p1, p2) {
        return Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
    }
    
    // Point to line segment distance with closest point
    function pointToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1, dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return { dist: pointDistance({x: px, y: py}, {x: x1, y: y1}), t: 0, point: {x: x1, y: y1} };
        
        const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
        const closestX = x1 + t * dx;
        const closestY = y1 + t * dy;
        
        return {
            dist: Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2),
            t: t,
            point: { x: closestX, y: closestY }
        };
    }
    
    // ========== ENHANCED HIT TESTING ==========
    
    function findControlPointAt(sx, sy, obj) {
        if (!obj || !obj.points || !obj.getWorldPoints) return null;
        
        const zoom = window.state?.hexMap?.viewport?.scale || 1;
        const threshold = CONFIG.UX.VERTEX_RADIUS * 2.5 / Math.max(0.3, zoom * 0.01);
        const worldPoints = obj.getWorldPoints();
        
        let closest = { dist: Infinity, index: -1 };
        
        for (let i = 0; i < worldPoints.length; i++) {
            const p = worldPoints[i];
            const dist = Math.sqrt((sx - p.x) ** 2 + (sy - p.y) ** 2);
            if (dist < threshold && dist < closest.dist) {
                closest = { dist, index: i, point: p, object: obj };
            }
        }
        
        return closest.index >= 0 ? closest : null;
    }
    
    function findEdgeAt(sx, sy, obj) {
        if (!obj || !obj.points || !obj.getWorldPoints) return null;
        
        const zoom = window.state?.hexMap?.viewport?.scale || 1;
        const threshold = CONFIG.UX.EDGE_HIT_AREA / Math.max(0.3, zoom * 0.01);
        const vertexThreshold = CONFIG.UX.VERTEX_RADIUS * 2 / Math.max(0.3, zoom * 0.01);
        const worldPoints = obj.getWorldPoints();
        
        let closest = { dist: Infinity };
        
        for (let i = 0; i < worldPoints.length; i++) {
            const p1 = worldPoints[i];
            const p2 = worldPoints[(i + 1) % worldPoints.length];
            const result = pointToSegment(sx, sy, p1.x, p1.y, p2.x, p2.y);
            
            // Exclude areas too close to vertices
            const distToP1 = pointDistance({ x: sx, y: sy }, p1);
            const distToP2 = pointDistance({ x: sx, y: sy }, p2);
            
            if (result.dist < threshold && 
                result.dist < closest.dist &&
                distToP1 > vertexThreshold && 
                distToP2 > vertexThreshold) {
                closest = {
                    dist: result.dist,
                    edgeIndex: i,
                    point: result.point,
                    t: result.t,
                    object: obj
                };
            }
        }
        
        return closest.edgeIndex !== undefined ? closest : null;
    }
    
    // ========== CURSOR MANAGEMENT ==========
    
    function updateCursor() {
        const canvas = document.getElementById('hexCanvas');
        if (!canvas) return;
        
        let cursor = 'default';
        
        if (settlementState.isDragging) {
            cursor = settlementState.dragType === 'shape' ? 'grabbing' : 'move';
        } else if (settlementState.hoveredVertex) {
            cursor = 'move';
        } else if (settlementState.hoveredEdge) {
            cursor = 'crosshair';
        } else if (settlementState.hoveredObject) {
            cursor = 'grab';
        } else if (settlementState.detailLevel === 'SETTLEMENT') {
            cursor = 'crosshair';
        }
        
        canvas.style.cursor = cursor;
    }
    
    // ========== ENHANCED DRAG HANDLERS ==========
    
    function setupDragHandlers() {
        // Document-level mouse tracking for smooth dragging outside canvas
        let isDocumentDragging = false;
        
        document.addEventListener('mousemove', (e) => {
            if (!settlementState.isDragging || !isDocumentDragging) return;
            
            const canvas = document.getElementById('hexCanvas');
            if (!canvas) return;
            
            const rect = canvas.getBoundingClientRect();
            const canvasX = e.clientX - rect.left;
            const canvasY = e.clientY - rect.top;
            
            handleDragMove(canvasX, canvasY);
        });
        
        document.addEventListener('mouseup', () => {
            if (isDocumentDragging) {
                isDocumentDragging = false;
                handleDragEnd();
            }
        });
        
        // Canvas mouse move - handles hover states and dragging
        window.settlementMouseMoveHandler = function(canvasX, canvasY) {
            if (settlementState.detailLevel !== 'SETTLEMENT') return false;
            
            const activeHex = settlementState.activeHex;
            if (!activeHex) return false;
            
            const hexCenter = window.hexToPixel(activeHex.q, activeHex.r);
            const scale = window.state.hexMap.viewport.scale;
            const settlementScale = scale * 0.01;
            
            const sx = (canvasX - hexCenter.x) / settlementScale;
            const sy = (canvasY - hexCenter.y) / settlementScale;
            
            // Handle active dragging
            if (settlementState.isDragging) {
                handleDragMove(canvasX, canvasY);
                return true;
            }
            
            // Update hover states
            const data = activeHex.settlementData;
            if (!data) return false;
            
            const prevVertex = settlementState.hoveredVertex;
            const prevEdge = settlementState.hoveredEdge;
            const prevObject = settlementState.hoveredObject;
            
            settlementState.hoveredVertex = null;
            settlementState.hoveredEdge = null;
            settlementState.hoveredObject = null;
            
            const selectedObj = settlementState.selectedObject;
            
            // Check vertex hover on selected object
            if (selectedObj) {
                const vertex = findControlPointAt(sx, sy, selectedObj);
                if (vertex) {
                    settlementState.hoveredVertex = vertex;
                } else {
                    // Check edge hover
                    const edge = findEdgeAt(sx, sy, selectedObj);
                    if (edge) {
                        settlementState.hoveredEdge = edge;
                    }
                }
            }
            
            // Check shape hover
            if (!settlementState.hoveredVertex && !settlementState.hoveredEdge) {
                const shape = findObjectAt(sx, sy, data);
                if (shape) {
                    settlementState.hoveredObject = shape;
                }
            }
            
            // Update cursor
            updateCursor();
            
            // Re-render if hover state changed
            const hoverChanged = prevVertex !== settlementState.hoveredVertex ||
                               prevEdge !== settlementState.hoveredEdge ||
                               prevObject !== settlementState.hoveredObject;
            
            if (hoverChanged) {
                renderSettlement();
            }
            
            return false;
        };
        
        // Start dragging
        window.settlementStartDrag = function(type, target, startPos) {
            settlementState.isDragging = true;
            settlementState.dragType = type;
            settlementState.dragTarget = target;
            settlementState.dragStart = { ...startPos };
            isDocumentDragging = true;
            
            if (type === 'shape' && target.object) {
                settlementState.dragOffset = {
                    x: startPos.x - target.object.x,
                    y: startPos.y - target.object.y
                };
                settlementState.smoothDragTarget = { x: target.object.x, y: target.object.y };
            } else if (type === 'vertex' && target.object && target.object.points) {
                settlementState.originalDragPoint = { ...target.object.points[target.index] };
            }
            
            updateCursor();
        };
        
        // Mouse up handler
        window.settlementMouseUpHandler = function() {
            if (settlementState.isDragging) {
                handleDragEnd();
                return true;
            }
            return false;
        };
    }
    
    function handleDragMove(canvasX, canvasY) {
        if (!settlementState.isDragging || !settlementState.dragTarget) return;
        
        const activeHex = settlementState.activeHex;
        if (!activeHex) return;
        
        const hexCenter = window.hexToPixel(activeHex.q, activeHex.r);
        const scale = window.state.hexMap.viewport.scale;
        const settlementScale = scale * 0.01;
        
        const sx = (canvasX - hexCenter.x) / settlementScale;
        const sy = (canvasY - hexCenter.y) / settlementScale;
        
        const target = settlementState.dragTarget;
        const obj = target.object;
        
        if (settlementState.dragType === 'vertex') {
            // Vertex dragging - immediate response
            const pointIndex = target.index;
            if (obj && obj.points && obj.points[pointIndex] && settlementState.originalDragPoint) {
                const dx = sx - settlementState.dragStart.x;
                const dy = sy - settlementState.dragStart.y;
                
                // Transform to local space
                const cos = Math.cos(-obj.rotation);
                const sin = Math.sin(-obj.rotation);
                const localDx = dx * cos - dy * sin;
                const localDy = dx * sin + dy * cos;
                
                obj.points[pointIndex].x = settlementState.originalDragPoint.x + localDx;
                obj.points[pointIndex].y = settlementState.originalDragPoint.y + localDy;
            }
            renderSettlement();
        } else if (settlementState.dragType === 'shape') {
            // Shape dragging with smoothing
            const targetX = sx - settlementState.dragOffset.x;
            const targetY = sy - settlementState.dragOffset.y;
            
            // Apply smoothing
            obj.x = lerp(obj.x, targetX, CONFIG.UX.SMOOTHING_FACTOR);
            obj.y = lerp(obj.y, targetY, CONFIG.UX.SMOOTHING_FACTOR);
            
            // Continue smoothing animation if needed
            const needsAnimation = Math.abs(obj.x - targetX) > 0.5 || Math.abs(obj.y - targetY) > 0.5;
            
            settlementState.smoothDragTarget = { x: targetX, y: targetY };
            
            if (needsAnimation && !settlementState.animationFrameId) {
                settlementState.animationFrameId = requestAnimationFrame(function smoothLoop() {
                    if (!settlementState.isDragging || settlementState.dragType !== 'shape') {
                        settlementState.animationFrameId = null;
                        return;
                    }
                    
                    const target = settlementState.smoothDragTarget;
                    obj.x = lerp(obj.x, target.x, CONFIG.UX.SMOOTHING_FACTOR);
                    obj.y = lerp(obj.y, target.y, CONFIG.UX.SMOOTHING_FACTOR);
                    
                    renderSettlement();
                    
                    if (Math.abs(obj.x - target.x) > 0.5 || Math.abs(obj.y - target.y) > 0.5) {
                        settlementState.animationFrameId = requestAnimationFrame(smoothLoop);
                    } else {
                        settlementState.animationFrameId = null;
                    }
                });
            }
            
            renderSettlement();
        }
    }
    
    function handleDragEnd() {
        const target = settlementState.dragTarget;
        const dragType = settlementState.dragType;
        
        // Snap to final position for shapes
        if (dragType === 'shape' && target?.object && settlementState.smoothDragTarget) {
            target.object.x = settlementState.smoothDragTarget.x;
            target.object.y = settlementState.smoothDragTarget.y;
        }
        
        // Regenerate content if vertex was dragged
        if (dragType === 'vertex' && target?.object) {
            regenerateObject(target.object);
        }
        
        // Cancel any pending animation
        if (settlementState.animationFrameId) {
            cancelAnimationFrame(settlementState.animationFrameId);
            settlementState.animationFrameId = null;
        }
        
        // Reset drag state
        settlementState.isDragging = false;
        settlementState.dragType = null;
        settlementState.dragTarget = null;
        settlementState.originalDragPoint = null;
        settlementState.smoothDragTarget = null;
        
        updateCursor();
        renderSettlement();
        updateHierarchy();
        
        console.log('🏰 Drag ended');
    }
    
    function findObjectAt(x, y, data) {
        for (let i = data.forests.length - 1; i >= 0; i--) {
            if (data.forests[i].contains(x, y)) return data.forests[i];
        }
        for (let i = data.buildings.length - 1; i >= 0; i--) {
            if (data.buildings[i].contains(x, y)) return data.buildings[i];
        }
        for (let i = data.blocks.length - 1; i >= 0; i--) {
            if (data.blocks[i].contains(x, y)) return data.blocks[i];
        }
        for (let i = data.districts.length - 1; i >= 0; i--) {
            if (data.districts[i].contains(x, y)) return data.districts[i];
        }
        for (let i = data.cities.length - 1; i >= 0; i--) {
            if (data.cities[i].contains(x, y)) return data.cities[i];
        }
        return null;
    }

    function deleteSelected() {
        const selected = settlementState.selectedObject;
        if (!selected) return;
        
        const hex = settlementState.activeHex;
        if (!hex || !hex.settlementData) return;
        
        const data = hex.settlementData;
        
        if (selected.type === 'city') {
            data.cities = data.cities.filter(c => c.id !== selected.id);
            selected.districts.forEach(d => {
                data.districts = data.districts.filter(district => district.id !== d.id);
                d.blocks.forEach(b => {
                    data.blocks = data.blocks.filter(block => block.id !== b.id);
                    data.buildings = data.buildings.filter(bld => bld.blockId !== b.id);
                });
            });
        } else if (selected.type === 'district') {
            data.districts = data.districts.filter(d => d.id !== selected.id);
            selected.blocks.forEach(b => {
                data.blocks = data.blocks.filter(block => block.id !== b.id);
                data.buildings = data.buildings.filter(bld => bld.blockId !== b.id);
            });
        } else if (selected.type === 'block') {
            data.blocks = data.blocks.filter(b => b.id !== selected.id);
            data.buildings = data.buildings.filter(bld => bld.blockId !== selected.id);
        } else if (selected.type === 'forest') {
            data.forests = data.forests.filter(f => f.id !== selected.id);
        } else if (selected.type === 'building') {
            data.buildings = data.buildings.filter(b => b.id !== selected.id);
        }
        
        settlementState.selectedObject = null;
        console.log('🏰 Deleted:', selected.type, selected.id);
        renderSettlement();
        updateHierarchy();
    }

    // ========== UI ==========
    function createUI() {
        const sidebar = document.querySelector('.sidebar-left');
        if (!sidebar) return;
        
        // Add Settlement button to the Tools mode selector
        const modeSelector = document.querySelector('.mode-selector');
        if (modeSelector && !document.querySelector('[data-mode="settlement"]')) {
            const settlementBtn = document.createElement('button');
            settlementBtn.className = 'mode-btn';
            settlementBtn.setAttribute('data-mode', 'settlement');
            settlementBtn.setAttribute('onclick', "setHexMode('settlement')");
            settlementBtn.innerHTML = `
                <div class="mode-icon">
                    <img src="https://api.iconify.design/game-icons/medieval-gate.svg?color=white" style="width: 100%; height: 100%;" alt="Settlement">
                </div>
                Settlement
            `;
            modeSelector.appendChild(settlementBtn);
        }
        
        // Remove old section if exists
        let section = document.getElementById('settlementSection');
        if (section) section.remove();
        
        // Create Settlement tool-section (like tokenCreatorSection, landmarkCreatorSection, etc.)
        section = document.createElement('div');
        section.id = 'settlementSection';
        section.className = 'tool-section';
        section.style.display = 'none';
        section.innerHTML = `
            <h3>Settlement Tools</h3>
            
            <!-- Shape Tools -->
            <div class="path-type-selector" style="margin-bottom: 16px;">
                <label class="section-label">Create Shape</label>
                <div class="path-type-grid" style="grid-template-columns: repeat(3, 1fr);">
                    <button class="path-type-btn active" data-tool="district" id="settlementTool_district">
                        <div class="path-type-icon">
                            <img src="https://api.iconify.design/game-icons/house-town.svg?color=white" style="width: 100%; height: 100%;">
                        </div>
                        <span class="path-type-label">District</span>
                    </button>
                    <button class="path-type-btn" data-tool="block" id="settlementTool_block">
                        <div class="path-type-icon">
                            <img src="https://api.iconify.design/game-icons/house.svg?color=white" style="width: 100%; height: 100%;">
                        </div>
                        <span class="path-type-label">Block</span>
                    </button>
                    <button class="path-type-btn" data-tool="building" id="settlementTool_building">
                        <div class="path-type-icon">
                            <img src="https://api.iconify.design/game-icons/hut.svg?color=white" style="width: 100%; height: 100%;">
                        </div>
                        <span class="path-type-label">Building</span>
                    </button>
                    <button class="path-type-btn" data-tool="city" id="settlementTool_city">
                        <div class="path-type-icon">
                            <img src="https://api.iconify.design/game-icons/city.svg?color=white" style="width: 100%; height: 100%;">
                        </div>
                        <span class="path-type-label">City</span>
                    </button>
                    <button class="path-type-btn" data-tool="forest" id="settlementTool_forest">
                        <div class="path-type-icon">
                            <img src="https://api.iconify.design/game-icons/pine-tree.svg?color=white" style="width: 100%; height: 100%;">
                        </div>
                        <span class="path-type-label">Forest</span>
                    </button>
                </div>
            </div>
            
            <div style="font-size: 11px; color: #718096; line-height: 1.5; margin-bottom: 16px; padding: 12px; background: #2d3748; border-radius: 6px;">
                <strong>Settlement Mode:</strong><br>
                • Double-click empty → create shape<br>
                • Click shape → select & drag<br>
                • Drag vertex → reshape<br>
                • Double-click edge → add vertex
            </div>
            
            <!-- Actions -->
            <button class="btn btn-primary" id="generateCityBtn" style="width:100%;margin-bottom:8px;">🎲 Generate City</button>
            <div style="display: flex; gap: 8px; margin-bottom: 16px;">
                <button class="btn btn-secondary" id="deleteSelectedBtn" style="flex:1;">🗑️ Delete</button>
                <button class="btn btn-secondary" id="clearSettlementBtn" style="flex:1;">🧹 Clear All</button>
            </div>
            
            <!-- Building Settings (collapsible) -->
            <details style="margin-bottom: 12px;">
                <summary style="cursor: pointer; font-size: 12px; font-weight: 600; color: #e4e7eb; padding: 8px 0;">Building Settings</summary>
                <div style="padding-top: 8px;">
                    <div style="margin-bottom: 8px;">
                        <div style="font-size: 11px; color: #9ca3af; margin-bottom: 4px;">Building Mode</div>
                        <select id="buildingMode" style="width:100%;padding:6px;background:#2d3139;border:1px solid #3d4451;border-radius:4px;color:#e4e7eb;font-size:12px;">
                            <option value="original">Original - Random</option>
                            <option value="perimeter" selected>Perimeter - Edge Aligned</option>
                            <option value="mixed">Mixed - Random Selection</option>
                        </select>
                    </div>
                    
                    <div class="brush-control" style="margin-bottom: 8px;">
                        <label style="font-size: 11px; color: #9ca3af;">Density</label>
                        <div class="slider-container">
                            <input type="range" class="slider" id="buildingDensity" min="0.3" max="2.0" step="0.1" value="1.0">
                            <span class="slider-value" id="densityValue">1.0x</span>
                        </div>
                    </div>
                    
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px;color:#e4e7eb;">
                        <input type="checkbox" id="blockTreesEnabled" style="cursor:pointer;">
                        <span>Add Trees in Blocks</span>
                    </label>
                    
                    <div id="blockTreeDensityGroup" style="margin-top:8px;display:none;">
                        <div class="brush-control">
                            <label style="font-size: 11px; color: #9ca3af;">Block Tree Density</label>
                            <div class="slider-container">
                                <input type="range" class="slider" id="blockTreeDensity" min="0.1" max="1.0" step="0.1" value="0.5">
                                <span class="slider-value" id="blockTreeDensityValue">0.5x</span>
                            </div>
                        </div>
                    </div>
                </div>
            </details>
            
            <!-- Block Shapes (collapsible) -->
            <details style="margin-bottom: 12px;">
                <summary style="cursor: pointer; font-size: 12px; font-weight: 600; color: #e4e7eb; padding: 8px 0;">Block Shapes</summary>
                <div style="padding-top: 8px;">
                    <div class="brush-control" style="margin-bottom: 6px;">
                        <label style="font-size: 11px; color: #9ca3af;">Squares/Rectangles</label>
                        <div class="slider-container">
                            <input type="range" class="slider" id="verticalSlider" min="0" max="100" step="1" value="30">
                            <span class="slider-value" id="verticalValue">30%</span>
                        </div>
                    </div>
                    <div class="brush-control" style="margin-bottom: 6px;">
                        <label style="font-size: 11px; color: #9ca3af;">Rhombuses</label>
                        <div class="slider-container">
                            <input type="range" class="slider" id="diagonalSlider" min="0" max="100" step="1" value="40">
                            <span class="slider-value" id="diagonalValue">40%</span>
                        </div>
                    </div>
                    <div class="brush-control">
                        <label style="font-size: 11px; color: #9ca3af;">Triangles</label>
                        <div class="slider-container">
                            <input type="range" class="slider" id="horizontalSlider" min="0" max="100" step="1" value="30">
                            <span class="slider-value" id="horizontalValue">30%</span>
                        </div>
                    </div>
                </div>
            </details>
            
            <!-- Forest Settings (collapsible) -->
            <details style="margin-bottom: 12px;">
                <summary style="cursor: pointer; font-size: 12px; font-weight: 600; color: #e4e7eb; padding: 8px 0;">Forest Settings</summary>
                <div style="padding-top: 8px;">
                    <div class="brush-control" style="margin-bottom: 6px;">
                        <label style="font-size: 11px; color: #9ca3af;">Tree Density</label>
                        <div class="slider-container">
                            <input type="range" class="slider" id="forestDensity" min="0.5" max="2.0" step="0.1" value="1.0">
                            <span class="slider-value" id="forestDensityValue">1.0x</span>
                        </div>
                    </div>
                    <div class="brush-control">
                        <label style="font-size: 11px; color: #9ca3af;">Tree Size</label>
                        <div class="slider-container">
                            <input type="range" class="slider" id="treeSize" min="6" max="30" step="1" value="12">
                            <span class="slider-value" id="treeSizeValue">12px</span>
                        </div>
                    </div>
                </div>
            </details>
            
            <!-- Background Colors (collapsible) -->
            <details style="margin-bottom: 12px;">
                <summary style="cursor: pointer; font-size: 12px; font-weight: 600; color: #e4e7eb; padding: 8px 0;">Background Colors</summary>
                <div style="padding-top: 8px;">
                    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#e4e7eb;margin-bottom:8px;">
                        <input type="checkbox" id="cityBgEnabled" style="cursor:pointer;">
                        <span>City Background</span>
                        <input type="color" id="cityBgColor" value="#d4c4a4" style="width:30px;height:20px;border:none;cursor:pointer;margin-left:auto;">
                    </label>
                    <label style="display:flex;align-items:center;gap:8px;font-size:12px;color:#e4e7eb;">
                        <input type="checkbox" id="districtBgEnabled" checked style="cursor:pointer;">
                        <span>District Background</span>
                        <input type="color" id="districtBgColor" value="#c4a76c" style="width:30px;height:20px;border:none;cursor:pointer;margin-left:auto;">
                    </label>
                </div>
            </details>
            
            <div id="settlementHierarchy" style="font-size:11px;color:#9ca3af;"></div>
        `;
        
        // Insert after path creator section or at end
        const pathSection = document.getElementById('pathCreatorSection');
        if (pathSection?.parentNode) {
            pathSection.parentNode.insertBefore(section, pathSection.nextSibling);
        } else {
            sidebar.appendChild(section);
        }
        
        // Tool buttons - use same style as path types
        section.querySelectorAll('.path-type-btn[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => {
                section.querySelectorAll('.path-type-btn[data-tool]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                settlementState.currentTool = btn.dataset.tool;
            });
        });
        
        // Generate city button
        document.getElementById('generateCityBtn').addEventListener('click', () => {
            const hex = settlementState.activeHex;
            if (!hex) return;
            const data = getSettlementData(hex);
            data.cities = []; data.districts = []; data.blocks = []; data.buildings = []; data.forests = [];
            const city = new City(0, 0, 250, hex);
            data.cities.push(city);
            city.subdivideIntoDistricts();
            settlementState.selectedObject = city;
            renderSettlement();
            updateHierarchy();
        });
        
        // Delete selected button
        document.getElementById('deleteSelectedBtn').addEventListener('click', () => {
            deleteSelected();
        });
        
        // Clear button
        document.getElementById('clearSettlementBtn').addEventListener('click', () => {
            const hex = settlementState.activeHex;
            if (!hex) return;
            hex.settlementData = null;
            settlementState.selectedObject = null;
            renderSettlement();
            updateHierarchy();
        });
        
        // Setup slider listeners
        setupSliderListeners();
    }
    
    function setupSliderListeners() {
        const densitySlider = document.getElementById('buildingDensity');
        const buildingModeSelect = document.getElementById('buildingMode');
        const verticalSlider = document.getElementById('verticalSlider');
        const diagonalSlider = document.getElementById('diagonalSlider');
        const horizontalSlider = document.getElementById('horizontalSlider');
        const forestDensitySlider = document.getElementById('forestDensity');
        const treeSizeSlider = document.getElementById('treeSize');

        function updateSliderDisplay() {
            if (densitySlider) {
                document.getElementById('densityValue').textContent = parseFloat(densitySlider.value).toFixed(1) + 'x';
            }
            if (verticalSlider) {
                document.getElementById('verticalValue').textContent = verticalSlider.value + '%';
            }
            if (diagonalSlider) {
                document.getElementById('diagonalValue').textContent = diagonalSlider.value + '%';
            }
            if (horizontalSlider) {
                document.getElementById('horizontalValue').textContent = horizontalSlider.value + '%';
            }
            if (forestDensitySlider) {
                document.getElementById('forestDensityValue').textContent = parseFloat(forestDensitySlider.value).toFixed(1) + 'x';
            }
            if (treeSizeSlider) {
                document.getElementById('treeSizeValue').textContent = treeSizeSlider.value + 'px';
            }
        }

        function updateShapeDistribution(changedSlider) {
            const vert = parseInt(verticalSlider.value);
            const diag = parseInt(diagonalSlider.value);
            const horiz = parseInt(horizontalSlider.value);
            const total = vert + diag + horiz;
            
            if (total !== 100) {
                if (changedSlider === 'vertical') {
                    const remaining = 100 - vert;
                    const ratio = remaining / (diag + horiz || 1);
                    diagonalSlider.value = Math.round(diag * ratio);
                    horizontalSlider.value = 100 - vert - parseInt(diagonalSlider.value);
                } else if (changedSlider === 'diagonal') {
                    const remaining = 100 - diag;
                    const ratio = remaining / (vert + horiz || 1);
                    verticalSlider.value = Math.round(vert * ratio);
                    horizontalSlider.value = 100 - diag - parseInt(verticalSlider.value);
                } else if (changedSlider === 'horizontal') {
                    const remaining = 100 - horiz;
                    const ratio = remaining / (vert + diag || 1);
                    verticalSlider.value = Math.round(vert * ratio);
                    diagonalSlider.value = 100 - horiz - parseInt(verticalSlider.value);
                }
            }
            updateSliderDisplay();
            regenerateCity();
        }

        function regenerateBuildings() {
            updateSliderDisplay();
            const hex = settlementState.activeHex;
            if (!hex || !hex.settlementData) return;
            
            const data = hex.settlementData;
            const selected = settlementState.selectedObject;
            
            if (selected && selected.type === 'block') {
                selected.generateBuildings();
            } else if (selected && selected.type === 'district') {
                selected.blocks.forEach(b => b.generateBuildings());
            } else if (selected && selected.type === 'city') {
                selected.districts.forEach(d => {
                    d.blocks.forEach(b => b.generateBuildings());
                });
            } else {
                // Regenerate all blocks
                data.blocks.forEach(b => b.generateBuildings());
            }
            renderSettlement();
        }

        function regenerateCity() {
            const hex = settlementState.activeHex;
            if (!hex || !hex.settlementData) return;
            
            const selected = settlementState.selectedObject;
            if (selected && selected.type === 'district') {
                selected.subdivideIntoBlocks();
            } else if (selected && selected.type === 'city') {
                selected.districts.forEach(d => d.subdivideIntoBlocks());
            } else {
                // Regenerate all districts
                const data = hex.settlementData;
                data.districts.forEach(d => d.subdivideIntoBlocks());
            }
            renderSettlement();
        }

        function regenerateForests() {
            updateSliderDisplay();
            const hex = settlementState.activeHex;
            if (!hex || !hex.settlementData) return;
            
            const selected = settlementState.selectedObject;
            if (selected && selected.type === 'forest') {
                selected.generateTrees();
            } else {
                hex.settlementData.forests.forEach(f => f.generateTrees());
            }
            renderSettlement();
        }

        if (densitySlider) {
            densitySlider.addEventListener('input', regenerateBuildings);
        }
        if (buildingModeSelect) {
            buildingModeSelect.addEventListener('change', regenerateBuildings);
        }
        
        if (verticalSlider) {
            verticalSlider.addEventListener('input', () => updateShapeDistribution('vertical'));
        }
        if (diagonalSlider) {
            diagonalSlider.addEventListener('input', () => updateShapeDistribution('diagonal'));
        }
        if (horizontalSlider) {
            horizontalSlider.addEventListener('input', () => updateShapeDistribution('horizontal'));
        }
        
        if (forestDensitySlider) {
            forestDensitySlider.addEventListener('input', regenerateForests);
        }
        if (treeSizeSlider) {
            treeSizeSlider.addEventListener('input', regenerateForests);
        }

        // Block trees settings
        const blockTreesCheckbox = document.getElementById('blockTreesEnabled');
        const blockTreeDensitySlider = document.getElementById('blockTreeDensity');
        const blockTreeDensityGroup = document.getElementById('blockTreeDensityGroup');
        
        function updateBlockTreeDisplay() {
            if (blockTreeDensitySlider) {
                document.getElementById('blockTreeDensityValue').textContent = parseFloat(blockTreeDensitySlider.value).toFixed(1) + 'x';
            }
            if (blockTreeDensityGroup) {
                blockTreeDensityGroup.style.display = blockTreesCheckbox?.checked ? 'block' : 'none';
            }
        }
        
        function regenerateBlockTrees() {
            updateBlockTreeDisplay();
            const hex = settlementState.activeHex;
            if (!hex || !hex.settlementData) return;
            hex.settlementData.blocks.forEach(b => b.generateTrees());
            renderSettlement();
        }
        
        if (blockTreesCheckbox) {
            blockTreesCheckbox.addEventListener('change', regenerateBlockTrees);
        }
        if (blockTreeDensitySlider) {
            blockTreeDensitySlider.addEventListener('input', regenerateBlockTrees);
        }

        // Background color settings
        const cityBgEnabled = document.getElementById('cityBgEnabled');
        const cityBgColor = document.getElementById('cityBgColor');
        const districtBgEnabled = document.getElementById('districtBgEnabled');
        const districtBgColor = document.getElementById('districtBgColor');
        
        if (cityBgEnabled) cityBgEnabled.addEventListener('change', renderSettlement);
        if (cityBgColor) cityBgColor.addEventListener('input', renderSettlement);
        if (districtBgEnabled) districtBgEnabled.addEventListener('change', renderSettlement);
        if (districtBgColor) districtBgColor.addEventListener('input', renderSettlement);

        updateSliderDisplay();
        updateBlockTreeDisplay();
    }
    
    function updateUI() {
        const section = document.getElementById('settlementSection');
        if (!section) return;
        
        // Show section when in SETTLEMENT detail level OR when in settlement mode
        const inSettlementMode = window.state?.hexMap?.mode === 'settlement';
        const inSettlementLevel = settlementState.detailLevel === 'SETTLEMENT';
        
        section.style.display = (inSettlementMode || inSettlementLevel) ? 'block' : 'none';
        
        // Update mode button active state
        const settlementModeBtn = document.querySelector('[data-mode="settlement"]');
        if (settlementModeBtn) {
            if (inSettlementLevel) {
                // Auto-activate settlement mode when zoomed in
                settlementModeBtn.classList.add('active');
                document.querySelectorAll('.mode-btn').forEach(btn => {
                    if (btn !== settlementModeBtn) btn.classList.remove('active');
                });
            }
        }
    }
    
    // Hook into setHexMode to handle settlement mode
    function hookModeSwitch() {
        const originalSetHexMode = window.setHexMode;
        if (originalSetHexMode) {
            window.setHexMode = function(mode) {
                // Call original
                if (mode !== 'settlement') {
                    originalSetHexMode(mode);
                } else {
                    // Handle settlement mode
                    window.state.hexMap.mode = 'settlement';
                    
                    // Update mode buttons
                    document.querySelectorAll('.mode-btn').forEach(btn => {
                        btn.classList.toggle('active', btn.dataset.mode === 'settlement');
                    });
                    
                    // Hide other tool sections
                    ['brushSettingsSection', 'terrainPaletteSection', 'tokenCreatorSection', 
                     'landmarkCreatorSection', 'pathCreatorSection'].forEach(id => {
                        const el = document.getElementById(id);
                        if (el) el.style.display = 'none';
                    });
                    
                    // Show settlement section
                    const section = document.getElementById('settlementSection');
                    if (section) section.style.display = 'block';
                }
            };
        }
    }
    
    function updateHierarchy() {
        const container = document.getElementById('settlementHierarchy');
        if (!container) return;
        
        const hex = settlementState.activeHex;
        if (!hex || !hex.settlementData) {
            container.innerHTML = 'No settlement data';
            return;
        }
        
        const data = hex.settlementData;
        container.innerHTML = `Cities: ${data.cities.length} | Districts: ${data.districts.length} | Blocks: ${data.blocks.length} | Buildings: ${data.buildings.length} | Forests: ${data.forests.length}`;
    }
    
    function getCenterHex() {
        try {
            const canvas = document.getElementById('hexCanvas');
            if (!canvas) return null;
            // Get hex at center of screen
            const centerX = canvas.width / 2;
            const centerY = canvas.height / 2;
            const hexCoords = window.pixelToHex(centerX, centerY);
            // Use getHex helper or Map.get - hexes is a Map, not an array!
            const hex = window.getHex ? window.getHex(hexCoords.q, hexCoords.r) : 
                        window.state.hexMap.hexes.get(`${hexCoords.q},${hexCoords.r}`);
            return hex || null;
        } catch (e) {
            console.error('getCenterHex error:', e);
            return null;
        }
    }

    // ========== POST-RENDER HOOK ==========
    function settlementPostRenderHook(ctx, scale) {
        try {
            const newLevel = getDetailLevel(scale);
            
            // Always log scale for debugging
            if (scale > 2.0) {
                console.log('🏰 Hook called, scale:', scale.toFixed(2), 'level:', newLevel, 'activeHex:', settlementState.activeHex?.q + ',' + settlementState.activeHex?.r);
            }
            
            if (newLevel !== settlementState.detailLevel) {
                console.log('🏰 Level change:', settlementState.detailLevel, '→', newLevel, 'at scale', scale);
                settlementState.detailLevel = newLevel;
                updateUI();
            }
            
            // Update active hex when in settlement mode
            if (newLevel === 'SETTLEMENT' || getSettlementOpacity(scale) > 0) {
                const hex = getCenterHex();
                console.log('🏰 getCenterHex returned:', hex?.q, hex?.r);
                if (hex && hex !== settlementState.activeHex) {
                    console.log('🏰 Active hex changed to:', hex.q, hex.r);
                    settlementState.activeHex = hex;
                    updateHierarchy();
                }
            }
            
            // Update overlay opacity (fade in/out)
            if (settlementState.pixiContainer) {
                const opacity = getSettlementOpacity(scale);
                settlementState.pixiContainer.style.opacity = opacity;
            }
            
            // Render settlement if visible
            if (getSettlementOpacity(scale) > 0 && settlementState.activeHex) {
                renderSettlement();
            }
            
            // Update zoom indicator
            const zoomEl = document.getElementById('zoomLevel');
            if (zoomEl) {
                const icons = { WORLD: '🌍', REGIONAL: '🗺️', SETTLEMENT: '🏰' };
                zoomEl.innerHTML = Math.round(scale * 100) + '% <span style="opacity:0.6;font-size:11px;">' + (icons[newLevel] || '') + '</span>';
            }
            
        } catch (error) {
            console.error('🏰 Hook error:', error);
        }
    }

    // ========== INIT ==========
    async function init() {
        if (!window.state?.hexMap || !window.renderHex) {
            setTimeout(init, 200);
            return;
        }
        
        if (settlementState.initialized) return;
        settlementState.initialized = true;
        
        console.log('🏰 Initializing...');
        
        // Inject modern UX styles
        injectModernStyles();
        
        try {
            await loadPixiJS();
            createPixiOverlay();
        } catch (e) {
            console.warn('🏰 PixiJS init error:', e);
        }
        
        // Register post-render hook
        window.postRenderHooks = window.postRenderHooks || [];
        window.postRenderHooks.push(settlementPostRenderHook);
        
        // Icon fade is now built into game.js drawHexTile function
        
        createUI();
        hookModeSwitch();
        setupClickHandler();
        setupDragHandlers();
        
        console.log('✅ Settlement Integration ready! Zoom to 400%+ or select Settlement mode');
        console.log('✨ Modern UX enabled: smooth dragging, hover states, animated selection');
        window.renderHex();
    }
    
    // ========== MODERN UX STYLES ==========
    function injectModernStyles() {
        const styleId = 'settlement-modern-ux-styles';
        if (document.getElementById(styleId)) return;
        
        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            /* ========== SETTLEMENT MODERN UX STYLES ========== */
            
            /* Smooth cursor transitions */
            #hexCanvas {
                transition: cursor 0.15s ease;
            }
            
            /* Enhanced tool buttons */
            #settlementSection .path-type-btn {
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
                overflow: hidden;
            }
            
            #settlementSection .path-type-btn::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: linear-gradient(135deg, rgba(102, 126, 234, 0.15) 0%, rgba(118, 75, 162, 0.15) 100%);
                opacity: 0;
                transition: opacity 0.25s ease;
            }
            
            #settlementSection .path-type-btn:hover::before {
                opacity: 1;
            }
            
            #settlementSection .path-type-btn:hover {
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.25);
            }
            
            #settlementSection .path-type-btn.active {
                background: linear-gradient(135deg, rgba(102, 126, 234, 0.3) 0%, rgba(118, 75, 162, 0.3) 100%);
                border-color: #667eea;
                box-shadow: 0 0 20px rgba(102, 126, 234, 0.35), 
                            inset 0 0 15px rgba(102, 126, 234, 0.15),
                            0 4px 15px rgba(102, 126, 234, 0.2);
            }
            
            #settlementSection .path-type-btn.active::after {
                content: '';
                position: absolute;
                bottom: 0;
                left: 50%;
                transform: translateX(-50%);
                width: 60%;
                height: 3px;
                background: linear-gradient(90deg, transparent, #667eea, transparent);
                border-radius: 2px;
                animation: activeGlow 2s ease-in-out infinite;
            }
            
            @keyframes activeGlow {
                0%, 100% { opacity: 0.7; }
                50% { opacity: 1; }
            }
            
            /* Enhanced instructions card */
            #settlementSection > div[style*="background: #2d3748"] {
                background: linear-gradient(135deg, #2d3748 0%, #1f2937 100%) !important;
                border: 1px solid rgba(102, 126, 234, 0.25) !important;
                position: relative;
                overflow: hidden;
            }
            
            #settlementSection > div[style*="background: #2d3748"]::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 2px;
                background: linear-gradient(90deg, transparent, rgba(102, 126, 234, 0.6), transparent);
            }
            
            /* Enhanced buttons */
            #settlementSection .btn {
                transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
                overflow: hidden;
            }
            
            #settlementSection .btn-primary {
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border: none;
                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.35);
            }
            
            #settlementSection .btn-primary:hover {
                transform: translateY(-2px);
                box-shadow: 0 6px 25px rgba(102, 126, 234, 0.45);
            }
            
            #settlementSection .btn-primary:active {
                transform: translateY(0);
                box-shadow: 0 2px 10px rgba(102, 126, 234, 0.3);
            }
            
            #settlementSection .btn-secondary {
                background: rgba(45, 55, 72, 0.9);
                border: 1px solid rgba(102, 126, 234, 0.35);
                backdrop-filter: blur(4px);
            }
            
            #settlementSection .btn-secondary:hover {
                background: rgba(55, 65, 82, 0.95);
                border-color: rgba(102, 126, 234, 0.55);
                box-shadow: 0 4px 15px rgba(0, 0, 0, 0.25);
            }
            
            /* Enhanced sliders */
            #settlementSection input[type="range"] {
                -webkit-appearance: none;
                appearance: none;
                background: transparent;
                cursor: pointer;
            }
            
            #settlementSection input[type="range"]::-webkit-slider-track {
                background: linear-gradient(90deg, rgba(102, 126, 234, 0.35), rgba(118, 75, 162, 0.35));
                height: 6px;
                border-radius: 3px;
            }
            
            #settlementSection input[type="range"]::-webkit-slider-thumb {
                -webkit-appearance: none;
                appearance: none;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: linear-gradient(135deg, #667eea, #764ba2);
                box-shadow: 0 2px 10px rgba(102, 126, 234, 0.45);
                transition: transform 0.2s ease, box-shadow 0.2s ease;
            }
            
            #settlementSection input[type="range"]::-webkit-slider-thumb:hover {
                transform: scale(1.2);
                box-shadow: 0 4px 15px rgba(102, 126, 234, 0.55);
            }
            
            #settlementSection input[type="range"]:active::-webkit-slider-thumb {
                transform: scale(1.1);
            }
            
            /* Enhanced details/summary */
            #settlementSection details {
                border: 1px solid rgba(102, 126, 234, 0.2);
                border-radius: 8px;
                background: rgba(45, 55, 72, 0.4);
                overflow: hidden;
                transition: all 0.3s ease;
            }
            
            #settlementSection details[open] {
                border-color: rgba(102, 126, 234, 0.35);
                background: rgba(45, 55, 72, 0.6);
            }
            
            #settlementSection details summary {
                padding: 12px;
                cursor: pointer;
                user-select: none;
                transition: background 0.2s ease;
            }
            
            #settlementSection details summary:hover {
                background: rgba(102, 126, 234, 0.15);
            }
            
            /* Enhanced hierarchy display */
            #settlementHierarchy {
                background: linear-gradient(135deg, rgba(102, 126, 234, 0.12), rgba(118, 75, 162, 0.12)) !important;
                border: 1px solid rgba(102, 126, 234, 0.25) !important;
                border-radius: 8px !important;
                padding: 10px 14px !important;
                font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace !important;
                font-size: 11px !important;
                letter-spacing: 0.3px !important;
            }
            
            /* Toast notifications */
            .settlement-toast {
                position: fixed;
                bottom: 24px;
                left: 50%;
                transform: translateX(-50%) translateY(100px);
                background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
                border: 1px solid rgba(102, 126, 234, 0.35);
                border-radius: 12px;
                padding: 12px 20px;
                color: #e5e7eb;
                font-size: 13px;
                font-weight: 500;
                box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                z-index: 10000;
                opacity: 0;
                transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
                pointer-events: none;
            }
            
            .settlement-toast.show {
                transform: translateX(-50%) translateY(0);
                opacity: 1;
            }
            
            .settlement-toast.success {
                border-color: rgba(16, 185, 129, 0.5);
            }
            
            .settlement-toast.success::before {
                content: '✓ ';
                color: #10b981;
            }
        `;
        document.head.appendChild(style);
        console.log('✨ Modern UX styles injected');
    }
    
    // Toast notification helper
    function showToast(message, type = 'default') {
        let toast = document.querySelector('.settlement-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'settlement-toast';
            document.body.appendChild(toast);
        }
        
        toast.textContent = message;
        toast.className = 'settlement-toast ' + type;
        
        requestAnimationFrame(() => {
            toast.classList.add('show');
            setTimeout(() => {
                toast.classList.remove('show');
            }, 2500);
        });
    }
    
    window.showSettlementToast = showToast;
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
    } else {
        setTimeout(init, 300);
    }
    
    // Exports
    window.settlementState = settlementState;
    window.getSettlementData = getSettlementData;
    window.renderSettlement = renderSettlement;
    window.SettlementCity = City;
    window.SettlementDistrict = District;
    window.SettlementBlock = Block;
    window.SettlementBuilding = Building;
    window.SettlementForest = Forest;
})();