import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getDatabase, ref, set, onValue, update, remove, push, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// === CONFIG ===
const firebaseConfig = {
    apiKey: "AIzaSyBSNd99iZQE3OawjoN0G0KAsyBOoIxUJow",
    authDomain: "my-io-game.firebaseapp.com",
    databaseURL: "https://my-io-game-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "my-io-game",
    storageBucket: "my-io-game.firebasestorage.app",
    messagingSenderId: "611910695781",
    appId: "1:611910695781:web:5124e62f4aa4139f9c7f8c"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

const TILE = 60; 
const MAP_WIDTH_TILES = 60; // Ширина карти в блоках (60x60 = 3600px)
const MAP_SIZE = MAP_WIDTH_TILES * TILE;

// === 1. БІБЛІОТЕКА СТРУКТУР (JSON-style) ===
// 1 = Стіна, 0 = Підлога (прохід)
const ROOM_PATTERNS = {
    // --- КОРИДОРИ ---
    corridor_h: [[1,1,1,1,1],[0,0,0,0,0],[0,0,0,0,0],[1,1,1,1,1]], // Горизонтальний
    corridor_v: [[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,0,0,1],[1,0,0,1]], // Вертикальний
    crossroad:  [[1,1,0,1,1],[1,1,0,1,1],[0,0,0,0,0],[1,1,0,1,1],[1,1,0,1,1]], // Перехрестя
    turn_ur:    [[1,1,0,0,0],[1,1,0,1,1],[1,1,0,1,1],[1,1,0,1,1]], // Поворот

    // --- МАЛІ КІМНАТИ ---
    box_room:   [[1,1,1,1,1],[1,0,0,0,1],[1,0,0,0,1],[1,0,0,0,0],[1,1,1,1,1]], // Кімната з одним входом
    dual_room:  [[1,1,1,1,1],[0,0,0,0,0],[1,0,1,0,1],[1,0,0,0,1],[1,1,1,1,1]], // Прохідна
    storage:    [[1,1,1,1],[1,0,0,1],[1,0,1,1],[1,0,0,1],[1,1,1,1]], // Зі стовпом

    // --- ЗАЛИ ---
    hall_pillars: [
        [1,1,1,1,1,1,1],
        [1,0,0,0,0,0,1],
        [1,0,1,0,1,0,1],
        [0,0,0,0,0,0,0],
        [1,0,1,0,1,0,1],
        [1,0,0,0,0,0,1],
        [1,1,1,1,1,1,1]
    ],
    boss_arena: [
        [1,1,1,0,1,1,1],
        [1,0,0,0,0,0,1],
        [1,0,0,0,0,0,1],
        [1,0,0,1,0,0,1],
        [1,0,0,0,0,0,1],
        [1,0,0,0,0,0,1],
        [1,1,1,0,1,1,1]
    ],

    // --- БУНКЕРНІ ЕЛЕМЕНТИ ---
    u_shape: [[1,1,1,1],[1,0,0,1],[1,0,0,1],[1,1,0,1]],
    maze_bit: [[1,1,1,1,1],[1,0,0,0,1],[1,0,1,0,1],[1,0,1,0,0],[1,1,1,1,1]],
    checkpoint: [[1,1,1],[1,0,1],[0,0,0],[1,0,1],[1,1,1]],
    
    // --- ДЕКОРАТИВНІ БЛОКИ ---
    dense_block: [[1,1],[1,1]],
    pillar: [[1]]
};

// === CLASSES ===
const CLASSES = {
    // --- MELEE (Ближній бій) ---
    warrior: { 
        name:"Штурмовик", icon:"⚔️", 
        hp: 180, mana: 100, stam: 100, speed: 4.5, def: 0.25, color: '#e74c3c', 
        type: 'melee', cooldown: 400, manaCost: 0, dmg: 40, w: 'sword' 
    },
    tank: { 
        name:"Джаггернаут", icon:"🛡️", 
        hp: 350, mana: 80, stam: 80, speed: 3.2, def: 0.60, color: '#27ae60', 
        type: 'melee', cooldown: 900, manaCost: 0, dmg: 70, w: 'shield' 
    },
    rogue: { 
        name:"Тінь", icon:"🗡️", 
        hp: 120, mana: 100, stam: 160, speed: 7.0, def: 0.0, color: '#34495e', 
        type: 'melee', cooldown: 250, manaCost: 5, dmg: 25, w: 'dagger' 
    },
    paladin: { 
        name:"Паладин", icon:"🔨", 
        hp: 250, mana: 150, stam: 90, speed: 3.8, def: 0.40, color: '#f1c40f', 
        type: 'melee', cooldown: 1000, manaCost: 10, dmg: 90, w: 'hammer' 
    },
    berserk: { 
        name:"Берсерк", icon:"🪓", 
        hp: 160, mana: 50, stam: 120, speed: 5.5, def: 0.10, color: '#800000', 
        type: 'melee', cooldown: 300, manaCost: 0, dmg: 35, w: 'axe' 
    },

    // --- RANGED (Дальній бій) ---
    gunner: { 
        name:"Кулеметник", icon:"💣", 
        hp: 160, mana: 120, stam: 90, speed: 4.0, def: 0.15, color: '#d35400', 
        type: 'range', cooldown: 800, manaCost: 20, dmg: 20, projSpeed: 16, w: 'minigun', mechanic: 'spread' 
    },
    sniper: { 
        name:"Снайпер", icon:"🎯", 
        hp: 100, mana: 150, stam: 100, speed: 4.2, def: 0.0, color: '#7f8c8d', 
        type: 'range', cooldown: 1500, manaCost: 40, dmg: 130, projSpeed: 45, w: 'rifle', mechanic: 'pierce' 
    },
    mage: { 
        name:"Маг", icon:"🔥", 
        hp: 110, mana: 250, stam: 80, speed: 4.5, def: 0.05, color: '#8e44ad', 
        type: 'range', cooldown: 700, manaCost: 35, dmg: 55, projSpeed: 14, w: 'staff', mechanic: 'explode' 
    },
    chemist: { 
        name:"Хімік", icon:"🧪", 
        hp: 130, mana: 200, stam: 100, speed: 4.8, def: 0.1, color: '#b8e994', 
        type: 'range', cooldown: 600, manaCost: 25, dmg: 35, projSpeed: 12, w: 'flask', mechanic: 'poison' 
    },
    ninja: { 
        name:"Ніндзя", icon:"🥷", 
        hp: 120, mana: 120, stam: 180, speed: 6.5, def: 0.0, color: '#2c3e50', 
        type: 'range', cooldown: 400, manaCost: 15, dmg: 18, projSpeed: 22, w: 'shuriken', mechanic: 'fan' 
    },
    hunter: { 
        name:"Мисливець", icon:"🏹", 
        hp: 140, mana: 100, stam: 140, speed: 5.0, def: 0.1, color: '#5f27cd', 
        type: 'range', cooldown: 500, manaCost: 10, dmg: 40, projSpeed: 25, w: 'crossbow' 
    }
};

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const miniCanvas = document.getElementById("minimap");
const miniCtx = miniCanvas.getContext("2d");

// --- STATE ---
let myId = null;
let players = {};
let obstacles = []; // Тут будуть стіни
let projectiles = [];
let selectedClass = 'warrior';
let keys = {}, mouse = {x:0, y:0};
let lastAttack = 0;

// Локальний гравець (відокремлений від мережі для плавності)
let myData = { 
    x: 0, y: 0, hp: 100, maxHp: 100, mana: 100, maxMana: 100, stam: 100, maxStam: 100,
    lvl: 1, class: 'warrior', angle: 0, name: "Player"
};

// --- MENU & UI ---
function initMenu() {
    const grid = document.getElementById('classGrid');
    grid.innerHTML = '';
    for(let k in CLASSES) {
        let c = CLASSES[k];
        let div = document.createElement('div');
        div.className = 'class-card';
        if(k==='warrior') div.classList.add('selected');
        div.innerHTML = `<div class="icon">${c.icon}</div><b>${c.name}</b>`;
        div.onclick = () => {
            document.querySelectorAll('.class-card').forEach(e=>e.classList.remove('selected'));
            div.classList.add('selected');
            selectedClass = k;
        };
        div.oncontextmenu = (e) => { e.preventDefault(); showInfo(k); };
        grid.appendChild(div);
    }
}
initMenu();

function showInfo(key) {
    const c = CLASSES[key];
    const modal = document.getElementById('infoModal');
    const cvs = document.getElementById('info-canvas');
    const ctxInfo = cvs.getContext('2d');
    
    document.getElementById('info-title').innerText = c.icon + " " + c.name;
    document.getElementById('info-desc').innerText = `HP: ${c.hp} | SPD: ${c.speed}`;
    modal.style.display = 'block';

    let ang = 0;
    const loop = setInterval(() => {
        if(modal.style.display === 'none') { clearInterval(loop); return; }
        ctxInfo.fillStyle = "#1a1a1a"; ctxInfo.fillRect(0,0,cvs.width,cvs.height);
        ctxInfo.save();
        ctxInfo.translate(cvs.width/2, cvs.height/2);
        drawPlayerModel(ctxInfo, { x:0, y:0, class:key, angle: ang, hp:c.hp, maxHp:c.hp }, true, 1.5);
        ctxInfo.restore();
        ang += 0.05;
    }, 30);
}

document.getElementById('closeInfo').onclick = () => document.getElementById('infoModal').style.display='none';
document.getElementById('playBtn').onclick = () => {
    const nick = document.getElementById('nick').value.trim();
    if(!nick) return alert("Введіть позивний!");
    
    myData.name = nick;
    myData.class = selectedClass;
    const c = CLASSES[selectedClass];
    myData.hp = myData.maxHp = c.hp;
    myData.mana = myData.maxMana = c.mana;
    myData.stam = myData.maxStam = c.stam;

    document.getElementById('startScreen').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    startGame();
};

// --- GAME LOGIC ---
function startGame() {
    signInAnonymously(auth).then(cred => {
        myId = cred.user.uid;

        // Спочатку завантажуємо карту, потім спавнимось
        onValue(ref(db, 'obstacles'), s => {
            const val = s.val();
            if(val) {
                obstacles = Object.values(val);
                // Якщо стін вже багато, просто шукаємо місце
                if(obstacles.length > 50) findSafeSpawn();
                drawMinimapStatic();
            } else {
                // Якщо карта пуста - генеруємо (Тільки перший гравець)
                generateBunkerLevel();
                setTimeout(findSafeSpawn, 1000);
            }
        });

        const pRef = ref(db, `players/${myId}`);
        set(pRef, myData);
        onDisconnect(pRef).remove();

        onValue(ref(db, 'players'), s => players = s.val() || {});
        onValue(ref(db, 'projectiles'), s => projectiles = Object.values(s.val() || {}));
        
        gameLoop();
    });
}

// === LEVEL GENERATION (BUNKER ALGORITHM) ===
function generateBunkerLevel() {
    let generatedWalls = [];
    const usedTiles = new Set(); // Щоб не накладати кімнати

    // Функція перевірки чи вільно
    const isFree = (tx, ty, w, h) => {
        for(let y=0; y<h; y++) {
            for(let x=0; x<w; x++) {
                if(usedTiles.has(`${tx+x},${ty+y}`)) return false;
            }
        }
        return true;
    };

    // 1. Ставимо ~40 структур випадковим чином, але щільно
    const keys = Object.keys(ROOM_PATTERNS);
    
    for(let i=0; i<50; i++) {
        let patKey = keys[Math.floor(Math.random()*keys.length)];
        let pattern = ROOM_PATTERNS[patKey];
        let h = pattern.length;
        let w = pattern[0].length;

        // Випадкова позиція (Grid snapped)
        let tx = Math.floor(Math.random() * (MAP_WIDTH_TILES - w));
        let ty = Math.floor(Math.random() * (MAP_WIDTH_TILES - h));

        if(isFree(tx, ty, w, h)) {
            // Записуємо в obstacles
            for(let py=0; py<h; py++) {
                for(let px=0; px<w; px++) {
                    usedTiles.add(`${tx+px},${ty+py}`); // Маркуємо простір як зайнятий структурою
                    if(pattern[py][px] === 1) {
                        // Це стіна
                        // Центруємо карту навколо 0,0
                        let worldX = (tx + px) * TILE - MAP_SIZE/2;
                        let worldY = (ty + py) * TILE - MAP_SIZE/2;
                        generatedWalls.push({ x: worldX, y: worldY, w: TILE, h: TILE });
                    }
                }
            }
        }
    }

    // Заливаємо в БД
    generatedWalls.forEach(w => push(ref(db, 'obstacles'), w));
}

function findSafeSpawn() {
    let safe = false;
    let attempts = 0;
    while(!safe && attempts < 500) {
        attempts++;
        // Спавн в межах карти
        let x = (Math.random()-0.5) * (MAP_SIZE - 200);
        let y = (Math.random()-0.5) * (MAP_SIZE - 200);
        
        if(!checkCollision(x, y, 35)) {
            myData.x = x; 
            myData.y = y; 
            safe = true;
        }
    }
    // Якщо не знайшли - в центр (ризиковано, але краще ніж нічого)
    if(!safe) { myData.x = 0; myData.y = 0; }
}

// === CONTROLS ===
window.onkeydown = e => keys[e.code] = true;
window.onkeyup = e => keys[e.code] = false;
window.onmousemove = e => { mouse.x = e.clientX; mouse.y = e.clientY; };
window.onmousedown = (e) => { if(e.button===0) keys['Mouse'] = true; };
window.onmouseup = (e) => { if(e.button===0) keys['Mouse'] = false; };
window.onresize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
window.dispatchEvent(new Event('resize'));

// === PHYSICS ===
function checkCollision(x, y, r) {
    // Оптимізація: перевіряємо лише стіни поруч (в радіусі 150px)
    for(let o of obstacles) {
        if(Math.abs(o.x - x) > 150 || Math.abs(o.y - y) > 150) continue;
        if (x+r > o.x && x-r < o.x+o.w && y+r > o.y && y-r < o.y+o.h) return true;
    }
    return false;
}

function isObstructed(x1, y1, x2, y2) {
    for(let o of obstacles) {
        // Raycast optimization
        if(Math.min(x1,x2) > o.x+o.w || Math.max(x1,x2) < o.x || Math.min(y1,y2) > o.y+o.h || Math.max(y1,y2) < o.y) continue;
        if(lineRect(x1,y1,x2,y2, o.x, o.y, o.w, o.h)) return true;
    }
    return false;
}

function lineRect(x1,y1,x2,y2,rx,ry,rw,rh) {
    return lineLine(x1,y1,x2,y2,rx,ry,rx,ry+rh) || 
           lineLine(x1,y1,x2,y2,rx+rw,ry,rx+rw,ry+rh) ||
           lineLine(x1,y1,x2,y2,rx,ry,rx+rw,ry) ||
           lineLine(x1,y1,x2,y2,rx,ry+rh,rx+rw,ry+rh);
}
function lineLine(x1,y1,x2,y2,x3,y3,x4,y4) {
    let uA = ((x4-x3)*(y1-y3) - (y4-y3)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    let uB = ((x2-x1)*(y1-y3) - (y2-y1)*(x1-x3)) / ((y4-y3)*(x2-x1) - (x4-x3)*(y2-y1));
    return (uA >= 0 && uA <= 1 && uB >= 0 && uB <= 1);
}

// === LOOP ===
function gameLoop() {
    if(myId) {
        const now = Date.now();
        const cls = CLASSES[myData.class];

        // 1. Move Logic
        let move = (keys['KeyW']||keys['KeyA']||keys['KeyS']||keys['KeyD']);
        let run = keys['ShiftLeft'] && myData.stam > 0;
        
        if(move && run) myData.stam = Math.max(0, myData.stam - 1.2);
        else myData.stam = Math.min(myData.maxStam, myData.stam + 0.5);
        
        myData.mana = Math.min(myData.maxMana, myData.mana + 0.2);

        let spd = cls.speed * (run ? 1.4 : 1);
        let dx=0, dy=0;
        if(keys['KeyW']) dy-=spd; if(keys['KeyS']) dy+=spd;
        if(keys['KeyA']) dx-=spd; if(keys['KeyD']) dx+=spd;
        if(dx && dy) { dx *= 0.71; dy *= 0.71; }

        // Local collision check
        if((dx||dy) && !checkCollision(myData.x+dx, myData.y, 20)) myData.x+=dx;
        if((dx||dy) && !checkCollision(myData.x, myData.y+dy, 20)) myData.y+=dy;
        
        myData.angle = Math.atan2(mouse.y - canvas.height/2, mouse.x - canvas.width/2);

        // 2. Attack Logic (Updated)
        if((keys['Mouse']||keys['KeyF']) && now-lastAttack > cls.cooldown && myData.mana >= cls.manaCost) {
            lastAttack = now;
            myData.mana -= cls.manaCost;
            
            // Melee Attack
            if(cls.type === 'melee') {
                Object.keys(players).forEach(k => {
                    if(k===myId) return;
                    let p = players[k];
                    // Радіус атаки залежить від зброї (молот і щит б'ють далі)
                    let range = (cls.w === 'hammer' || cls.w === 'shield') ? 160 : 130; 
                    
                    if(Math.hypot(p.x-myData.x, p.y-myData.y) < range && !isObstructed(myData.x, myData.y, p.x, p.y)) {
                         let ang = Math.atan2(p.y-myData.y, p.x-myData.x);
                         if(Math.abs(ang-myData.angle)<1.2) {
                            update(ref(db,`players/${k}/hit`), {d:cls.dmg, t:now});
                            // Тут можна додати відкидання (pushback) в майбутньому
                         }
                    }
                });
            } else {
                // Ranged Attack (Mechanics)
                const baseProj = {
                    o: myId, sx: myData.x, sy: myData.y,
                    d: cls.dmg, t: now, c: myData.class
                };

                if(cls.mechanic === 'spread') {
                    // Gunner: 3 bullets narrow spread
                    [-0.15, 0, 0.15].forEach(offset => {
                        let a = myData.angle + offset;
                        push(ref(db, 'projectiles'), { ...baseProj, vx: Math.cos(a)*cls.projSpeed, vy: Math.sin(a)*cls.projSpeed });
                    });
                } 
                else if(cls.mechanic === 'fan') {
                    // Ninja: 3 shurikens wide spread
                    [-0.3, 0, 0.3].forEach(offset => {
                        let a = myData.angle + offset;
                        push(ref(db, 'projectiles'), { ...baseProj, vx: Math.cos(a)*cls.projSpeed, vy: Math.sin(a)*cls.projSpeed });
                    });
                }
                else {
                    // Normal / Sniper / Mage / Chemist
                    push(ref(db, 'projectiles'), { 
                        ...baseProj, 
                        vx: Math.cos(myData.angle)*cls.projSpeed, 
                        vy: Math.sin(myData.angle)*cls.projSpeed,
                        special: cls.mechanic // 'pierce', 'explode', 'poison'
                    });
                }
            }
        }

        // 3. Receive Hits & Effects
        onValue(ref(db, `players/${myId}/hit`), s => {
            let h = s.val();
            if(h && h.t > now-2000) {
                let dmg = h.d || 0;
                let effect = h.effect || null;
                let sourceClass = h.sourceClass || null;
                // --- Класова унікальність ---
                if (cls.class === 'tank' && Math.random()<0.25) dmg = 0; // 25% шанс повного блокування
                if (cls.class === 'paladin' && Math.random()<0.15) { myData.hp = Math.min(myData.maxHp, myData.hp+30); } // 15% шанс зцілення
                if (cls.class === 'berserk' && dmg>0) { myData.stam = Math.min(myData.maxStam, myData.stam+10); } // Берсерк отримує адреналін
                if (effect === 'poison') {
                    myData.hp -= dmg * 0.5;
                    myData.status = 'poisoned';
                } else if (effect === 'explode') {
                    myData.hp -= dmg * 1.2;
                    myData.status = 'burn';
                } else if (effect === 'pierce') {
                    myData.hp -= dmg * 0.8;
                } else {
                    myData.hp -= dmg * (1-cls.def);
                }
                // Візуальний ефект (можна додати сплеск, shake, etc)
                myData.lastHit = now;
                remove(ref(db, `players/${myId}/hit`));
            }
        }, {onlyOnce:true});
        if(myData.hp <= 0) {
            myData.hp = myData.maxHp;
            myData.status = null;
            findSafeSpawn();
        }

        // 4. Sync
        update(ref(db, `players/${myId}`), {
            x: myData.x, y: myData.y, hp: myData.hp, maxHp: myData.maxHp,
            angle: myData.angle, name: myData.name, class: myData.class
        });

        updateUI();
        drawMinimapLive();
    }
    draw();
    requestAnimationFrame(gameLoop);
}

function updateUI() {
    document.getElementById('bar-hp').style.width = (myData.hp/myData.maxHp)*100 + "%";
    document.getElementById('txt-hp').innerText = Math.ceil(myData.hp);
    document.getElementById('bar-mana').style.width = (myData.mana/myData.maxMana)*100 + "%";
    document.getElementById('bar-stam').style.width = (myData.stam/myData.maxStam)*100 + "%";
}

// === DRAWING (FIXED SYNC) ===
function draw() {
    // 1. Clear & Background
    ctx.fillStyle = "#050505"; // Темний фон (пустота)
    ctx.fillRect(0,0,canvas.width,canvas.height);

    if(!myId) return;

    // ВАЖЛИВО: Камера фокусується на myData (локальних координатах), 
    // щоб не було розсинхрону між мишкою, гравцем і екраном.
    const cx = canvas.width/2 - myData.x;
    const cy = canvas.height/2 - myData.y;
    
    ctx.save(); 
    ctx.translate(cx, cy); // Зсуваємо світ

    // 2. Draw Floor (Тільки всередині бункера)
    // Малюємо великий прямокутник підлоги, або краще - під кожною стіною
    // Але для простоти малюємо сітку в межах карти
    ctx.strokeStyle="#151515"; ctx.lineWidth=1; ctx.beginPath();
    let sx = Math.floor((myData.x-canvas.width/2)/TILE)*TILE;
    let ex = sx + canvas.width + TILE;
    let sy = Math.floor((myData.y-canvas.height/2)/TILE)*TILE;
    let ey = sy + canvas.height + TILE;
    for(let x=sx; x<ex; x+=TILE) { ctx.moveTo(x,sy); ctx.lineTo(x,ey); }
    for(let y=sy; y<ey; y+=TILE) { ctx.moveTo(sx,y); ctx.lineTo(ex,y); }
    ctx.stroke();

    // 3. Walls (Bunker Style)
    ctx.fillStyle = "#34495e"; 
    ctx.strokeStyle = "#1a252f"; 
    ctx.lineWidth=2;

    obstacles.forEach(o => {
        // Cull (не малюємо те, що за екраном)
        if(Math.abs(o.x - myData.x) > canvas.width/2 + 100) return;
        if(Math.abs(o.y - myData.y) > canvas.height/2 + 100) return;

        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        // "Дах" стін (ефект 3D)
        ctx.fillStyle = "#2c3e50";
        ctx.fillRect(o.x+4, o.y+4, o.w-8, o.h-8);
        ctx.fillStyle = "#34495e";
    });

    // 4. Projectiles
    projectiles.forEach(p => {
        let age = (Date.now()-p.t)/1000;
        let px = p.sx + p.vx*age*60;
        let py = p.sy + p.vy*age*60;
        if(checkCollision(px,py,5)) return;

        if(p.o === myId || !isObstructed(myData.x, myData.y, px, py)) {
            ctx.fillStyle = CLASSES[p.c]?.color || "#fff";
            ctx.beginPath(); ctx.arc(px,py,5,0,7); ctx.fill();
        }
    });

    // 5. Draw Enemies (Server Data)
    Object.keys(players).forEach(pid => {
        if(pid === myId) return; // Себе малюємо окремо!
        let p = players[pid];
        if(!p) return;
        if(isObstructed(myData.x, myData.y, p.x, p.y)) return; // Туман війни
        drawPlayerModel(ctx, p, false);
    });

    // 6. Draw SELF (Local Data) -> ВИРІШУЄ ПРОБЛЕМУ "ВІДСТАВАННЯ"
    drawPlayerModel(ctx, myData, true);


    ctx.restore(); // Повертаємо координати для UI
}

function drawPlayerModel(ctx, p, isMe, scale=1) {
    let cl = CLASSES[p.class || 'warrior'];
    ctx.save(); 

    // Always translate to player position (when drawing in-world the canvas is already camera-translated).
    // For preview (showInfo) the caller has translated to center and passes p.x=0,p.y=0.
    ctx.translate(p.x || 0, p.y || 0);

    // Apply scaling for previews
    if(scale !== 1) ctx.scale(scale, scale);

    if(scale === 1) {
        // Name & HP
        ctx.fillStyle="white"; ctx.font="10px Arial"; ctx.textAlign="center"; 
        ctx.fillText(p.name, 0, -45);
        ctx.fillStyle="#444"; ctx.fillRect(-20,-38,40,4);
        ctx.fillStyle= isMe ? "#0f0" : "#f00"; ctx.fillRect(-20,-38,40*(p.hp/p.maxHp),4);
    }
    
    ctx.rotate(p.angle);
    
    // Body
    ctx.fillStyle = cl.color;
    ctx.beginPath(); ctx.arc(0, 0, 20, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "#000"; ctx.lineWidth=2; ctx.stroke();
    
    // Hands
    ctx.fillStyle = cl.color;
    ctx.beginPath(); ctx.arc(15, 15, 8, 0, 7); ctx.fill(); ctx.stroke(); // R Hand
    ctx.beginPath(); ctx.arc(15, -15, 8, 0, 7); ctx.fill(); ctx.stroke(); // L Hand
    
    // Weapon Visuals
    ctx.fillStyle = "#333";
    const w = cl.w;

    if(w === 'sword') { 
        ctx.fillStyle="#ccc"; ctx.fillRect(10,-4,45,8); // Лезо
        ctx.fillStyle="#444"; ctx.fillRect(10,-8,4,16); // Гарда
    }
    else if(w === 'hammer') {
        ctx.fillStyle="#5d4037"; ctx.fillRect(10,-3,40,6); // Ручка
        ctx.fillStyle="#7f8c8d"; ctx.fillRect(45,-15,20,30); // Бойок
    }
    else if(w === 'axe') {
        ctx.fillStyle="#5d4037"; ctx.fillRect(10,-3,40,6); // Ручка
        ctx.fillStyle="#c0392b"; ctx.beginPath(); ctx.moveTo(40,-3); ctx.lineTo(55,-20); ctx.lineTo(55,20); ctx.fill(); // Лезо
    }
    else if(w === 'shield') {
        ctx.fillStyle="#2c3e50"; ctx.fillRect(10,-20,12,40); 
        ctx.strokeStyle="#f1c40f"; ctx.lineWidth=2; ctx.strokeRect(10,-20,12,40);
    }
    else if(w === 'dagger') {
        ctx.fillStyle="#bdc3c7"; ctx.beginPath(); ctx.moveTo(15,-4); ctx.lineTo(35,0); ctx.lineTo(15,4); ctx.fill();
    }
    else if(w === 'rifle') { 
        ctx.fillStyle="#111"; ctx.fillRect(10,-3,65,6); 
    }
    else if(w === 'minigun') { 
        ctx.fillStyle="#333"; ctx.fillRect(15,-10,35,20); 
        ctx.fillStyle="#000"; ctx.beginPath(); ctx.arc(50,0,5,0,7); ctx.fill();
    }
    else if(w === 'staff') { 
        ctx.fillStyle="#6d4c41"; ctx.fillRect(15,-3,55,6);
        ctx.fillStyle=cl.color; ctx.beginPath(); ctx.arc(70,0,5,0,7); ctx.fill();
    }
    else if(w === 'flask') {
        ctx.fillStyle="rgba(255,255,255,0.3)"; ctx.beginPath(); ctx.arc(25,0,8,0,7); ctx.fill(); ctx.stroke();
        ctx.fillStyle="#b8e994"; ctx.beginPath(); ctx.arc(25,0,6,0,7); ctx.fill(); // Poison inside
    }
    else if(w === 'crossbow') {
        ctx.fillStyle="#5d4037"; ctx.fillRect(10,-2,30,4);
        ctx.strokeStyle="#aaa"; ctx.beginPath(); ctx.moveTo(30,-15); ctx.lineTo(30,15); ctx.stroke();
    }
    else if(w === 'shuriken') {
         // Ніндзя не тримає зброю постійно, вона з'являється при атаці, або просто пусті руки
    }

    ctx.restore();
}

// --- SHADOWS & FOG (visibility-based, soft edges) ---
function raySegmentIntersect(rx, ry, rdx, rdy, x1, y1, x2, y2) {
    // Ray: R(t) = (rx,ry) + t*(rdx,rdy), t >= 0
    // Segment: S(u) = (x1,y1) + u*(x2-x1,y2-y1), u in [0,1]
    const sdx = x2 - x1, sdy = y2 - y1;
    const denom = rdx * sdy - rdy * sdx;
    if (Math.abs(denom) < 1e-6) return null;
    const t = ((x1 - rx) * sdy - (y1 - ry) * sdx) / denom;
    const u = ((x1 - rx) * rdy - (y1 - ry) * rdx) / denom;
    if (t >= 0 && u >= 0 && u <= 1) return { x: rx + rdx * t, y: ry + rdy * t, t };
    return null;
}

function getVisibilityPolygon(px, py, radius = 900) {
    const eps = 0.0003; // tiny angle offset to avoid grazing problems
    const pts = [];

    // bounding box to cap rays
    const half = MAP_SIZE * 0.75; // much larger than map to be safe
    const bbox = [
        {x: -half, y: -half}, {x: half, y: -half}, {x: half, y: half}, {x: -half, y: half}
    ];

    // Collect candidate vertices (corners of nearby obstacles + bbox corners)
    const candidates = [];
    obstacles.forEach(o => {
        const dist = Math.hypot(o.x + o.w/2 - px, o.y + o.h/2 - py);
        if (dist > radius + 300) return; // skip far obstacles
        candidates.push({x: o.x, y: o.y});
        candidates.push({x: o.x + o.w, y: o.y});
        candidates.push({x: o.x + o.w, y: o.y + o.h});
        candidates.push({x: o.x, y: o.y + o.h});
    });
    bbox.forEach(c => candidates.push(c));

    const edges = [];
    // build segment list
    obstacles.forEach(o => {
        const x = o.x, y = o.y, w = o.w, h = o.h;
        edges.push([x,y,x+w,y]); // top
        edges.push([x+w,y,x+w,y+h]); // right
        edges.push([x+w,y+h,x,y+h]); // bottom
        edges.push([x,y+h,x,y]); // left
    });
    // bbox edges
    edges.push([bbox[0].x,bbox[0].y,bbox[1].x,bbox[1].y]);
    edges.push([bbox[1].x,bbox[1].y,bbox[2].x,bbox[2].y]);
    edges.push([bbox[2].x,bbox[2].y,bbox[3].x,bbox[3].y]);
    edges.push([bbox[3].x,bbox[3].y,bbox[0].x,bbox[0].y]);

    function castAngle(angle) {
        const rdx = Math.cos(angle), rdy = Math.sin(angle);
        let nearest = null;
        // check each edge for intersection
        for (let e of edges) {
            const ip = raySegmentIntersect(px, py, rdx, rdy, e[0], e[1], e[2], e[3]);
            if (!ip) continue;
            if (ip.t > radius) continue;
            if (!nearest || ip.t < nearest.t) nearest = ip;
        }
        if (nearest) return {x: nearest.x, y: nearest.y, a: angle};
        return {x: px + rdx * radius, y: py + rdy * radius, a: angle};
    }

    const usedAngles = new Set();
    candidates.forEach(c => {
        const ang = Math.atan2(c.y - py, c.x - px);
        [-eps, 0, eps].forEach(off => {
            const a = ang + off;
            // avoid duplicates
            const key = Math.round(a*10000);
            if (usedAngles.has(key)) return;
            usedAngles.add(key);
            pts.push(castAngle(a));
        });
    });

    // also sample some extra angles to fill gaps (optional)
    for (let i=0;i<32;i++) {
        const a = (i/32)*Math.PI*2;
        const key = Math.round(a*10000);
        if (usedAngles.has(key)) continue;
        usedAngles.add(key);
        pts.push(castAngle(a));
    }

    // sort by angle
    pts.sort((p1,p2) => p1.a - p2.a);
    // remove duplicates (very close points)
    const out = [];
    for (let p of pts) {
        if (!out.length) out.push(p);
        else {
            const last = out[out.length-1];
            if (Math.hypot(last.x - p.x, last.y - p.y) > 1) out.push(p);
        }
    }
    return out;
}




// === MINIMAP ===
let minimapStaticDrawn = false;
const mapCache = document.createElement('canvas');
mapCache.width = 300; mapCache.height = 300;
const mapCtx = mapCache.getContext('2d');

function drawMinimapStatic() {
    mapCtx.fillStyle = "#000"; mapCtx.fillRect(0,0,300,300);
    const scale = 300 / MAP_SIZE;
    
    mapCtx.fillStyle = "#555";
    obstacles.forEach(o => {
        // Перетворення світових координат у мінікарту (0..300)
        let mx = (o.x + MAP_SIZE/2) * scale;
        let my = (o.y + MAP_SIZE/2) * scale;
        mapCtx.fillRect(mx, my, o.w*scale, o.h*scale);
    });
    minimapStaticDrawn = true;
}

function drawMinimapLive() {
    if(!minimapStaticDrawn) return;
    miniCtx.drawImage(mapCache, 0, 0);

    const scale = 300 / MAP_SIZE;
    miniCtx.fillStyle = "#0f0";
    miniCtx.beginPath();
    miniCtx.arc((myData.x + MAP_SIZE/2)*scale, (myData.y + MAP_SIZE/2)*scale, 3, 0, 7);
    miniCtx.fill();
}