// --- Constants and simple helpers ---
        const canvas = document.getElementById('gameCanvas');
        const ctx = canvas.getContext('2d');
        const gridSize = 30;
        const tileCount = 20;
        const hudPowerup = document.getElementById('powerupHud');

        // --- Core Game class with modular managers ---
        class Game {
            constructor() {
                // basic state
                this.snake = new Snake(this, [{x:10,y:10}]);
                this.input = new InputManager(this);
                this.powerUpManager = new PowerUpManager(this);
                this.obstacleManager = new ObstacleManager(this);
                this.teleportManager = new TeleportManager(this);
                this.zoneManager = new ZoneManager(this);
                this.comboSystem = new ComboSystem(this);
                this.missionManager = new MissionManager(this);
                this.effectManager = new EffectManager(this);
                this.renderer = new Renderer(this);

                this.score = 0;
                this.level = 1;
                this.highScore = Number(localStorage.getItem('snakeHighScore') || 0);

                this.movementAccumulator = 0;
                this.gameSpeed = 150; // ms per step (lower = faster)
                this.timeScale = 1.0; // global timescale, modifiable by effects
                this.running = false;
                this.paused = false;
                this.dying = false; // during death cinematic
                this.lastTime = 0;

                // initial positions for food/bonus
                this.food = {x:15,y:15};
                this.bonus = null; // {x,y, timer}
                this.updateHUD();
            }

            start() {
                if (this.running) return;
                this.reset();
                this.obstacleManager.generateObstacles();
                this.placeFood();
                this.powerUpManager.reset();
                this.teleportManager.ensurePairs();
                this.running = true;
                this.paused = false;
                this.dying = false;
                this.lastTime = performance.now();
                requestAnimationFrame(this.loop.bind(this));
            }

            reset() {
                this.snake.reset([{x:10,y:10}]);
                this.score = 0;
                this.level = 1;
                this.gameSpeed = 150;
                this.movementAccumulator = 0;
                this.zoneManager.reset();
                this.obstacleManager.reset();
                this.teleportManager.reset();
                this.comboSystem.reset();
                this.missionManager.reset();
                document.getElementById('score').textContent = this.score;
                document.getElementById('level').textContent = this.level;
                document.getElementById('highScore').textContent = this.highScore;
            }

            loop(now) {
                if (!this.running) return;
                const rawDelta = Math.min(60, (now - this.lastTime)); // cap delta to avoid big jumps
                this.lastTime = now;
                if (!this.paused) {
                    const scaledDelta = rawDelta * this.timeScale;
                    // update managers that run each frame
                    this.effectManager.update(rawDelta); // effect manager uses raw time for easing
                    this.powerUpManager.update(rawDelta);
                    this.obstacleManager.update(rawDelta);
                    this.teleportManager.update(rawDelta);
                    this.zoneManager.update(rawDelta);
                    this.input.update(rawDelta);
                    this.movementAccumulator += scaledDelta;

                    // step movement when enough ms accumulated
                    while (this.movementAccumulator >= this.gameSpeed) {
                        this.movementAccumulator -= this.gameSpeed;
                        if (!this.dying) this.step(); // single movement step
                    }

                    // after step updates
                    this.comboSystem.update(rawDelta);
                    this.missionManager.update(rawDelta);
                }

                // render
                this.renderer.render(ctx);
                requestAnimationFrame(this.loop.bind(this));
            }

            step() {
                // --- FIX: do not step (and therefore not compute a head that equals the current head)
                // if snake is stationary (velocity 0,0), skip movement step
                const dir = this.snake.velocity;
                if (dir.x === 0 && dir.y === 0) {
                    return;
                }

                // compute new head
                const head = {x: this.snake.segments[0].x + dir.x, y: this.snake.segments[0].y + dir.y};

                // check zone bounds
                if (!this.zoneManager.isInside(head.x, head.y)) {
                    this.startDeathSequence('wall');
                    return;
                }

                // check wall collisions (obstacles)
                if (!this.snake.invincible) {
                    if (this.obstacleManager.collides(head)) {
                        this.startDeathSequence('obstacle');
                        return;
                    }
                }

                // self collision
                if (!this.snake.invincible) {
                    if (this.snake.collidesWith(head)) {
                        this.startDeathSequence('self');
                        return;
                    }
                }

                // teleport handling - if tile has teleport, apply before placing head into segments
                const teleport = this.teleportManager.getTeleportAt(head.x, head.y);
                if (teleport) {
                    const dest = this.teleportManager.getPairedPosition(teleport.id);
                    if (dest) {
                        // find nearest safe tile at dest if occupied
                        const safe = this.findNearestSafe(dest.x, dest.y);
                        if (!safe) {
                            // no safe place -> death
                            this.startDeathSequence('teleport');
                            return;
                        }
                        head.x = safe.x;
                        head.y = safe.y;
                        // optionally rotate direction to match orientation - keep same velocity for simplicity
                    }
                }

                // push new head
                this.snake.unshiftHead(head);

                // food
                if (head.x === this.food.x && head.y === this.food.y) {
                    const base = 10;
                    const multiplier = this.comboSystem.getMultiplier();
                    const golden = this.powerUpManager.hasActive('golden') ? 2 : 1;
                    const gained = Math.floor(base * multiplier * golden);
                    this.addScore(gained);
                    this.snake.grow(1); // growth already implicit by not popping
                    this.placeFood();
                    this.powerUpManager.maybeSpawnOnEat();
                    this.comboSystem.onFoodEaten();
                    this.missionManager.emit({type:'eat', subtype:'apple', x: head.x, y: head.y});
                    // level up logic when score crosses multiples of 50 (keeps original behavior)
                    if (this.score % 50 === 0) {
                        this.levelUp();
                    }
                } else {
                    // not eating: normal move -> remove tail
                    this.snake.popTail();
                }

                // bonus (gold star) pickup
                if (this.bonus && head.x === this.bonus.x && head.y === this.bonus.y) {
                    this.addScore(50);
                    this.showBonusNotification();
                    this.bonus = null;
                    this.missionManager.emit({type:'eat', subtype:'bonus', x: head.x, y: head.y});
                }

                // check power-up pickups (powerups placed as items on grid)
                const pu = this.powerUpManager.getAt(head.x, head.y);
                if (pu) {
                    this.powerUpManager.pickup(pu);
                }

                // check moving walls or hazards that might kill after moving (already handled by collides)
            }

            addScore(amount) {
                this.score += amount;
                document.getElementById('score').textContent = this.score;
                // update highscore display live
                if (this.score > this.highScore) {
                    document.getElementById('highScore').textContent = this.score;
                }
            }

            levelUp() {
                this.level++;
                document.getElementById('level').textContent = this.level;
                // speed up slightly each level
                this.gameSpeed = Math.max(50, 150 - this.level * 8);
                // dynamic map changes every 5-10 levels: use 5 for predictability
                if (this.level % 5 === 0) {
                    this.obstacleManager.applyRandomPreset();
                    this.teleportManager.ensurePairs();
                    this.zoneManager.onMapChange();
                } else {
                    // refresh obstacles to increase challenge
                    this.obstacleManager.generateObstacles();
                }
            }

            placeFood() {
                let tries = 0;
                do {
                    this.food.x = Math.floor(Math.random() * tileCount);
                    this.food.y = Math.floor(Math.random() * tileCount);
                    tries++;
                    if (tries > 500) break;
                } while (!this.isTileFree(this.food.x, this.food.y));
            }

            isTileFree(x,y) {
                // not on snake, obstacles, teleport, powerups, outside zone
                if (!this.zoneManager.isInside(x,y)) return false;
                if (this.snake.segments.some(s => s.x===x && s.y===y)) return false;
                if (this.obstacleManager.collides({x,y})) return false;
                if (this.teleportManager.getTeleportAt(x,y)) return false;
                if (this.powerUpManager.getAt(x,y)) return false;
                return true;
            }

            findNearestSafe(x,y) {
                // BFS up to small radius to find free tile inside zone
                const maxRadius = 3;
                const dirs = [{x:0,y:0},{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},
                              {x:1,y:1},{x:1,y:-1},{x:-1,y:1},{x:-1,y:-1}];
                for (let r=0;r<=maxRadius;r++) {
                    for (let dx=-r;dx<=r;dx++) {
                        for (let dy=-r;dy<=r;dy++) {
                            const nx = x+dx, ny = y+dy;
                            if (Math.abs(dx)===r || Math.abs(dy)===r) {
                                if (nx>=0 && nx<tileCount && ny>=0 && ny<tileCount && this.isTileFree(nx,ny)) {
                                    return {x:nx,y:ny};
                                }
                            }
                        }
                    }
                }
                return null;
            }

            showBonusNotification() {
                const notif = document.getElementById('bonusNotif');
                notif.style.display = 'block';
                setTimeout(() => notif.style.display = 'none', 2000);
            }

            startDeathSequence(type) {
                // use slow-motion cinematic, then finalize game over
                if (this.dying) return;
                this.dying = true;
                // stop accepting inputs
                this.input.block();
                // trigger cinematic slow-motion
                this.effectManager.slowMotion(1200, 0.12);
                // spawn death particles at head - simple particles stored in renderer
                this.renderer.spawnDeathEffect(this.snake.segments[0]);
                // finalize after cinematic
                setTimeout(()=> {
                    this.finalizeGameOver();
                }, 1200);
            }

            finalizeGameOver() {
                this.running = false;
                this.dying = false;
                // update & persist high score
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
                this.start();
            }

            updateHUD() {
                document.getElementById('score').textContent = this.score;
                document.getElementById('level').textContent = this.level;
                document.getElementById('highScore').textContent = this.highScore;
            }
        }

        // --- Snake class ---
        class Snake {
            constructor(game, segments) {
                this.game = game;
                this.segments = segments.slice();
                this.velocity = {x:0,y:0};
                this.growAmount = 0;
                this.invincible = false;
                this.reverseControls = false;
            }
            reset(segments) {
                this.segments = segments.slice();
                this.velocity = {x:0,y:0};
                this.growAmount = 0;
                this.invincible = false;
                this.reverseControls = false;
            }
            setInvincible(v) { this.invincible = v; }
            setReverse(v) { this.reverseControls = v; }
            unshiftHead(head) { this.segments.unshift(head); }
            popTail() { if (this.growAmount>0) { this.growAmount--; } else { this.segments.pop(); } }
            grow(n=1) { this.growAmount += n; }
            shrink(n=1) {
                this.segments.splice(-n, n);
                if (this.segments.length < 2) {
                    // ensure minimum length
                    while (this.segments.length < 2) this.segments.push({...this.segments[this.segments.length-1]});
                }
            }
            collidesWith(pos) {
                for (let i=0;i<this.segments.length;i++) {
                    if (this.segments[i].x===pos.x && this.segments[i].y===pos.y) return true;
                }
                return false;
            }
        }

        // --- Input manager ---
        class InputManager {
            constructor(game) {
                this.game = game;
                this.blocked = false;
                // listen
                document.addEventListener('keydown', this.onKey.bind(this));
            }
            onKey(e) {
                const game = this.game;
                if (!game.running && ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','w','a','s','d','W','A','S','D'].includes(e.key)) {
                    game.start();
                }
                if (!game.running || this.blocked) return;
                // map keys with reverse control support
                const snake = game.snake;
                const rev = snake.reverseControls;
                const mapKey = (k) => {
                    if (!rev) return k;
                    // inverted mapping when reverse controls active
                    const map = {
                        'ArrowUp':'ArrowDown',
                        'ArrowDown':'ArrowUp',
                        'ArrowLeft':'ArrowRight',
                        'ArrowRight':'ArrowLeft',
                        'w':'s','W':'s','s':'w','S':'w','a':'d','A':'d','d':'a','D':'a'
                    };
                    return map[k] || k;
                };
                const key = mapKey(e.key);
                switch (key) {
                    case 'ArrowUp':
                    case 'w':
                        if (snake.velocity.y !== 1) snake.velocity = {x:0,y:-1};
                        break;
                    case 'ArrowDown':
                    case 's':
                        if (snake.velocity.y !== -1) snake.velocity = {x:0,y:1};
                        break;
                    case 'ArrowLeft':
                    case 'a':
                        if (snake.velocity.x !== 1) snake.velocity = {x:-1,y:0};
                        break;
                    case 'ArrowRight':
                    case 'd':
                        if (snake.velocity.x !== -1) snake.velocity = {x:1,y:0};
                        break;
                }
                // if velocity was zero and now non-zero, movement will happen in next step automatically
                e.preventDefault();
            }
            update() { /* reserved for touch/virtual controls */ }
            block() { this.blocked = true; }
            unblock() { this.blocked = false; }
        }

        // --- PowerUp system ---
        class PowerUpManager {
            constructor(game) {
                this.game = game;
                this.active = []; // active timed powerups
                this.items = []; // placed powerups on map {x,y,type}
                this.spawnTimer = 0;
                this.spawnInterval = 8000; // ms
            }
            reset() {
                this.active = [];
                this.items = [];
                this.spawnTimer = 2000;
                this.updateHud();
            }
            update(delta) {
                // spawn logic (randomized)
                this.spawnTimer -= delta;
                if (this.spawnTimer <= 0) {
                    this.spawnTimer = Math.max(4000, 8000 - this.game.level*200) + Math.random()*4000;
                    this.spawnRandomItem();
                }

                // update active timed powerups
                for (let i = this.active.length-1; i>=0; i--) {
                    const p = this.active[i];
                    p.timer -= delta;
                    if (p.timer <= 0) {
                        p.end();
                        this.active.splice(i,1);
                        this.updateHud();
                    }
                }
            }
            spawnRandomItem() {
                // choose weighted random type
                const pool = [
                    {type:'speed', w:30},
                    {type:'slow', w:20},
                    {type:'reverse', w:12},
                    {type:'invincible', w:8},
                    {type:'golden', w:10},
                    {type:'purple', w:5}
                ];
                const total = pool.reduce((s,p)=>s+p.w,0);
                let r = Math.random()*total;
                let choice = pool.find(p => (r -= p.w) <= 0).type;
                // place on free tile
                let tries = 0;
                while (tries < 200) {
                    const x = Math.floor(Math.random()*tileCount);
                    const y = Math.floor(Math.random()*tileCount);
                    if (this.game.isTileFree(x,y)) {
                        this.items.push({x,y,type:choice});
                        return;
                    }
                    tries++;
                }
            }
            getAt(x,y) {
                return this.items.find(it => it.x===x && it.y===y);
            }
            pickup(item) {
                // remove item
                const idx = this.items.indexOf(item);
                if (idx>=0) this.items.splice(idx,1);
                // apply effect
                switch(item.type) {
                    case 'speed': this.activate(new SpeedBoost(this.game)); break;
                    case 'slow': this.activate(new SlowMotion(this.game)); break;
                    case 'reverse': this.activate(new ReverseControls(this.game)); break;
                    case 'invincible': this.activate(new Invincibility(this.game)); break;
                    case 'golden': this.activate(new GoldenApple(this.game)); break;
                    case 'purple': this.activate(new PurpleOrb(this.game)); break;
                }
                this.updateHud();
            }
            activate(powerup) {
                // instant effect or timed
                powerup.start();
                if (powerup.timer && powerup.timer>0) {
                    this.active.push(powerup);
                } else {
                    // immediate/one-shot - nothing to keep
                }
                this.updateHud();
            }
            hasActive(name) {
                return this.active.some(p => p.name === name);
            }
            maybeSpawnOnEat() {
                // 30% chance to spawn a bonus golden star near food
                if (Math.random() < 0.3) {
                    let tries = 0;
                    while (tries < 200) {
                        const x = Math.floor(Math.random()*tileCount);
                        const y = Math.floor(Math.random()*tileCount);
                        if (this.game.isTileFree(x,y)) {
                            this.game.bonus = {x,y,timer:5000};
                            // we'll store only one bonus at a time; renderer uses game.bonus
                            break;
                        }
                        tries++;
                    }
                }
            }
            updateHud() {
                hudPowerup.innerHTML = '';
                // show active powerups with timers
                for (const p of this.active) {
                    const div = document.createElement('div');
                    div.className = 'powerup-icon';
                    div.title = p.name;
                    const label = p.name[0].toUpperCase();
                    div.textContent = label;
                    hudPowerup.appendChild(div);
                }
            }
        }

        // Base powerup class and implementations
        class PowerUpBase {
            constructor(game, name, duration=3000) {
                this.game = game;
                this.name = name;
                this.timer = duration;
            }
            start() {}
            end() {}
        }

        class SpeedBoost extends PowerUpBase {
            constructor(game) { super(game,'speed',3000); this.origSpeed = null; }
            start() {
                this.origSpeed = this.game.gameSpeed;
                this.game.gameSpeed = Math.max(30, Math.floor(this.origSpeed*0.6));
                this.game.renderer.addEffect({type:'snakeGlow', color:'#00ffff'});
            }
            end() {
                if (this.origSpeed) this.game.gameSpeed = this.origSpeed;
                this.game.renderer.removeEffect('snakeGlow');
            }
        }

        class SlowMotion extends PowerUpBase {
            constructor(game) { super(game,'slow',2000); this.origScale=1; }
            start() {
                this.origScale = this.game.timeScale;
                this.game.effectManager.pushTimeScale(0.45, 300, 2000); // target, ease in, duration
                this.game.renderer.addEffect({type:'screenDesaturate'});
            }
            end() {
                // effect manager will pop scale automatically (no explicit revert needed)
                this.game.renderer.removeEffect('screenDesaturate');
            }
        }

        class ReverseControls extends PowerUpBase {
            constructor(game) { super(game,'reverse',4000); }
            start() {
                this.game.snake.setReverse(true);
                this.game.renderer.addEffect({type:'screenTilt'});
            }
            end() {
                this.game.snake.setReverse(false);
                this.game.renderer.removeEffect('screenTilt');
            }
        }

        class Invincibility extends PowerUpBase {
            constructor(game) { super(game,'invincible',2500); }
            start() {
                this.game.snake.setInvincible(true);
                this.game.renderer.addEffect({type:'goldShimmer'});
            }
            end() {
                this.game.snake.setInvincible(false);
                this.game.renderer.removeEffect('goldShimmer');
            }
        }

        class GoldenApple extends PowerUpBase {
            constructor(game) { super(game,'golden',8000); }
            start() {
                // adds double score by interacting with combo scoring
                this.game.renderer.addEffect({type:'goldTint'});
            }
            end() {
                this.game.renderer.removeEffect('goldTint');
            }
        }

        class PurpleOrb extends PowerUpBase {
            constructor(game) { super(game,'purple',0); } // instant effect
            start() {
                // shrink snake proportional to length
                const n = Math.min(Math.max(1, Math.floor(this.game.snake.segments.length/4)), 8);
                this.game.snake.shrink(n);
                this.game.renderer.spawnShrinkEffect();
            }
            end() {}
        }

        // --- Obstacle Manager (static + moving walls) ---
        class ObstacleManager {
            constructor(game) {
                this.game = game;
                this.tiles = []; // array of {x,y}
                this.movingWalls = []; // array of {id, path:[{x,y}], speed, progress}
            }
            reset() {
                this.tiles = [];
                this.movingWalls = [];
            }
            generateObstacles() {
                // keep much of original generateObstacles logic but simplified
                this.tiles = [];
                const level = this.game.level;
                const obstacleCount = Math.min(Math.floor(level * 2), 12);
                
                const shapes = [
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:3,y:0}],
                    [{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:0,y:3}],
                    [{x:0,y:0},{x:1,y:0},{x:0,y:1},{x:1,y:1}],
                    [{x:0,y:0},{x:0,y:1},{x:0,y:2},{x:1,y:2}],
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:1,y:1}],
                    [{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1}]
                ];

                for (let i=0;i<obstacleCount;i++) {
                    let attempts = 0;
                    let valid=false;
                    let shape = shapes[Math.floor(Math.random()*shapes.length)];
                    let baseX, baseY;
                    do {
                        baseX = 2 + Math.floor(Math.random() * (tileCount - 8));
                        baseY = 2 + Math.floor(Math.random() * (tileCount - 8));
                        valid = true;
                        attempts++;
                        for (let t of shape) {
                            const x = baseX + t.x, y = baseY + t.y;
                            if (!this.game.zoneManager.isInside(x,y)) { valid=false; break; }
                            if (Math.abs(x-10)<5 && Math.abs(y-10)<5) { valid=false; break; }
                            if (this.game.snake.segments.some(s=>s.x===x && s.y===y)) { valid=false; break; }
                            if (this.tiles.some(o=>o.x===x && o.y===y)) { valid=false; break; }
                            if (x===this.game.food.x && y===this.game.food.y) { valid=false; break; }
                        }
                        if (attempts>200) break;
                    } while(!valid);
                    if (valid) {
                        for (let t of shape) this.tiles.push({x: baseX+t.x, y: baseY+t.y});
                    }
                }

                // occasionally add moving walls as separate obstacles
                if (Math.random() < 0.4) {
                    this.createMovingWall();
                }
            }

            createMovingWall() {
                // create a short 3-tile wall that oscillates
                const tries = 100;
                for (let i=0;i<tries;i++) {
                    const x = 2 + Math.floor(Math.random()*(tileCount-4));
                    const y = 2 + Math.floor(Math.random()*(tileCount-4));
                    if (!this.game.snake.segments.some(s=>s.x===x && s.y===y) && this.game.zoneManager.isInside(x,y)) {
                        const horizontal = Math.random() < 0.5;
                        const path = [];
                        for (let p=0;p<3;p++) path.push({x: x + (horizontal?p:0), y: y + (horizontal?0:p)});
                        const id = Date.now() + Math.random();
                        this.movingWalls.push({id,path,speed: (0.5 + Math.random()*1.5)*1000, offset:0});
                        return;
                    }
                }
            }

            applyRandomPreset() {
                // simple presets: dense obstacles, moving walls heavy, teleporters added
                const presets = ['dense','moving','sparse','maze'];
                const pick = presets[Math.floor(Math.random()*presets.length)];
                if (pick==='dense') {
                    this.tiles = [];
                    for (let i=0;i<40;i++) {
                        const x = 1 + Math.floor(Math.random()*(tileCount-2));
                        const y = 1 + Math.floor(Math.random()*(tileCount-2));
                        if (this.game.isTileFree(x,y)) this.tiles.push({x,y});
                    }
                } else if (pick==='moving') {
                    this.tiles = [];
                    this.movingWalls = [];
                    for (let i=0;i<3;i++) this.createMovingWall();
                } else if (pick==='sparse') {
                    this.tiles = [];
                    this.movingWalls = [];
                } else if (pick==='maze') {
                    this.tiles = [];
                    // create some long walls
                    for (let r=2;r<tileCount-2;r+=4) {
                        for (let c=2;c<tileCount-2;c++) {
                            if (Math.random() < 0.6 && this.game.zoneManager.isInside(c,r)) this.tiles.push({x:c,y:r});
                        }
                    }
                }
            }

            update(delta) {
                // update moving walls progress and set their current tiles
                // moving walls follow simple oscillation along their path
                // (no interpolation in tiles - they teleport between points per speed)
                for (const mw of this.movingWalls) {
                    mw.offset += delta;
                    const step = Math.floor((mw.offset / mw.speed)) % mw.path.length;
                    // place the wall tile at that index and adjacent tiles to form a short block
                    // we'll rebuild tiles set as union of static tiles + moving walls
                }
            }

            collides(pos) {
                // check static tiles
                if (this.tiles.some(t=>t.x===pos.x && t.y===pos.y)) return true;
                // check moving walls - project current positions
                for (const mw of this.movingWalls) {
                    const idx = Math.floor((mw.offset / mw.speed)) % mw.path.length;
                    const p = mw.path[idx];
                    if (!p) continue;
                    // consider the 3-tile wall center p
                    if (p.x === pos.x && p.y === pos.y) return true;
                }
                // zone holes or hazards can be handled elsewhere
                return false;
            }

            allTiles() {
                const moving = [];
                for (const mw of this.movingWalls) {
                    const idx = Math.floor((mw.offset / mw.speed)) % mw.path.length;
                    const p = mw.path[idx];
                    if (p) moving.push(p);
                }
                return this.tiles.concat(moving);
            }
        }

        // --- Teleport (paired holes) ---
        class TeleportManager {
            constructor(game) {
                this.game = game;
                this.pairs = []; // [{id, a:{x,y}, b:{x,y}}]
            }
            reset() { this.pairs = []; }
            ensurePairs() {
                // ensure a small number of teleport pairs exist
                if (this.pairs.length >= 2) return;
                while (this.pairs.length < 2) {
                    const a = this.randomFree();
                    const b = this.randomFree();
                    if (a && b) this.pairs.push({id:Date.now()+Math.random(), a,b});
                }
            }
            randomFree() {
                let tries=0;
                while (tries<200) {
                    const x = 1 + Math.floor(Math.random()*(tileCount-2));
                    const y = 1 + Math.floor(Math.random()*(tileCount-2));
                    if (this.game.isTileFree(x,y)) return {x,y};
                    tries++;
                }
                return null;
            }
            getTeleportAt(x,y) {
                for (const p of this.pairs) {
                    if (p.a.x===x && p.a.y===y) return {id:p.id, pos:'a'};
                    if (p.b.x===x && p.b.y===y) return {id:p.id, pos:'b'};
                }
                return null;
            }
            getPairedPosition(id) {
                const p = this.pairs.find(x=>x.id===id);
                if (!p) return null;
                return {x: p.a.x === p.a.x ? p.b.x : p.a.x, y: p.a.y === p.a.y ? p.b.y : p.a.y}; // simplified: pick b
            }
            update() {}
        }

        // --- Zone manager (shrinking play area) ---
        class ZoneManager {
            constructor(game) {
                this.game = game;
                this.inset = 0;
                this.shrinkTimer = 0;
                this.shrinkInterval = 20000; // ms between shrink steps
            }
            reset() {
                this.inset = 0;
                this.shrinkTimer = 0;
            }
            update(delta) {
                // slowly shrink over time only in later levels
                if (this.game.level >= 4) {
                    this.shrinkTimer += delta;
                    if (this.shrinkTimer >= this.shrinkInterval) {
                        this.shrinkTimer = 0;
                        this.shrinkStep();
                    }
                }
            }
            shrinkStep() {
                // inset one tile from each edge, but never make play area less than 6x6
                const maxInset = Math.floor((tileCount - 6)/2);
                if (this.inset < maxInset) {
                    this.inset++;
                    // when zone shrinks, remove obstacles outside and ensure snake is inside
                    // if snake head outside, kill it (but give small grace)
                    const head = this.game.snake.segments[0];
                    if (!this.isInside(head.x, head.y)) {
                        // try to move head inward
                        const safe = this.game.findNearestSafe(Math.floor(tileCount/2), Math.floor(tileCount/2));
                        if (safe) { head.x = safe.x; head.y = safe.y; }
                        else this.game.startDeathSequence('zone');
                    }
                }
            }
            isInside(x,y) {
                return x >= this.inset && x < tileCount - this.inset && y >= this.inset && y < tileCount - this.inset;
            }
            onMapChange() {
                // when map changes drastically, possibly adjust inset or timers slightly
                this.shrinkTimer = Math.max(0, this.shrinkTimer - 4000);
            }
        }

        // --- Combo system ---
        class ComboSystem {
            constructor(game) {
                this.game = game;
                this.timestamps = []; // ms times of eats
                this.window = 6000; // ms window to count quick eats
                this.comboCount = 0; // number of times triggered
                this.activeMultiplier = 1;
            }
            reset() {
                this.timestamps = [];
                this.comboCount = 0;
                this.activeMultiplier = 1;
            }
            onFoodEaten() {
                const t = performance.now();
                this.timestamps.push(t);
                // remove old
                this.timestamps = this.timestamps.filter(ts => t - ts <= this.window);
                if (this.timestamps.length >= 3) {
                    // increase combo
                    this.comboCount++;
                    this.activeMultiplier = Math.min(1 + this.comboCount, 4); // cap 4x
                    // clear timestamps so next combo requires fresh eats (or reduce)
                    this.timestamps = [];
                    this.game.renderer.spawnComboEffect(this.activeMultiplier);
                    // short timer to decay multiplier
                    setTimeout(()=> {
                        this.activeMultiplier = 1;
                        this.comboCount = 0;
                    }, 5000);
                }
            }
            update() {}
            getMultiplier() {
                // multiplicative with golden apple handled elsewhere
                return this.activeMultiplier;
            }
        }

        // --- Mission Manager (simple example) ---
        class Mission {
            constructor(spec) {
                this.id = spec.id;
                this.description = spec.description;
                this.targetType = spec.targetType; // e.g. 'eat'
                this.subType = spec.subType || null;
                this.targetCount = spec.targetCount || 0;
                this.progress = 0;
                this.constraints = spec.constraints || {};
                this.reward = spec.reward || {};
                this.active = true;
            }
            track(event) {
                if (!this.active) return;
                if (this.targetType === 'eat' && event.type === 'eat') {
                    if (this.subType && event.subtype !== this.subType) return;
                    // check constraints
                    if (this.constraints.resetOnWallTouch && event.type === 'wallTouch') {
                        this.progress = 0; return;
                    }
                    this.progress++;
                }
            }
            isComplete() { return this.progress >= this.targetCount; }
        }

        class MissionManager {
            constructor(game) {
                this.game = game;
                this.activeMissions = [];
                // add a sample mission: 'Eat 10 apples without touching walls'
                this.activeMissions.push(new Mission({
                    id:'M1',
                    description: 'Mangez 10 pommes sans toucher un mur',
                    targetType: 'eat',
                    subType: 'apple',
                    targetCount: 10,
                    constraints: { resetOnWallTouch: true },
                    reward: { score: 500, powerup: 'invincible' }
                }));
            }
            reset() {
                this.activeMissions.forEach(m => m.progress = 0);
            }
            update() {
                // check completions
                for (const m of this.activeMissions) {
                    if (m.active && m.isComplete()) {
                        m.active = false;
                        this.reward(m);
                    }
                }
            }
            emit(event) {
                for (const m of this.activeMissions) {
                    m.track(event);
                }
            }
            reward(m) {
                // simple reward: add score and activate powerup
                if (m.reward.score) this.game.addScore(m.reward.score);
                if (m.reward.powerup) {
                    // spawn immediate powerup
                    this.game.powerUpManager.activate(new Invincibility(this.game));
                }
                // show small HUD toast (renderer)
                this.game.renderer.showMissionComplete(m.description);
            }
        }

        // --- Effect Manager (handles global timeScale & easing) ---
        class EffectManager {
            constructor(game) {
                this.game = game;
                this.timeScaleStack = []; // stores pushed scales with expiration
                this.currentScale = 1;
                this.tween = null; // for smooth transitions
            }
            pushTimeScale(targetScale, easeMs = 100, duration = 1000) {
                // push a timescale effect that lasts duration and then reverts
                const entry = {target: targetScale, endAt: performance.now() + duration, easeMs};
                this.timeScaleStack.push(entry);
                // apply immediately by tweening
                this.tweenTo(targetScale, easeMs);
                // schedule pop
                setTimeout(()=> {
                    // remove this entry
                    const idx = this.timeScaleStack.indexOf(entry);
                    if (idx>=0) this.timeScaleStack.splice(idx,1);
                    // compute new target (top of stack or 1)
                    const newTarget = this.timeScaleStack.length ? this.timeScaleStack[this.timeScaleStack.length-1].target : 1.0;
                    this.tweenTo(newTarget, 200);
                }, duration);
            }
            tweenTo(target, duration) {
                const start = performance.now();
                const from = this.game.timeScale;
                const d = Math.max(1,duration);
                const step = () => {
                    const now = performance.now();
                    const t = Math.min(1,(now - start)/d);
                    this.game.timeScale = from + (target - from) * t;
                    if (t < 1) requestAnimationFrame(step);
                };
                step();
            }
            slowMotion(durationMs=1000, factor=0.15) {
                this.pushTimeScale(factor, 40, durationMs);
            }
            update() {}
        }

        // --- Renderer: draws everything, handles visual effects & particles ---
        class Renderer {
            constructor(game) {
                this.game = game;
                this.effects = new Set();
                this.particles = [];
                this.comboParticles = [];
            }
            addEffect(e) { this.effects.add(e.type || e); }
            removeEffect(type) {
                if (typeof type === 'string') {
                    for (const e of Array.from(this.effects)) {
                        if (e === type) this.effects.delete(e);
                    }
                } else if (type && type.type) {
                    this.effects.delete(type.type);
                }
            }
            render(ctx) {
                // clear
                ctx.clearRect(0,0,canvas.width,canvas.height);
                // background
                ctx.fillStyle = '#000';
                ctx.fillRect(0,0,canvas.width,canvas.height);

                // subtle grid
                ctx.strokeStyle = 'rgba(0,255,0,0.05)';
                for (let i=0;i<=tileCount;i++){
                    ctx.beginPath();
                    ctx.moveTo(i*gridSize,0); ctx.lineTo(i*gridSize,canvas.height); ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(0,i*gridSize); ctx.lineTo(canvas.width,i*gridSize); ctx.stroke();
                }

                // draw zone overlay for shrinking area
                this.drawZone(ctx);

                // draw obstacles
                ctx.save();
                ctx.shadowBlur = 12;
                ctx.shadowColor = '#00aa00';
                ctx.fillStyle = 'rgba(0,100,0,0.7)';
                for (const obs of this.game.obstacleManager.allTiles()) {
                    ctx.fillRect(obs.x*gridSize, obs.y*gridSize, gridSize, gridSize);
                    ctx.strokeStyle = '#00aa00';
                    ctx.lineWidth = 3;
                    ctx.strokeRect(obs.x*gridSize, obs.y*gridSize, gridSize, gridSize);
                }
                ctx.restore();

                // draw teleporters
                this.game.teleportManager.pairs.forEach(p => {
                    this.drawPortal(ctx, p.a.x, p.a.y, '#7f00ff');
                    this.drawPortal(ctx, p.b.x, p.b.y, '#ff7f00');
                });

                // draw food
                ctx.save();
                ctx.shadowBlur = 15; ctx.shadowColor = '#ff0000'; ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(this.game.food.x*gridSize + gridSize/2, this.game.food.y*gridSize + gridSize/2, gridSize/2 - 2, 0, Math.PI*2);
                ctx.fill();
                ctx.restore();

                // draw bonus star
                if (this.game.bonus) {
                    ctx.save();
                    ctx.globalAlpha = 0.9;
                    ctx.shadowBlur = 18; ctx.shadowColor = '#ffff00'; ctx.fillStyle = '#ffff00';
                    const b = this.game.bonus;
                    ctx.beginPath();
                    for (let i=0;i<5;i++){
                        const angle = (Math.PI*2*i)/5 - Math.PI/2;
                        const x = b.x*gridSize + gridSize/2 + Math.cos(angle)*(gridSize/2 - 4);
                        const y = b.y*gridSize + gridSize/2 + Math.sin(angle)*(gridSize/2 - 4);
                        if (i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
                        const angle2 = (Math.PI*2*(i+0.5))/5 - Math.PI/2;
                        const x2 = b.x*gridSize + gridSize/2 + Math.cos(angle2)*(gridSize/4);
                        const y2 = b.y*gridSize + gridSize/2 + Math.sin(angle2)*(gridSize/4);
                        ctx.lineTo(x2,y2);
                    }
                    ctx.closePath(); ctx.fill();
                    ctx.restore();
                }

                // draw snake segments with effects
                this.drawSnake(ctx);

                // draw powerups items on map
                for (const item of this.game.powerUpManager.items) {
                    this.drawPowerupIcon(ctx, item);
                }

                // draw particles
                this.updateAndDrawParticles(ctx);

                // draw HUD overlays (score etc are DOM elements)
            }

            drawZone(ctx) {
                const zm = this.game.zoneManager;
                if (zm.inset === 0) return;
                ctx.save();
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                // top
                ctx.fillRect(0,0,canvas.width, zm.inset*gridSize);
                // bottom
                ctx.fillRect(0, (tileCount-zm.inset)*gridSize, canvas.width, zm.inset*gridSize);
                // left
                ctx.fillRect(0, zm.inset*gridSize, zm.inset*gridSize, (tileCount-2*zm.inset)*gridSize);
                // right
                ctx.fillRect((tileCount-zm.inset)*gridSize, zm.inset*gridSize, zm.inset*gridSize, (tileCount-2*zm.inset)*gridSize);
                ctx.restore();
            }

            drawPortal(ctx, x, y, color) {
                ctx.save();
                ctx.translate(x*gridSize + gridSize/2, y*gridSize + gridSize/2);
                ctx.rotate((Date.now() % 3600) / 3600 * Math.PI*2);
                ctx.globalAlpha = 0.85;
                const g = ctx.createRadialGradient(0,0,2,0,0,gridSize/2);
                g.addColorStop(0,'rgba(255,255,255,0.9)');
                g.addColorStop(0.6,color);
                g.addColorStop(1,'rgba(0,0,0,0.2)');
                ctx.fillStyle = g;
                ctx.beginPath(); ctx.arc(0,0,gridSize/2 - 2, 0, Math.PI*2); ctx.fill();
                ctx.restore();
            }

            drawSnake(ctx) {
                const segments = this.game.snake.segments;
                for (let i=segments.length-1;i>=0;i--) {
                    const s = segments[i];
                    const gradient = ctx.createLinearGradient(s.x*gridSize, s.y*gridSize, s.x*gridSize + gridSize, s.y*gridSize + gridSize);
                    if (i===0) {
                        gradient.addColorStop(0, '#00ff88'); gradient.addColorStop(1, '#00cc66');
                        ctx.shadowBlur = 20;
                    } else {
                        gradient.addColorStop(0, '#4CAF50'); gradient.addColorStop(1, '#45a049');
                        ctx.shadowBlur = 12;
                    }
                    ctx.shadowColor = '#00ff00';
                    ctx.fillStyle = gradient;
                    ctx.fillRect(s.x*gridSize + 1, s.y*gridSize + 1, gridSize - 2, gridSize - 2);
                    ctx.strokeStyle = i===0 ? '#00ff88' : '#66BB6A';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(s.x*gridSize + 1, s.y*gridSize + 1, gridSize - 2, gridSize - 2);
                }
                ctx.shadowBlur = 0;
            }

            drawPowerupIcon(ctx, item) {
                ctx.save();
                const x = item.x * gridSize, y = item.y * gridSize;
                if (item.type === 'speed') {
                    ctx.fillStyle = '#00ffff';
                } else if (item.type === 'slow') {
                    ctx.fillStyle = '#88ccff';
                } else if (item.type === 'reverse') {
                    ctx.fillStyle = '#ff88ff';
                } else if (item.type === 'invincible') {
                    ctx.fillStyle = '#ffd700';
                } else if (item.type === 'golden') {
                    ctx.fillStyle = '#ffcc33';
                } else if (item.type === 'purple') {
                    ctx.fillStyle = '#b366ff';
                } else ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(x + gridSize/2, y + gridSize/2, gridSize/3, 0, Math.PI*2);
                ctx.fill();
                ctx.restore();
            }

            spawnDeathEffect(pos) {
                // create burst of particles at pos
                for (let i=0;i<30;i++) {
                    const angle = Math.random()*Math.PI*2;
                    const speed = 0.05 + Math.random()*0.15;
                    this.particles.push({
                        x: pos.x*gridSize + gridSize/2,
                        y: pos.y*gridSize + gridSize/2,
                        vx: Math.cos(angle)*speed*gridSize,
                        vy: Math.sin(angle)*speed*gridSize,
                        life: 800 + Math.random()*600,
                        color: 'rgba(255,50,50,0.9)'
                    });
                }
            }

            spawnShrinkEffect() {
                // small purple pops across snake body
                for (let i=0;i<12;i++) {
                    this.particles.push({
                        x: (Math.random()*tileCount)*gridSize,
                        y: (Math.random()*tileCount)*gridSize,
                        vx: 0, vy:0,
                        life: 400 + Math.random()*400,
                        color: 'rgba(180,80,255,0.9)'
                    });
                }
            }

            spawnComboEffect(mult) {
                // ephemeral center pop
                this.comboParticles.push({mult, life: 1200, start: performance.now()});
            }

            showMissionComplete(text) {
                // simple toast using bonusNotif
                const notif = document.getElementById('bonusNotif');
                notif.textContent = 'Mission complète! ' + text;
                notif.style.display = 'block';
                setTimeout(()=> { notif.style.display='none'; notif.textContent = '+50 Points Bonus! 🌟'; }, 3000);
            }

            updateAndDrawParticles(ctx) {
                const now = performance.now();
                // update particles
                for (let i = this.particles.length-1; i>=0;i--) {
                    const p = this.particles[i];
                    p.life -= 16; // approx per-frame
                    p.x += p.vx;
                    p.y += p.vy;
                    p.vx *= 0.98; p.vy *= 0.98;
                    const alpha = Math.max(0, p.life/1000);
                    ctx.fillStyle = p.color.replace(/[\d\.]+\)$/,'') + alpha + ')';
                    ctx.beginPath(); ctx.arc(p.x,p.y,3,0,Math.PI*2); ctx.fill();
                    if (p.life <= 0) this.particles.splice(i,1);
                }
                // combo particles (big screen text)
                for (let i = this.comboParticles.length-1; i>=0;i--) {
                    const c = this.comboParticles[i];
                    const t = (now - c.start) / c.life;
                    if (t > 1) { this.comboParticles.splice(i,1); continue; }
                    ctx.save();
                    ctx.globalAlpha = 1 - t;
                    ctx.fillStyle = '#ffdd55';
                    ctx.font = 'bold 40px monospace';
                    ctx.fillText(`${c.mult}x COMBO!`, canvas.width/2 - 100, canvas.height/3);
                    ctx.restore();
                }
            }
        }

        // --- Instantiate and wire UI buttons ---
        const game = new Game();

        document.getElementById('startBtn').addEventListener('click', ()=> game.start());
        document.getElementById('pauseBtn').addEventListener('click', ()=> game.pauseToggle());
        document.getElementById('restartBtn').addEventListener('click', ()=> {
            if (game.running) {
                game.running = false;
                game.paused = false;
                setTimeout(()=> game.start(), 120);
            } else {
                game.start();
            }
        });

        // Expose restartGame for modal button
        window.restartGame = ()=> game.restart();

        // initial draw
        game.renderer.render(ctx);