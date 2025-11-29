        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        const gridSize = 30;
        const tileCount = 20;

        class Game {
            constructor() {
                this.snake = new Snake(this, [{x:10,y:10}]);
                this.input = new InputManager(this);
                this.obstacleManager = new ObstacleManager(this);
                this.teleportManager = new TeleportManager(this);
                this.renderer = new Renderer(this);

                this.score = 0;
                this.level = 1;
                this.highScore = Number(localStorage.getItem('snakeHighScore') || 0);

                this.movementAccumulator = 0;
                this.gameSpeed = 150;
                this.running = false;
                this.paused = false;
                this.lastTime = 0;

                this.food = {x:15,y:15};
                this.mapChangeProtection = false; // Invincibility during map transitions
                this.updateHUD();
            }

            start() {
                this.reset();
                this.obstacleManager.generateObstacles();
                this.teleportManager.ensurePairs();
                this.placeFood();
                this.running = true;
                this.paused = false;
                this.lastTime = performance.now();
                
                // Start with portals hidden - they'll appear after the interval
                this.teleportManager.isActive = false;
                this.teleportManager.activeTimer = 15000; // First portals appear after 3 seconds
                
                requestAnimationFrame(this.loop.bind(this));
            }

            reset() {
                this.snake.reset([{x:10,y:10}]);
                this.score = 0;
                this.level = 1;
                this.gameSpeed = 200; // Even slower starting speed
                this.movementAccumulator = 0;
                this.obstacleManager.reset();
                this.teleportManager.reset();
                this.updateHUD();
            }

            loop(now) {
                if (!this.running) return;
                const rawDelta = Math.min(60, (now - this.lastTime));
                this.lastTime = now;
                
                if (!this.paused) {
                    this.movementAccumulator += rawDelta;
                    
                    // Update teleport manager for portal spawning/despawning
                    this.teleportManager.update(rawDelta);

                    while (this.movementAccumulator >= this.gameSpeed) {
                        this.movementAccumulator -= this.gameSpeed;
                        this.step();
                    }
                }

                this.renderer.render(ctx);
                requestAnimationFrame(this.loop.bind(this));
            }

            step() {
    // Apply any queued direction changes at the start of the step
    if (this.input.applyQueuedDirection) {
        this.input.applyQueuedDirection();
    }
    
    // Get current movement direction
    const dir = this.snake.velocity;
    
    // If snake is stationary (not moving yet), skip this step
    if (dir.x === 0 && dir.y === 0) return;

    // Calculate new head position based on current direction
    let head = {
        x: this.snake.segments[0].x + dir.x, 
        y: this.snake.segments[0].y + dir.y
    };

    // COLLISION DETECTION FIRST (before teleport)
    if (!this.mapChangeProtection) {
        // Check if hit wall boundaries
        if (head.x < 0 || head.x >= tileCount || head.y < 0 || head.y >= tileCount) {
            this.gameOver();
            return;
        }

        // Check if hit obstacle block
        if (this.obstacleManager.collides(head)) {
            this.gameOver();
            return;
        }

        // Check if snake hit itself
        if (this.snake.collidesWith(head)) {
            this.gameOver();
            return;
        }
    }

            // TELEPORT CHECK - Only after we know movement is valid
            const teleport = this.teleportManager.getTeleportAt(head.x, head.y);
            if (teleport && this.teleportManager.isActive) { // ← ADD isActive CHECK
                let dest = this.teleportManager.getPairedPosition(teleport);
                // If destination is blocked, find nearest safe tile
                if (dest && !this.isTileFree(dest.x, dest.y)) {
                    const safe = this.findNearestSafe(dest.x, dest.y);
                    if (safe) dest = safe;
                }
                if (dest) {
                    head.x = dest.x;
                    head.y = dest.y;

                    // Tiny invincibility after teleport to prevent instant death
                    this.mapChangeProtection = true;
                    setTimeout(() => { this.mapChangeProtection = false; }, 50);
                }
            }

            // FOOD EATING LOGIC - Check BEFORE adding head
            const ateFood = (head.x === this.food.x && head.y === this.food.y);
            
            // Add new head position to front of snake
            this.snake.unshiftHead(head);

            if (ateFood) {
                // Snake ate food!
                this.addScore(10);
                
                // Place new food on map
                this.placeFood();
                
                // Check if player reached next level (every 50 points)
                if (this.score % 50 === 0 && this.score > 0) {
                    this.levelUp();
                }
            } else {
                // Snake didn't eat food, so remove tail to maintain length
                this.snake.popTail();
            }
        }

            addScore(amount) {
                this.score += amount;
                document.getElementById('score').textContent = this.score;
                if (this.score > this.highScore) {
                    this.highScore = this.score;
                    document.getElementById('highScore').textContent = this.score;
                }
            }

            levelUp() {
                this.level++;
                document.getElementById('level').textContent = this.level;

                const speedacc = Math.min(this.level * 3, 45); 
                this.gameSpeed = Math.max(100, 200 - speedacc);

                this.mapChangeProtection = true;

                setTimeout(() => {

                    // Change map layout
                    this.obstacleManager.applyRandomPreset();

                    // DELETE old teleports to avoid invisible teleport zones
                    this.teleportManager.reset();

                    // Create fresh new portal pair
                    this.teleportManager.ensurePairs();

                    // End protection after 3 sec
                    setTimeout(() => {
                        this.mapChangeProtection = false;
                        this.renderer.hideProtectionWarning();
                    }, 3000);

                }, 500);
}


            placeFood() {
    let tries = 0;
    do {
        this.food.x = Math.floor(Math.random() * tileCount);
        this.food.y = Math.floor(Math.random() * tileCount);
        tries++;
        if (tries > 500) {
            // Fallback: find ANY free tile
            for (let y = 0; y < tileCount; y++) {
                for (let x = 0; x < tileCount; x++) {
                    if (this.isTileFree(x, y)) {
                        this.food.x = x;
                        this.food.y = y;
                        return;
                    }
                }
            }
            break;
        }
    } while (!this.isTileFree(this.food.x, this.food.y) || this.isSurroundedByWalls(this.food.x, this.food.y) ||  this.obstacleManager.collides(this.food));
}

// Add this new method to Game class (after placeFood)
            isSurroundedByWalls(x, y) {
                // Check if position has at least 2 escape routes
                let freeNeighbors = 0;
                const directions = [{x:0,y:-1}, {x:0,y:1}, {x:-1,y:0}, {x:1,y:0}];
                
                for (let dir of directions) {
                    const nx = x + dir.x;
                    const ny = y + dir.y;
                    
                    // Check if neighbor is free (not wall, obstacle, or out of bounds)
                    if (nx >= 0 && nx < tileCount && ny >= 0 && ny < tileCount) {
                        if (!this.obstacleManager.collides({x: nx, y: ny})) {
                            freeNeighbors++;
                        }
                    }
                }
                
                // If less than 3 escape routes, it's a dead end or corner
                return freeNeighbors < 3;
            }

            isTileFree(x, y) {
                if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) return false;
                if (this.snake.segments.some(s => s.x === x && s.y === y)) return false;
                if (this.obstacleManager.collides({x, y})) return false;
                if (this.teleportManager.getTeleportAt(x, y)) return false;
                return true;
            }

            findNearestSafe(x, y) {
                const maxRadius = 3;
                for (let r = 0; r <= maxRadius; r++) {
                    for (let dx = -r; dx <= r; dx++) {
                        for (let dy = -r; dy <= r; dy++) {
                            if (Math.abs(dx) === r || Math.abs(dy) === r) {
                                const nx = x + dx, ny = y + dy;
                                if (nx >= 0 && nx < tileCount && ny >= 0 && ny < tileCount && this.isTileFree(nx, ny)) {
                                    return {x: nx, y: ny};
                                }
                            }
                        }
                    }
                }
                return null;
            }

            gameOver() {
                this.running = false;
                if (this.score > this.highScore) {
                    this.highScore = this.score;
                    localStorage.setItem('snakeHighScore', this.highScore);
                }
                document.getElementById('finalScore').textContent = this.score;
                document.getElementById('finalLevel').textContent = this.level;
                document.getElementById('modalHighScore').textContent = this.highScore;
                document.getElementById('highScore').textContent = this.highScore;
                document.getElementById('gameOverModal').style.display = 'flex';
            }

            pauseToggle() {
                if (!this.running) return;
                this.paused = !this.paused;
                if (!this.paused) {
                    this.input.unblock();
                    this.lastTime = performance.now();
                } else {
                    this.input.block();
                }
                document.getElementById('pauseBtn').textContent = this.paused ? 'Reprendre' : 'Pause';
            }

            restart() {
                document.getElementById('gameOverModal').style.display = 'none';
                this.running = false;
                this.paused = false;
                document.getElementById('pauseBtn').textContent = 'Pause';
                setTimeout(() => this.start(), 100);
            }

            updateHUD() {
                document.getElementById('score').textContent = this.score;
                document.getElementById('level').textContent = this.level;
                document.getElementById('highScore').textContent = this.highScore;
            }
        }

        // --- Snake class: Manages the snake's body segments and behavior ---
        class Snake {
            constructor(game, segments) {
                this.game = game;
                this.segments = segments.slice(); // Array of {x, y} positions
                this.velocity = {x: 0, y: 0}; // Current movement direction
                this.growAmount = 0; // How many segments to grow
            }

            reset(segments) {
                // Reset snake to initial state
                this.segments = segments.slice();
                this.velocity = {x: 0, y: 0};
                this.growAmount = 0;
            }

            unshiftHead(head) {
                // Add new head position to front of snake body
                this.segments.unshift(head);
            }

            popTail() {
                // Remove tail segment - but only if not growing
                if (this.growAmount > 0) {
                    // Snake is growing, so keep the tail (don't remove it)
                    this.growAmount--;
                } else {
                    // Normal movement: remove last segment
                    this.segments.pop();
                }
            }

            grow(n = 1) {
                // Queue up growth - tail won't be removed for n moves
                this.growAmount += n;
            }

            collidesWith(pos) {
                // Check if position collides with any segment of snake body
                return this.segments.some(s => s.x === pos.x && s.y === pos.y);
            }
        }


        
        // --- Input manager: Handles keyboard controls ---
       class InputManager {
        constructor(game) {
        this.game = game;
        this.blocked = false;
        this.queuedDirection = null; // Buffer for next direction
        this.currentDirection = {x: 0, y: 0}; // Track current direction separately
        document.addEventListener('keydown', this.onKey.bind(this));
    }
     applyQueuedDirection() {
        // Apply the queued direction at the beginning of each game step
        if (this.queuedDirection) {
            this.currentDirection = this.queuedDirection;
            this.game.snake.velocity = this.queuedDirection;
            this.queuedDirection = null; // Clear the queue
        }
    }

    onKey(e) {
        const game = this.game;
        const allowedKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd', 'W', 'A', 'S', 'D'];
        
        // If game not running, any arrow key starts the game
        if (!game.running && allowedKeys.includes(e.key)) {
            game.start();
            return;
        }

        // Ignore input if game not running or input is blocked
        if (!game.running || this.blocked) return;

        let newDirection = null;
        
        // Handle directional input - only queue valid directions
        switch (e.key) {
            case 'ArrowUp':
            case 'w':
            case 'W':
                // Only allow up if not currently going down
                if (this.currentDirection.y !== 1) 
                    newDirection = {x: 0, y: -1};
                break;
            case 'ArrowDown':
            case 's':
            case 'S':
                // Only allow down if not currently going up
                if (this.currentDirection.y !== -1) 
                    newDirection = {x: 0, y: 1};
                break;
            case 'ArrowLeft':
            case 'a':
            case 'A':
                // Only allow left if not currently going right
                if (this.currentDirection.x !== 1) 
                    newDirection = {x: -1, y: 0};
                break;
            case 'ArrowRight':
            case 'd':
            case 'D':
                // Only allow right if not currently going left
                if (this.currentDirection.x !== -1) 
                    newDirection = {x: 1, y: 0};
                break;
        }
        
        // Queue the direction for the next game step
        if (newDirection) {
            this.queuedDirection = newDirection;
        }
        
        e.preventDefault();
    }

    applyQueuedDirection() {
        // Apply the queued direction at the beginning of each game step
        if (this.queuedDirection) {
            this.currentDirection = this.queuedDirection;
            this.game.snake.velocity = this.queuedDirection;
            this.queuedDirection = null; // Clear the queue
        }
    }

    block() {
        this.blocked = true;
    }

    unblock() {
        this.blocked = false;
    }

    reset() {
    this.snake.reset([{x:10,y:10}]);
    this.input.reset(); // Reset input state too
    this.score = 0;
    this.level = 1;
    this.gameSpeed = 200;
    this.movementAccumulator = 0;
    this.obstacleManager.reset();
    this.teleportManager.reset();
    this.updateHUD();
}
}
        
        /*class ObstacleManager {
            constructor(game) {
                this.game = game;
                this.tiles = [];
            }

            reset() {
                this.tiles = [];
            }

            generateObstacles() {
                this.tiles = [];
                const level = this.game.level;
                const obstacleCount = Math.min(Math.floor(level * 1.5), 8);
                
                // Larger, taller shapes that block the CENTER of the map
                /*const shapes = [
                    // Tall vertical walls
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:5,y:0},{x:6,y:0},{x:7,y:0},{x:7,y:1},{x:7,y:2},{x:7,y:3},{x:7,y:4},{x:7,y:5},{x:7,y:6},{x:7,y:7},{x:6,y:7}],
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:5,y:0},{x:6,y:0},{x:6,y:1},{x:5,y:1},{x:4,y:1},{x:3,y:1},{x:2,y:1},{x:1,y:1},{x:0,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2},{x:6,y:2},{x:6,y:3},{x:5,y:3},{x:4,y:3},{x:3,y:3},{x:2,y:3},{x:1,y:3},{x:0,y:3}],
                    // Long horizontal walls
                    [{x:0,y:0},{x:1,y:0},{x:3,y:0},{x:4,y:0},{x:6,y:0},{x:7,y:0},{x:0,y:1},{x:2,y:1},{x:4,y:1},{x:6,y:1},{x:1,y:2},{x:3,y:2},{x:5,y:2},{x:7,y:2},{x:0,y:3},{x:2,y:3},{x:4,y:3},{x:6,y:3},{x:1,y:4},{x:3,y:4},{x:5,y:4},{x:7,y:4}],
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:5,y:0}],
                    // Big blocks
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2}],
                    [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:0,y:2},{x:1,y:2},{x:0,y:3},{x:1,y:3}],
                    // L-shapes
                    [{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:0,y:3},{x:0,y:4},{x:1,y:4},{x:2,y:4},{x:3,y:4}],
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:3,y:1},{x:3,y:2},{x:3,y:3},{x:3,y:4}],
                    // T-shapes
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:2,y:1},{x:2,y:2},{x:2,y:3}],
                    // Cross shapes
                    [{x:2,y:0},{x:2,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:2,y:3},{x:2,y:4}]
                ];
                const shapes = [
    // Original tall walls
    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:5,y:0},{x:6,y:0},{x:7,y:0},{x:7,y:1},{x:7,y:2},{x:7,y:3},{x:7,y:4},{x:7,y:5},{x:7,y:6},{x:7,y:7},{x:6,y:7}],

    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:5,y:0},{x:6,y:0},{x:6,y:1},{x:5,y:1},{x:4,y:1},{x:3,y:1},{x:2,y:1},{x:1,y:1},{x:0,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2},{x:6,y:2},{x:6,y:3},{x:5,y:3},{x:4,y:3},{x:3,y:3},{x:2,y:3},{x:1,y:3},{x:0,y:3}],


    // Original long horizontal walls
    [{x:0,y:0},{x:1,y:0},{x:3,y:0},{x:4,y:0},{x:6,y:0},{x:7,y:0},{x:0,y:1},{x:2,y:1},{x:4,y:1},{x:6,y:1},{x:1,y:2},{x:3,y:2},{x:5,y:2},{x:7,y:2},{x:0,y:3},{x:2,y:3},{x:4,y:3},{x:6,y:3},{x:1,y:4},{x:3,y:4},{x:5,y:4},{x:7,y:4}],

    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:5,y:0}],

    // Original big blocks
    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2}],

    [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1},{x:0,y:2},{x:1,y:2},{x:0,y:3},{x:1,y:3}],

    // Original L-shapes
    [{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:0,y:3},{x:0,y:4},{x:1,y:4},{x:2,y:4},{x:3,y:4}],

    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:3,y:1},{x:3,y:2},{x:3,y:3},{x:3,y:4}],

    // Original T-shape
    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:2,y:1},{x:2,y:2},{x:2,y:3}],

    // Original cross
    [{x:2,y:0},{x:2,y:1},{x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:2,y:3},{x:2,y:4}],

    // ========= NEW COMPLEX MAZE SHAPES =========

    // 1. Spiral Maze
    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:5,y:0},{x:6,y:0},{x:7,y:0},{x:8,y:0},{x:9,y:0},{x:9,y:1},{x:9,y:2},{x:9,y:3},{x:9,y:4},{x:9,y:5},{x:9,y:6},{x:9,y:7},{x:9,y:8},{x:8,y:8},{x:7,y:8},{x:6,y:8},{x:5,y:8},{x:4,y:8},{x:3,y:8},{x:3,y:7},{x:3,y:6},{x:3,y:5},{x:4,y:5},{x:5,y:5},{x:6,y:5},{x:6,y:4},{x:6,y:3},{x:5,y:3},{x:4,y:3},{x:4,y:4}],

    // 2. Zigzag Corridor
    [{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:3,y:1},{x:3,y:2},{x:2,y:2},{x:1,y:2},{x:1,y:3},{x:2,y:3},{x:3,y:3},{x:4,y:3},{x:5,y:3},{x:5,y:4},{x:4,y:4},{x:3,y:4},{x:3,y:5},{x:4,y:5},{x:5,y:5},{x:6,y:5},{x:7,y:5},{x:7,y:6},{x:6,y:6},{x:5,y:6},{x:5,y:7}],

    // 3. Square Room With Pillars
    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:4,y:1},{x:4,y:2},{x:4,y:3},{x:4,y:4},{x:0,y:4},{x:1,y:4},{x:2,y:4},{x:3,y:4},{x:0,y:1},{x:0,y:2},{x:0,y:3},{x:2,y:2},{x:1,y:2},{x:3,y:2}],

    // 4. Two-Lane Split Path
    [{x:0,y:1},{x:1,y:1},{x:2,y:1},{x:3,y:1},{x:4,y:1},{x:5,y:1},{x:0,y:3},{x:1,y:3},{x:2,y:3},{x:3,y:3},{x:4,y:3},{x:5,y:3},{x:3,y:2},{x:3,y:4},{x:3,y:0}],

    // 5. Winding Snake
    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:4,y:1},{x:3,y:1},{x:2,y:1},{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2},{x:6,y:2},{x:6,y:3},{x:5,y:3},{x:4,y:3},{x:4,y:4},{x:5,y:4},{x:6,y:4},{x:7,y:4}],

    // 6. Forest of Blocks
    [{x:1,y:1},{x:2,y:1},{x:1,y:2},{x:2,y:2},{x:4,y:1},{x:5,y:1},{x:4,y:2},{x:5,y:2},{x:7,y:1},{x:8,y:1},{x:7,y:2},{x:8,y:2},{x:3,y:4},{x:4,y:4},{x:3,y:5},{x:4,y:5},{x:6,y:4},{x:7,y:4},{x:6,y:5},{x:7,y:5}],

    // 7. Maze Box With Tunnel
    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:4,y:1},{x:4,y:2},{x:4,y:3},{x:4,y:4},{x:0,y:4},{x:1,y:4},{x:2,y:4},{x:3,y:4},{x:0,y:1},{x:0,y:2},{x:0,y:3},{x:2,y:1},{x:2,y:2},{x:2,y:3}],

    // 8. Four-Square Grid
    [{x:1,y:1},{x:2,y:1},{x:1,y:2},{x:2,y:2},{x:4,y:1},{x:5,y:1},{x:4,y:2},{x:5,y:2},{x:1,y:4},{x:2,y:4},{x:1,y:5},{x:2,y:5},{x:4,y:4},{x:5,y:4},{x:4,y:5},{x:5,y:5}],

    // 9. Arrow Maze
    [{x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2},{x:4,y:2},{x:5,y:2},{x:6,y:2},{x:7,y:2},{x:7,y:1},{x:6,y:1},{x:5,y:1},{x:4,y:1},{x:3,y:1},{x:3,y:3},{x:4,y:3},{x:5,y:3}],

    // 10. Saw-Tooth Pattern
    [{x:0,y:0},{x:1,y:1},{x:2,y:0},{x:3,y:1},{x:4,y:0},{x:5,y:1},{x:6,y:0},{x:7,y:1},{x:1,y:3},{x:2,y:4},{x:3,y:3},{x:4,y:4},{x:5,y:3},{x:6,y:4}]
];


                for (let i = 0; i < obstacleCount; i++) {
                    let attempts = 0;
                    let valid = false;
                    let shape = shapes[Math.floor(Math.random() * shapes.length)];
                    let baseX, baseY;

                    do {
                        // CENTER AREA ONLY: keep obstacles in middle 60% of map
                        const centerMin = Math.floor(tileCount * 0.2); // 20% from edge
                        const centerMax = Math.floor(tileCount * 0.8); // 80% (leave 20% on other side)
                        baseX = centerMin + Math.floor(Math.random() * (centerMax - centerMin - 8));
                        baseY = centerMin + Math.floor(Math.random() * (centerMax - centerMin - 8));
                        valid = true;
                        attempts++;

                        for (let t of shape) {
                            const x = baseX + t.x, y = baseY + t.y;
                            if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) {
                                valid = false;
                                break;
                            }
                            // Keep away from starting position
                            if (Math.abs(x - 10) < 4 && Math.abs(y - 10) < 4) {
                                valid = false;
                                break;
                            }
                            if (this.game.snake.segments.some(s => s.x === x && s.y === y)) {
                                valid = false;
                                break;
                            }
                            if (this.tiles.some(o => o.x === x && o.y === y)) {
                                valid = false;
                                break;
                            }
                            if (x === this.game.food.x && y === this.game.food.y) {
                                valid = false;
                                break;
                            }
                        }
                        if (attempts > 300) break;
                    } while (!valid);

                    if (valid) {
                        for (let t of shape) {
                            this.tiles.push({x: baseX + t.x, y: baseY + t.y});
                        }
                    }
                }
            }

            applyRandomPreset() {
                const presets = ['dense', 'sparse', 'maze', 'corridors'];
                const pick = presets[Math.floor(Math.random() * presets.length)];
                
                this.tiles = [];
                
                // CENTER AREA boundaries
                const centerMin = Math.floor(tileCount * 0.25);
                const centerMax = Math.floor(tileCount * 0.75);
                
                if (pick === 'dense') {
                    // Many large obstacles in CENTER only
                    for (let i = 0; i < 60; i++) {
                        const x = centerMin + Math.floor(Math.random() * (centerMax - centerMin));
                        const y = centerMin + Math.floor(Math.random() * (centerMax - centerMin));
                        if (this.game.isTileFree(x, y)) {
                            this.tiles.push({x, y});
                        }
                    }
                } else if (pick === 'maze') {
                    // Long horizontal and vertical walls in CENTER creating maze
                    for (let r = centerMin; r < centerMax; r += 4) {
                        for (let c = centerMin; c < centerMax; c++) {
                            if (Math.random() < 0.8) {
                                this.tiles.push({x: c, y: r});
                            }
                        }
                    }
                    for (let c = centerMin; c < centerMax; c += 4) {
                        for (let r = centerMin; r < centerMax; r++) {
                            if (Math.random() < 0.8) {
                                this.tiles.push({x: c, y: r});
                            }
                        }
                    }
                } else if (pick === 'corridors') {
                    // Create narrow corridors in CENTER
                    for (let i = 0; i < 3; i++) {
                        const isVertical = Math.random() < 0.5;
                        if (isVertical) {
                            const col = centerMin + Math.floor(Math.random() * (centerMax - centerMin));
                            for (let row = centerMin; row < centerMax; row++) {
                                if (Math.random() < 0.85) {
                                    this.tiles.push({x: col, y: row});
                                    if (Math.random() < 0.5 && col + 1 < centerMax) {
                                        this.tiles.push({x: col + 1, y: row});
                                    }
                                }
                            }
                        } else {
                            const row = centerMin + Math.floor(Math.random() * (centerMax - centerMin));
                            for (let col = centerMin; col < centerMax; col++) {
                                if (Math.random() < 0.85) {
                                    this.tiles.push({x: col, y: row});
                                    if (Math.random() < 0.5 && row + 1 < centerMax) {
                                        this.tiles.push({x: col, y: row + 1});
                                    }
                                }
                            }
                        }
                    }
                }
            }

            collides(pos) {
                return this.tiles.some(t => t.x === pos.x && t.y === pos.y);
            }
        }
*/



        class ObstacleManager {
    constructor(game) {
        this.game = game;
        this.tiles = [];
    }

    reset() {
        this.tiles = [];
    }

    generateObstacles() {
        this.tiles = [];
        const level = this.game.level;
        const obstacleCount = Math.min(Math.floor(level * 1.5), 8);
        
        // COOL SHAPES - Designed for playability and visual appeal
        const shapes = [
            // 1. Spiral Maze (playable)
            [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},{x:5,y:0},
             {x:5,y:1},{x:5,y:2},{x:5,y:3},{x:5,y:4},
             {x:4,y:4},{x:3,y:4},{x:2,y:4},{x:1,y:4},
             {x:1,y:3},{x:1,y:2},{x:2,y:2},{x:3,y:2},
             {x:3,y:1},{x:2,y:1}],

            // 2. Symmetrical Cross
            [{x:2,y:0},{x:2,y:1},{x:2,y:2},
             {x:0,y:2},{x:1,y:2},{x:3,y:2},{x:4,y:2},
             {x:2,y:3},{x:2,y:4}],

            // 3. Hollow Square with openings
            [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},
             {x:0,y:1},{x:4,y:1},
             {x:0,y:2},{x:2,y:2},{x:4,y:2},
             {x:0,y:3},{x:4,y:3},
             {x:0,y:4},{x:1,y:4},{x:2,y:4},{x:3,y:4},{x:4,y:4}],

            // 4. Arrow Shape
            [{x:2,y:0},
             {x:1,y:1},{x:2,y:1},{x:3,y:1},
             {x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2},{x:4,y:2},
             {x:2,y:3},
             {x:2,y:4}],

            // 5. Diamond with pathways
            [{x:2,y:0},
             {x:1,y:1},{x:3,y:1},
             {x:0,y:2},{x:4,y:2},
             {x:1,y:3},{x:3,y:3},
             {x:2,y:4}],

            // 6. Plus Sign with gaps
            [{x:2,y:0},
             {x:2,y:1},
             {x:0,y:2},{x:1,y:2},{x:3,y:2},{x:4,y:2},
             {x:2,y:3},
             {x:2,y:4}],

            // 7. Castle Walls with gates
            [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},
             {x:0,y:1},{x:4,y:1},
             {x:0,y:2},{x:4,y:2},
             {x:0,y:3},{x:4,y:3},
             {x:0,y:4},{x:1,y:4},{x:2,y:4},{x:3,y:4},{x:4,y:4}],

            // 8. Zigzag corridor
            [{x:0,y:0},{x:1,y:0},{x:2,y:0},
             {x:2,y:1},{x:2,y:2},
             {x:0,y:2},{x:1,y:2},{x:2,y:2},
             {x:0,y:3},{x:0,y:4},
             {x:0,y:4},{x:1,y:4},{x:2,y:4}],

            // 9. Checkerboard pattern (playable)
            [{x:0,y:0},{x:2,y:0},{x:4,y:0},
             {x:1,y:1},{x:3,y:1},
             {x:0,y:2},{x:2,y:2},{x:4,y:2},
             {x:1,y:3},{x:3,y:3},
             {x:0,y:4},{x:2,y:4},{x:4,y:4}],

            // 10. Circuit board pattern
            [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0},{x:4,y:0},
             {x:0,y:2},{x:1,y:2},{x:2,y:2},{x:3,y:2},{x:4,y:2},
             {x:0,y:4},{x:1,y:4},{x:2,y:4},{x:3,y:4},{x:4,y:4},
             {x:0,y:1},{x:4,y:1},
             {x:0,y:3},{x:4,y:3}]
        ];

        for (let i = 0; i < obstacleCount; i++) {
            let attempts = 0;
            let valid = false;
            let shape = shapes[Math.floor(Math.random() * shapes.length)];
            let baseX, baseY;

            // Calculate shape dimensions
            const shapeWidth = Math.max(...shape.map(t => t.x)) + 1;
            const shapeHeight = Math.max(...shape.map(t => t.y)) + 1;

            do {
                // Smart placement - avoid edges and starting area
                const margin = 3;
                const maxX = tileCount - margin - shapeWidth;
                const maxY = tileCount - margin - shapeHeight;
                
                if (maxX <= margin || maxY <= margin) {
                    valid = false;
                    break;
                }
                
                baseX = margin + Math.floor(Math.random() * (maxX - margin));
                baseY = margin + Math.floor(Math.random() * (maxY - margin));
                valid = true;
                attempts++;

                // Enhanced validation - ensure playability
                for (let t of shape) {
                    const x = baseX + t.x;
                    const y = baseY + t.y;
                    
                    // Boundary check
                    if (x < 0 || x >= tileCount || y < 0 || y >= tileCount) {
                        valid = false;
                        break;
                    }
                    
                    // Safe distance from starting position
                    if (Math.abs(x - 10) < 4 && Math.abs(y - 10) < 4) {
                        valid = false;
                        break;
                    }
                    
                    // Check collisions
                    if (this.game.snake.segments.some(s => s.x === x && s.y === y) ||
                        this.tiles.some(o => o.x === x && o.y === y) ||
                        (x === this.game.food.x && y === this.game.food.y)) {
                        valid = false;
                        break;
                    }
                }
                
                // Additional playability check: ensure there are pathways
                if (valid && !this.hasPathways(baseX, baseY, shape)) {
                    valid = false;
                }
                
                if (attempts > 200) break;
            } while (!valid);

            if (valid) {
                // Place the shape
                for (let t of shape) {
                    this.tiles.push({
                        x: baseX + t.x, 
                        y: baseY + t.y
                    });
                }
                console.log(`Placed cool shape ${i} at ${baseX},${baseY}`);
            }
        }
        
        console.log(`Total cool obstacles placed: ${this.tiles.length}`);
    }

    // Check if the shape allows pathways for snake movement
    hasPathways(baseX, baseY, shape) {
        const tempTiles = [];
        for (let t of shape) {
            tempTiles.push({x: baseX + t.x, y: baseY + t.y});
        }
        
        // Check if there are adjacent free tiles (pathways)
        let hasPathways = false;
        for (let t of tempTiles) {
            const neighbors = [
                {x: t.x-1, y: t.y}, {x: t.x+1, y: t.y},
                {x: t.x, y: t.y-1}, {x: t.x, y: t.y+1}
            ];
            
            for (let neighbor of neighbors) {
                if (neighbor.x >= 0 && neighbor.x < tileCount && 
                    neighbor.y >= 0 && neighbor.y < tileCount &&
                    !tempTiles.some(tt => tt.x === neighbor.x && tt.y === neighbor.y) &&
                    !this.tiles.some(ot => ot.x === neighbor.x && ot.y === neighbor.y)) {
                    hasPathways = true;
                    break;
                }
            }
            if (hasPathways) break;
        }
        
        return hasPathways;
    }

    applyRandomPreset() {
        const presets = ['maze', 'corridors', 'islands', 'symmetrical'];
        const pick = presets[Math.floor(Math.random() * presets.length)];
        
        this.tiles = [];
        
        if (pick === 'maze') {
            this.createPlayableMaze();
        } else if (pick === 'corridors') {
            this.createCorridors();
        } else if (pick === 'islands') {
            this.createIslands();
        } else { // symmetrical
            this.createSymmetricalPattern();
        }
        
        console.log(`Applied ${pick} preset with ${this.tiles.length} obstacles`);
    }

    createPlayableMaze() {
        // Create a maze with guaranteed pathways
        for (let x = 3; x < tileCount - 3; x += 2) {
            for (let y = 3; y < tileCount - 3; y += 2) {
                if (Math.random() < 0.7 && Math.abs(x - 10) >= 3 && Math.abs(y - 10) >= 3) {
                    this.tiles.push({x, y});
                    // Add occasional connecting walls
                    if (Math.random() < 0.3) {
                        this.tiles.push({x: x + 1, y});
                    }
                    if (Math.random() < 0.3) {
                        this.tiles.push({x, y: y + 1});
                    }
                }
            }
        }
    }

    createCorridors() {
        // Create corridors with openings
        for (let i = 0; i < 4; i++) {
            const vertical = Math.random() < 0.5;
            const pos = 4 + Math.floor(Math.random() * (tileCount - 8));
            
            for (let j = 2; j < tileCount - 2; j++) {
                // Leave gaps for passage
                if (j % 4 !== 0) {
                    if (vertical) {
                        this.tiles.push({x: pos, y: j});
                    } else {
                        this.tiles.push({x: j, y: pos});
                    }
                }
            }
        }
    }

    createIslands() {
        // Create isolated obstacle groups with space between them
        const islandPositions = [
            {x: 3, y: 3}, {x: 13, y: 3}, 
            {x: 3, y: 13}, {x: 13, y: 13},
            {x: 8, y: 8}
        ];
        
        const smallShapes = [
            [{x:0,y:0},{x:1,y:0},{x:0,y:1}],
            [{x:0,y:0},{x:1,y:0},{x:1,y:1}],
            [{x:0,y:0},{x:1,y:0},{x:2,y:0}],
            [{x:0,y:0},{x:0,y:1},{x:0,y:2}]
        ];
        
        for (let pos of islandPositions) {
            if (Math.random() < 0.7) {
                const shape = smallShapes[Math.floor(Math.random() * smallShapes.length)];
                for (let t of shape) {
                    const x = pos.x + t.x;
                    const y = pos.y + t.y;
                    if (x >= 2 && x < tileCount - 2 && y >= 2 && y < tileCount - 2) {
                        this.tiles.push({x, y});
                    }
                }
            }
        }
    }

    createSymmetricalPattern() {
        // Create symmetrical pattern that's playable
        for (let x = 2; x < tileCount - 2; x++) {
            for (let y = 2; y < tileCount - 2; y++) {
                if ((x % 3 === 0 && y % 3 === 0) || 
                    (x === tileCount - y - 1 && x % 2 === 0)) {
                    if (Math.abs(x - 10) >= 3 && Math.abs(y - 10) >= 3) {
                        this.tiles.push({x, y});
                    }
                }
            }
        }
    }

    collides(pos) {
        return this.tiles.some(t => t.x === pos.x && t.y === pos.y);
    }
}




        // --- Teleport Manager: Handles wormhole portals that appear/disappear ---
        /*class TeleportManager {
            constructor(game) {
                this.game = game;
                this.pairs = []; // Array of portal pairs [{id, a:{x,y}, b:{x,y}}]
                this.activeTimer = 0; // Tracks time for spawn/despawn cycle
                this.isActive = false; // Whether portals are currently visible
                this.spawnInterval = 18000; // Changed from 15000 to 18000 (18 seconds)
                this.activeTime = 4000; // Changed from 3000 to 4000 (4 seconds visible)
            }

            reset() {
                // Clear all portals
                this.pairs = [];
                this.activeTimer = 0;
                this.isActive = false;
            }

            update(delta) {
                // Update timer for portal spawn/despawn cycle
                this.activeTimer += delta;
                
                if (this.isActive) {
                    // Portals are currently visible
                    // Check if it's time to hide them
                    if (this.activeTimer >= this.activeTime) {
                        this.isActive = false;
                        this.pairs = []; // Remove all portals
                        this.activeTimer = 0;
                    }
                } else {
                    // Portals are hidden
                    // Check if it's time to spawn new ones
                    if (this.activeTimer >= this.spawnInterval) {
                        this.ensurePairs(); // Create new portal pairs
                        this.isActive = true;
                        this.activeTimer = 0;
                    }
                }
            }

            ensurePairs() {
    // Create portal pairs that are far apart from each other
    this.pairs = [];
    const pairCount = 1; // Create 1 pair of portals (2 portals total)
    
    let a = null;
    let b = null;
    let attempts = 0;
    
    // Keep trying until we find portals that are far apart AND not in snake's path
    while (attempts < 200) {
        a = this.randomFree();
        b = this.randomFree();
        
        if (a && b) {
            // Calculate distance between the two portal positions
            const distance = Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
            
            // Require minimum distance of 10 tiles between paired portals
            if (distance >= 10) {
                // Also verify they're not in the same quadrant of the map
                const aQuadX = a.x < tileCount / 2 ? 'left' : 'right';
                const aQuadY = a.y < tileCount / 2 ? 'top' : 'bottom';
                const bQuadX = b.x < tileCount / 2 ? 'left' : 'right';
                const bQuadY = b.y < tileCount / 2 ? 'top' : 'bottom';
                
                // Portals should be in different areas AND not in snake's path
                if ((aQuadX !== bQuadX || aQuadY !== bQuadY) && 
                    !this.isInSnakePath(a.x, a.y) && 
                    !this.isInSnakePath(b.x, b.y)) {
                    break; // Good positions found!
                }
            }
        }
        attempts++;
    }
    
    // Add the portal pair if we found good positions
    if (a && b && attempts < 200) {
        this.pairs.push({
            id: Date.now() + Math.random(),
            a: a,
            b: b
        });
    }
}

            randomFree() {
                // Find a random free tile for portal placement
                // Prefer edges and corners (away from center obstacles)
                let tries = 0;
                while (tries < 200) {
                    const edgeChance = Math.random();
                    let x, y;
                    
                    if (edgeChance < 0.5) {
                        // 50% chance: Place near edges of the map
                        if (Math.random() < 0.5) {
                            // Top or bottom edge
                            x = 1 + Math.floor(Math.random() * (tileCount - 2));
                            y = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 3) : tileCount - 4 + Math.floor(Math.random() * 3);
                        } else {
                            // Left or right edge
                            x = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 3) : tileCount - 4 + Math.floor(Math.random() * 3);
                            y = 1 + Math.floor(Math.random() * (tileCount - 2));
                        }
                    } else {
                        // 50% chance: Random position anywhere
                        x = 1 + Math.floor(Math.random() * (tileCount - 2));
                        y = 1 + Math.floor(Math.random() * (tileCount - 2));
                    }
                    
                    // Check if this tile is free (not occupied)
                    if (this.game.isTileFree(x, y) && !this.isInSnakePath(x, y)) {
                        return {x, y};
                    }
                    tries++;
                }
                return null; // Couldn't find free position
            }

             randomFree() {
                // Find a random free tile for portal placement
                // Prefer edges and corners (away from center obstacles)
                let tries = 0;
                while (tries < 200) {
                    const edgeChance = Math.random();
                    let x, y;
                    
                    if (edgeChance < 0.5) {
                        // 50% chance: Place near edges of the map
                        if (Math.random() < 0.5) {
                            // Top or bottom edge
                            x = 1 + Math.floor(Math.random() * (tileCount - 2));
                            y = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 3) : tileCount - 4 + Math.floor(Math.random() * 3);
                        } else {
                            // Left or right edge
                            x = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 3) : tileCount - 4 + Math.floor(Math.random() * 3);
                            y = 1 + Math.floor(Math.random() * (tileCount - 2));
                        }
                    } else {
                        // 50% chance: Random position anywhere
                        x = 1 + Math.floor(Math.random() * (tileCount - 2));
                        y = 1 + Math.floor(Math.random() * (tileCount - 2));
                    }
                    
                    // Check if this tile is free (not occupied)
                    if (this.game.isTileFree(x, y) && !this.isInSnakePath(x, y)) {
                        return {x, y};
                    }
                    tries++;
                }
                return null; // Couldn't find free position
            }

           isInSnakePath(x, y) {
                const snake = this.game.snake;
                const head = snake.segments[0];
                const vel = snake.velocity;
                
                // If snake isn't moving yet, no path to avoid
                if (vel.x === 0 && vel.y === 0) return false;
                
                // Check a MUCH larger area in front of snake (10 tiles ahead)
                for (let i = 1; i <= 10; i++) {
                    const checkX = head.x + (vel.x * i);
                    const checkY = head.y + (vel.y * i);
                    
                    if (checkX === x && checkY === y) {
                        return true; // Portal would be directly in snake's path
                    }
                }
                
                // ALSO check adjacent tiles to the snake's path (diagonal safety zone)
                for (let i = 1; i <= 8; i++) {
                    const checkX = head.x + (vel.x * i);
                    const checkY = head.y + (vel.y * i);
                    
                    // Check tiles adjacent to the path
                    const adjacentChecks = [
                        {x: checkX + 1, y: checkY},
                        {x: checkX - 1, y: checkY},
                        {x: checkX, y: checkY + 1},
                        {x: checkX, y: checkY - 1}
                    ];
                    
                    for (let adj of adjacentChecks) {
                        if (adj.x === x && adj.y === y) {
                            return true; // Too close to snake's path
                        }
                    }
                }
                
                // ALSO check if portal is too close to snake's current position
                const distanceToHead = Math.abs(head.x - x) + Math.abs(head.y - y);
                if (distanceToHead < 5) {
                    return true; // Too close to snake head
                }
                
                return false;
            }


            isInSnakePath(x, y) {
                // Check if position is directly in front of snake (within 3 tiles in its direction)
                const snake = this.game.snake;
                const head = snake.segments[0];
                const vel = snake.velocity;
                
                // If snake isn't moving yet, no path to avoid
                if (vel.x === 0 && vel.y === 0) return false;
                
                // Check the next 3 tiles in the snake's current direction
                for (let i = 1; i <= 3; i++) {
                    const checkX = head.x + (vel.x * i);
                    const checkY = head.y + (vel.y * i);
                    
                    if (checkX === x && checkY === y) {
                        return true; // Portal would be directly in snake's path
                    }
                }
                
                return false;
            }

            randomFree() {
                // Find a random free tile for portal placement
                // Prefer edges and corners (away from center obstacles)
                let tries = 0;
                while (tries < 200) {
                    const edgeChance = Math.random();
                    let x, y;
                    
                    if (edgeChance < 0.5) {
                        // 50% chance: Place near edges of the map
                        if (Math.random() < 0.5) {
                            // Top or bottom edge
                            x = 1 + Math.floor(Math.random() * (tileCount - 2));
                            y = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 3) : tileCount - 4 + Math.floor(Math.random() * 3);
                        } else {
                            // Left or right edge
                            x = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 3) : tileCount - 4 + Math.floor(Math.random() * 3);
                            y = 1 + Math.floor(Math.random() * (tileCount - 2));
                        }
                    } else {
                        // 50% chance: Random position anywhere
                        x = 1 + Math.floor(Math.random() * (tileCount - 2));
                        y = 1 + Math.floor(Math.random() * (tileCount - 2));
                    }
                    
                    // Check if this tile is free (not occupied)
                    if (this.game.isTileFree(x, y)) {
                        return {x, y};
                    }
                    tries++;
                }
                return null; // Couldn't find free position
            }

            getTeleportAt(x, y) {
                // Check if there's a portal at the given position
                for (const p of this.pairs) {
                    if (p.a.x === x && p.a.y === y) {
                        return {id: p.id, pos: 'a', pair: p};
                    }
                    if (p.b.x === x && p.b.y === y) {
                        return {id: p.id, pos: 'b', pair: p};
                    }
                }
                return null; // No portal at this position
            }

            getPairedPosition(teleport) {
                // Get the destination position for a portal
                // If snake enters portal 'a', it exits from portal 'b' (and vice versa)
                if (!teleport || !teleport.pair) return null;
                const p = teleport.pair;
                return teleport.pos === 'a' ? p.b : p.a;
            }
        }*/

        class TeleportManager {
    constructor(game) {
        this.game = game;
        this.pairs = [];
        this.activeTimer = 0;
        this.isActive = false;
        this.spawnInterval = 18000;
        this.activeTime = 4000;
    }

    reset() {
        this.pairs = [];
        this.activeTimer = 0;
        this.isActive = false;
    }

    update(delta) {
        this.activeTimer += delta;
        
        if (this.isActive) {
            if (this.activeTimer >= this.activeTime) {
                this.isActive = false;
                this.pairs = [];
                this.activeTimer = 0;
            }
        } else {
            if (this.activeTimer >= this.spawnInterval) {
                this.ensurePairs();
                this.isActive = true;
                this.activeTimer = 0;
            }
        }
    }

    ensurePairs() {
        this.pairs = [];
        
        const snakeHead = this.game.snake.segments[0];
        const food = this.game.food;
        
        let portalA = null;
        let portalB = null;
        let attempts = 0;
        
        // Keep trying until we get good portal placement
        while (attempts < 100) {
            // Portal A: Close to snake (but not directly in front)
            portalA = this.findPositionNearSnake(snakeHead);
            
            // Portal B: Close to food but FAR from portal A
            portalB = this.findPositionNearFoodButFarFromPortal(food, portalA);
            
            if (portalA && portalB) {
                // Verify they're at least 12 tiles apart
                const distance = Math.sqrt(Math.pow(portalA.x - portalB.x, 2) + Math.pow(portalA.y - portalB.y, 2));
                if (distance >= 12) {
                    break; // Good placement found
                }
            }
            attempts++;
        }
        
        if (portalA && portalB) {
            this.pairs.push({
                id: Date.now() + Math.random(),
                a: portalA,
                b: portalB
            });
        }
    }

    findPositionNearSnake(snakeHead) {
        const directions = [
            {x: -3, y: -2}, {x: 3, y: -2}, {x: -2, y: -3}, {x: 2, y: -3},
            {x: -3, y: 2}, {x: 3, y: 2}, {x: -2, y: 3}, {x: 2, y: 3},
            {x: -3, y: 0}, {x: 3, y: 0}, {x: 0, y: -3}, {x: 0, y: 3}
        ];
        
        const shuffled = [...directions].sort(() => Math.random() - 0.5);
        
        for (let dir of shuffled) {
            const x = snakeHead.x + dir.x;
            const y = snakeHead.y + dir.y;
            
            if (this.isValidPortalPosition(x, y) && !this.isInDirectSnakePath(x, y)) {
                return {x, y};
            }
        }
        
        return this.randomFree();
    }

    findPositionNearFoodButFarFromPortal(food, portalA) {
        if (!portalA) return this.findPositionNearFood(food);
        
        const directions = [
            {x: -3, y: -2}, {x: 3, y: -2}, {x: -2, y: -3}, {x: 2, y: -3},
            {x: -3, y: 2}, {x: 3, y: 2}, {x: -2, y: 3}, {x: 2, y: 3},
            {x: -3, y: 0}, {x: 3, y: 0}, {x: 0, y: -3}, {x: 0, y: 3}
        ];
        
        const shuffled = [...directions].sort(() => Math.random() - 0.5);
        
        // First try positions near food that are far from portal A
        for (let dir of shuffled) {
            const x = food.x + dir.x;
            const y = food.y + dir.y;
            
            if (this.isValidPortalPosition(x, y)) {
                const distance = Math.sqrt(Math.pow(portalA.x - x, 2) + Math.pow(portalA.y - y, 2));
                if (distance >= 12) {
                    return {x, y};
                }
            }
        }
        
        // If no good positions near food, find any position far from portal A
        return this.findPositionFarFrom(portalA);
    }

    findPositionNearFood(food) {
        const directions = [
            {x: -3, y: -2}, {x: 3, y: -2}, {x: -2, y: -3}, {x: 2, y: -3},
            {x: -3, y: 2}, {x: 3, y: 2}, {x: -2, y: 3}, {x: 2, y: 3},
            {x: -3, y: 0}, {x: 3, y: 0}, {x: 0, y: -3}, {x: 0, y: 3}
        ];
        
        const shuffled = [...directions].sort(() => Math.random() - 0.5);
        
        for (let dir of shuffled) {
            const x = food.x + dir.x;
            const y = food.y + dir.y;
            
            if (this.isValidPortalPosition(x, y)) {
                return {x, y};
            }
        }
        
        return this.randomFree();
    }

    findPositionFarFrom(portal) {
        // Try corners and edges far from the given portal
        const corners = [
            {x: 2, y: 2}, {x: 2, y: tileCount-3}, 
            {x: tileCount-3, y: 2}, {x: tileCount-3, y: tileCount-3}
        ];
        
        // Sort by distance (farthest first)
        corners.sort((a, b) => {
            const distA = Math.sqrt(Math.pow(portal.x - a.x, 2) + Math.pow(portal.y - a.y, 2));
            const distB = Math.sqrt(Math.pow(portal.x - b.x, 2) + Math.pow(portal.y - b.y, 2));
            return distB - distA;
        });
        
        for (let corner of corners) {
            if (this.isValidPortalPosition(corner.x, corner.y)) {
                return corner;
            }
        }
        
        return this.randomFree();
    }

    isValidPortalPosition(x, y) {
        return x >= 1 && x < tileCount - 1 && 
               y >= 1 && y < tileCount - 1 && 
               this.game.isTileFree(x, y);
    }

    isInDirectSnakePath(x, y) {
        const snake = this.game.snake;
        const head = snake.segments[0];
        const vel = snake.velocity;
        
        if (vel.x === 0 && vel.y === 0) return false;
        
        for (let i = 1; i <= 2; i++) {
            const checkX = head.x + (vel.x * i);
            const checkY = head.y + (vel.y * i);
            if (checkX === x && checkY === y) {
                return true;
            }
        }
        return false;
    }

    randomFree() {
        for (let tries = 0; tries < 100; tries++) {
            const edgeChance = Math.random();
            let x, y;
            
            if (edgeChance < 0.5) {
                if (Math.random() < 0.5) {
                    x = 1 + Math.floor(Math.random() * (tileCount - 2));
                    y = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 3) : tileCount - 4 + Math.floor(Math.random() * 3);
                } else {
                    x = Math.random() < 0.5 ? 1 + Math.floor(Math.random() * 3) : tileCount - 4 + Math.floor(Math.random() * 3);
                    y = 1 + Math.floor(Math.random() * (tileCount - 2));
                }
            } else {
                x = 1 + Math.floor(Math.random() * (tileCount - 2));
                y = 1 + Math.floor(Math.random() * (tileCount - 2));
            }
            
            if (this.game.isTileFree(x, y) && !this.isInSnakePath(x, y)) {
                return {x, y};
            }
        }
        return null;
    }

    isInSnakePath(x, y) {
        const snake = this.game.snake;
        const head = snake.segments[0];
        const vel = snake.velocity;
        
        if (vel.x === 0 && vel.y === 0) return false;
        
        for (let i = 1; i <= 10; i++) {
            const checkX = head.x + (vel.x * i);
            const checkY = head.y + (vel.y * i);
            
            if (checkX === x && checkY === y) {
                return true;
            }
        }
        
        for (let i = 1; i <= 8; i++) {
            const checkX = head.x + (vel.x * i);
            const checkY = head.y + (vel.y * i);
            
            const adjacentChecks = [
                {x: checkX + 1, y: checkY}, {x: checkX - 1, y: checkY},
                {x: checkX, y: checkY + 1}, {x: checkX, y: checkY - 1}
            ];
            
            for (let adj of adjacentChecks) {
                if (adj.x === x && adj.y === y) {
                    return true;
                }
            }
        }
        
        const distanceToHead = Math.abs(head.x - x) + Math.abs(head.y - y);
        if (distanceToHead < 5) {
            return true;
        }
        
        return false;
    }

    getTeleportAt(x, y) {
        for (const p of this.pairs) {
            if (p.a.x === x && p.a.y === y) {
                return {id: p.id, pos: 'a', pair: p};
            }
            if (p.b.x === x && p.b.y === y) {
                return {id: p.id, pos: 'b', pair: p};
            }
        }
        return null;
    }

    getPairedPosition(teleport) {
        if (!teleport || !teleport.pair) return null;
        const p = teleport.pair;
        return teleport.pos === 'a' ? p.b : p.a;
    }
}

        class Renderer {
            constructor(game) {
                this.game = game;
                this.protectionNotification = null;
            }

            render(ctx) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#000';
                ctx.fillRect(0, 0, canvas.width, canvas.height);

                // Grid
                ctx.strokeStyle = 'rgba(0,255,0,0.05)';
                ctx.lineWidth = 1;
                for (let i = 0; i <= tileCount; i++) {
                    ctx.beginPath();
                    ctx.moveTo(i * gridSize, 0);
                    ctx.lineTo(i * gridSize, canvas.height);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(0, i * gridSize);
                    ctx.lineTo(canvas.width, i * gridSize);
                    ctx.stroke();
                }

                // Obstacles
                ctx.save();
                ctx.shadowBlur = 12;
                ctx.shadowColor = '#00aa00';
                ctx.fillStyle = 'rgba(0,100,0,0.7)';
                for (const obs of this.game.obstacleManager.tiles) {
                    ctx.fillRect(obs.x * gridSize, obs.y * gridSize, gridSize, gridSize);
                    ctx.strokeStyle = '#00aa00';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(obs.x * gridSize, obs.y * gridSize, gridSize, gridSize);
                }
                ctx.restore();

                // Teleporters (only if active)
                if (this.game.teleportManager.isActive) {
                    // Calculate fade effect for portals
                    const timeRemaining = this.game.teleportManager.activeTime - this.game.teleportManager.activeTimer;
                    let alpha = 1.0;
                    
                    // Fade out in last 2000ms
                    if (timeRemaining < 2000) {
                        alpha = timeRemaining / 2000;
                    }
                    // Fade in during first 300ms
                    if (this.game.teleportManager.activeTimer < 300) {
                        alpha = this.game.teleportManager.activeTimer / 300;
                    }
                    
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    this.game.teleportManager.pairs.forEach((p, index) => {
                    this.drawPortal(ctx, p.a.x, p.a.y, index === 0 ? '#7f00ff' : '#ff7f00');
                    this.drawPortal(ctx, p.b.x, p.b.y, index === 0 ? '#7f00ff' : '#ff7f00');
                    });
                    ctx.restore();
                }

                // Food
                ctx.save();
                ctx.shadowBlur = 15;
                ctx.shadowColor = '#ff0000';
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(
                    this.game.food.x * gridSize + gridSize / 2,
                    this.game.food.y * gridSize + gridSize / 2,
                    gridSize / 2 - 2,
                    0,
                    Math.PI * 2
                );
                ctx.fill();
                ctx.restore();

                // Snake
                this.drawSnake(ctx);
            }

            drawPortal(ctx, x, y, color) {
                ctx.save();
                ctx.translate(x * gridSize + gridSize / 2, y * gridSize + gridSize / 2);
                const rotation = (Date.now() % 3600) / 3600 * Math.PI * 2;
                ctx.rotate(rotation);
                ctx.globalAlpha = 0.85;
                
                const g = ctx.createRadialGradient(0, 0, 2, 0, 0, gridSize / 2);
                g.addColorStop(0, 'rgba(255,255,255,0.9)');
                g.addColorStop(0.6, color);
                g.addColorStop(1, 'rgba(0,0,0,0.2)');
                
                ctx.fillStyle = g;
                ctx.beginPath();
                ctx.arc(0, 0, gridSize / 2 - 2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            drawSnake(ctx) {
                const segments = this.game.snake.segments;
                const isProtected = this.game.mapChangeProtection;
                
                for (let i = segments.length - 1; i >= 0; i--) {
                    const s = segments[i];
                    
                    // Add golden glow when protected
                    if (isProtected) {
                        ctx.save();
                        ctx.shadowBlur = 30;
                        ctx.shadowColor = '#ffd700';
                        ctx.globalAlpha = 0.3 + Math.sin(Date.now() / 100) * 0.2;
                        ctx.fillStyle = '#ffd700';
                        ctx.fillRect(s.x * gridSize - 2, s.y * gridSize - 2, gridSize + 4, gridSize + 4);
                        ctx.restore();
                    }
                    
                    const gradient = ctx.createLinearGradient(
                        s.x * gridSize,
                        s.y * gridSize,
                        s.x * gridSize + gridSize,
                        s.y * gridSize + gridSize
                    );
                    
                    if (i === 0) {
                        gradient.addColorStop(0, isProtected ? '#ffd700' : '#00ff88');
                        gradient.addColorStop(1, isProtected ? '#ffed4e' : '#00cc66');
                        ctx.shadowBlur = isProtected ? 25 : 20;
                        ctx.shadowColor = isProtected ? '#ffd700' : '#00ff00';
                    } else {
                        gradient.addColorStop(0, isProtected ? '#ffed4e' : '#4CAF50');
                        gradient.addColorStop(1, isProtected ? '#ffd700' : '#45a049');
                        ctx.shadowBlur = isProtected ? 20 : 12;
                        ctx.shadowColor = isProtected ? '#ffd700' : '#00ff00';
                    }
                    
                    ctx.fillStyle = gradient;
                    ctx.fillRect(s.x * gridSize + 1, s.y * gridSize + 1, gridSize - 2, gridSize - 2);
                    ctx.strokeStyle = isProtected ? '#ffd700' : (i === 0 ? '#00ff88' : '#66BB6A');
                    ctx.lineWidth = isProtected ? 3 : 2;
                    ctx.strokeRect(s.x * gridSize + 1, s.y * gridSize + 1, gridSize - 2, gridSize - 2);
                }
                ctx.shadowBlur = 0;
            }
        }

        const game = new Game();

        document.getElementById('startBtn').addEventListener('click', () => {
            if (!game.running) {
                game.start();
            }
        });

        document.getElementById('pauseBtn').addEventListener('click', () => {
            game.pauseToggle();
        });

        document.getElementById('restartBtn').addEventListener('click', () => {
            if (game.running) {
                game.running = false;
                game.paused = false;
                document.getElementById('pauseBtn').textContent = 'Pause';
                setTimeout(() => game.start(), 100);
            } else {
                game.start();
            }
        });

        // Expose restartGame for modal button
        window.restartGame = () => game.restart();

        // Initial render
        game.renderer.render(ctx);